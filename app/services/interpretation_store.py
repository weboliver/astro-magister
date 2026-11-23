"""Service für das Lesen und Schreiben von Interpretations-Sessions und Nachrichten."""
from __future__ import annotations

import json
import logging
from typing import List, Optional

from sqlalchemy import func as sqlfunc
from sqlalchemy.orm import Session, joinedload

from app.db.models.interpretations import UserInterpretation, UserInterpretationMessage
from app.schemas.interpretations import InterpretationCreate, MessageCreate


def _assert_person_ownership(
    user_id: int,
    user_persons_id: Optional[int],
    user_person_id_2: Optional[int] = None,
) -> None:
    """Wirft ValueError wenn eine der referenzierten Personen nicht zum User gehört.

    Beide Referenzen werden geprüft: ``user_persons_id`` (die Hauptperson) und
    ``user_person_id_2`` (bei Synastrie die zweite Person). Die zweite wurde
    ursprünglich nicht geprüft, wodurch eine Session mit fremder Person als
    zweitem Partner angelegt werden konnte, obwohl ``get_interpretation`` beim
    Lesen nach ``user_id`` filtert (CR-01-Nebenbefund aus `43-REVIEW.md`).
    """
    from app.services import auth as auth_service

    for person_id in (user_persons_id, user_person_id_2):
        if person_id is None:
            continue
        person = auth_service.get_person(user_id, person_id)
        if not person:
            raise ValueError(f"Person {person_id} not found or access denied")

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
                UserInterpretation.comparison_mode == payload.comparison_mode,
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


#: Kopf der verdichteten Nachricht älterer Runden (mechanisch, kein LLM).
_CONDENSED_HISTORY_HEADER = "Bisheriger Verlauf (verdichtet):"

#: Zeichen-Obergrenzen je Runde in der verdichteten Nachricht.
_QUESTION_PREVIEW_CHARS = 120
_ANSWER_PREVIEW_CHARS = 200


def _one_line(text: str, limit: int) -> str:
    """Kürzt einen Text mechanisch auf eine Zeile und ``limit`` Zeichen."""
    return " ".join(str(text or "").split())[:limit]


def _legacy_question(raw: str) -> str:
    """Gibt den zu sendenden Fragetext einer ``query``-Zeile zurück.

    Im Bestand stehen zwei Speicherformen:

    - **neu** (ab D-23): die Zeile enthält nur den Fragetext des Nutzers,
    - **alt**: die Zeile enthält ``json.dumps`` der damals gesamten Konversation.

    Für die alte Form wird ausschließlich der ``content`` des **letzten**
    ``user``-Eintrags verwendet — das ist die in dieser Runde neu gestellte
    Frage (D-23a); alles davor steht ohnehin in den früheren Runden. Der ganze
    Blob würde die Verdichtung sonst wirkungslos machen: bei einer langen
    Altsession gingen die letzten Blobs mit je ~24k–100k Tokens mit. Ist der
    Inhalt kein parsebares JSON-Array aus Dicts mit ``role``/``content`` oder
    fehlt ein ``user``-Eintrag, bleibt der Rohtext unverändert.

    Args:
        raw: Gespeicherter Inhalt einer ``query``-Zeile.

    Returns:
        Der Fragetext dieser Runde.
    """
    if not raw.startswith("["):
        return raw
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return raw
    if not isinstance(parsed, list):
        return raw
    for entry in reversed(parsed):
        if (
            isinstance(entry, dict)
            and entry.get("role") == "user"
            and isinstance(entry.get("content"), str)
        ):
            return entry["content"]
    return raw


def _rounds_by_position(messages: List[UserInterpretationMessage]) -> List[tuple]:
    """Gruppiert die Kontext-Zeilen in Runden (eine Runde = eine ``position``).

    Nur ``query``- (→ Rolle ``user``) und ``assistant``-Zeilen zählen;
    ``user``-Zeilen sind die Anzeigeform. Die Rundenbildung läuft über die
    Spalte ``position`` und **nicht** über die Abfolge ``query`` → ``assistant``,
    weil eine abgebrochene Runde (Query ohne Antwort) die Zählung sonst
    verschiebt. Sortiert wird aufsteigend nach ``position``.
    """
    rounds: dict[int, dict[str, List[str]]] = {}
    for m in messages:
        if m.role not in ("query", "assistant"):
            continue
        rounds.setdefault(m.position, {"query": [], "assistant": []})[m.role].append(m.content)
    return [(position, rounds[position]) for position in sorted(rounds)]


def _condensed_line(number: int, round_messages: dict) -> str:
    """Eine Zeile der verdichteten Nachricht: Frage und Antwortbeginn einer Runde."""
    question = round_messages["query"][0] if round_messages["query"] else ""
    answer = round_messages["assistant"][0] if round_messages["assistant"] else ""
    return (
        f"Runde {number} — "
        f"Frage: {_one_line(_legacy_question(question), _QUESTION_PREVIEW_CHARS)}"
        f" | Kern: {_one_line(answer, _ANSWER_PREVIEW_CHARS)}"
    )


def build_message_history(
    messages: List[UserInterpretationMessage],
    *,
    keep_full_rounds: int = 3,
) -> List[dict]:
    """Baut die Nachrichtenliste für das Modell aus den gespeicherten Zeilen.

    Reine Ableitung: keine Datenbank, kein Netz. Gespeichert wird pro Runde nur
    der neue Turn (D-23); der gesendete Kontext entsteht beim Lesen, damit er
    linear statt quadratisch wächst.

    Runden entstehen über die Spalte ``position`` (siehe
    :func:`_rounds_by_position`). Regeln:

    - Runde 1 (Stufenauftrag **und** Horoskopdaten) geht immer vollständig mit —
      ohne diese Daten hätte das Modell keinen Chart.
    - Die letzten ``keep_full_rounds`` Runden gehen vollständig mit.
    - Alle älteren Runden werden zu **einer** User-Nachricht verdichtet, die mit
      ``Bisheriger Verlauf (verdichtet):`` beginnt und je Runde eine Zeile
      ``Runde <n> — Frage: … | Kern: …`` trägt (Frage auf 120, Antwortbeginn auf
      200 Zeichen gekürzt). Die Verdichtung ist mechanisch: deterministisch,
      kostenlos, offline testbar und für alle Alt-Sessions nachträglich
      verbessert sie sich mit dem Code. Es gibt bewusst **keine** gespeicherte
      Zusammenfassung (kein zusätzlicher LLM-Aufruf je Runde, keine Drift, keine
      zweite Wahrheitsquelle).

    Beide Speicherformen werden gelesen: neue ``query``-Zeilen tragen den reinen
    Fragetext, alte ein JSON-Blob der damaligen Konversation, das über
    :func:`_legacy_question` auf die letzte Frage reduziert wird (D-23a).
    Zurückgeschrieben wird nichts (kein Backfill, keine Migration).

    Fehlende Antworten (abgebrochene Runde) erzeugen weder eine Ausnahme noch
    eine leere Nachricht.

    Args:
        messages: Gespeicherte Nachrichten in Anzeige-Reihenfolge
            (``position`` aufsteigend, dann ``user`` → ``query`` → ``assistant``).
        keep_full_rounds: Anzahl der vollständig gesendeten Runden am Ende.

    Returns:
        Liste von ``{"role", "content"}``-Dicts; leer bei leerer Eingabe.
    """
    rounds = _rounds_by_position(messages)
    if not rounds:
        return []

    keep = max(0, int(keep_full_rounds))
    first_full_trailing = max(1, len(rounds) - keep)

    condensed_lines = [
        _condensed_line(index + 1, rounds[index][1])
        for index in range(1, first_full_trailing)
    ]

    result: List[dict] = []
    for index, (_position, round_messages) in enumerate(rounds):
        if index == 1 and condensed_lines:
            result.append({
                "role": "user",
                "content": _CONDENSED_HISTORY_HEADER + "\n" + "\n".join(condensed_lines),
            })
        if 0 < index < first_full_trailing:
            continue  # steckt in der verdichteten Nachricht
        for content in round_messages["query"]:
            result.append({"role": "user", "content": _legacy_question(content)})
        for content in round_messages["assistant"]:
            if content and content.strip():
                result.append({"role": "assistant", "content": content})
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
    _assert_person_ownership(user_id, user_persons_id, user_person_id_2)

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
