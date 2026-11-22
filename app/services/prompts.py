"""Gemeinsame Prompt-Quelle für beide Provider und alle Auswertungsarten.

Dieses Modul ist die einzige Stelle, die Prompt-Text produziert. Die Provider
(:mod:`app.services.perplexity`, :mod:`app.services.providers.mistral_client`)
bauen ihr ``system_prompt``-Dict ausschließlich aus :data:`PROMPT_KEYS`, und die
Router liefern nur noch berechnete Chart-Daten an :func:`summary_prompt`.

Die Funktionen sind rein: kein Datenbank-, Env- oder Zustandszugriff, keine
Zufallswerte. Dadurch laufen Paritätstest und Prompt-Lint ohne Netz und ohne DB.
"""
from __future__ import annotations

STUFEN: tuple[str, ...] = ("Laie", "Fortgeschritten", "Experte")

#: Neun Prompt-Arten: die acht Auswertungen aus D-01 plus ``planets``.
#: ``planets`` ist eigenständig (kein Alias auf ``horoskop``) — der Router
#: ``app/routers/positions.py`` baut einen planeten-only-Datenprompt.
PROMPT_KEYS: tuple[str, ...] = (
    "horoskop",
    "houses",
    "transits",
    "solar_return",
    "age_points",
    "mondknoten",
    "synastrie",
    "entry",
    "planets",
)

#: Die acht Auswertungsarten ohne den CMS-Redaktionsschlüssel ``entry``.
#: Alle Stufen-, Regel-, Gliederungs- und Lint-Prüfungen laufen hierüber;
#: ``entry`` ist laut Review-Korrektur 2026-11-04 stufenunabhängig.
AUSWERTUNG_KEYS: tuple[str, ...] = tuple(k for k in PROMPT_KEYS if k != "entry")


#: Gemeinsame Regeln für jede Auswertung (D-09 / TEXT-05).
#:
#: Das Überschriften-Schema steht bewusst als Ebenen-Angabe statt als
#: ``#``-Zeichen: derselbe Block ist auch die führende System-Nachricht jeder
#: Folgefrage (Plan 05) und darf dort keine Vollauswertungs-Gliederung
#: anfordern. Die Gliederung und das Wortbudget trägt der Art-Auftrag.
REGELN: str = (
    "Regeln für den gesamten Text:\n"
    "Schreibe ausschließlich auf Deutsch.\n"
    "Verwende deutsche Planeten-, Zeichen- und Aspektnamen, für Node immer Mondknoten.\n"
    "Gliedere Überschriften nur auf Ebene 2 und 3, für Abschnitte und Unterpunkte; "
    "niemals eine Überschrift auf Ebene 1.\n"
    "Schreibe keine Meta-Kommentare und keine Selbst-Einleitungen.\n"
    "Gib keine medizinischen, finanziellen oder rechtlichen Ratschläge.\n"
    "Nenne keine deterministischen Vorhersagen.\n"
)


#: Stufen-Stimme: nur Ton und Anrede, keine Abschnittszahl, keine Gliederung,
#: kein Wortbudget (D-05 bis D-07). Die du-Form steht bei Laie **und**
#: Fortgeschritten, weil der Text-Lint aus Plan 01 ``\bSie\b`` in beiden
#: Nachher-Regionen als Verstoß zählt — Gate und Prompt tragen dieselbe Regel.
STUFEN_REGELN: dict[str, str] = {
    "Laie": (
        "Stimme: Schreib so, dass der Text ohne Vorwissen verständlich ist.\n"
        "Sprich die lesende Person direkt mit du an und verwende kurze Sätze.\n"
        "Verwende keine Gradzahlen und keine Orbis-Angaben.\n"
        "Verwende kein AC/MC/IC/DC-Vokabular.\n"
        "Zähle keine Häuserspitzen auf.\n"
        "Die übergebenen Daten enthalten technische Angaben (Gradzahlen, Kürzel wie AC oder MC, "
        "Häuserspitzen) — übernimm diese Angaben nicht in den Text, sondern beschreibe den "
        "Lebensbereich in Alltagssprache.\n"
    ),
    "Fortgeschritten": (
        "Stimme: Sprich die lesende Person direkt mit du an.\n"
        "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
        "Verwende keine Gradzahlen und keine Orbis-Angaben.\n"
    ),
    "Experte": (
        "Stimme: Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
        "Du bist die einzige Stufe, die Gradzahlen und Orbis nennen darf; "
        "nutze sie, wo sie das Bild schärfen.\n"
    ),
}


#: Fachlicher Einstieg je Art — beantwortet „worum geht es hier überhaupt?“.
_ART_EINSTIEG: dict[str, str] = {
    "horoskop": (
        "Du deutest das Gesamtbild eines Horoskops: Sternzeichen, Aszendent und das "
        "Zusammenspiel der Kräfte, die diese Person ausmachen."
    ),
    "houses": (
        "Du deutest die Häuser eines Horoskops: die zwölf Lebensbereiche und das, "
        "was sie über Alltag, Beziehungen, Arbeit und Entwicklung sagen."
    ),
    "transits": (
        "Du deutest Transite: die aktuelle Entwicklung und das, was gerade in Bewegung kommt."
    ),
    "solar_return": (
        "Du deutest das Solar-Jahr: das Jahresthema und die Schwerpunkte des kommenden Jahres."
    ),
    "age_points": (
        "Du deutest Alterspunkte: die Entwicklungsschritte, die ein Lebensalter prägen."
    ),
    "mondknoten": (
        "Du deutest die Mondknoten: die Lebensaufgabe und die Richtung, in die Entwicklung geht."
    ),
    "synastrie": (
        "Du deutest ein Partnerhoroskop: die Beziehungsdynamik zwischen zwei Menschen, "
        "ihre Anziehung und ihre Reibungspunkte."
    ),
    "planets": (
        "Du deutest die Planeten eines Horoskops: die Grundkräfte, die in dieser Person wirken."
    ),
}


#: Stufenabhängiger Auftrag je Art. Trägt die Gliederung (``##``) und das
#: Wortbudget; der gemeinsame Regelblock wird beim Bauen komponiert, nicht
#: dupliziert. Je Art und Stufe genau ein Literal.
_ART_AUFTRAG: dict[str, dict[str, str]] = {
    "horoskop": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "So bist du", "Beziehungen", "Arbeit & Berufung" '
            'und "Was dir gut tut".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre die astrologischen Kräfte "
            "in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute das Gesamtbild der Person mit angemessener Tiefe, ohne Gradzahlen "
            "und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute das Gesamtbild der Person mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
    "houses": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Zuhause", "Kommunikation", "Wurzeln", "Berufung" '
            'und "Beziehungen".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre die Häuser in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute die Häuser und Lebensbereiche mit angemessener Tiefe, ohne Gradzahlen "
            "und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute die Häuser und Lebensbereiche mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
    "transits": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Was gerade wichtig ist", "Beziehungen", "Arbeit" '
            'und "Was dir jetzt hilft".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre die aktuellen Einflüsse "
            "in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute die aktuellen Transite und die Entwicklungsdynamik, ohne Gradzahlen "
            "und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute die aktuellen Transite mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
    "solar_return": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Das Jahr im Überblick", "Beziehungen", '
            '"Arbeit & Berufung" und "Was dir gut tut".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre das Jahresthema in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute das Solar-Jahr und sein Jahresthema, ohne Gradzahlen und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute das Solar-Jahr mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
    "age_points": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Was dieser Lebensabschnitt bedeutet", "Beziehungen", '
            '"Arbeit" und "Entwicklung".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre den Alterspunkt in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute die Alterspunkte und ihre Entwicklungsschritte, ohne Gradzahlen "
            "und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute die Alterspunkte mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
    "mondknoten": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Deine Lebensaufgabe", "Was du mitbringst", '
            '"Was du lernen willst" und "Alltag".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre die Mondknoten in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute die Mondknoten und die Lebensaufgabe, ohne Gradzahlen und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute die Mondknoten mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
    "synastrie": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Was euch verbindet", "Wo es reibt", '
            '"Wie ihr miteinander sprecht" und "Was euch trägt".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre die Beziehungsdynamik "
            "in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute die Beziehungsdynamik des Partnerhoroskops, ohne Gradzahlen "
            "und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute die Beziehungsdynamik des Partnerhoroskops mit Gradzahlen und Orbis, "
            "wo sie das Bild schärfen."
        ),
    },
    "planets": {
        "Laie": (
            "Gliedere den Text in 3 bis 5 Lebensbereiche als ##-Abschnitte mit je 80–120 Wörtern.\n"
            'Nutze dafür die Abschnitte "Deine Grundkräfte", "Wie du denkst", '
            '"Wie du fühlst" und "Wie du handelst".\n'
            "Schreibe kurze Sätze in der du-Form und erkläre die Planetenkräfte in Alltagssprache."
        ),
        "Fortgeschritten": (
            "Gliedere den Text in ##-Abschnitte mit je 120–180 Wörtern und nutze ### für Unterpunkte.\n"
            "Erkläre jeden Fachbegriff beim ersten Auftreten in Klammern im Fließtext.\n"
            "Deute die Grundkräfte der Planeten, ohne Gradzahlen und ohne Orbis-Werte."
        ),
        "Experte": (
            "Gliedere den Text in ##-Abschnitte mit je 200–300 Wörtern und nutze ### für Unterpunkte.\n"
            "Schreib in der Huber-Terminologie ohne Erklärung der Fachbegriffe.\n"
            "Deute die Grundkräfte der Planeten mit Gradzahlen und Orbis, wo sie das Bild schärfen."
        ),
    },
}


#: Der bisherige Redaktionsprompt des Wiki-CMS (D-04), inhaltlich unverändert.
#:
#: ``entry`` ist eine Ausnahme der Komposition: der CMS-Pfad
#: (``app/services/wiki.py``) baut ``PerplexityClient(role_type="Fortgeschritten")``
#: und übergibt den Schlüssel ``entry``. Mit ``rules_block`` und einem
#: Stufen-Auftrag bekäme der Redaktionsprompt die du-Form und die
#: Ebenen-Regel einer Auswertung — das wäre ein Umbau des CMS-Outputs, der
#: laut CONTEXT ausdrücklich nicht in Scope ist. Deshalb gibt
#: :func:`system_prompt` für ``entry`` stufenunabhängig genau diesen Text
#: zurück, und :func:`summary_prompt` wirft ``ValueError``.
_ENTRY_PROMPT: str = (
    "Du bist ein erfahrener Astrologie-Redakteur, spezialisiert auf die Erstellung von "
    "astrologischen Inhalten für eine deutschsprachige Wiki-Huber-Astrologie Seite.\n"
    "Deine Aufgabe ist es, basierend auf Titel, Bereich, Kategorie und vorhandenen Texten, "
    "einen vollständigen, gut strukturierten und fachlich fundierten Beitrag zu erstellen "
    "oder zu verbessern.\n"
    "Verwende immer Listen mit Bullet Points, um die Informationen klar und übersichtlich "
    "zu präsentieren.\n"
    "Halte dich strikt an diese Struktur. Keine Meta-Kommentare. Keine Quellenangaben.\n"
)


def _check(art: str | None, stufe: str) -> None:
    """Prüft Art und Stufe gegen die erlaubten Werte.

    Args:
        art: Prompt-Schlüssel oder ``None``, wenn nur die Stufe geprüft wird.
        stufe: Stufenname (``Laie``, ``Fortgeschritten``, ``Experte``).

    Raises:
        ValueError: Bei unbekannter Art oder Stufe. Ein Tippfehler darf nie zu
            einem gültigen System-Prompt werden (T-43-06).
    """
    if art is not None and art not in PROMPT_KEYS:
        raise ValueError(f"Unbekannte Prompt-Art: {art!r}")
    if stufe not in STUFEN:
        raise ValueError(f"Unbekannte Stufe: {stufe!r}")


def rules_block(stufe: str) -> str:
    """Gemeinsame Regeln plus Stufen-Stimme.

    Enthält bewusst **keine** Art-Struktur: dieser Block ist auch die führende
    System-Nachricht des Folgefrage-Pfads und darf dort keine zweite
    Vollauswertung anfordern.

    Args:
        stufe: Stufenname (``Laie``, ``Fortgeschritten``, ``Experte``).

    Returns:
        Regelblock als Text, Regeln und Stufen-Stimme durch eine Leerzeile
        getrennt.

    Raises:
        ValueError: Bei unbekannter Stufe.
    """
    _check(None, stufe)
    return f"{REGELN}\n\n{STUFEN_REGELN[stufe]}"


def system_prompt(art: str, stufe: str) -> str:
    """System-Prompt je Art und Stufe.

    ``entry`` liefert stets den unveränderten Redaktionsprompt. Alle anderen
    Arten komponieren Art-Einstieg, stufenabhängigen Art-Auftrag und
    Regelblock; der Auftrag erscheint bewusst im System-Prompt **und** in
    :func:`summary_prompt` (ein Literal, zwei Kompositionen).

    Args:
        art: Prompt-Schlüssel aus :data:`PROMPT_KEYS`.
        stufe: Stufenname (``Laie``, ``Fortgeschritten``, ``Experte``).

    Returns:
        Vollständiger System-Prompt-Text.

    Raises:
        ValueError: Bei unbekannter Art oder Stufe.
    """
    _check(art, stufe)
    if art == "entry":
        return _ENTRY_PROMPT
    return (
        f"{_ART_EINSTIEG[art]}\n\n"
        f"{_ART_AUFTRAG[art][stufe]}\n\n"
        f"{rules_block(stufe)}"
    )


def summary_prompt(art: str, daten: str, stufe: str) -> str:
    """Daten-Prompt je Art und Stufe: Auftrag plus berechnete Chart-Daten.

    Der Auftrag steht vor den Daten, damit die Gliederungs- und
    Längenvorgabe nicht unter dem Datenblock verschwindet.

    Args:
        art: Prompt-Schlüssel aus :data:`AUSWERTUNG_KEYS`.
        daten: Bereits formatierter Datenblock des Routers (nur Daten, keine
            Instruktionen).
        stufe: Stufenname (``Laie``, ``Fortgeschritten``, ``Experte``).

    Returns:
        Auftrag und Datenblock, mit einem abschließenden Zeilenumbruch.

    Raises:
        ValueError: Bei unbekannter Art, unbekannter Stufe oder für ``entry``
            (der CMS-Pfad baut seinen Datenprompt selbst).
    """
    _check(art, stufe)
    if art == "entry":
        raise ValueError("entry hat keinen Datenprompt; der CMS-Pfad baut ihn selbst")
    return f"{_ART_AUFTRAG[art][stufe]}\n\n{daten}".strip() + "\n"
