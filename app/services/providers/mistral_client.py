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
from app.services import prompts
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
    # System prompts — einzige Quelle ist app.services.prompts (D-01)
    # ---------------------------------------------------------------------------
    def _init_system_prompts(self) -> None:
        """Baut das ``system_prompt``-Dict aus dem gemeinsamen Prompt-Modul (D-01).

        Die parameterlose Signatur bleibt, weil der Paritätstest beide Clients
        für dieselbe Stufe konstruiert.
        """
        stufe = self.role_type or "Laie"
        self.system_prompt = {
            key: prompts.system_prompt(key, stufe) for key in prompts.PROMPT_KEYS
        }

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
