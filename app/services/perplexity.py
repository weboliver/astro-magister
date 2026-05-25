"""Perplexity API client service.

Sendet Summaries an die Perplexity Chat Completions API.
Der API Key wird aus der .env-Datei per `API_KEY` gelesen.

Endpoint: POST https://api.perplexity.ai/chat/completions
Auth:     Authorization: Bearer <API_KEY>
"""
import asyncio
from typing import Optional, Dict, Any, AsyncIterator, List
import json
import logging
import hashlib
import re
from collections import OrderedDict
from importlib import import_module
from threading import RLock
from time import monotonic

import httpx

from app import config as app_config

# ABC compliance (Phase 21)
from app.services.providers import ChatProvider
from app.services.providers._cache import (
    CacheBackend, LocalCacheBackend,
    make_cache_key, cache_get, cache_set, cache_delete,
    create_provider_cache,
    get_cache_overview as _shared_get_cache_overview,
    delete_cache_entry as _shared_delete_cache_entry,
    clear_cache as _shared_clear_cache,
    _suffix_prefix_overlap as _suffix_prefix_overlap,
)

logger = logging.getLogger(__name__)


PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
# Verfügbare Modelle: sonar | sonar-pro | sonar-reasoning-pro | sonar-deep-research
DEFAULT_MODEL_PRO = "sonar-pro"
DEFAULT_MODEL_DEEP_PRO = "sonar-pro"
DEFAULT_MODEL = "sonar"
_THINK_OPEN_TAG = "<think>"
_THINK_CLOSE_TAG = "</think>"


def _strip_think_blocks(text: str) -> str:
    """Remove Perplexity thinking blocks from response text.

    Args:
        text: Response text potentially containing think blocks.

    Returns:
        Text with think blocks removed.
    """
    if not text:
        return text
    return re.sub(r"<think>.*?(|$)", "", text, flags=re.IGNORECASE | re.DOTALL)


def _normalize_prompt_echo_text(text: str) -> str:
    """Normalize text for prompt echo detection.

    Args:
        text: Text to normalize.

    Returns:
        Lowercased, whitespace-normalized text.
    """
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip().lower()


def _looks_like_prompt_echo(prompt: str, response_text: str) -> bool:
    """Check if response appears to echo the prompt (API glitch).

    Args:
        prompt: Original prompt sent to API.
        response_text: Response text from API.

    Returns:
        True if response appears to be prompt echo.
    """
    normalized_prompt = _normalize_prompt_echo_text(prompt)
    normalized_response = _normalize_prompt_echo_text(response_text)

    if not normalized_prompt or not normalized_response:
        return False

    if normalized_prompt == normalized_response:
        return True

    if len(normalized_prompt) < 80 or len(normalized_response) < 80:
        return False

    min_prefix_length = min(len(normalized_prompt), len(normalized_response), 400)
    prefix_matches = normalized_response.startswith(normalized_prompt[:min_prefix_length])
    length_delta = abs(len(normalized_prompt) - len(normalized_response))
    allowed_delta = max(80, len(normalized_prompt) // 10)
    if prefix_matches and length_delta <= allowed_delta:
        return True

    if normalized_prompt.startswith(normalized_response):
        return len(normalized_response) / len(normalized_prompt) >= 0.9

    return False


def append_additional_question(summary: Optional[str], additional_question: Optional[str]) -> Optional[str]:
    """Append a user's additional question to the summary context.

    Args:
        summary: Previous summary text.
        additional_question: Additional question to append.

    Returns:
        Combined text with additional question, or None if summary is None.
    """
    if summary is None:
        return None

    normalized_question = (additional_question or "").strip()
    if not normalized_question:
        return summary

    return (
        f"{summary}\n\n"
        f"Zusatzfrage des Nutzers:\n{normalized_question}\n\n"
        "Beantworte diese Zusatzfrage explizit und beziehe sie in die Interpretation ein."
    )


class _ThinkStreamFilter:
    def __init__(self) -> None:
        self._buffer = ""
        self._inside_think = False

    def process(self, chunk: str) -> str:
        if not chunk:
            return ""
        self._buffer += chunk
        output: List[str] = []

        while self._buffer:
            lower_buffer = self._buffer.lower()
            if self._inside_think:
                close_index = lower_buffer.find(_THINK_CLOSE_TAG)
                if close_index == -1:
                    keep = _suffix_prefix_overlap(lower_buffer, _THINK_CLOSE_TAG)
                    self._buffer = self._buffer[-keep:] if keep else ""
                    return ""
                self._buffer = self._buffer[close_index + len(_THINK_CLOSE_TAG):]
                self._inside_think = False
                continue

            open_index = lower_buffer.find(_THINK_OPEN_TAG)
            if open_index == -1:
                keep = _suffix_prefix_overlap(lower_buffer, _THINK_OPEN_TAG)
                if keep:
                    output.append(self._buffer[:-keep])
                    self._buffer = self._buffer[-keep:]
                else:
                    output.append(self._buffer)
                    self._buffer = ""
                return "".join(output)

            if open_index > 0:
                output.append(self._buffer[:open_index])
            self._buffer = self._buffer[open_index + len(_THINK_OPEN_TAG):]
            self._inside_think = True

        return "".join(output)

    def flush(self) -> str:
        if self._inside_think:
            self._buffer = ""
            return ""
        remainder = self._buffer
        self._buffer = ""
        return remainder


class PerplexityClient(ChatProvider):
    """Client für die Perplexity Chat Completions API.

    Parameters
    - api_key: expliziter API Key (Fallback: `API_KEY` aus .env)
    - model: Modellname (Standard: llama-3.1-sonar-small-128k-online)
    - timeout: Request-Timeout in Sekunden
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = DEFAULT_MODEL,
        timeout: int = 60,
        role_type: str = "Laie",
    ):
        self.api_key = api_key or app_config.get_env_setting("API_KEY") or app_config.API_KEY
        self.model = model
        self.timeout = timeout
        self.role_type = role_type or "Laie"
        self.text_type = "ausführlich" if self.role_type in {"Fortgeschritten", "Experte"} else "kurz"
        self.token_count = "(je 50 - 75 tokens)" if self.text_type == "kurz" else "(je 75 - 100 tokens)"
        if self.role_type == "Experte":
            self.model = DEFAULT_MODEL_DEEP_PRO
        elif self.role_type == "Fortgeschritten":
            self.model = DEFAULT_MODEL_PRO
        self.tokens = 4096
        if self.role_type == "Fortgeschritten":
            self.tokens = 8192
        elif self.role_type == "Experte":
            self.tokens = 9216


        self.init_system_prompts(self.role_type)
        # print(f"PerplexityClient initialized with role_type={self.role_type} und tokens={self.tokens} und model={self.model}")
        if not self.api_key:
            logger.warning("Perplexity API key ist nicht gesetzt (API_KEY). Anfragen werden fehlschlagen.")
        # Reference module-level cache for shared cache operations
        self._cache = _CACHE

    @property
    def model_name(self) -> str:
        """Resolved model identifier (per D-07)."""
        return self.model

    # Initialisiere die System-Prompts für verschiedene Anwendungsfälle
    def get_system_prompt_role_values(self, prompt_type: str) -> str:
        nur_woertlich = "Du bist Huber-Astrologie-Experte. Analysiere die folgenden Horoskopdaten nach Huber-Prinzipien.\n"\
        "Die Horoskopdaten wurden von einer auf Huber-Astrologie spezialisierten Software erstellt.\n"\

        allgemeine_deutung = "Schreibe ausschließlich auf Deutsch. Alle Begriffe (Planeten, Zeichen, Aspekte) auf Deutsch.\n"\
            "Halte dich strikt an diese Struktur. Keine Einleitungen, keine Meta-Kommentare.\n"\
            "Schreibe für Node immer Mondknoten\n"\
            "Alle Planeten, Sternzeichen und Aspekte immer auf deutsch\n"

        if not prompt_type or prompt_type == "Laie":
            nur_woertlich += "\nBerücksichtige bei der Interpretation und Darstellung, dass der Nutzer ein Laie ist und erkläre die astrologischen Prinzipien und Fachbegriffe verständlich und anschaulich."
        elif prompt_type == "Fortgeschritten":
            nur_woertlich += "\nBerücksichtige bei der Interpretation und Darstellung, dass der Nutzer fortgeschrittene astrologische Kenntnisse hat und erkläre die Deutungen mit angemessener Tiefe und Fachsprache."
        elif prompt_type == "Experte":
            nur_woertlich += "\nBerücksichtige bei der Interpretation und Darstellung, dass der Nutzer ein Experte ist und liefere eine tiefgründige, fachlich anspruchsvolle Analyse mit Fokus auf psychologische Dynamiken und Entwicklungspotentiale."
        return nur_woertlich, allgemeine_deutung

    def init_system_prompts(self, role_type: str = "Laie") -> str:
        self.system_prompt = {}
        nur_woertlich, allgemeine_deutung = self.get_system_prompt_role_values(role_type)
        if role_type == "Laie":
            HOROSCOPE_SYSTEM_PROMPT = (
                f"{nur_woertlich}\n"
                "Schreibe am Anfang die Überschrift: Horoskop Interpretation - [Datum]\n"
                "Überschrift 2: Sternzeichen und Aszendent danach kurze Erläuterung zum Sternzeichen und zum Aszendenten.\n"
                "Zeige am Anfang die wichtigsten Erkenntnisse an. Liste danach in dieser Reihenfolge:"\
                "1. Häuserspitzen, als Bullet Liste mit Bedeutung (je 50-75 Tokens).\n"\
                "2. Planeten, als Bullet Liste mit Bedeutung (je 50-75 Tokens).\n"\
                "3. Aspekte, als Bullet Liste mit Bedeutung (je 50-75 Tokens).\n"\
                "Füge am Ende eine Zusammenfassung mit psychologischer Gesamtschau an.\n"
                f"{allgemeine_deutung}\n"
            )
        else:
             HOROSCOPE_SYSTEM_PROMPT = (
                f"{nur_woertlich}\n"
                "Schreibe am Anfang die Überschrift: Horoskop Interpretation - [Datum]\n"
                "Überschrift 2: Sternzeichen und Aszendent danach kurze Erläuterung zum Sternzeichen und zum Aszendenten.\n"
                "Zeige am Anfang die wichtigsten Erkenntnisse an. Liste danach in dieser Reihenfolge:"\
                "1. Häuserspitzen, als Bullet Liste mit Bedeutung ausführlich (je 75-100 Tokens).\n"\
                "2. Planeten, als Bullet Liste mit Bedeutung ausführlich (je 75-100 Tokens).\n"\
                "3. Aspekte, als Bullet Liste mit Bedeutung ausführlich (je 75-100 Tokens).\n"\
                "Füge am Ende eine Zusammenfassung / psychologische Gesamtschau an.\n"
                f"{allgemeine_deutung}\n"
            )
        NODE_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Mondknoten Interpretation - [Datum]\n"
            f"Schreibe danach eine detailierte Erläuterung zu den Mondknoten als Bullet Liste {self.text_type} {self.token_count}\n"\
            "Füge am Ende eine Zusammenfassung der Mondknotenpositionen an.\n"
            f"{allgemeine_deutung}\n"
        )
        HOUSES_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Häuser Interpretation - [Datum]\n"
            f"Schreibe danach eine detailierte Erläuterung zu den Häusern als Bullet Liste {self.text_type} {self.token_count}\n"\
            "Füge am Ende eine Zusammenfassung der Häuserpositionen an.\n"
            f"{allgemeine_deutung}\n"
        )
        TRANSITS_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Transit Interpretation - [Datum]\n"
            f"Schreibe danach die wichtigsten Transit-Aspekte als Bullet Liste {self.text_type} {self.token_count} auf und erläutere danach deren psychologische Bedeutung.\n"
            "Füge am Ende eine kurze Zusammenfassung der aktuellen Entwicklungsdynamik an.\n"
            f"{allgemeine_deutung}\n"
        )
        SOLAR_RETURN_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Solar Jahr Interpretation - [Datum]\n"
            f"Liste zuerst die wichtigsten Themen des Solar Jahrs auf und erläutere danach Planeten, Häuser und markante Aspekte als Bullet Liste {self.text_type} {self.token_count}.\n"
            f"Füge am Ende eine kurze psychologische Gesamtschau für das Solar-Return-Jahr an.\n"
            f"{allgemeine_deutung}\n"
        )
        AGE_POINTS_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Alterspunkt Interpretation - [Datum]\n"
            f"Erläutere zuerst das Hauptthema des ausgewählten Alterspunkts, beziehe dann die relevanten Transite als Bullet Liste {self.text_type} {self.token_count} ein\n"
            f"Schließe die Interpretation mit einer {self.text_type}en {self.token_count} psychologischen Gesamtschau bezüglich Alterspunkt und gleichzeitige Transite ab.\n"
            f"{allgemeine_deutung}\n"
        )

        ENTRY_GENERATION_SYSTEM_PROMPT = (
            "Du bist ein erfahrener Astrologie-Redakteur, spezialisiert auf die Erstellung von astrologischen Inhalten für eine deutschsprachige Wiki-Huber-Astrologie Seite.\n"\
            "Deine Aufgabe ist es, basierend auf Titel, Bereich, Kategorie und vorhandenen Texten, einen vollständigen, gut strukturierten und fachlich fundierten Beitrag zu erstellen oder zu verbessern.\n"\
            "Verwende immer Listen mit Bullet Points, um die Informationen klar und übersichtlich zu präsentieren.\n"
            "Halte dich strikt an diese Struktur. Keine Meta-Kommentare. Keine Quellenangaben.\n"\
        )

        SYNASTRY_SYSTEM_PROMPT = (
            f"{nur_woertlich}\n"
            "Schreibe am Anfang die Überschrift: Partnerhoroskop Interpretation\n"
            f"Schreibe danach eine detailierte Erläuterung der Beziehungsaspekte als Bullet Liste {self.text_type} {self.token_count}\n"
            "Beschreibe sowohl die harmonischen als auch die herausfordernden Aspekte der Beziehung.\n"
            "Gehe auf die Häuserüberlagerungen ein: Welche Lebensbereiche der Partner werden durch die Planeten des anderen aktiviert?\n"
            f"Füge am Ende eine psychologische Gesamtschau der Partnerschaftsdynamik aus Sicht der Huber-Astrologie an.\n"
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

    def system_prompt_for_summary(self, type_of_prompt: str) -> str:
        # Implementiere die Logik zur Generierung des System-Prompts basierend auf dem Typ
        if type_of_prompt not in self.system_prompt:
            raise ValueError(f"Unbekannter Typ für System-Prompt: {type_of_prompt}")
        return self.system_prompt[type_of_prompt]

    def resolve_system_prompt(self, prompt_key_or_text: Optional[str]) -> Optional[str]:
        """Resolve a system prompt key (e.g., 'horoskop') to full text, or pass through raw text."""
        return self._resolve_system_prompt(prompt_key_or_text)

    def _resolve_system_prompt(self, system_prompt: Optional[str]) -> Optional[str]:
        """Resolve a system_prompt parameter which may be either a key (e.g. 'horoskop')
        or the full prompt text. Returns the prompt text or None.
        """
        if system_prompt is None:
            return None
        # if caller passed a key matching configured prompts, return the stored prompt
        if hasattr(self, "system_prompt") and system_prompt in self.system_prompt:
            return self.system_prompt[system_prompt]
        # otherwise assume it's already the full prompt text
        return system_prompt

    def _build_messages(self, summary: str, system_prompt: Optional[str] = None) -> List[Dict[str, str]]:
        if not summary:
            raise ValueError("summary darf nicht leer sein")

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": summary})
        return messages

    def _build_headers(self, accept: str = "application/json") -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": accept,
        }

    def send_summary(self, summary: str, system_prompt: Optional[str] = None) -> Dict[str, Any]:
        """Sendet eine Summary als User-Nachricht an die Perplexity API."""
        resolved = self._resolve_system_prompt(system_prompt)
        # Fallback auf den Horoskop-Prompt, falls nichts übergeben wurde
        if resolved is None:
            resolved = self.system_prompt_for_summary("horoskop")
        messages = self._build_messages(summary=summary, system_prompt=resolved)

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
        }
        headers = self._build_headers()

        # logger.debug("Sende Anfrage an Perplexity (model=%s, länge=%d Zeichen)", self.model, len(summary))
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(PERPLEXITY_API_URL, json=payload, headers=headers)
            resp.raise_for_status()
            return resp.json()

    def get_cached_summary(self, summary: str, system_prompt: Optional[str] = None) -> Optional[str]:
        if app_config.DISABLE_AI:
            return None
        resolved = self._resolve_system_prompt(system_prompt)
        if resolved is None:
            resolved = self.system_prompt_for_summary("horoskop")

        key = make_cache_key(summary, resolved, self.model)
        cached = cache_get(self._cache, key)
        if cached is None:
            return None

        if _looks_like_prompt_echo(summary, cached):
            logger.warning("Verwerfe verunreinigten Perplexity-Cache-Eintrag, der den Prompt spiegelt")
            cache_delete(self._cache, key)
            return None

        return cached

    async def send_summary_stream(
        self,
        summary: str,
        system_prompt: Optional[str] = None,
        stream_mode: str = "full",
    ) -> AsyncIterator[str]:
        """Sendet eine Summary an Perplexity und liefert Text-Chunks aus dem SSE-Stream."""
        if app_config.DISABLE_AI:
            placeholder = "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n*(DISABLE_AI ist gesetzt — keine Perplexity-Anfragen werden gesendet.)*\n\n---\n\n"
            yield placeholder
            return
        resolved = self._resolve_system_prompt(system_prompt)
        if resolved is None:
            resolved = self.system_prompt_for_summary("horoskop")
        try:
            cached = self.get_cached_summary(summary, resolved)
            if cached is not None:
                yield cached
                return
        except Exception as e:
            logger.debug(f"Cache miss: {e}")
        disable_search = True
        if system_prompt == "entry":
            disable_search = False
        messages = self._build_messages(summary=summary, system_prompt=resolved)
        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "disable_search": disable_search,
            "stream_mode": stream_mode,
            "max_tokens": self.tokens,  # erhöhe max_tokens für längere Antworten
        }
        headers = self._build_headers(accept="text/event-stream")

        logger.debug(
            "Sende Streaming-Anfrage an Perplexity (model=%s, länge=%d Zeichen)",
            self.model,
            len(summary),
        )
        normalized_prompt = _normalize_prompt_echo_text(summary)
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream("POST", PERPLEXITY_API_URL, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                think_filter = _ThinkStreamFilter()
                buffered_chunks: list[str] = []
                buffered_text = ""
                prompt_prefix_pending = True

                def _buffer_or_yield(chunk: str) -> AsyncIterator[str]:
                    raise NotImplementedError

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue

                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        if data == "[DONE]":
                            break
                        continue

                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        # logger.debug("Überspringe unbekannten Perplexity-Stream-Chunk: %s", data)
                        continue

                    choices = event.get("choices") or []
                    if not choices:
                        continue

                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        filtered = think_filter.process(content)
                        if filtered:
                            if prompt_prefix_pending:
                                buffered_chunks.append(filtered)
                                buffered_text += filtered
                                normalized_buffer = _normalize_prompt_echo_text(buffered_text)
                                if normalized_buffer and not normalized_prompt.startswith(normalized_buffer):
                                    prompt_prefix_pending = False
                                    for chunk in buffered_chunks:
                                        yield chunk
                                    buffered_chunks.clear()
                                    buffered_text = ""
                            else:
                                yield filtered

                remainder = think_filter.flush()
                if remainder:
                    if prompt_prefix_pending:
                        buffered_chunks.append(remainder)
                        buffered_text += remainder
                    else:
                        yield remainder

                if prompt_prefix_pending and buffered_text:
                    if _looks_like_prompt_echo(summary, buffered_text):
                        logger.warning("Perplexity-Stream hat den Prompt gespiegelt, wechsle auf Text-Fallback ohne Cache")
                        fallback_text = await asyncio.to_thread(
                            self.send_summary_text,
                            summary,
                            resolved,
                            False,
                            True,
                        )
                        if fallback_text and not _looks_like_prompt_echo(summary, fallback_text):
                            yield fallback_text
                            return
                        raise ValueError("Perplexity hat im Stream den Prompt statt einer Interpretation zurückgegeben")

                    for chunk in buffered_chunks:
                        yield chunk

    async def stream_messages(self, messages: List[Dict[str, str]]) -> AsyncIterator[str]:
        """ABC-compliant: stream completion from a pre-built message list.

        Used by interpretations.py followup endpoint for conversation history.
        Bypasses cache (followups are unique per conversation path).
        """
        if app_config.DISABLE_AI:
            yield "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n*(DISABLE_AI ist gesetzt — keine Perplexity-Anfragen werden gesendet.)*\n\n---\n\n"
            return

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": True,
            "disable_search": True,
            "max_tokens": self.tokens,
        }
        headers = self._build_headers(accept="text/event-stream")
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream("POST", PERPLEXITY_API_URL, json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    choices = event.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content = delta.get("content")
                    if content:
                        yield content

    async def stream_completion(self, summary: str, system_prompt: Optional[str] = None) -> AsyncIterator[str]:
        """ABC-compliant streaming method. Delegates to send_summary_stream."""
        async for chunk in self.send_summary_stream(summary=summary, system_prompt=system_prompt):
            yield chunk

    def send_summary_text(
        self,
        summary: str,
        system_prompt: Optional[str] = None,
        use_cache: bool = True,
        retry_on_prompt_echo: bool = True,
    ) -> str:
        """Wie send_summary(), gibt aber nur den reinen Antworttext zurück."""
        if app_config.DISABLE_AI:
            return "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n*(DISABLE_AI ist gesetzt — keine Perplexity-Anfragen werden gesendet.)*\n\n---\n\n"
        system_prompt = self._resolve_system_prompt(system_prompt)
        if system_prompt is None:
            system_prompt = self.system_prompt_for_summary("horoskop")
        key = make_cache_key(summary, system_prompt, self.model)
        if use_cache:
            cached = self.get_cached_summary(summary, system_prompt)
            if cached is not None:
                return cached

        result = self.send_summary(summary=summary, system_prompt=system_prompt)
        try:
            text = _strip_think_blocks(result["choices"][0]["message"]["content"])
        except (KeyError, IndexError, TypeError) as e:
            raise ValueError(f"Unerwartete Perplexity-Antwortstruktur: {e} — Raw: {result}")

        if _looks_like_prompt_echo(summary, text):
            if retry_on_prompt_echo:
                logger.warning("Perplexity hat den Prompt gespiegelt, wiederhole Anfrage ohne Cache")
                return self.send_summary_text(
                    summary,
                    system_prompt=system_prompt,
                    use_cache=False,
                    retry_on_prompt_echo=False,
                )
            raise ValueError("Perplexity hat den Prompt statt einer Interpretation zurückgegeben")

        try:
            cache_set(self._cache, key, text)
        except Exception:
            pass

        return text

    def chat_completion(self, summary: str, system_prompt: Optional[str] = None) -> str:
        """ABC-compliant synchronous completion. Delegates to send_summary_text."""
        return self.send_summary_text(summary=summary, system_prompt=system_prompt)

    def get_cached(self, summary: str, system_prompt: Optional[str] = None) -> Optional[str]:
        """ABC-compliant cached lookup."""
        return self.get_cached_summary(summary=summary, system_prompt=system_prompt)

    def cache_result(self, summary: str, system_prompt: Optional[str], text: str) -> None:
        """Store completion in provider's cache namespace."""
        resolved = self.resolve_system_prompt(system_prompt)
        key = make_cache_key(summary, resolved, self.model)
        cache_set(self._cache, key, text)


_CACHE = create_provider_cache(
    prefix=(app_config.get_env_setting("PERPLEXITY_CACHE_PREFIX") or "perplexity").strip() or "perplexity",
    max_entries=int(app_config.get_env_setting("PERPLEXITY_CACHE_MAX") or 256),
    ttl_seconds=int(app_config.get_env_setting("PERPLEXITY_CACHE_TTL") or 7 * 24 * 3600),
    redis_url=(app_config.get_env_setting("REDIS_URL") or "").strip() or None,
    cache_backend_type=(app_config.get_env_setting("PERPLEXITY_CACHE_BACKEND") or "local").strip().lower(),
)


def get_cache_overview(
    limit: int = 100,
    include_values: bool = True,
    value_max_length: int = 2000,
) -> Dict[str, Any]:
    """Get overview of cache contents (backward-compatible wrapper)."""
    return _shared_get_cache_overview(_CACHE, limit=limit, include_values=include_values, value_max_length=value_max_length)


def delete_cache_entry(key: str) -> Dict[str, Any]:
    """Delete a single cache entry (backward-compatible wrapper)."""
    return _shared_delete_cache_entry(_CACHE, key)


def clear_cache() -> Dict[str, Any]:
    """Clear all cache entries (backward-compatible wrapper)."""
    return _shared_clear_cache(_CACHE)



# ---------------------------------------------------------------------------
# Backward-compatible module-level wrappers for router imports
# ---------------------------------------------------------------------------
# _make_cache_key has same signature as shared make_cache_key
_make_cache_key = make_cache_key


def _cache_get(key: str) -> Optional[str]:
    """Get cached response by key (backward-compatible wrapper)."""
    return cache_get(_CACHE, key)


def _cache_set(key: str, text: str) -> None:
    """Store text in cache with key (backward-compatible wrapper)."""
    cache_set(_CACHE, key, text)


def _cache_delete(key: str) -> None:
    """Delete cached entry by key (backward-compatible wrapper)."""
    cache_delete(_CACHE, key)




def send_summary_to_perplexity(
    summary: str,
    system_prompt: Optional[str] = None,
    **client_kwargs,
) -> Dict[str, Any]:
    """Hilfsfunktion: erzeugt einen Client und sendet die Summary."""
    client = PerplexityClient(**client_kwargs)
    return client.send_summary(summary=summary, system_prompt=system_prompt)