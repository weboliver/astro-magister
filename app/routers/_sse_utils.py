"""Shared SSE utilities for AI interpretation streaming endpoints."""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, AsyncIterator, Callable, Optional

if TYPE_CHECKING:
    from app.services.providers import ChatProvider

logger = logging.getLogger(__name__)


def sse_event(event: str, data: dict) -> str:
    """Format a Server-Sent Events message.

    Args:
        event: Event type string (e.g. "meta", "done", "summary_delta").
        data: Data dictionary to serialize as JSON.

    Returns:
        Formatted SSE string with event name and JSON data.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def sse_stream_ai_interpretation(
    provider: "ChatProvider",
    summary_prompt: str,
    system_prompt: str,
    response_data: dict,
    meta_fields: dict,
    user: Optional[dict],
    user_id: Optional[int],
    user_persons_id: Optional[int],
    user_person_id_2: Optional[int],
    context_type: str,
    comparison_mode: Optional[str],
    model: Optional[str],
    interp_year: Optional[int],
    interp_month: Optional[int],
    interp_day: Optional[int],
    interp_hour: Optional[int],
    interp_minute: Optional[int],
    location_latitude: Optional[float],
    location_longitude: Optional[float],
    db_session_factory,
    istore_module,
) -> AsyncIterator[str]:
    """Standard SSE streaming generator for AI interpretations.

    Handles: meta event → cache check → provider stream → done event → save → error handling.
    Eliminates the copy-paste pattern across horoscope/nodes/synastry routers.

    Yields:
        SSE event strings: meta, summary_delta, done, saved, error
    """
    import asyncio

    if not summary_prompt:
        yield sse_event("meta", meta_fields)
        yield sse_event("done", {"summary": ""})
        return

    yield sse_event("meta", meta_fields)

    cached = provider.get_cached(summary_prompt, system_prompt)

    if cached is not None:
        yield sse_event("done", {"summary": cached})
        if user and user_id is not None:
            try:
                db = db_session_factory()
                try:
                    _interp_id = istore_module.save_or_append_stream_result(
                        db,
                        user_id=user_id,
                        interpretation_id=None,
                        user_question="",
                        query_content=summary_prompt,
                        assistant_content=cached,
                        user_persons_id=user_persons_id,
                        user_person_id_2=user_person_id_2,
                        context_type=context_type,
                        comparison_mode=comparison_mode,
                        model=model or provider.model_name,
                        interp_year=interp_year,
                        interp_month=interp_month,
                        interp_day=interp_day,
                        interp_hour=interp_hour,
                        interp_minute=interp_minute,
                        location_latitude=location_latitude,
                        location_longitude=location_longitude,
                    )
                    yield sse_event("saved", {"interpretation_id": _interp_id})
                finally:
                    db.close()
            except Exception:
                logger.exception("Failed to save cached interpretation")
        return

    summary_parts = []
    try:
        async for chunk in provider.stream_completion(
            summary=summary_prompt,
            system_prompt=system_prompt,
        ):
            summary_parts.append(chunk)
            yield sse_event("summary_delta", {"content": chunk})

        if not summary_parts:
            try:
                text = await asyncio.to_thread(
                    provider.chat_completion,
                    summary_prompt,
                    system_prompt,
                )
                summary_parts = [text]
            except Exception:
                logger.exception("Synchronous fallback failed")

        full_summary = "".join(summary_parts)
        try:
            provider.cache_result(summary_prompt, system_prompt, full_summary)
        except Exception:
            logger.exception("Failed to set cache")

        yield sse_event("done", {"summary": full_summary})

        if user and user_id is not None:
            try:
                db = db_session_factory()
                try:
                    _interp_id = istore_module.save_or_append_stream_result(
                        db,
                        user_id=user_id,
                        interpretation_id=None,
                        user_question="",
                        query_content=summary_prompt,
                        assistant_content=full_summary,
                        user_persons_id=user_persons_id,
                        user_person_id_2=user_person_id_2,
                        context_type=context_type,
                        comparison_mode=comparison_mode,
                        model=model or provider.model_name,
                        interp_year=interp_year,
                        interp_month=interp_month,
                        interp_day=interp_day,
                        interp_hour=interp_hour,
                        interp_minute=interp_minute,
                        location_latitude=location_latitude,
                        location_longitude=location_longitude,
                    )
                    yield sse_event("saved", {"interpretation_id": _interp_id})
                finally:
                    db.close()
            except Exception:
                logger.exception("Failed to save interpretation after stream")

    except Exception as exc:
        logger.exception("Error in AI stream")
        yield sse_event("error", {"detail": str(exc)})
