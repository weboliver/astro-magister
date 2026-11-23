<!-- generated-by: gsd-doc-writer -->
# Astronex — Architecture

## System Overview

Astronex (product name "Astro-Magister") is an astrological web application that computes
planetary positions, houses, transits, synastry, solar returns, and age points using the
**Swiss Ephemeris** engine, and augments the raw calculations with AI-generated German-language
interpretations streamed to the browser over Server-Sent Events (SSE).

The system is layered:

- A **FastAPI backend** (`app/`) exposes a JSON + SSE API. It performs the ephemeris
  calculations through a SWIG-generated Python binding of Swiss Ephemeris (`pysw.py` /
  `_pysw.so`), reuses the GTK3 desktop app's chart and graphics core (`astronex/`), and
  calls external LLM providers (Perplexity, Mistral) for interpretation text.
- A **React/Vite single-page application** (`app/frontend/`) is the web frontend. Routing is
  `react-router` 7 (data router, `createBrowserRouter` in `src/main.jsx`): the route table lives
  in `src/routing/pages.js` (path, meta, access level, shell — the single source), `src/routes.jsx`
  derives the route objects from it, and `src/routing/pageFrame.jsx` provides the title/subtitle/
  action frame of the shell. It talks to the API through exactly one entrance — the dev server
  proxies `/api/`, nginx proxies `/api/` in production.
- A **GTK3 desktop application** (`astronex/`, "Astro-Nex") shares the same calculation core
  and is fully independent of the web stack.
- **PostgreSQL** is the primary datastore (schema managed by Alembic migrations); **Redis**
  backs the JWT blacklist, rate limiting, and the AI provider response cache.
- **nginx** terminates TLS and routes traffic to the API, the Vite frontend, and the static
  Astro wiki under `/astro-wiki/`.

Primary inputs are birth data (date, time, coordinates) and optional person pairs for
synastry; primary outputs are computed chart data (JSON), chart images (PNG), glyph images,
and streamed interpretation text.

## Component Diagram

```mermaid
graph TD
    U[Browser] --> N[nginx :80/:443<br/>docker/nginx.*.conf]
    N -->|"/api/*"| API[FastAPI API :8000<br/>app/main.py]
    N -->|"/" SPA| FE[Vite frontend :5173<br/>app/frontend]
    N -->|"/astro-wiki/*"| WIKIDIST[Astro wiki dist<br/>app/wiki/dist]

    API --> DB[(PostgreSQL 16<br/>port 5433:5432 host)]
    API --> RD[(Redis 7<br/>jwt blacklist, AI cache)]
    API --> SWISS[Swiss Ephemeris<br/>pysw.py + _pysw.so<br/>ext/ext64 sources]
    API --> NEXCORE[Shared desktop core<br/>astronex/ (chart, drawing)]
    API --> AI[AI providers<br/>Perplexity / Mistral]

    NEXCORE --> SWISS
    NEXCORE --> DESKDB[(SQLite<br/>astronex/db/local.db)]

    WIKIBUILDER[wiki-builder :9000<br/>docker/wiki-build-server.js] --> WIKIDIST
    NEXAPP[GTK3 desktop app<br/>astronex/ (Astro-Nex)] --> SWISS
    NEXAPP --> DESKDB
```

The API container (docker-compose service `api`) mounts the whole repository read-write and
imports `astronex.chart` and `astronex` rendering code directly — which is why
`docker/api.Dockerfile` installs `python3-gi`, GTK3, and Cairo bindings alongside the API
dependencies.

## Data Flow

### Request lifecycle (JSON endpoints)

1. The browser calls an API path (e.g. `/api/horoscope`); in production nginx strips the `/api`
   prefix and proxies to the `api` service on port 8000
   (`docker/nginx.https.conf.template`, `location ^~ /api/`). In development the Vite server
   proxies the same single `/api/` prefix (and strips it) to `VITE_PROXY_TARGET`
   (default `http://localhost:8000`, `vite.config.js`). `/api/` is the only API entrance on both
   paths; there are no per-feature prefixes and no separate `/theme/` location.
2. `DatabaseMiddleware` (`app/db/middleware.py`) opens a request-scoped SQLAlchemy session,
   stored on `request.state.db_session`, commits on success and rolls back on error.
3. The `log_requests` HTTP middleware (`app/main.py`) records timing into
   `PerformanceMonitor` (exposed at `app.state.performance_monitor`) and adds an
   `X-Astronex-Process-Time` response header.
4. The router validates the payload against Pydantic schemas in `app/schemas/`, calls a
   service, and returns the response model. Routers requiring authentication depend on
   `require_authenticated_user` (`app/routers/auth.py`).

### Startup sequence

`app/main.py` registers a FastAPI `lifespan` handler that runs once at boot:

1. Resolves the repository root and `~/.astronex` writable home directory.
2. `app_config.init_swisseph_path()` — locates the Swiss Ephemeris data files
   (`sefstars.txt`, `seas_18.se1` in `astronex/resources/`) and calls `pysw.setpath`.
3. `init_users_db()` (`app/services/db_init.py`) — for PostgreSQL it runs
   `alembic upgrade head` and seeds the default roles (`Laie`, `Fortgeschritten`,
   `Experte`); for SQLite (tests) it falls back to `Base.metadata.create_all`.
4. Refreshes the glyph PNG cache with the accent colors stored in the DB and installs the
   German country-name translations (`astronex.countries.install('de')`).

### AI interpretation flow (SSE endpoints)

Endpoints such as `POST /horoscope/stream`, `/planets/stream`, `/houses/stream`,
`/transits/stream`, `/solar-return/stream`, `/age-points/stream`, `/nodes/stream` and
`/synastry/stream` share one pattern:

1. The router computes the chart facts (planet longitudes, houses, aspect positions) from
   the ephemeris layer and builds a text summary.
2. It asks `get_chat_provider(role_type)` (`app/services/providers/__init__.py`) for the
   active `ChatProvider` — resolved from the `chat_provider` row in `app_settings`, falling
   back to the `CHAT_PROVIDER` env var (`perplexity` by default).
3. The provider streams completion chunks back over SSE; responses are cached
   (`app/services/providers/_cache.py`) in Redis or in-process memory. All AI endpoints
   respect `DISABLE_AI` (placeholder text) and AI-specific rate limits.
4. Interpretation sessions and their messages are persisted via
   `app/services/interpretation_store.py` (`user_interpretations`,
   `user_interpretation_messages` tables) and served back through
   `app/routers/interpretations.py`.

### Chart image rendering

`POST /horoscope/graphic`, `/houses/graphic`, `/synastry/graphic` and
`solar-return/graphic` return PNG images: the router builds an `astronex.chart.Chart`,
then `app/services/horoscope_graphics.py` renders it with Cairo. Zodiac/planet glyphs are
rendered separately by `app/services/glyph_renderer.py` (Pillow + `Astro-Nex.ttf`) and
served by `app/routers/glyphs.py` at `/sign/{index}`, `/planet/{index}`, `/background`.

### Article cover images (render-on-miss)

Wiki entries carry an optional cover selection in three columns — `cover_glyph`, `cover_bg`,
`cover_fg` (`app/db/models/wiki.py`). There is no stored file name: `app/services/wiki_covers.py`
derives the content-addressed URL `/static/wiki-covers/<hash>.webp` on every read
(`cover_url_for()`, exposed as `EntryOut.cover_url`), and the file name is a hash over the glyph,
the two preset hex values, the layout and the renderer version. The directory
`app/static/wiki-covers/` is a gitignored runtime artifact, not repository content.

Delivery is render-on-miss in two stages: nginx `location /static/wiki-covers/` serves the file
from the shared `/workspace` mount and falls back to the named `@cover_miss` location, which
proxies the unchanged path to the API. `app/routers/covers.py` answers it by rendering through
`ensure_cover()` — the single render entry, used by the write path, the bulk suggestion and the
miss endpoint alike — and answers 404 for a malformed name or a hash outside the whitelist
(35 glyphs × 50 allowed colour pairs), so a guessed URL costs one lookup instead of CPU time.

Entries without a usable selection fall back to one default image: `default_cover_url()` is an
ordinary whitelisted selection (glyph "Sonne" on the "Schiefer" background with the "Elfenbein"
symbol colour), not a file in the repository; the frontend mirrors it as `DEFAULT_COVER_URL` in
`src/services/covers.js`. It is delivered through the same render-on-miss path as every other
cover.

### Home page curation

The public start page is not a static component: `GET /wiki/home-cards` returns the curated
entries, and `app/frontend/src/pages/Dashboard.jsx` renders exactly that answer. Curation lives
on the entry itself — `home_featured` (the flag survives unpublishing) and `home_order` (dense
`1..n`), indexed as `ix_entries_home_curated`. The CMS side is admin-only: the
`GET /wiki/home-selection` endpoint returns the complete marked set including private and inactive entries
(so a label, not a silent disappearance), and `PUT /wiki/home-order` writes the whole dense order
in one call — the server, not CMS discipline, rules out duplicate `home_order` values.

## Key Abstractions

| Abstraction | Location | Purpose |
| --- | --- | --- |
| `FastAPI` app | `app/main.py` | Application entry point; lifespan, CORS, `DatabaseMiddleware`, request logging, router registration |
| `APIRouter` modules | `app/routers/*.py` | Per-feature HTTP surface (positions, houses, auth, wiki, …) |
| `DatabaseMiddleware` / `get_db_session` | `app/db/middleware.py` | Request-scoped SQLAlchemy sessions (commit/rollback/close) |
| `Base`, `engine`, `SessionLocal` | `app/db/session.py` | SQLAlchemy declarative base, engine and session factory; `DATABASE_URL` built from env (`DATABASE_URL` or `DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, port 5432) |
| `pysw` module | `pysw.py` (+ `_pysw.so`) | SWIG binding of Swiss Ephemeris: `julday`, `revjul`, `sidtime`, `calc`, `calc_ut`, `calc_ut_with_speed`, `houses`, `fixstar`, `setpath`; planet/house calls are LRU-cached (maxsize 16384) |
| `app.services.ephemeris` | `app/services/ephemeris.py` | Thin re-export of `pysw` functions used by routers |
| `ChatProvider` ABC | `app/services/providers/__init__.py` | Interface for AI providers (`stream_completion`, `chat_completion`, caching, prompt resolution); implemented by `PerplexityClient` (`app/services/perplexity.py`) and `MistralClient` (`app/services/providers/mistral_client.py`) |
| `PerformanceMonitor` | `app/services/performance.py` | Thread-safe per-route timing statistics on `app.state.performance_monitor` |
| `Chart` | `astronex/chart.py` | Shared chart computation core used by both the API and the desktop app |
| Auth helpers | `app/services/auth.py`, `auth_security.py`, `jwt_blacklist.py` | JWT issue/verify (HS256), refresh-token handling, login rate limiting/lockout, Turnstile captcha verification, Redis-backed token blacklist |
| `init_users_db` | `app/services/db_init.py` | Startup schema bootstrap via Alembic (PostgreSQL) or `create_all` (SQLite); role seeding; sequence repair |

## Directory Structure Rationale

```
astronex/
├── app/                 # Web application (backend + frontend) — the "app-only" edit zone
│   ├── main.py          # FastAPI app factory, lifespan, middleware
│   ├── config.py        # .env loading, provider selection, Swiss Ephemeris path setup
│   ├── routers/         # One module per API feature; all registered in main.py
│   ├── services/        # Business logic: ephemeris, auth, AI providers, rendering, DB init
│   ├── db/              # SQLAlchemy engine/session + ORM models (users, locations, wiki, …)
│   ├── schemas/         # Pydantic request/response models
│   ├── static/          # Sign/planet/aspect name tables (English templates + German names)
│   ├── frontend/        # React/Vite SPA (src/pages, src/services, src/contexts, …) + Playwright e2e
│   └── wiki/            # Plain Astro wiki site (astro.config.mjs, src/content) — content via CMS
├── astronex/            # GTK3 desktop app "Astro-Nex" — shares chart core with the API
│   ├── nex.py           # Desktop application bootstrap (GTK main window / console)
│   ├── boss.py          # Component manager for the desktop UI
│   ├── chart.py         # Chart computation core, reused by app/services
│   ├── drawing/         # Chart rendering surfaces
│   ├── gui/             # GTK windows, panels, dialogs
│   ├── db/local.db      # Bundled SQLite location database (reflected read-only by app/db/models/local.py)
│   └── resources/       # Fonts (Astro-Nex.ttf), images, charts.db, Swiss Ephemeris data (sefstars.txt, *.se1)
├── ext/ext64/           # Swiss Ephemeris C sources + SWIG interface (pysw.i) → _pysw.so
├── alembic/             # Database migrations (alembic.ini at repo root; 15 revision files in versions/)
├── docker/              # docker-compose services, Dockerfiles, nginx templates, helper scripts
└── scripts/             # DB bootstrap and migration helper scripts (docker_init_postgres.sh, …)
```

The split exists because the web API and the desktop application share one calculation and
rendering core: `app/services/` imports `astronex.chart` (`app/services/horoscope_graphics.py`)
and the country translation tables (`app/services/astro_env.py`) directly, while
`astronex.nexdate` is imported by `app/routers/positions.py` and `app/routers/solar.py`; the
desktop app never touches the FastAPI code.
The `app/` tree is deliberately kept separate so the desktop application (and its
`astronex/drawing/` module) can evolve without breaking the web stack.

### Deployment topology (docker-compose)

Services defined in `docker/docker-compose.yml` on a private bridge network
(default `astronex_internal`, subnet `172.28.0.0/16`; overridable via `NETWORK_NAME` /
`NETWORK_SUBNET` / `NETWORK_IP_PREFIX` in the `.env`):

| Service | Image | Fixed IP | Role |
| --- | --- | --- | --- |
| `db` | postgres:16-alpine | `<NETWORK_IP_PREFIX>.10` | Primary datastore; host port 5433 → container 5432 |
| `redis` | redis:7-alpine | `…​.11` | Token blacklist, AI response cache, rate-limit state |
| `api` | astronex-api:dev | `…​.12` | Uvicorn on 8000 (4 workers; `--reload` when `DEBUG=true`) |
| `frontend` | node:20-alpine | `…​.13` | Vite dev server or built preview on 5173 |
| `wiki-builder` | node:20-alpine | `…​.14` | HTTP build server on 9000 (`POST /build` → `npm run build` in `app/wiki`) |
| `nginx` | astronex-nginx:letsencrypt | `…​.15` | TLS termination, rate limiting, reverse proxy (host ports 80/443) |

<!-- VERIFY: deployment-time values are not verifiable from the repository alone — production: the Let's Encrypt domains, NGINX_SERVER_NAME and the certificate paths, the latter derived from PRIMARY_DOMAIN by docker/nginx-entrypoint.sh (/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem + privkey.pem) after LETSENCRYPT_DOMAINS is rendered; development only: DEV_SSL_CERT_PATH / DEV_SSL_KEY_PATH for the mkcert certificates used in the DEBUG=true branch -->

The `api` service sets `DATABASE_URL=postgresql+psycopg2://...@db:5432/...` and
`REDIS_URL=redis://redis:6379/0` explicitly; the `frontend` service passes
`VITE_PROXY_TARGET=http://api:8000` to the Vite proxy.
