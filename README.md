# Astronex

Astrology software for the Huber method, powered by Swiss Ephemeris 2025. GTK3 desktop app + FastAPI backend + React/Vite frontend.

## Quick Start

### 1. System dependencies (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y \
  python3 python3-pip python3-venv \
  python3-gi python3-gi-cairo libgtk-3-dev libgirepository1.0-dev gobject-introspection \
  libcairo2-dev pkg-config python3-dev build-essential swig
```

### 2. Python packages

```bash
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Swiss Ephemeris

```bash
cd ext/ext64 && make && cp _pysw.so ../.. && cp pysw.py ../.. && cd ../..
```

### 4. Astro-Nex font

```bash
mkdir -p ~/.fonts
cp astronex/resources/Astro-Nex.ttf ~/.fonts/
fc-cache -f -v
```

### 5. Fixsterne (optional, for fixed star calculations)

```bash
wget https://www.astro.com/ftp/swisseph/sefstars.txt -O astronex/resources/sefstars.txt
```

### 6. Run

| Component | Command |
|-----------|---------|
| GTK app | `python nex.py` |
| API only | `uvicorn app.main:app --host 0.0.0.0 --port 8000` |
| Dev frontend | `cd app/frontend && npm install && npm run dev` |

---

## Installation

### Python virtual environment

Create a venv that can access system-installed GTK/GI packages:

```bash
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Swiss Ephemeris

The extension is precompiled for x86-64 and Raspberry Pi 5. Build manually if needed:

```bash
cd ext/ext64
make
cp _pysw.so ../../
cp pysw.py ../../
```

Docker builds this automatically via `docker/api.Dockerfile`.

### PostgreSQL in Docker

```bash
export DATABASE_URL='postgresql+psycopg2://postgres:postgres@db:5432/astronex'
# optional: export SEED_USERS=1 SEED_LOCATIONS=1
./scripts/docker_init_postgres.sh
```

For schema-only (no seed data):

```bash
SEED_USERS=0 SEED_LOCATIONS=0 ./scripts/docker_init_postgres.sh
```

---

## Development Setup

### Backend (API)

```bash
source .venv/bin/activate
export SWISS_EPHE_PATH="$PWD/astronex/resources"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

API docs: http://localhost:8000/docs

### Frontend

```bash
cd app/frontend
npm install
npm run dev           # dev server on http://localhost:5173
npm run build         # production build
npm run preview       # preview production build
```

### Running tests

```bash
python -m pytest tests/ -v
```

---

## Docker

Start all services (PostgreSQL, API, Frontend, Nginx):

```bash
cd docker
docker compose --env-file ../.env up --build
```

Access points:
- App: http://localhost/
- API: http://localhost/api/
- API docs: http://localhost/api/docs

### Docker environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG` | `false` | `true` uses Vite dev server on port 5173 |
| `DATABASE_URL` | `postgresql+psycopg2://...` | PostgreSQL connection string |
| `SEED_USERS` | `0` | Import users from `~/.astronex/users.db` on first start |
| `SEED_LOCATIONS` | `0` | Import locations from `astronex/db/local.db` |
| `MIGRATE_IF_EMPTY_ONLY` | `1` | Only run migrations when tables are empty |
| `FORCE_MIGRATIONS` | `0` | Run migrations even on non-empty tables |
| `GEOIP2_ENABLED` | `0` | Enable GeoIP2 blocking for `/api/` |
| `GEOIP2_ALLOWED_COUNTRIES` | `DE,AT,CH` | Countries allowed through GeoIP2 |
| `GEOIP2_LICENSE_KEY` | — | MaxMind download license key |
| `LETSENCRYPT_DOMAINS` | — | Domains for Let's Encrypt (e.g. `example.com,www.example.com`) |
| `LETSENCRYPT_EMAIL` | — | Email for Let's Encrypt certificate renewal |
| `LETSENCRYPT_STAGING` | `0` | Use Let's Encrypt staging environment |
| `DEV_HTTPS_HOSTS` | — | Hosts for local HTTPS via mkcert (e.g. `yourserver.local localhost`) |

### HTTPS with Let's Encrypt

Requires `LETSENCRYPT_DOMAINS` and `LETSENCRYPT_EMAIL`. Domain must be publicly reachable with ports 80 and 443 open. Does not work for `localhost` or `.local`.

```bash
cd docker
docker compose --env-file ../.env up --build -d nginx
```

### Local HTTPS (development)

```bash
mkdir -p docker/certs
mkcert -key-file docker/certs/yourserver.local-key.pem \
       -cert-file docker/certs/yourserver.local.pem \
       yourserver.local localhost 127.0.0.1 ::1
cd docker
docker compose up -d --build --force-recreate nginx
```

Requires `DEBUG=true` and `DEV_HTTPS_HOSTS=yourserver.local localhost` in `.env`.

### Upgrade GeoIP2 database

```bash
cd docker
./update_geoip_db.sh
# or rebuild nginx container:
./build.sh --no-deps nginx
docker compose --env-file ../.env exec nginx nginx -t
```

### Make admin user (after docker setup)

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

---

## API Reference

Base URL (local): `http://localhost:8000`
Base URL (via Nginx): `http://localhost/api/`

### Date/Time conversion

**POST /julday** — Calendar date → Julian Day

```bash
curl -X POST http://localhost:8000/julday \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12.0}'
# → {"julian_day": 2451545.0, ...}
```

**POST /revjul** — Julian Day → calendar date

```bash
curl -X POST http://localhost:8000/revjul \
  -H "Content-Type: application/json" \
  -d '{"julian_day":2451545.0,"gregorian_calendar":true}'
```

### Planet positions

**POST /calc** — Single planet position

```bash
curl -X POST 'http://localhost:8000/calc?planet_id=0' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0}'
```

Planet IDs: 0=Sun, 1=Moon, 2=Mercury, 3=Venus, 4=Mars, 5=Jupiter, 6=Saturn, 7=Uranus, 8=Neptune, 9=Pluto, 10=Chiron, 11=Lilith.

**POST /planets** — All planets

```bash
curl -X POST 'http://localhost:8000/planets' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0}'
```

### Houses

**POST /houses** — House cusps (Placidus)

```bash
curl -X POST 'http://localhost:8000/houses?latitude=48.8566&longitude=2.3522' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12}'
```

### Age Points (Progressions)

**POST /age-points**

```bash
curl -X POST http://localhost:8000/age-points \
  -H "Content-Type: application/json" \
  -d '{"year":1990,"month":6,"day":15,"hour":10,"minute":30,"kind":"radix"}'
```

### Fixed stars

**POST /fixstar**

```bash
curl -X POST 'http://localhost:8000/fixstar?star_name=Sirius' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0}'
```

### Solar Return

**POST /solar-return**

```bash
curl -X POST http://localhost:8000/solar-return \
  -H "Content-Type: application/json" \
  -d '{"birth_year":1990,"birth_month":6,"birth_day":15,"birth_hour":10,"birth_minute":30,"target_year":2026}'
```

### Horoscope

**POST /horoscope** — Compact output with planets, houses, aspects

```bash
curl -X POST http://localhost:8000/horoscope \
  -H "Content-Type: application/json" \
  -d '{"year":2026,"month":1,"day":26,"hour":12,"minute":0,"second":0,"latitude":48.0,"longitude":11.0}'
```

### Transits

**POST /transits** — Compare transit vs. natal positions

```bash
curl -X POST http://localhost:8000/transits \
  -H "Content-Type: application/json" \
  -d '{"birthday": {"year":1990,"month":6,"day":15,"hour":10,"minute":30,"second":0}, "birth_location": {"latitude":48.0,"longitude":11.0}, "transitdate": {"year":2026,"month":1,"day":26,"hour":12,"minute":0,"second":0}, "transit_location": {"latitude":48.0,"longitude":11.0}, "groupby":"aspect"}'
```

### Diagnostic

**GET /ephepath** — Show Swiss Ephemeris path and sefstars.txt status

```bash
curl http://localhost:8000/ephepath
# → {"ephe_path": "...", "sefstars_present": true}
```

### Health check

**GET /health**

```bash
curl http://localhost:8000/health
```

---

## Project Structure

```
astronex/
├── app/
│   ├── main.py              # FastAPI app, router registration, CORS, logging
│   ├── config.py            # Configuration from environment
│   ├── routers/             # HTTP endpoints per domain
│   ├── schemas/             # Pydantic request/response models
│   ├── services/            # Business logic, external integrations
│   ├── db/                  # SQLAlchemy models and sessions
│   └── frontend/            # React/Vite frontend
│       └── src/
│           ├── components/   # Shared React components
│           ├── pages/        # Page-level components
│           ├── hooks/        # Custom React hooks
│           └── utils/        # Shared utilities
├── astronex/
│   ├── nex.py               # GTK app entry point
│   ├── boss.py              # App controller
│   ├── state.py             # Application state
│   ├── chart.py             # Chart/family member logic
│   ├── directions.py        # Primary directions
│   ├── zodiac.py            # Zodiac sign calculations
│   ├── drawing/             # Chart graphics, Cairo rendering
│   ├── gui/                 # GTK GUI components
│   ├── surfaces/            # Layout surfaces
│   ├── gi_init.py           # Swiss Ephemeris initialization
│   └── resources/            # Fonts, ephemeris files, sefstars.txt
├── ext/
│   └── ext64/               # Swiss Ephemeris C extension (_pysw.so, pysw.py)
├── docker/                  # Docker Compose, Nginx, entrypoint scripts
├── scripts/
│   └── docker_init_postgres.sh
├── alembic/                 # Database migration scripts
├── tests/                  # Pytest test suite
├── requirements.txt         # Python dependencies
├── INSTALL.md               # (superseded — see this README)
├── API_GUIDE.md             # (superseded — see /docs endpoint)
└── DEVELOPMENT_MAP.md       # Developer reference (keep)
```

For detailed developer overview, see [DEVELOPMENT_MAP.md](DEVELOPMENT_MAP.md).

---

## Deployment (systemd)

```bash
sudo cp docker/astronex.service /etc/systemd/system/astronex.service
sudo systemctl daemon-reload
sudo systemctl enable astronex.service
sudo systemctl start astronex.service
```

---

## Licenses

- **Astro-Magister**: AGPL-3.0 (LICENSE_ASTROMAGISTER)
- **Astronex-Integration**: MIT (LICENSE_ASTRONEX)
- **Swiss Ephemeris**: AGPL-3.0 (LICENSE_SWISS_EPHE)

Swiss Ephemeris documentation: https://github.com/aloistr/swisseph/blob/master/readme.md