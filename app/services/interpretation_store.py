"""Service für das Lesen und Schreiben von Interpretations-Sessions und Nachrichten."""
from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session, joinedload

from app.db.models.interpretations import UserInterpretation, UserInterpretationMessage
from app.schemas.interpretations import InterpretationCreate, MessageCreate


def _assert_person_ownership(user_id: int, user_persons_id: Optional[int]) -> None:
    """Wirft ValueError wenn user_persons_id nicht zum User gehört."""
    if user_persons_id is None:
        return
    from app.services import auth as auth_service
    person = auth_service.get_person(user_id, user_persons_id)
    if not person:
        raise ValueError(f"Person {user_persons_id} not found or access denied")

logger = logging.getLogger(__name__)


def create_interpretation(
    db: Session,
    user_id: int,
    payload: InterpretationCreate,
) -> UserInterpretation:
    """Legt eine neue Interpretations-Session inkl. initaler Nachrichten an.

    Duplikatschutz: Existiert bereits eine Session desselben Nutzers mit
    identischem context_type, interp_year/month/day/hour/minute *und* einer
    Nachricht (position=1, role='user') mit demselben Inhalt, wird diese
    zurückgegeben statt einen neuen Datensatz anzulegen.
    """
    first_user_msg = next(
        (m for m in payload.messages if m.position == 1 and m.role == "user"),
        None,
    )
    if first_user_msg is not None:
        existing = (
            db.query(UserInterpretation)
            .join(
                UserInterpretationMessage,
                UserInterpretationMessage.interpretation_id == UserInterpretation.id,
            )
            .filter(
                UserInterpretation.user_id == user_id,
                UserInterpretation.context_type == payload.context_type,
                UserInterpretation.user_persons_id == payload.user_persons_id,
                UserInterpretation.user_person_id_2 == payload.user_person_id_2,
                UserInterpretation.interp_year == payload.interp_year,
                UserInterpretation.interp_month == payload.interp_month,
                UserInterpretation.interp_day == payload.interp_day,
                UserInterpretation.interp_hour == payload.interp_hour,
                UserInterpretation.interp_minute == payload.interp_minute,
                UserInterpretationMessage.position == 1,
                UserInterpretationMessage.role == "user",
                UserInterpretationMessage.content == first_user_msg.content,
            )
            .first()
        )
        if existing is not None:
            logger.debug(
                "create_interpretation: Duplikat erkannt, gebe bestehende Session %d zurück",
                existing.id,
            )
            return existing

    interp = UserInterpretation(
        user_id=user_id,
        user_persons_id=payload.user_persons_id,
        user_person_id_2=payload.user_person_id_2,
        context_type=payload.context_type,
        comparison_mode=payload.comparison_mode,
        model=payload.model,
        interp_year=payload.interp_year,
        interp_month=payload.interp_month,
        interp_day=payload.interp_day,
        interp_hour=payload.interp_hour,
        interp_minute=payload.interp_minute,
        location_country=payload.location_country,
        location_region=payload.location_region,
        location_city=payload.location_city,
        location_longitude=payload.location_longitude,
        location_latitude=payload.location_latitude,
        transit_location_latitude=payload.transit_location_latitude,
        transit_location_longitude=payload.transit_location_longitude,
    )
    db.add(interp)
    db.flush()  # id wird benötigt für die Nachrichten

    for msg in payload.messages:
        db.add(UserInterpretationMessage(
            interpretation_id=interp.id,
            position=msg.position,
            role=msg.role,
            content=msg.content,
        ))

    db.commit()
    db.refresh(interp)
    return interp


def get_interpretation(
    db: Session,
    user_id: int,
    interpretation_id: int,
) -> Optional[UserInterpretation]:
    """Lädt eine Session; gibt None zurück wenn nicht gefunden oder falscher Eigentümer."""
    return (
        db.query(UserInterpretation)
        .options(
            joinedload(UserInterpretation.user_person),
            joinedload(UserInterpretation.user_person_2),
        )
        .filter(
            UserInterpretation.id == interpretation_id,
            UserInterpretation.user_id == user_id,
        )
        .first()
    )


def list_interpretations(
    db: Session,
    user_id: int,
    context_type: Optional[str] = None,
    user_persons_id: Optional[int] = None,
    own_profile_only: bool = False,
    limit: int = 20,
    offset: int = 0,
) -> List[UserInterpretation]:
    """Gibt paginierte Sessions des Nutzers zurück, neueste zuerst."""
    q = (
        db.query(UserInterpretation)
        .options(
            joinedload(UserInterpretation.user_person),
            joinedload(UserInterpretation.user_person_2),
        )
        .filter(UserInterpretation.user_id == user_id)
    )
    if context_type is not None:
        q = q.filter(UserInterpretation.context_type == context_type)
    if user_persons_id is not None:
        q = q.filter(UserInterpretation.user_persons_id == user_persons_id)
    elif own_profile_only:
        q = q.filter(UserInterpretation.user_persons_id == None)
    return (
        q.order_by(UserInterpretation.created.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def delete_interpretation(db: Session, user_id: int, interpretation_id: int) -> bool:
    """Löscht eine Session (inkl. Nachrichten via DB-CASCADE)."""
    interp = get_interpretation(db, user_id, interpretation_id)
    if interp is None:
        return False
    db.delete(interp)
    db.commit()
    return True


def get_next_round_position(db: Session, interpretation_id: int) -> int:
    """Gibt die nächste Gesprächsrunden-Position zurück (max + 1, mindestens 1)."""
    result = (
        db.query(sqlfunc.max(UserInterpretationMessage.position))
        .filter(UserInterpretationMessage.interpretation_id == interpretation_id)
        .scalar()
    )
    return (result or 0) + 1


def append_message(
    db: Session,
    interpretation: UserInterpretation,
    role: str,
    content: str,
    position: int,
) -> UserInterpretationMessage:
    """Hängt eine neue Nachricht mit expliziter Position an."""
    msg = UserInterpretationMessage(
        interpretation_id=interpretation.id,
        position=position,
        role=role,
        content=content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


_ROLE_ORDER = {"user": 0, "query": 1, "assistant": 2}


def get_messages_ordered(
    db: Session,
    interpretation_id: int,
) -> List[UserInterpretationMessage]:
    """Gibt alle Nachrichten einer Session sortiert zurück (position ASC, dann user→query→assistant)."""
    msgs = (
        db.query(UserInterpretationMessage)
        .filter(UserInterpretationMessage.interpretation_id == interpretation_id)
        .order_by(UserInterpretationMessage.position)
        .all()
    )
    msgs.sort(key=lambda m: (m.position, _ROLE_ORDER.get(m.role, 99)))
    return msgs


def build_message_history(messages: List[UserInterpretationMessage]) -> List[dict]:
    """Konvertiert gespeicherte Nachrichten in das dict-Format für die Perplexity-API.

    Nur 'query'- (→ role='user') und 'assistant'-Nachrichten werden verwendet.
    'user'-Nachrichten (Anzeigeform) werden übersprungen.
    """
    result = []
    for m in messages:
        if m.role == "query":
            result.append({"role": "user", "content": m.content})
        elif m.role == "assistant":
            result.append({"role": "assistant", "content": m.content})
    return result


def get_first_user_question(messages: List[UserInterpretationMessage]) -> Optional[str]:
    """Gibt den Inhalt der ersten user-Nachricht zurück (für Listenvorschau)."""
    for m in messages:
        if m.role == "user":
            return m.content[:200]
    return None


def save_or_append_stream_result(
    db: Session,
    user_id: int,
    interpretation_id: Optional[int],
    user_question: str,
    query_content: str,
    assistant_content: str,
    *,
    user_persons_id: Optional[int] = None,
    context_type: Optional[str] = None,
    model: Optional[str] = None,
    interp_year: Optional[int] = None,
    interp_month: Optional[int] = None,
    interp_day: Optional[int] = None,
    interp_hour: Optional[int] = None,
    interp_minute: Optional[int] = None,
    location_latitude: Optional[float] = None,
    location_longitude: Optional[float] = None,
    transit_location_latitude: Optional[float] = None,
    transit_location_longitude: Optional[float] = None,
    user_person_id_2: Optional[int] = None,
    comparison_mode: Optional[str] = None,
) -> int:
    """Speichert einen Stream-Treffer entweder als neue Session oder hängt ihn an eine bestehende an.

    Für Synastrie (context_type="synastry"): Eine EINZIGE Session mit beiden Personen-
    Referenzen (user_persons_id + user_person_id_2).

    Gibt die interpretation_id der Session zurück.
    """
    _assert_person_ownership(user_id, user_persons_id)

    if interpretation_id:
        interp = get_interpretation(db, user_id, interpretation_id)
        if interp:
            next_pos = get_next_round_position(db, interpretation_id)
            append_message(db, interp, role="user", content=user_question, position=next_pos)
            append_message(db, interp, role="query", content=query_content, position=next_pos)
            append_message(db, interp, role="assistant", content=assistant_content, position=next_pos)
            return interpretation_id

    # Neue Session anlegen
    from app.schemas.interpretations import InterpretationCreate, MessageCreate
    ic = InterpretationCreate(
        user_persons_id=user_persons_id,
        user_person_id_2=user_person_id_2,
        context_type=context_type,
        comparison_mode=comparison_mode,
        model=model,
        interp_year=interp_year,
        interp_month=interp_month,
        interp_day=interp_day,
        interp_hour=interp_hour,
        interp_minute=interp_minute,
        location_latitude=location_latitude,
        location_longitude=location_longitude,
        transit_location_latitude=transit_location_latitude,
        transit_location_longitude=transit_location_longitude,
        messages=[
            MessageCreate(role="user", content=user_question, position=1),
            MessageCreate(role="query", content=query_content, position=1),
            MessageCreate(role="assistant", content=assistant_content, position=1),
        ],
    )
    saved = create_interpretation(db, user_id, ic)

    # Synastrie: BEIDE Personen werden in einer einzigen Session gespeichert.

    return saved.id
