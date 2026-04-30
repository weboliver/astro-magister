"""CRUD-Router für Interpretations-Sessions und Folgefragen."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.db.models.interpretations import UserInterpretation
from app.db.session import get_session
from app.routers.auth import _get_user_from_request, require_authenticated_user
from app.schemas.interpretations import (
    FollowupMessageCreate,
    InterpretationCreate,
    InterpretationCreatedOut,
    InterpretationListItem,
    InterpretationOut,
    MessageOut,
)
from app.services import interpretation_store as store
from app.services.perplexity import PerplexityClient
from app.services.auth_security import (
    build_ai_rate_limit_error_detail,
    check_ai_rate_limit,
    get_client_ip,
    log_auth_event,
)

router = APIRouter(
    prefix="/interpretations",
    tags=["interpretations"],
    dependencies=[Depends(require_authenticated_user)],
)
logger = logging.getLogger(__name__)


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _require_user(request: Request) -> dict:
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def _to_list_item(interp: UserInterpretation) -> InterpretationListItem:
    first_question: Optional[str] = None
    if interp.messages:
        first_question = store.get_first_user_question(interp.messages)
    return InterpretationListItem(
        id=interp.id,
        context_type=interp.context_type,
        created=interp.created,
        interp_year=interp.interp_year,
        interp_month=interp.interp_month,
        interp_day=interp.interp_day,
        location_city=interp.location_city,
        user_persons_id=interp.user_persons_id,
        first_question=first_question,
    )


# ---------------------------------------------------------------------------
# POST /interpretations  – neue Session anlegen
# ---------------------------------------------------------------------------

@router.post("", response_model=InterpretationCreatedOut, status_code=201)
def create_interpretation(payload: InterpretationCreate, request: Request):
    user = _require_user(request)
    db = get_session()
    try:
        interp = store.create_interpretation(db, user_id=user["id"], payload=payload)
        return InterpretationCreatedOut(id=interp.id)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /interpretations  – eigene Sessions auflisten
# ---------------------------------------------------------------------------

@router.get("", response_model=List[InterpretationListItem])
def list_interpretations(
    request: Request,
    context_type: Optional[str] = Query(None),
    user_persons_id: Optional[int] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    user = _require_user(request)
    db = get_session()
    try:
        items = store.list_interpretations(
            db,
            user_id=user["id"],
            context_type=context_type,
            user_persons_id=user_persons_id,
            limit=limit,
            offset=offset,
        )
        return [_to_list_item(i) for i in items]
    finally:
        db.close()


# ---------------------------------------------------------------------------
# GET /interpretations/{id}  – Session + Kette laden
# ---------------------------------------------------------------------------

@router.get("/{interpretation_id}", response_model=InterpretationOut)
def get_interpretation(interpretation_id: int, request: Request):
    user = _require_user(request)
    db = get_session()
    try:
        interp = store.get_interpretation(db, user_id=user["id"], interpretation_id=interpretation_id)
        if interp is None:
            raise HTTPException(status_code=404, detail="Interpretation not found")
        messages = store.get_messages_ordered(db, interp.id)
        return InterpretationOut(
            id=interp.id,
            user_persons_id=interp.user_persons_id,
            context_type=interp.context_type,
            model=interp.model,
            interp_year=interp.interp_year,
            interp_month=interp.interp_month,
            interp_day=interp.interp_day,
            interp_hour=interp.interp_hour,
            interp_minute=interp.interp_minute,
            location_country=interp.location_country,
            location_region=interp.location_region,
            location_city=interp.location_city,
            location_longitude=interp.location_longitude,
            location_latitude=interp.location_latitude,
            created=interp.created,
            messages=[MessageOut.model_validate(m) for m in messages],
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# DELETE /interpretations/{id}
# ---------------------------------------------------------------------------

@router.delete("/{interpretation_id}", status_code=204)
def delete_interpretation(interpretation_id: int, request: Request):
    user = _require_user(request)
    db = get_session()
    try:
        deleted = store.delete_interpretation(db, user_id=user["id"], interpretation_id=interpretation_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Interpretation not found")
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /interpretations/{id}/messages  – Folgefrage stellen (SSE-Stream)
# ---------------------------------------------------------------------------

@router.post("/{interpretation_id}/messages")
async def followup_message(
    interpretation_id: int,
    payload: FollowupMessageCreate,
    request: Request,
):
    user = _require_user(request)
    db = get_session()

    try:
        interp = store.get_interpretation(db, user_id=user["id"], interpretation_id=interpretation_id)
        if interp is None:
            raise HTTPException(status_code=404, detail="Interpretation not found")

        # Rate-Limit vor dem Streamen prüfen
        rate_limit = check_ai_rate_limit(
            request,
            user_id=user["id"],
            scope=f"ai:{interp.context_type or 'interp'}",
        )
        if not rate_limit.allowed:
            log_auth_event(
                event_type="ai_rate_limited",
                success=False,
                username=user.get("username"),
                user_id=user.get("id"),
                ip_address=get_client_ip(request),
                user_agent=request.headers.get("user-agent"),
                detail="Interpretation followup rate limit exceeded",
            )
            raise HTTPException(
                status_code=429,
                detail=build_ai_rate_limit_error_detail(rate_limit),
                headers={"Retry-After": str(rate_limit.retry_after_seconds)},
            )

        # Bisherige Kette laden und neue Frage anhängen
        existing_messages = store.get_messages_ordered(db, interpretation_id)
        history = store.build_message_history(existing_messages)
        history.append({"role": "user", "content": payload.content})

        # Nutzerfrage sofort persistieren
        store.append_message(db, interp, role="user", content=payload.content)

        perplexity_client = PerplexityClient(role_type=None)
        model_name = interp.model or perplexity_client.model

    except HTTPException:
        db.close()
        raise
    except Exception as e:
        db.close()
        logger.exception("Error preparing followup for interpretation %d", interpretation_id)
        raise HTTPException(status_code=500, detail=str(e))

    async def event_stream():
        summary_parts: list[str] = []
        try:
            # Perplexity erwartet messages-Liste; wir nutzen _build_messages nicht direkt,
            # sondern übergeben die vollständige Kette als "summary" über einen kleinen Wrapper.
            # Da PerplexityClient.send_summary_stream nur summary+system_prompt kennt,
            # rufen wir die API direkt mit der vollständigen History auf.
            import httpx
            from app.services.perplexity import PERPLEXITY_API_URL

            headers_http = {
                "Authorization": f"Bearer {perplexity_client.api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            }
            api_payload = {
                "model": model_name,
                "messages": history,
                "stream": True,
                "disable_search": True,
                "max_tokens": perplexity_client.tokens,
            }

            async with httpx.AsyncClient(timeout=perplexity_client.timeout) as client:
                async with client.stream(
                    "POST", PERPLEXITY_API_URL, json=api_payload, headers=headers_http
                ) as resp:
                    resp.raise_for_status()
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
                            continue
                        choices = event.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        content = delta.get("content")
                        if content:
                            summary_parts.append(content)
                            yield _sse_event("summary_delta", {"content": content})

            full_answer = "".join(summary_parts)

            # KI-Antwort persistieren
            try:
                store.append_message(db, interp, role="assistant", content=full_answer)
            except Exception:
                logger.exception("Failed to persist assistant message for interpretation %d", interpretation_id)

            yield _sse_event("done", {"summary": full_answer})

        except Exception as exc:
            logger.exception("Error streaming followup for interpretation %d", interpretation_id)
            yield _sse_event("error", {"detail": str(exc)})
        finally:
            db.close()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
