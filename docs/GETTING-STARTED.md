<!-- generated-by: gsd-doc-writer -->
# Getting Started

Astronex is astrology software for the Huber method powered by Swiss Ephemeris 2025. It ships three
frontends around one ephemeris core: a GTK3 desktop app (`python nex.py`), a FastAPI REST backend
(`uvicorn app.main:app`), and a React/Vite web frontend (`app/frontend`). This guide takes you from a
fresh checkout to a running system.
For architecture and data flow see [ARCHITECTURE.md](ARCHITECTURE.md); for configuration details see
[CONFIGURATION.md](CONFIGURATION.md).

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | The repository venv is Python 3.11; the Docker image is `debian:bookworm-slim` (Python 3.11) |
| GTK 3 / GObject Introspection | — | System packages, **not** pip-installable (see below) |
| Node.js + npm | Node 20+ (LTS) | The frontend container uses `node:20-alpine` |
| Docker + Docker Compose | — | Only needed for PostgreSQL/Redis (see [docker/docker-compose.yml](../docker/docker-compose.yml)) |
| Build toolchain | — | `gcc`, `make`, `swig`, `pkg-config` for building the Swiss Ephemeris extension |
| git | — | To clone the repository |

### Ubuntu/Debian system dependencies

```bash
sudo apt update
sudo apt install -y \
  python3 python3-pip python3-venv \
  python3-gi python3-gi-cairo libgtk-3-dev libgirepository1.0-dev gobject-introspection \
  libcairo2-dev pkg-config python3-dev build-essential swig
```

GTK/GI bindings (`PyGObject`, `pycairo`) are provided by the system packages `python3-gi` and
`python3-gi-cairo` — that is why the virtual environment must be created with
`--system-site-packages` (see below). Fedora/RHEL equivalents: `gtk3-devel gobject-introspection-devel`.

## Installation steps

### 1. Clone the repository

```bash
git clone <repository-url> astronex
cd astronex
```

### 2. Create the Python virtual environment

The venv **must** be created with `--system-site-packages` so it can see the system-installed GTK/GI
bindings:

```bash
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 4. Create the `.env` file

`app/main.py` refuses to start without a `.env` file at the repository root. Copy the example and
adjust at least `SECRET_KEY` (minimum 32 characters) if you run with `DEBUG=false`:

```bash
cp .env.example .env
# SECRET_KEY: generate one with:
#   python -c "import secrets; print(secrets.token_hex(32))"
```

See [CONFIGURATION.md](CONFIGURATION.md) for the full variable reference.

### 5. Build the Swiss Ephemeris extension

The extension is precompiled for x86-64 and Raspberry Pi 5 (`_pysw.so`, `pysw.py` at the repository
root), so this step is only required if those binaries are missing or do not match your architecture:

```bash
cd ext/ext64 && make && cp _pysw.so ../.. && cp pysw.py ../.. && cd ../..
```

`make` requires `gcc`, `swig`, `pkg-config` and the Python development headers (`python3-dev`).

### 6. Install the Astro-Nex font

The chart glyphs need the `Astro-Nex` font (shipped in `astronex/resources/Astro-Nex.ttf`):

```bash
mkdir -p ~/.fonts
cp astronex/resources/Astro-Nex.ttf ~/.fonts/
fc-cache -f -v
```

### 7. Fixed stars (optional)

`astronex/resources/sefstars.txt` is shipped with the repo. To update it from the Swiss Ephemeris
archive (needed for fixed-star calculations):

```bash
wget https://www.astro.com/ftp/swisseph/sefstars.txt -O astronex/resources/sefstars.txt
```

### 8. Start PostgreSQL (for the API/web frontend)

The database runs in Docker; the host port is mapped to **5433** (container port 5432). The desktop
GTK app does **not** need this — it talks to Swiss Ephemeris directly.

```bash
cd docker
docker compose --env-file ../.env up -d db redis
cd ..
```

Migrations and seed data are applied by the Docker API container (via
`scripts/docker_init_postgres.sh`, which runs Alembic migrations and optionally seeds users/locations).
Do **not** run Alembic migrations from the local venv — migrations run inside Docker only.

To apply schema + seed data without starting the full API, run the API service once:

```bash
cd docker
docker compose --env-file ../.env up --build api
```

The seed behavior is controlled by `SEED_USERS` (imports users from `~/.astronex/users.db`),
`SEED_LOCATIONS` (imports locations from `astronex/db/local.db`) and `SEED_E2E_USER`
(creates `e2e-test-user` / `Test1234!`); all default to off in `docker-compose.yml` except
`SEED_LOCATIONS=1`.

## First run

Once installed, you can start any of the three components independently.

### GTK desktop app

```bash
source .venv/bin/activate
python nex.py
```

The desktop app needs the system GTK/GI packages and the Swiss Ephemeris extension in place.

### API backend

```bash
source .venv/bin/activate
export SWISS_EPHE_PATH="$PWD/astronex/resources"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Verify it is up:

```bash
curl http://localhost:8000/health
# → {"status": "ok", ...}
```

The root endpoint (`GET /`) returns the API name/version; interactive API docs are not exposed
(`docs_url=None` in `app/main.py`), so use the endpoints directly or the frontend.

### Web frontend (dev server)

```bash
cd app/frontend
npm install
npm run dev        # Vite dev server on http://localhost:5173
```

The Vite dev server proxies API paths (`/auth`, `/horoscope`, `/transits`, `/wiki`, …) to the
backend at `http://localhost:8000` by default (`VITE_PROXY_TARGET` in `app/frontend/vite.config.js`),
so start the API first. Make sure `.env` is ready before testing the frontend.

### First-use steps

1. **Register a user** — open http://localhost:5173 and register, or call the API directly:
   ```bash
   curl -X POST http://localhost:8000/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"myuser","password":"MyPassword123!"}'
   ```
   Turnstile captcha validation is only disabled by `BYPASS_CAPTCHA=true`; a placeholder
   `TURNSTILE_SECRET_KEY` (with or without `DEBUG=true`) does not bypass verification, so registration
   is rejected with a 400 captcha error.
2. **Make the user an admin** (optional, e.g. for `admin`) — the desktop app's `~/.astronex/users.db`
   and the Postgres `users` table share the auth model; promote a user inside the `astronex-db`
   container:
   ```bash
   docker exec -it astronex-db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
   INSERT INTO user_profiles (user_id, isadmin)
   SELECT id, TRUE
   FROM users
   WHERE username = '\''admin'\''
   ON CONFLICT (user_id)
   DO UPDATE SET isadmin = EXCLUDED.isadmin;
   "'
   ```
3. **Calculate your first chart** — in the web frontend use the horoscope page; via the API:
   ```bash
   curl -X POST http://localhost:8000/horoscope \
     -H "Content-Type: application/json" \
     -d '{"year":2026,"month":1,"day":26,"hour":12,"minute":0,"second":0,"latitude":48.0,"longitude":11.0}'
   ```
The test suite lives in the private repository this tree is mirrored from; this tree does not contain it.

## Common setup issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `RuntimeError: Missing .env file at ...` | No `.env` at the repository root | `cp .env.example .env` before starting the API |
| `ValueError: SECRET_KEY is missing or too short` | Placeholder/absent `SECRET_KEY` with `DEBUG=false` | Generate a 32+ char key (`python -c "import secrets; print(secrets.token_hex(32))"`) or set `DEBUG=true` |
| `ModuleNotFoundError: gi` / `Gtk` import failures | venv created without system site packages | Recreate with `python3 -m venv --system-site-packages .venv` and (re)install `python3-gi python3-gi-cairo` |
| `_pysw.so` build failure | Missing `gcc`/`swig`/`pkg-config`/Python headers | Install `build-essential swig pkg-config python3-dev`, then rebuild with `make` in `ext/ext64` |
| API cannot reach the database | Postgres container not running, or wrong host/port | `cd docker && docker compose --env-file ../.env up -d db`; the host port is **5433** — for local runs set `DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5433/astronex` |
| `/health` reports `degraded` with warning `Astro-Nex.ttf font not accessible — glyph PNGs will not render` | `Astro-Nex.ttf` not installed | Re-run the font step and `fc-cache -f -v` |
| Port already in use (8000 / 5173 / 5433) | Another process on the same port | Stop the conflicting process or change the port (API: `--port`, Vite: `server.port` in `vite.config.js`) |

## Next steps

- [README.md](../README.md) — project overview, API reference, Docker and deployment
- [ARCHITECTURE.md](ARCHITECTURE.md) — system overview, components and data flow
- [CONFIGURATION.md](CONFIGURATION.md) — environment variables, Docker and Nginx settings
