<!-- Dies ist die öffentliche Variante dieser Datei für den Spiegel (astro-magister).
     Die private Fassung liegt im Entwicklungs-Repository; Abweichungen betreffen
     ausschließlich Verweise auf private Werkzeuge, Prüfskripte, Testdokumente und
     Agentenregeln. Beitrags-, Workflow- und Lizenzabschnitte sind inhaltlich identisch. -->
# Contributing to Astronex

Thanks for considering a contribution to Astronex — astrology software for the Huber method, powered by Swiss Ephemeris 2025. It combines a GTK3 desktop app, a FastAPI backend, and a React/Vite frontend.

This document describes the ground rules for working in this repository. Please read it before opening your first pull request.

## Scope Rules: App-Only Edits

The repository contains two distinct codebases, and they are **not** treated equally:

- ✅ **`app/`** — backend (FastAPI) and frontend (React/Vite). Edit freely.
- ❌ **`astronex/`** — the GTK3 desktop application. **Do not edit** unless explicitly instructed.
- ❌ **`astronex/drawing/`** — chart graphics and Cairo rendering for the desktop app. **Do not edit** (affects the desktop app).

If your change touches the desktop application, it is out of scope for this repository's contribution workflow — coordinate with the maintainer first.

## Development Setup

See the following documents before starting:

- [README.md](README.md) — prerequisites, install, first run, and run commands
- [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md) — step-by-step setup for a fresh checkout
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system overview and data flow
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md) — environment variables and settings

Quick reference for local development:

1. **Python** — set up the system packages and the virtualenv as described in
   [docs/GETTING-STARTED.md](docs/GETTING-STARTED.md).
2. **Environment** — copy `.env.example` to `.env` and adjust values. Verify `.env` is ready before testing the Vite frontend.
3. **Database** — the Astronex database runs on port `5433` or via Docker; see `docker/docker-compose.yml`. Never point at a database directly — use Alembic migrations (see below).
4. **Hot reload** — the API and frontend watch for source changes, so there is no need to restart the containers during development.

## Verifying Before Submitting

The automated test suite and the project-wide gate live in the private repository this tree is
mirrored from; this tree ships no test suite and no test runner. A pull request here therefore
describes **how the change was verified** — a manual run of the affected endpoint or page is
enough for review, and the maintainer runs the regression suite on the private side before merging.

### Frontend build

For frontend changes, make sure the production build still succeeds:

```bash
cd app/frontend
npm ci                       # the versioned package-lock.json is the source of truth
npm run build
```

## Database & Migrations

This project uses **Alembic** for all schema changes. Rules:

- **Never migrate the database directly** — always through Alembic revisions.
- Alembic must be run **inside the `astronex-api` Docker container**, not against your local `.venv`.
- After model changes, create a new revision:

```bash
docker exec astronex-api alembic revision --autogenerate -m "description of change"
docker exec astronex-api alembic upgrade head
```

The full migration workflow is documented in the maintainers' developer guide in the private repository.

## Coding Standards

- **Backend (Python)** — no automated linter or formatter is enforced in CI; follow the existing style of `app/` and general PEP 8 conventions.
- **Frontend (JavaScript/React)** — no ESLint/Prettier configuration is present; match the style of existing components in `app/frontend/src/`.
- **Config** — project-level editor defaults are defined in `.gitignore`-tracked tooling only; keep environment-specific values in `.env` (never committed — `.env` is git-ignored).
- **Scope discipline** — changes outside `app/` are rejected (see [Scope Rules](#scope-rules-app-only-edits)).

## Git Workflow Conventions

- **`master` is protected.** Never push or merge to `master` directly. The maintainer handles remote merges manually; local feature branches are for development only.
- **Branch naming** — use prefixed branches:
  - `feature/<short-description>` — new features (e.g., `feature/theme-settings`)
  - `hotfix/<short-description>` — bug fixes (e.g., `hotfix/security-issues`)
- **Commit messages** — use the conventional commits format, with a scope matching the feature or area:

  ```
  feat(synastrie): mirror global selection as Person A
  fix(wiki): replace hardcoded colors with CSS variables
  test(synastrie): add e2e test for global person pre-selection
  docs(api): document the new houses endpoint
  refactor(auth): simplify login rate limiting
  chore: remove obsolete requirements file
  ```

  Commonly used types: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.
- **Tags** — do not create git tags without the maintainer's confirmation.

## Pull Request Guidelines

1. Create a `feature/` or `hotfix/` branch off `master`; never commit directly to `master`.
2. Keep changes scoped to `app/` unless explicitly asked to touch the desktop app.
3. Describe how you verified the change — the endpoint or page you exercised and what you observed.
4. Keep the change limited to the area you touched: the automated test suite and the project-wide gate run on the private side, not in this tree.
5. Include a `feat(...)`/`fix(...)`-style commit message describing what and why.
6. Note any environment variables, schema migrations (Alembic revision), or container changes your PR requires.

## Issue Reporting

Report bugs and feature requests via GitHub Issues at:

https://github.com/weboliver/astro-magister/issues

When reporting a bug, include:

- **Steps to reproduce** — exact inputs (e.g., birth date/time and location) and the endpoint or UI action used
- **Expected vs. actual behavior** — including any wrong astrological output, since calculation errors are the most valuable reports
- **Environment** — Docker vs. local run, `.env` settings, and whether the issue appears in the API, the web frontend, or the desktop app. Note: the API has no `/docs` page (FastAPI docs are disabled in `app/main.py` via `docs_url=None`), so reproduce API issues with `curl` against actual endpoints (e.g., `curl http://localhost:8000/health`)

## Licensing Notes

This repository bundles several components under different licenses. Respect each when contributing:

- **Astronex integration** — MIT, see [LICENSE_ASTRONEX](LICENSE_ASTRONEX)
- **Astro-Magister** — AGPL-3.0, see [LICENSE_ASTROMAGISTER](LICENSE_ASTROMAGISTER)
- **Swiss Ephemeris** — distributed by Astrodienst AG under a dual-license model (AGPL-3.0 or the Swiss Ephemeris Professional License), see [LICENSE_SWISS_EPHE](LICENSE_SWISS_EPHE)

By contributing, you agree that your contributions are made under the license(s) applicable to the component(s) you modify. Do not copy code into this repository from sources whose licenses are incompatible with the above.
