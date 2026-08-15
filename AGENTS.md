# Agents Instructions

## Constraint: App-Only Edits

**Only edit files under `app/` unless explicitly instructed otherwise.**

This project has both a backend/frontend (`app/`) and a desktop application (`astronex/`). The desktop app is separate and must not be modified unless explicitly requested.

python is available under .venv
the astronex DB is available on Port 5433 or over docker - see docker/docker-compose.yml

No need to run pip install requirements.txt!!!!

This project uses alembic do not migrate db directly
This project runs in docker do not run migrations with alembic on local .venv!!!!
Do not migrate db directly always over alembic!!!!

As the api and the frontend ist guarding Source Code Changes there is no need to restart the containers while in develop mode

- ✅ `app/**` — Edit freely
- ❌ `astronex/**` — Do NOT edit unless explicitly instructed
- ❌ `astronex/drawing/**` — Do NOT edit (affects desktop app)


## Git: Protected Branches

**`master` is protected.** Do not push or merge to master directly. The user handles remote merges manually. Local feature branches are for development only.

Do not create git tags without user confirmation.

## Before Testing Vite check if .env is ready for testing

## Sprache

**Fragen von Sprachmodellen/Agents an den User immer von Anfang an auf Deutsch stellen** — nicht
erst nach einer Aufforderung umschalten.

## New Milestone → New Branch

**Wenn ein neuer Milestone beginnt (`.planning/STATE.md` bzw. `PROJECT.md` zeigt auf einen neuen
Milestone), vor jeder Implementierung einen neuen Branch anlegen und auschecken.** Nie
Milestone-Arbeit auf dem Branch des vorherigen Milestones weiterführen — auch wenn der
Milestone-Wechsel nicht selbst ausgelöst wurde: sobald `STATE.md` auf einen neuen Milestone zeigt,
der aktuelle Branch aber noch den alten widerspiegelt, zuerst Branch anlegen.

## Testing-Disziplin: nicht spekulativ testen

**Nur das testen, was tatsächlich geändert wurde. Keine spekulativen Voll-Durchläufe.**

- Backend-Änderung: gezielt das betroffene Testmodul laufen lassen (z.B.
  `pytest tests/test_<modul>.py`), nicht die volle Suite.
- Frontend-Änderung: kein Backend-pytest-Lauf.
- Kein voller E2E-Lauf während normaler Arbeitsphasen — maximal ein gezielter Spec/Grep-Lauf.
- Der volle Suite-Lauf (Backend + E2E) ist der expliziten Regression-Phase am Ende eines
  Milestones vorbehalten.

## Nie mit Daten testen, die die KI nicht selbst erzeugt hat

**Live-Verifikation eines schreibenden Features (API-Aufrufe, DB-Schreiboperationen, Sync- oder
Import-artige Abläufe) läuft ausschließlich gegen Daten, die im selben Arbeitsschritt eigens dafür
angelegt wurden — niemals gegen echte, vom User angelegte Profile/Horoskope/Daten.** Das gilt auch,
wenn "live gegen die echte DB/den echten Service" ausdrücklich das Ziel ist — die Infrastruktur darf
echt sein, die verwendeten Daten müssen trotzdem Wegwerf-Daten sein.

## Kein visueller Test ohne explizite Aufforderung

**Kein Playwright-Browser (Snapshot, Screenshot, Navigate etc.) und kein manuelles Durchklicken im
Browser nach einer Frontend-Änderung — außer der User sagt es explizit.** Code-Änderung + ggf.
gezielter E2E-Testlauf genügt als Abschluss. Erst auf explizite Anweisung den Browser öffnen.

## .env-Sicherheit

**Nie `.env` oder eine `.gitignore`-Datei committen. `git add --force` ist nie erlaubt.** Wenn
`git add <file>` wegen `.gitignore` fehlschlägt, stoppen — die Datei darf nicht committet werden.
`.env` enthält Secrets (DB-Passwörter, API-Keys). Bei neuen Env-Variablen stattdessen eine
`.env.example`/Dokumentation pflegen.

## Leerer `task_result` ≠ gescheitert (GSD/opencode-Subagent-Lektion)

Gespawnte Subagents (`gsd-executor`, `gsd-code-reviewer` etc.) liefern gelegentlich ein leeres
`task_result` zurück, obwohl sie ihre Arbeit erledigt und committet haben — der Completion-Kanal
bricht ab, nachdem alle Tool-Calls fertig waren. **Bevor ein Plan/Review als fehlgeschlagen
behandelt und neu gespawnt wird, erst prüfen, ob Commits/Artefakte aus dem erwarteten Zeitraum
existieren** (`git log --oneline --all --since="2 hours ago"` o.ä.). Sind Commits vorhanden, ist die
Arbeit da, nur das Signal fehlt — nicht neu spawnen, sondern fehlende Artefakte (z.B. SUMMARY.md)
gezielt nachziehen.

---

*Created: 2026-05-19*