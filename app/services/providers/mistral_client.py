"""Mistral AI chat provider — implements ChatProvider ABC.

Uses the mistralai SDK for chat completions and SSE streaming.
Activated when CHAT_PROVIDER=mistral.
"""
import asyncio
import logging
import os
from typing import Optional, Dict, Any, AsyncIterator, List

from mistralai.client import Mistral

from app import config as app_config
from app.services.providers import ChatProvider
from app.services.providers._cache import (
    CacheBackend,
    create_provider_cache,
    make_cache_key,
    cache_get,
    cache_set,
    cache_delete,
)

logger = logging.getLogger(__name__)

# Model mapping per D-06
MISTRAL_MODEL_SMALL = "mistral-small-latest"
MISTRAL_MODEL_MEDIUM = "mistral-medium-latest"
MISTRAL_MODEL_LARGE = "mistral-large-latest"
DEFAULT_MISTRAL_MODEL = MISTRAL_MODEL_SMALL

_MISTRAL_CACHE = create_provider_cache(
    prefix="mistral",
    max_entries=int(app_config.MISTRAL_CACHE_MAXSIZE),
    ttl_seconds=int(app_config.MISTRAL_CACHE_TTL),
    redis_url=(app_config.get_env_setting("REDIS_URL") or "").strip() or None,
    cache_backend_type=(app_config.get_env_setting("PERPLEXITY_CACHE_BACKEND") or "local").strip().lower(),
)


def _format_mistral_error(exc: Exception) -> str:
    """Parse Mistral SDK errors into user-friendly German messages."""
    msg = str(exc)
    try:
        import json
        if "Body:" in msg:
            body = msg.split("Body:", 1)[1].strip()
            data = json.loads(body)
            error_msg = data.get("message", "")
            error_code = data.get("code", "")
            if error_code == "3505":
                return (
                    "Der Mistral AI-Dienst ist derzeit ausgelastet (Tarif-Limit erreicht). "
                    "Bitte versuchen Sie es in einigen Sekunden erneut oder wechseln Sie zurück zu Perplexity."
                )
            return error_msg or msg
    except Exception:
        pass
    if "429" in msg:
        return (
            "Der KI-Dienst ist derzeit ausgelastet. "
            "Bitte versuchen Sie es in einem Moment erneut."
        )
    if "401" in msg or "403" in msg:
        return "MISTRAL_API_KEY ist ungültig oder fehlt. Bitte überprüfen Sie die .env-Konfiguration."
    if "timeout" in msg.lower():
        return "Die Anfrage an Mistral AI hat zu lange gedauert. Bitte versuchen Sie es erneut."
    return f"Mistral AI-Fehler: {msg[:200]}"


class MistralClient(ChatProvider):
    """Mistral AI chat completion provider.

    Activated when CHAT_PROVIDER=mistral env var is set.
    Implements the ChatProvider ABC — routers never import this class directly.
    """

    def __init__(self, api_key: Optional[str] = None, role_type: str = "Laie"):
        self.role_type = role_type or "Laie"
        self.api_key = api_key or app_config.MISTRAL_API_KEY

        # Resolve model from role type (D-06)
        if self.role_type == "Experte":
            self._model = MISTRAL_MODEL_LARGE
        elif self.role_type == "Fortgeschritten":
            self._model = MISTRAL_MODEL_MEDIUM  
        else:
            self._model = MISTRAL_MODEL_SMALL

        # Token budget — Mistral tends to produce shorter output than Perplexity
        if self.role_type == "Fortgeschritten":
            self._max_tokens = 12288
        elif self.role_type == "Experte":
            self._max_tokens = 16384
        else:
            self._max_tokens = 8192

        # PerplexityClient compat attributes (used in interpretations.py)
        self.timeout = 120

        # Initialize system prompts (reuse PerplexityClient's prompt structure)
        self.system_prompt = {}
        self._init_system_prompts()

        # Public tokens attr — PerplexityClient compat (used in interpretations.py)
        self.tokens = self._max_tokens

        # Share module-level cache across all instances (like PerplexityClient)
        self._cache = _MISTRAL_CACHE

        # Lazy SDK client — created on first request
        self._sdk_client = None

        if not self.api_key:
            logger.warning("MISTRAL_API_KEY not set. Mistral requests will fail.")

    def _get_sdk_client(self) -> Mistral:
        """Lazily create the Mistral SDK client."""
        if self._sdk_client is None:
            if not self.api_key:
                raise ValueError("MISTRAL_API_KEY is required")
            self._sdk_client = Mistral(api_key=self.api_key)
        return self._sdk_client

    # ---------------------------------------------------------------------------
    # System prompts (structure copied from PerplexityClient)
    # ---------------------------------------------------------------------------
    def get_system_prompt_role_values(self) -> tuple:
        """Return role-specific prompt prefix and general interpretation rules.

        The prompts are provider-agnostic — astrology interpretation rules
        that work for any LLM through the ChatProvider ABC.
        """
        role_type = self.role_type
        nur_woertlich = (
            "Du bist Huber-Astrologie-Experte. Analysiere die folgenden Horoskopdaten nach Huber-Prinzipien.\n"
            "Die Horoskopdaten wurden von einer auf Huber-Astrologie spezialisierten Software erstellt.\n"
        )

        allgemeine_deutung = (
            "Schreibe ausschließlich auf Deutsch. Alle Begriffe (Planeten, Zeichen, Aspekte) auf Deutsch.\n"
            "Halte dich strikt an diese Struktur. Keine Einleitungen, keine Meta-Kommentare.\n"
            "Schreibe für Node immer Mondknoten\n"
            "Alle Planeten, Sternzeichen und Aspekte immer auf deutsch\n"
        )

        if not role_type or role_type == "Laie":
            nur_woertlich += (
                "\nBerücksichtige bei der Interpretation und Darstellung, dass der Nutzer ein Laie ist "
                "und erkläre die astrologischen Prinzipien und Fachbegriffe verständlich und anschaulich."
            )
        elif role_type == "Fortgeschritten":
            nur_woertlich += (
                "\nBerücksichtige bei der Interpretation und Darstellung, dass der Nutzer fortgeschrittene "
                "astrologische Kenntnisse hat und erkläre die Deutungen mit angemessener Tiefe und Fachsprache."
            )
        elif role_type == "Experte":
            nur_woertlich += (
                "\nBerücksichtige bei der Interpretation und Darstellung, dass der Nutzer ein Experte ist "
                "und liefere eine tiefgründige, fachlich anspruchsvolle Analyse mit Fokus auf psychologische "
                "Dynamiken und Entwicklungspotentiale."
            )
        return nur_woertlich, allgemeine_deutung

    def _init_system_prompts(self) -> None:
        """Initialize all 8 system prompt types in self.system_prompt dict."""
        nur_woertlich, allgemeine_deutung = self.get_system_prompt_role_values()
        role_type = self.role_type
        text_type = "ausführlich" if role_type in {"Fortgeschritten", "Experte"} else "kurz"
        token_count = "(je 50 - 75 tokens)" if text_type == "kurz" else "(je 75 - 100 tokens)"

        if role_type == "Laie":
            HOROSCOPE_SYSTEM_PROMPT = (
                f"{nur_woertlich}\n"
                "Schreibe am Anfang die Überschrift: Horoskop Interpretation - [Datum]\n"
                "Überschrift 2: Sternzeichen und Aszendent danach kurze Erläuterung zum Sternzeichen und zum Aszendenten.\n"
                "Zeige am Anfang die wichtigsten Erkenntnisse an. Liste danach in dieser Reihenfolge:"
                "1. Häuserspitzen, als Bullet Liste mit Bedeutung (je 50-75 Tokens).\n"
                "2. Planeten, als Bullet Liste mit Bedeutung (je 50-75 Tokens).\n"
                "3. Aspekte, als Bullet Liste mit Bedeutung (je 50-75 Tokens).\n"
                "Füge am Ende eine Zusammenfassung mit psychologischer Gesamtschau an.\n"
                f"{allgemeine_deutung}\n"
            )
        else:
            HOROSCOPE_SYSTEM_PROMPT = (
                f"{nur_woertlich}\n"
                "Schreibe am Anfang die Überschrift: Horoskop Interpretation - [Datum]\n"
                "Überschrift 2: Sternzeichen und Aszendent danach kurze Erläuterung zum Sternzeichen und zum Aszendenten.\n"
                "Zeige am Anfang die wichtigsten Erkenntnisse an. Liste danach in dieser Reihenfolge:"
                "1. Häuserspitzen, als Bullet Liste mit Bedeutung ausführlich (je 75-100 Tokens).\n"
                "2. Planeten, als Bullet Liste mit Bedeutung ausführlich (je 75-100 Tokens).\n"
                "3. Aspekte, als Bullet Liste mit Bedeutung ausführlich (je 75-100 Tokens).\n"
                "Füge am Ende eine Zusammenfassung / psychologische Gesamtschau an.\n"
                f"{allgemeine_deutung}\n"
            )

        NODE_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Mondknoten Interpretation - [Datum]\n"
            f"Schreibe danach eine detailierte Erläuterung zu den Mondknoten als Bullet Liste {text_type} {token_count}\n"
            "Füge am Ende eine Zusammenfassung der Mondknotenpositionen an.\n"
            f"{allgemeine_deutung}\n"
        )
        HOUSES_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Häuser Interpretation - [Datum]\n"
            f"Schreibe danach eine detailierte Erläuterung zu den Häusern als Bullet Liste {text_type} {token_count}\n"
            "Füge am Ende eine Zusammenfassung der Häuserpositionen an.\n"
            f"{allgemeine_deutung}\n"
        )
        TRANSITS_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Transit Interpretation - [Datum]\n"
            f"Schreibe danach die wichtigsten Transit-Aspekte als Bullet Liste {text_type} {token_count} auf "
            "und erläutere danach deren psychologische Bedeutung.\n"
            "Füge am Ende eine kurze Zusammenfassung der aktuellen Entwicklungsdynamik an.\n"
            f"{allgemeine_deutung}\n"
        )
        SOLAR_RETURN_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Solar Jahr Interpretation - [Datum]\n"
            f"Liste zuerst die wichtigsten Themen des Solar Jahrs auf und erläutere danach Planeten, Häuser "
            f"und markante Aspekte als Bullet Liste {text_type} {token_count}.\n"
            f"Füge am Ende eine kurze psychologische Gesamtschau für das Solar-Return-Jahr an.\n"
            f"{allgemeine_deutung}\n"
        )
        AGE_POINTS_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Alterspunkt Interpretation - [Datum]\n"
            f"Erläutere zuerst das Hauptthema des ausgewählten Alterspunkts, beziehe dann die relevanten "
            f"Transite als Bullet Liste {text_type} {token_count} ein\n"
            f"Schließe die Interpretation mit einer {text_type}en {token_count} psychologischen Gesamtschau "
            f"bezüglich Alterspunkt und gleichzeitige Transite ab.\n"
            f"{allgemeine_deutung}\n"
        )
        ENTRY_GENERATION_SYSTEM_PROMPT = (
            "Du bist ein erfahrener Astrologie-Redakteur, spezialisiert auf die Erstellung von astrologischen "
            "Inhalten für eine deutschsprachige Wiki-Huber-Astrologie Seite.\n"
            "Deine Aufgabe ist es, basierend auf Titel, Bereich, Kategorie und vorhandenen Texten, einen "
            "vollständigen, gut strukturierten und fachlich fundierten Beitrag zu erstellen oder zu verbessern.\n"
            "Verwende immer Listen mit Bullet Points, um die Informationen klar und übersichtlich zu präsentieren.\n"
            "Halte dich strikt an diese Struktur. Keine Meta-Kommentare. Keine Quellenangaben.\n"
        )
        SYNASTRY_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Partnerhoroskop Interpretation\n"
            f"Schreibe danach eine detailierte Erläuterung der Beziehungsaspekte als Bullet Liste "
            f"{text_type} {token_count}\n"
            "Beschreibe sowohl die harmonischen als auch die herausfordernden Aspekte der Beziehung.\n"
            "Gehe auf die Häuserüberlagerungen ein: Welche Lebensbereiche der Partner werden durch die "
            "Planeten des anderen aktiviert?\n"
            f"Füge am Ende eine psychologische Gesamtschau der Partnerschaftsdynamik aus Sicht der "
            f"Huber-Astrologie an.\n"
            f"{allgemeine_deutung}\n"
        )

        self.system_prompt["horoskop"] = HOROSCOPE_SYSTEM_PROMPT
        self.system_prompt["mondknoten"] = NODE_SYSTEM_PROMPT
        self.system_prompt["houses"] = HOUSES_SYSTEM_PROMPT
        self.system_prompt["transits"] = TRANSITS_SYSTEM_PROMPT
        self.system_prompt["solar_return"] = SOLAR_RETURN_SYSTEM_PROMPT
        self.system_prompt["age_points"] = AGE_POINTS_SYSTEM_PROMPT
        self.system_prompt["entry"] = ENTRY_GENERATION_SYSTEM_PROMPT
        self.system_prompt["synastrie"] = SYNASTRY_SYSTEM_PROMPT

    def system_prompt_for_type(self, type_of_prompt: str) -> str:
        """Return the full system prompt text for a given prompt type key."""
        if type_of_prompt not in self.system_prompt:
            raise ValueError(f"Unknown prompt type: {type_of_prompt}")
        return self.system_prompt[type_of_prompt]

    # ---------------------------------------------------------------------------
    # ChatProvider ABC method implementations
    # ---------------------------------------------------------------------------
    @property
    def model_name(self) -> str:
        return self._model

    def resolve_system_prompt(self, prompt_key_or_text: Optional[str]) -> Optional[str]:
        """Resolve a system prompt key (e.g. 'horoskop') to full prompt
        text, or pass through raw text unchanged.
        """
        if prompt_key_or_text is None:
            return None
        if prompt_key_or_text in self.system_prompt:
            return self.system_prompt[prompt_key_or_text]
        return prompt_key_or_text

    def get_cached(self, summary: str, system_prompt: Optional[str] = None) -> Optional[str]:
        if app_config.DISABLE_AI:
            return None
        resolved = self.resolve_system_prompt(system_prompt)
        key = make_cache_key(summary, resolved, self._model)
        return cache_get(self._cache, key)

    def cache_result(self, summary: str, system_prompt: Optional[str], text: str) -> None:
        resolved = self.resolve_system_prompt(system_prompt)
        key = make_cache_key(summary, resolved, self._model)
        cache_set(self._cache, key, text)

    def chat_completion(self, summary: str, system_prompt: Optional[str] = None) -> str:
        if app_config.DISABLE_AI:
            return (
                "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n"
                "*(DISABLE_AI ist gesetzt — keine Mistral-Anfragen werden gesendet.)*\n\n---\n\n"
            )
        resolved = self.resolve_system_prompt(system_prompt)
        if resolved is None:
            resolved = self.system_prompt_for_type("horoskop")
        messages = self._build_messages(summary=summary, system_prompt=resolved)
        return self._complete_with_retry(messages)

    def _complete_with_retry(self, messages: List[Dict[str, str]], max_retries: int = 3) -> str:
        client = self._get_sdk_client()
        last_error = None
        for attempt in range(max_retries):
            try:
                res = client.chat.complete(
                    model=self._model,
                    messages=messages,
                    max_tokens=self._max_tokens
                )
                return res.choices[0].message.content
            except Exception as e:
                last_error = e
                error_str = str(e).lower()
                if "429" in error_str or "capacity" in error_str or "rate" in error_str:
                    if attempt < max_retries - 1:
                        delay = 2 ** attempt
                        logger.warning("Mistral rate limited, retrying in %ds (attempt %d/%d)", delay, attempt + 2, max_retries)
                        import time
                        time.sleep(delay)
                        continue
                raise
        raise last_error

    async def stream_completion(self, summary: str, system_prompt: Optional[str] = None) -> AsyncIterator[str]:
        if app_config.DISABLE_AI:
            yield (
                "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n"
                "*(DISABLE_AI ist gesetzt — keine Mistral-Anfragen werden gesendet.)*\n\n---\n\n"
            )
            return
        resolved = self.resolve_system_prompt(system_prompt)
        if resolved is None:
            resolved = self.system_prompt_for_type("horoskop")

        # Check cache first
        try:
            cached = self.get_cached(summary, resolved)
            if cached is not None:
                yield cached
                return
        except Exception as e:
            logger.debug("Mistral cache miss: %s", e)

        messages = self._build_messages(summary=summary, system_prompt=resolved)
        client = self._get_sdk_client()

        for attempt in range(3):
            try:
                stream = await client.chat.stream_async(
                    model=self._model,
                    messages=messages,
                    max_tokens=self._max_tokens,
                )
                async for chunk in stream:
                    delta = chunk.data.choices[0].delta.content
                    if delta:
                        yield delta
                return
            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "capacity" in error_str or "rate" in error_str:
                    if attempt < 2:
                        delay = 2 ** attempt
                        logger.warning("Mistral rate limited, retrying in %ds (attempt %d/3)", delay, attempt + 2)
                        await asyncio.sleep(delay)
                        continue
                logger.exception("Mistral stream error")
                # Build a clean user-facing error
                error_msg = _format_mistral_error(e)
                yield f"\n\n---\n\n**Fehler:** {error_msg}\n\n---\n\n"
                return

    async def stream_messages(self, messages: List[Dict[str, str]]) -> AsyncIterator[str]:
        """ABC-compliant: stream completion from a pre-built message list.

        Used by interpretations.py followup endpoint for conversation history.
        """
        if app_config.DISABLE_AI:
            yield (
                "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n"
                "*(DISABLE_AI ist gesetzt — keine Mistral-Anfragen werden gesendet.)*\n\n---\n\n"
            )
            return

        client = self._get_sdk_client()
        for attempt in range(3):
            try:
                stream = await client.chat.stream_async(
                    model=self._model,
                    messages=messages,
                    max_tokens=self._max_tokens,
                )
                async for chunk in stream:
                    delta = chunk.data.choices[0].delta.content
                    if delta:
                        yield delta
                return
            except Exception as e:
                error_str = str(e).lower()
                if "429" in error_str or "capacity" in error_str or "rate" in error_str:
                    if attempt < 2:
                        delay = 2 ** attempt
                        logger.warning("Mistral rate limited, retrying in %ds (attempt %d/3)", delay, attempt + 2)
                        await asyncio.sleep(delay)
                        continue
                logger.exception("Mistral stream_messages error")
                error_msg = _format_mistral_error(e)
                yield f"\n\n---\n\n**Fehler:** {error_msg}\n\n---\n\n"
                return

    def _build_messages(self, summary: str, system_prompt: Optional[str] = None) -> List[Dict[str, str]]:
        if not summary:
            raise ValueError("summary must not be empty")
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": summary})
        return messages
