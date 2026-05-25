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

---

*Created: 2026-05-19*