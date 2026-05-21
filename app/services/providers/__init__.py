"""Provider abstraction layer for chat completion services.

Defines the ChatProvider ABC that all chat providers (PerplexityClient,
MistralClient) must implement, and a factory function for runtime
provider selection via the CHAT_PROVIDER environment variable.
"""

from abc import ABC, abstractmethod
from typing import Optional, AsyncIterator

import os
import logging

logger = logging.getLogger(__name__)


class ChatProvider(ABC):
    """Abstract base for chat completion providers.

    Routers interact ONLY with this interface. Each concrete provider
    (PerplexityClient, MistralClient) implements all abstract methods
    and encapsulates its own model selection, stream processing, and
    caching strategy.
    """

    @abstractmethod
    async def stream_completion(
        self, summary: str, system_prompt: Optional[str] = None
    ) -> AsyncIterator[str]:
        """Yield text chunks from an SSE stream.

        Must handle DISABLE_AI internally — yield a placeholder and
        return immediately when AI is disabled.
        """
        ...

    @abstractmethod
    def chat_completion(
        self, summary: str, system_prompt: Optional[str] = None
    ) -> str:
        """Return full completion text synchronously."""
        ...

    @abstractmethod
    def get_cached(
        self, summary: str, system_prompt: Optional[str] = None
    ) -> Optional[str]:
        """Return cached completion or None."""
        ...

    @abstractmethod
    def cache_result(
        self, summary: str, system_prompt: Optional[str], text: str
    ) -> None:
        """Store completion in provider's cache namespace."""
        ...

    @abstractmethod
    def resolve_system_prompt(
        self, prompt_key_or_text: Optional[str]
    ) -> Optional[str]:
        """Resolve a system prompt key (e.g. 'horoskop') to full prompt
        text, or pass through raw text unchanged.
        """
        ...

    @property
    @abstractmethod
    def model_name(self) -> str:
        """Resolved model identifier for metadata storage only.

        Routers MUST NOT use this for display or logic (per D-07).
        """
        ...


KNOWN_PROVIDERS: list[str] = ["perplexity", "mistral"]


def _resolve_provider_name() -> str:
    try:
        from app.db.session import SessionLocal
        from app.db.models.settings import AppSetting
        session = SessionLocal()
        try:
            row = session.query(AppSetting).filter(
                AppSetting.setting_name == "chat_provider"
            ).first()
            if row and row.setting_value:
                return row.setting_value.strip().lower()
        finally:
            session.close()
    except Exception:
        pass
    return os.getenv("CHAT_PROVIDER", "perplexity").strip().lower()


def get_chat_provider(role_type: str = "Laie") -> ChatProvider:
    """Factory: return the active chat provider, resolved from DB or env var.

    Reads the chat_provider setting from the app_settings table first.
    Falls back to the CHAT_PROVIDER environment variable if no DB setting exists.
    Final fallback is 'perplexity'.

    Args:
        role_type: User role (Laie, Fortgeschritten, Experte) for
                   per-provider model tiering.

    Returns:
        A concrete ChatProvider instance.

    Raises:
        ValueError: If CHAT_PROVIDER is set to an unknown value.
    """
    provider = _resolve_provider_name()

    if provider == "mistral":
        try:
            from app.services.providers.mistral_client import MistralClient
        except ImportError:
            logger.error(
                "CHAT_PROVIDER=mistral but MistralClient could not be imported. "
                "Is the mistralai SDK installed? Falling back to perplexity."
            )
            from app.services.perplexity import PerplexityClient
            return PerplexityClient(role_type=role_type)
        return MistralClient(role_type=role_type)

    if provider == "perplexity":
        from app.services.perplexity import PerplexityClient
        return PerplexityClient(role_type=role_type)

    logger.warning(
        "Unknown CHAT_PROVIDER value '%s'. Falling back to 'perplexity'.",
        provider,
    )
    from app.services.perplexity import PerplexityClient
    return PerplexityClient(role_type=role_type)
