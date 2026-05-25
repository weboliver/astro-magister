"""CRUD-Router für Interpretations-Sessions und Folgefragen."""
from __future__ import annotations

import asyncio
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app import config as app_config
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
from app.services.auth import is_poweruser
from app.services import auth as auth_service
from app.services import interpretation_store as store
from app.services.providers import get_chat_provider
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
    """Format a Server-Sent Events message.

    Args:
        event: Event type string.
        data: Data dictionary to serialize as JSON.

    Returns:
        Formatted SSE string.
    """
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _require_user(request: Request) -> dict:
    """Require authenticated user from request.

    Args:
        request: FastAPI Request.

    Returns:
        User dict.

    Raises:
        HTTPException: If not authenticated.
    """
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def _to_list_item(interp: UserInterpretation) -> InterpretationListItem:
    """Convert UserInterpretation to list item for API response.

    Args:
        interp: UserInterpretation database model.

    Returns:
        InterpretationListItem for list display.
    """
    first_question: Optional[str] = None
    if interp.messages:
        first_question = store.get_first_user_question(interp.messages)

    item = InterpretationListItem(
        id=interp.id,
        context_type=interp.context_type,
        created=interp.created,
        interp_year=interp.interp_year,
        interp_month=interp.interp_month,
        interp_day=interp.interp_day,
        location_city=interp.location_city,
        user_persons_id=interp.user_persons_id,
        user_person_id_2=interp.user_person_id_2,
        comparison_mode=interp.comparison_mode,
        first_question=first_question,
    )

    if interp.context_type == "synastry":
        if interp.user_person and interp.user_person.name:
            item.user_person_name = interp.user_person.name
        elif interp.user_persons_id is None:
            item.user_person_name = "Eigenes Profil"
        if interp.user_person_2 and interp.user_person_2.name:
            item.user_person_2_name = interp.user_person_2.name
        elif interp.user_person_id_2 is None:
            item.user_person_2_name = "Eigenes Profil"

    return item


# ---------------------------------------------------------------------------
# POST /interpretations  – neue Session anlegen
# ---------------------------------------------------------------------------

@router.post("", response_model=InterpretationCreatedOut, status_code=201)
def create_interpretation(payload: InterpretationCreate, request: Request):
    """Create a new interpretation session.

    Args:
        payload: InterpretationCreate with context type and birth data.
        request: FastAPI Request.

    Returns:
        InterpretationCreatedOut with new interpretation ID.

    Raises:
        HTTPException: If unauthorized or person not found.
    """
    user = _require_user(request)
    if payload.user_persons_id is not None:
        person = auth_service.get_person(user["id"], payload.user_persons_id)
        if not person:
            raise HTTPException(status_code=403, detail="Person not found or access denied")
    db = get_session()
    try:
        interp = store.create_interpretation(db, user_id=user["id"], payload=payload)
        return InterpretationCreatedOut(id=interp.id)
    finally:
        db.close()


@router.get("", response_model=List[InterpretationListItem])
def list_interpretations(
    request: Request,
    context_type: Optional[str] = Query(None),
    user_persons_id: Optional[int] = Query(None),
    own_profile_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    """List user's interpretation sessions with optional filters.

    Args:
        request: FastAPI Request.
        context_type: Optional filter by context type.
        user_persons_id: Optional filter by person ID.
        own_profile_only: Only show own profile interpretations.
        limit: Max results to return.
        offset: Pagination offset.

    Returns:
        List of InterpretationListItem objects.
    """
    user = _require_user(request)
    db = get_session()
    try:
        items = store.list_interpretations(
            db,
            user_id=user["id"],
            context_type=context_type,
            user_persons_id=user_persons_id,
            own_profile_only=own_profile_only,
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
    """Get interpretation session with all messages.

    Args:
        interpretation_id: ID of interpretation to retrieve.
        request: FastAPI Request.

    Returns:
        InterpretationOut with full session and message history.

    Raises:
        HTTPException: If not found or unauthorized.
    """
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
            user_person_id_2=interp.user_person_id_2,
            context_type=interp.context_type,
            comparison_mode=interp.comparison_mode,
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
            transit_location_latitude=interp.transit_location_latitude,
            transit_location_longitude=interp.transit_location_longitude,
            created=interp.created,
            messages=[MessageOut.model_validate(m) for m in messages],
        )
    finally:
        db.close()


@router.delete("/{interpretation_id}", status_code=204)
def delete_interpretation(interpretation_id: int, request: Request):
    """Delete an interpretation session.

    Args:
        interpretation_id: ID of interpretation to delete.
        request: FastAPI Request.

    Raises:
        HTTPException: If not found or unauthorized.
    """
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
    """Stream a follow-up question to an existing interpretation session.

    Args:
        interpretation_id: ID of the interpretation session.
        payload: FollowupMessageCreate with the follow-up question content.
        request: FastAPI Request.

    Returns:
        StreamingResponse with SSE events containing the AI response.

    Raises:
        HTTPException: If interpretation not found, unauthorized, not a power user,
            or rate limited.
    """
    user = _require_user(request)
    db = get_session()

    try:
        interp = store.get_interpretation(db, user_id=user["id"], interpretation_id=interpretation_id)
        if interp is None:
            raise HTTPException(status_code=404, detail="Interpretation not found")

        if not is_poweruser(user["id"]):
            raise HTTPException(
                status_code=403,
                detail='Zusatzfragen sind nur für zahlende Mitglieder verfügbar. Bitte unterstützen Sie uns über Buy me a coffee: https://buymeacoffee.com/shinengakic',
            )

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

        # Bisherige Kette laden und neue Frage anhängen (nur query + assistant als Kontext)
        existing_messages = store.get_messages_ordered(db, interpretation_id)
        history = store.build_message_history(existing_messages)
        history.append({"role": "user", "content": payload.content})

        # Nächste Gesprächsrunde bestimmen
        next_pos = store.get_next_round_position(db, interpretation_id)

        # Nutzerfrage und Query sofort persistieren (beide mit identischer Position)
        store.append_message(db, interp, role="user", content=payload.content, position=next_pos)
        query_content = json.dumps(history, ensure_ascii=False)
        store.append_message(db, interp, role="query", content=query_content, position=next_pos)

        provider = get_chat_provider(role_type=None)
        model_name = interp.model or provider.model_name

    except HTTPException:
        db.close()
        raise
    except Exception as e:
        db.close()
        logger.exception("Error preparing followup for interpretation %d", interpretation_id)
        raise HTTPException(status_code=500, detail=str(e))

    async def event_stream():
        if app_config.DISABLE_AI:
            placeholder = "\n\n---\n\n**KI-Interpretation ist derzeit deaktiviert.**\n*(DISABLE_AI ist gesetzt — keine Perplexity-Anfragen werden gesendet.)*\n\n---\n\n"
            yield _sse_event("summary_delta", {"content": placeholder})
            yield _sse_event("done", {"summary": placeholder})
            return
        summary_parts: list[str] = []
        try:
            async for chunk in provider.stream_messages(history):
                summary_parts.append(chunk)
                yield _sse_event("summary_delta", {"content": chunk})

            full_answer = "".join(summary_parts)

            # KI-Antwort persistieren
            try:
                store.append_message(db, interp, role="assistant", content=full_answer, position=next_pos)
            except Exception as e:
                logger.exception(f"Failed to persist assistant message for interpretation {interpretation_id}: {e}")

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
