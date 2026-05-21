from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship

from app.db.session import Base


class UserInterpretation(Base):
    """Eine Interpretations-Session: Kontext, Datum und Ort der Fragestellung.

    Bezug zum Subjekt des Horoskops:
    - user_persons_id IS NULL  → Subjekt ist der angemeldete Nutzer selbst
                                  (Profil in user_profiles).
    - user_persons_id NOT NULL → Subjekt ist die Person in user_persons.

    user_id ist immer gesetzt (Eigentümerschaft).
    Eine Session enthält beliebig viele Nachrichten in user_interpretation_messages.
    """

    __tablename__ = "user_interpretations"

    __table_args__ = (
        Index("ix_user_interpretations_user_id", "user_id"),
        Index("ix_user_interpretations_user_persons_id", "user_persons_id"),
        Index("ix_user_interpretations_user_person_id_2", "user_person_id_2"),
        Index("ix_user_interpretations_created", "created"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Eigentümer – immer vorhanden
    user_id = Column(
        Integer,
        ForeignKey("user_profiles.user_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Subjekt des Horoskops – NULL bedeutet: der Nutzer selbst
    user_persons_id = Column(
        Integer,
        ForeignKey("user_persons.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Zweite Person für Synastrie-Vergleich (nullable — nur für context_type="synastry")
    user_person_id_2 = Column(
        Integer,
        ForeignKey("user_persons.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Fachlicher Kontext (z. B. "horoscope", "transit", "age_points", "solar", "synastry")
    context_type = Column(String(64), nullable=True)

    # Vergleichsmodus für Synastrie: "hh" (Häuservergleich) oder "rr" (Radixvergleich)
    comparison_mode = Column(String(8), nullable=True)

    # Verwendetes KI-Modell (z. B. "sonar-pro", "sonar")
    model = Column(String(64), nullable=True)

    # --- Astrologisches Datum der Interpretation ---
    # Gemeint ist z. B. das Transitdatum oder das Horoskop-Datum, nicht created.
    interp_year = Column(Integer, nullable=True)
    interp_month = Column(Integer, nullable=True)
    interp_day = Column(Integer, nullable=True)
    interp_hour = Column(Integer, nullable=True)
    interp_minute = Column(Integer, nullable=True)

    # --- Geburtsort (gilt für alle context_types) ---
    location_country = Column(Text, nullable=True)
    location_region = Column(Text, nullable=True)
    location_city = Column(Text, nullable=True)
    location_longitude = Column(Float, nullable=True)
    location_latitude = Column(Float, nullable=True)

    # --- Wohnort / Aufenthaltsort (nur relevant für context_type="transits") ---
    transit_location_latitude = Column(Float, nullable=True)
    transit_location_longitude = Column(Float, nullable=True)

    created = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Beziehungen
    user_profile = relationship(
        "UserProfile",
        primaryjoin="foreign(UserInterpretation.user_id) == UserProfile.user_id",
        back_populates="interpretations",
        uselist=False,
    )

    user_person = relationship(
        "UserPerson",
        primaryjoin="foreign(UserInterpretation.user_persons_id) == UserPerson.id",
        back_populates="interpretations",
        uselist=False,
    )

    user_person_2 = relationship(
        "UserPerson",
        primaryjoin="foreign(UserInterpretation.user_person_id_2) == UserPerson.id",
        uselist=False,
    )

    messages = relationship(
        "UserInterpretationMessage",
        back_populates="interpretation",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="UserInterpretationMessage.position",
    )


class UserInterpretationMessage(Base):
    """Eine einzelne Nachricht (Frage oder KI-Antwort) in einer Interpretations-Session.

    Die Reihenfolge im Gespräch wird durch `position` (0-basiert, aufsteigend) bestimmt.
    `role` folgt der OpenAI-Konvention: "user" | "assistant" | "system".
    """

    __tablename__ = "user_interpretation_messages"

    __table_args__ = (
        Index("ix_uim_interpretation_id", "interpretation_id"),
        Index("ix_uim_interpretation_position", "interpretation_id", "position"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)

    interpretation_id = Column(
        Integer,
        ForeignKey("user_interpretations.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Reihenfolge innerhalb der Session (0, 1, 2, …)
    position = Column(Integer, nullable=False)

    # "user" = Nutzerfrage, "assistant" = KI-Antwort, "system" = Systemprompt
    role = Column(String(16), nullable=False)

    # Inhalt der Nachricht
    content = Column(Text, nullable=False)

    created = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    interpretation = relationship(
        "UserInterpretation",
        back_populates="messages",
    )
