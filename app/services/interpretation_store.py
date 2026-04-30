"""Service für das Lesen und Schreiben von Interpretations-Sessions und Nachrichten."""
from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy.orm import Session

from app.db.models.interpretations import UserInterpretation, UserInterpretationMessage
from app.schemas.interpretations import InterpretationCreate, MessageCreate

logger = logging.getLogger(__name__)


def create_interpretation(
    db: Session,
    user_id: int,
    payload: InterpretationCreate,
) -> UserInterpretation:
    """Legt eine neue Interpretations-Session inkl. initaler Nachrichten an."""
    interp = UserInterpretation(
        user_id=user_id,
        user_persons_id=payload.user_persons_id,
        context_type=payload.context_type,
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
    limit: int = 20,
    offset: int = 0,
) -> List[UserInterpretation]:
    """Gibt paginierte Sessions des Nutzers zurück, neueste zuerst."""
    q = db.query(UserInterpretation).filter(UserInterpretation.user_id == user_id)
    if context_type is not None:
        q = q.filter(UserInterpretation.context_type == context_type)
    if user_persons_id is not None:
        q = q.filter(UserInterpretation.user_persons_id == user_persons_id)
    return (
        q.order_by(UserInterpretation.created.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def delete_interpretation(db: Session, user_id: int, interpretation_id: int) -> bool:
    """Löscht eine Session (inkl. Nachrichten via DB-CASCADE). Gibt False zurück wenn nicht gefunden."""
    interp = get_interpretation(db, user_id, interpretation_id)
    if interp is None:
        return False
    db.delete(interp)
    db.commit()
    return True


def append_message(
    db: Session,
    interpretation: UserInterpretation,
    role: str,
    content: str,
) -> UserInterpretationMessage:
    """Hängt eine neue Nachricht ans Ende der Kette und gibt sie zurück."""
    next_position = (
        db.query(UserInterpretationMessage)
        .filter(UserInterpretationMessage.interpretation_id == interpretation.id)
        .count()
    )
    msg = UserInterpretationMessage(
        interpretation_id=interpretation.id,
        position=next_position,
        role=role,
        content=content,
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def get_messages_ordered(
    db: Session,
    interpretation_id: int,
) -> List[UserInterpretationMessage]:
    """Gibt alle Nachrichten einer Session nach position sortiert zurück."""
    return (
        db.query(UserInterpretationMessage)
        .filter(UserInterpretationMessage.interpretation_id == interpretation_id)
        .order_by(UserInterpretationMessage.position)
        .all()
    )


def build_message_history(messages: List[UserInterpretationMessage]) -> List[dict]:
    """Konvertiert ORM-Nachrichten in das dict-Format für die Perplexity-API."""
    return [{"role": m.role, "content": m.content} for m in messages]


def get_first_user_question(messages: List[UserInterpretationMessage]) -> Optional[str]:
    """Gibt den Inhalt der ersten user-Nachricht zurück (für Listenvorschau)."""
    for m in messages:
        if m.role == "user":
            return m.content[:200]
    return None
