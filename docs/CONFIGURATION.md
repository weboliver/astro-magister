<!-- generated-by: gsd-doc-writer -->
# Configuration

Astronex is configured primarily through a single `.env` file at the repository root plus
Docker Compose service definitions and a set of Nginx templates. This document covers every
configuration surface: environment variables (from `.env.example` and `app/config.py`),
Docker Compose settings, Nginx/HTTPS/Let's Encrypt setup, the Vite frontend build/dev
configuration, and the Astro wiki configuration.

## Environment variables

All environment variables live in `.env` at the repository root. The canonical reference is
`.env.example`; `app/config.py` loads the file via `dotenv_values` (with a plain-text parser
fallback) and merges it with the process environment. `app/main.py` refuses to start if the
`.env` file does not exist.

Rotation procedures for these values and what a rotation invalidates are documented in
[SECRETS.md](SECRETS.md); this table stays the variable reference.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEBUG` | Optional | `false` | Boolean (`1`/`true`/`yes`/`on`). In dev mode relaxes `SECRET_KEY` validation, accepts placeholder Turnstile keys, runs the Vite dev server (Docker) and uses local mkcert HTTPS certificates (Nginx). |
| `SECRET_KEY` | **Required** | — | JWT signing secret, minimum 32 characters. Startup fails with `ValueError` if missing or too short and `DEBUG` is not `true`. Generate with `python -c "import secrets; print(secrets.token_hex(32))"`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Optional | `60` | JWT access-token lifetime in minutes (used by `app/config.py`, `app/services/auth.py`, `app/services/fastapi_users.py`). |
| `AUTH_COOKIE_SECURE` | Optional | `1` | `Secure` flag on the auth cookies (`app/routers/auth.py:48`; `1`/`true`/`yes`/`on` enables it). Any other value drops the flag. With the flag set the cookies only travel over HTTPS, so a login on a real host over plain HTTP fails; Chromium tolerates it on `http://localhost` (trustworthy origin), Safari does not. Documented in [API.md](API.md) as well. |
| `LOG_LEVEL` | Optional | `INFO` | Log level for the `app`, `uvicorn` and `uvicorn.access` loggers (`app/main.py`). `DEBUG` additionally logs per-request timing lines to stdout. |
| `API_HOST` | Optional | `0.0.0.0` | Declared in `.env.example` for manual uvicorn runs. The Docker Compose API container hardcodes `--host 0.0.0.0`, so this variable is not consumed there. |
| `API_PORT` | Optional | `8000` | Declared in `.env.example` for manual uvicorn runs. The Docker Compose API container hardcodes `--port 8000`. |
| `API_WORKERS` | Optional | `1` | Declared in `.env.example`. Docker Compose hardcodes `--workers 4` in production mode (4 is not configurable there). |
| `API_RELOAD` | Optional | `true` | Declared in `.env.example`. Docker Compose switches reload on/off from the `DEBUG` variable instead. |
| `EPHEMERIS_PATH` | Optional | — | Path to the Swiss Ephemeris resources; assigned to `EPHE_PATH` in `app/config.py`. |
| `SWISS_EPHE_PATH` | Optional | — | Alternative environment variable read directly from `os.environ` by `init_swisseph_path()` in `app/config.py`. Candidate paths are tried in order: `SWISS_EPHE_PATH`, `astronex/resources`, root `resources`, repo root. |
| `EPHEMERIS_YEAR_START` | Optional | `1900` | Declared in `.env.example`; not consumed by the FastAPI app code (legacy desktop-component setting). |
| `EPHEMERIS_YEAR_END` | Optional | `2100` | Declared in `.env.example`; not consumed by the FastAPI app code (legacy desktop-component setting). |
| `API_KEY` | Optional | — | Perplexity API key (`app/services/perplexity.py`). Requests fail at runtime if unset. |
| `API_BASE_URL` | Optional | `https://api.perplexity.ai/chat/completions` | Declared in `.env.example`. The Perplexity client currently uses a hardcoded URL constant (`PERPLEXITY_API_URL`) and does not read this variable. |
| `MISTRAL_API_KEY` | Optional | — | Mistral API key, required when `CHAT_PROVIDER=mistral` (`app/services/providers/mistral_client.py`). |
| `CHAT_PROVIDER` | Optional | `perplexity` | AI provider selection: `perplexity` or `mistral`. Resolution order: DB `app_settings.chat_provider` row → `CHAT_PROVIDER` env var → `perplexity`. Unknown values log a warning and fall back to `perplexity`. |
| `DISABLE_AI` | Optional | `false` | Boolean. When true, AI providers yield a German placeholder text instead of calling external APIs (used by E2E tests). |
| `BYPASS_CAPTCHA` | Optional | `false` | Boolean. Skips Turnstile captcha validation — intended for Playwright tests only. |
| `MISTRAL_CACHE_TTL` | Optional | `604800` | Mistral response cache TTL in seconds (`7 * 24 * 3600` in code). |
| `MISTRAL_CACHE_MAXSIZE` | Optional | `256` | Max entries in the Mistral local LRU cache. |
| `PERPLEXITY_CACHE_BACKEND` | Optional | `local` | Cache backend for provider responses: `local` (in-process LRU) or `redis` (requires `REDIS_URL`). Redis failures degrade to the local fallback. |
| `PERPLEXITY_CACHE_TTL` | Optional | `604800` | Perplexity response cache TTL in seconds (code default `7 * 24 * 3600`; `.env.example` sets `86400`). |
| `PERPLEXITY_CACHE_MAX` | Optional | `256` | Max entries in the Perplexity local LRU cache (`.env.example` sets `10000`). |
| `PERPLEXITY_CACHE_PREFIX` | Optional | `perplexity` | Redis key prefix for the Perplexity cache namespace. |
| `REDIS_URL` | Optional | — | Redis connection URL, e.g. `redis://redis:6379/0`. Used for the `redis` cache backend, the auth rate-limit store and the JWT blacklist. Three modes (Phase 49): (1) empty or unset = local mode — rate limits, lockout and blacklist live inside the process and no `503` is produced (dev, tests, single process); (2) set and reachable = Redis carries the counters, the blacklist and the lockout; (3) set but **not** reachable = the auth paths fail closed with `503` + `Retry-After`, while the daily AI budget degrades fail-open with one log line per call. The value is read at **import** time, so a change needs a container restart. Store keys have the form `{scope}:{subject}:{date}`, e.g. `login:ip:1.2.3.4:20261119`. |
| `TURNSTILE_SECRET_KEY` | Optional (see note) | — | Cloudflare Turnstile server secret. Placeholder values raise `ValueError` at startup unless `DEBUG=true`. |
| `VITE_TURNSTILE_SITE_KEY` | Optional | — | Turnstile site key passed to the Vite frontend (`import.meta.env.VITE_TURNSTILE_SITE_KEY` in `InvisibleTurnstile.jsx`). |
| `TURNSTILE_VERIFY_URL` | Optional | `https://challenges.cloudflare.com/turnstile/v0/siteverify` | Turnstile server-side verification endpoint (`app/services/auth_security.py`). |
| `LOGIN_RATE_LIMIT_ATTEMPTS` | Optional | `5` | Max login attempts per window per client IP. |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | Optional | `900` | Login rate-limit window in seconds. |
| `REGISTER_RATE_LIMIT_ATTEMPTS` | Optional | `5` | Max registration attempts per window. |
| `REGISTER_RATE_LIMIT_WINDOW_SECONDS` | Optional | `3600` | Registration rate-limit window in seconds. |
| `REFRESH_RATE_LIMIT_ATTEMPTS` | Optional | `30` | Max token-refresh attempts per window. |
| `REFRESH_RATE_LIMIT_WINDOW_SECONDS` | Optional | `300` | Refresh rate-limit window in seconds. |
| `FAILED_LOGIN_LOCKOUT_THRESHOLD` | Optional | `5` | Consecutive failed logins before the client IP is locked out. |
| `FAILED_LOGIN_LOCKOUT_SECONDS` | Optional | `3600` | Lockout duration in seconds after the threshold is reached. |
| `AI_DAILY_LIMIT_DEFAULT` | Optional | `5` | Daily AI-interpretation quota for regular users. |
| `AI_DAILY_LIMIT_POWERUSER` | Optional | `50` | Daily AI-interpretation quota for power users. |
| `AI_RATE_LIMIT_ATTEMPTS` | Optional | `6` | Declared in `.env.example`. Not read by the current app code — the runtime daily AI quota is controlled by `AI_DAILY_LIMIT_*`. |
| `AI_RATE_LIMIT_WINDOW_SECONDS` | Optional | `1800` | Declared in `.env.example`; not read by the current app code. |
| `DB_HOST` | Optional | `localhost` | PostgreSQL host used by SQLAlchemy when `DATABASE_URL` is not set. |
| `DB_NAME` | Optional | `astronex` | PostgreSQL database name. |
| `DB_USER` | Optional | `postgres` | PostgreSQL user. |
| `DB_PASSWORD` | Optional | `postgres` | PostgreSQL password. |
| `DATABASE_URL` | Optional | — | Full SQLAlchemy override, e.g. `postgresql+psycopg2://postgres:postgres@localhost/astronex`. Docker Compose sets it for the API container and `scripts/docker_init_postgres.sh` requires it. |
| `DB_WAIT_TIMEOUT_SECONDS` | Optional | `120` | Seconds the DB init script waits for PostgreSQL to become reachable (Docker Compose sets `180`). |
| `SEED_USERS` | Optional | `1` | When `1`, imports users/profiles/persons/tokens from `~/.astronex/users.db` (Docker Compose sets `0`). |
| `SEED_LOCATIONS` | Optional | `1` | When `1`, imports locations from `astronex/db/local.db` on first start. |
| `MIGRATE_IF_EMPTY_ONLY` | Optional | `1` | When `1`, migrations/seeding only run for tables with zero rows. |
| `FORCE_MIGRATIONS` | Optional | `0` | When `1`, runs migrations even on non-empty tables. |
| `SEED_E2E_USER` | Optional | `0` | When `1`, creates the `e2e-test-user` poweruser account on startup. |
| `ASTRONEX_HOME` | Optional | `~/.astronex` | Writable home directory for user DBs and charts (`scripts/docker_init_postgres.sh`, `scripts/migrate_users_sqlite_to_sqlalchemy.py`). |
| `CORS_ORIGINS` | Optional | *(empty)* | Comma-separated allow-list for CORS. When unset, no origins are allowed and `allow_credentials` is disabled (`app/main.py`). |
| `TRUSTED_PROXIES` | Optional | `<NETWORK_IP_PREFIX>.15` (Vorgabe `172.28.0.15`) | Comma-separated IPs trusted to set `X-Real-IP` (default is the Nginx container IP in the compose network; Docker Compose sets it to `<NETWORK_IP_PREFIX>.15` from the `.env`). `X-Forwarded-For` is only logged and never decides a rate limit, lockout or audit entry. Connections outside the compose network count with their direct peer IP — headers are ignored. |
| `NETWORK_NAME` | Optional | `astronex_internal` | Name of the bridge network the Compose stack uses (`docker/docker-compose.yml`). |
| `NETWORK_SUBNET` | Optional | `172.28.0.0/16` | Subnet of the Compose network. Change it when the range is already taken on the host (e.g. `10.99.0.0/24`). |
| `NETWORK_IP_PREFIX` | Optional | first three octets of `NETWORK_SUBNET` | Address block for the static container IPs `.10`–`.15`. If unset, `docker/build.sh`, `docker/start.sh` and `docker/update.sh` derive it from `NETWORK_SUBNET` and validate it. |
| `LETSENCRYPT_DOMAINS` | Optional | — | Comma-separated domains for Let's Encrypt certificates, e.g. `yourdomain.com,www.yourdomain.com`. |
| `LETSENCRYPT_EMAIL` | Optional | — | Email used for Let's Encrypt registration and renewal. |
| `LETSENCRYPT_STAGING` | Optional | `0` | `1` uses the Let's Encrypt staging environment (set to `0` for production). |
| `NGINX_SERVER_NAME` | Optional | `_` | Nginx `server_name` for the rendered config; falls back to `LETSENCRYPT_DOMAINS`. |
| `NGINX_CANONICAL_SOURCES` | Optional | `astro-magister.de` | Host(s) that get 301-redirected to the canonical host (comma-separated). The redirect blocks are **omitted when `DEBUG=true`**, so local hosts (e.g. `astro-magister.local`) are served directly instead of being redirected to production. |
| `NGINX_CANONICAL_HOST` | Optional | `www.astro-magister.de` | Redirect target of the canonical redirect (production only, see above). |
| `DEV_HTTPS_HOSTS` | Optional | `localhost` | Hosts used for local mkcert HTTPS in dev mode (`DEBUG=true`). |
| `DEV_SSL_CERT_PATH` | Optional | `/etc/nginx/dev-certs/localhost.local.pem` | mkcert certificate path inside the Nginx container. |
| `DEV_SSL_KEY_PATH` | Optional | `/etc/nginx/dev-certs/localhost.local-key.pem` | mkcert key path inside the Nginx container. |

### Operator notes: client IP resolution behind the proxy

The API reads the client IP exactly once (`app/services/auth_security.py:get_client_ip()`) and
reuses it for the login/registration/refresh rate limits, the failed-login lockout, the audit log
and the Turnstile verification:

- **Trusted peer → `X-Real-IP`.** nginx sets `X-Real-IP: $remote_addr` and overwrites any
  client-supplied header. After the nginx `real_ip` module has unwrapped the Cloudflare edge (only
  Cloudflare ranges are in `set_real_ip_from`), `$remote_addr` is the real client address. The value
  is validated with `ipaddress.ip_address()`; an invalid value falls back to the peer IP.
- **No trusted peer → direct connection IP.** Headers are ignored completely, so a client outside
  `TRUSTED_PROXIES` cannot choose its own identifier.
- **`X-Forwarded-For` is log information only.** nginx still forwards
  `$proxy_add_x_forwarded_for` for debugging, but it never decides a rate limit, lockout or audit
  entry.

Do **not** set uvicorn's `FORWARDED_ALLOW_IPS` / `--forwarded-allow-ips` to the compose network or
`*`. If uvicorn rewrites `request.client.host` from `X-Forwarded-For`, the peer is never the nginx
container IP, `TRUSTED_PROXIES` never matches, and the `X-Real-IP` branch silently becomes dead
code. The compose command runs uvicorn without that flag, so the default (`127.0.0.1`) applies.

### Operator notes: HTTPS cookies and the visible CAPTCHA fallback

**HTTPS is a login prerequisite.** `AUTH_COOKIE_SECURE` defaults to `1`, so the auth cookies carry
the `Secure` flag and are only sent over TLS. Serve the site through the HTTPS nginx template
(`docker/nginx.https.conf.template`) before letting users log in; on a real host over plain HTTP the
browser drops the session cookie right after a successful login. Chromium accepts `Secure` cookies on
`http://localhost` because it treats `localhost` as a trustworthy origin — Safari does not, so a local
plain-HTTP setup may look fine in Chrome and still fail in Safari.

**The visible Turnstile fallback needs the right widget mode.** The fallback area renders only a real
interactive challenge when the widget mode of the Turnstile site key is `Managed` or `Non-Interactive`
(Cloudflare → Turnstile → Widget → Settings). In the mode `Invisible` the frontend still opens the
fallback and shows the instruction, but Cloudflare renders no interactive widget, so the text sits
above an empty area. That is a pure dashboard setting — no deploy and no code change.

### Operator notes: Redis failure behaviour (fail-closed auth)

With `REDIS_URL` set, the API treats an unreachable Redis as an outage instead of silently falling
back to process-local counters (Phase 49 — the fallback that this document used to promise is gone).
`scripts/check-auth-resilience.sh` measures the behaviour live: it stops and restarts only the
`redis` service, leaves the API running, and creates and removes its own throwaway user.

- **Fail-closed, no silent weakening.** While Redis is unreachable, `POST /api/auth/login`,
  `/api/auth/register`, `/api/auth/refresh`, `/api/auth/logout` and every route behind
  `require_authenticated_user` answer `503` with `Retry-After: <seconds>` (at least `1`). The
  message is fixed (`Authentifizierung ist vorübergehend nicht verfügbar`) and names no
  infrastructure — no Redis host, no port, no exception text.
- **Optional-auth public reads fail closed as well.** Five read routes accept an optional session:
  `GET /api/wiki/entries`, `GET /api/wiki/by-slug/{slug}`, `GET /api/wiki/entries/{id}`,
  `GET /api/wiki/{category_slug}/{entry_slug}` and `GET /api/wiki/page-entries`. A request that
  carries a session (access cookie or bearer token) is checked against the JWT blacklist; while
  Redis is unreachable it answers `503` with `Retry-After` and the fixed message
  `Authentifizierung ist vorübergehend nicht verfügbar`. An anonymous request to the same URL
  still answers `200` — it has nothing to check. This is the deliberate fail-closed decision
  (variant A, 2026-11-20), not a bug: the alternative would be a silent degradation to the
  anonymous view, so an operator who needs the public page without `503` during an outage has to
  drop the session. `/chart-data` is not an optional-auth path — its router depends on
  `require_authenticated_user`, so its `503` is the ordinary fail-closed rule.
- **Auth beats AI — “Auth schlägt KI” (override 1).** Because the AI and calculation routes hang on
  `require_authenticated_user`, they are **not** reachable during an outage; the daily AI budget
  degradation below only ever applies on the rate-limit layer. That is the deliberate consequence
  of “never let anything through silently”, not a gap.
- **The AI budget degrades visibly.** A degraded call writes exactly one
  WARNING `ai_rate_limit_degraded reason=redis_unavailable scope=<scope> user=<id>` per call and is
  **not** counted. There is no local counter fallback in the configured mode, so the quota does not
  silently shrink or grow while Redis is down.
- **Time budget.** 250 ms connect timeout, 500 ms read timeout, 2 s circuit breaker per worker.
  Each worker logs the transition once: WARNING `auth_store_unavailable` when the breaker opens,
  INFO `auth_store_recovered` when it closes. Limit: with several workers (the compose default when
  `DEBUG` is off) the recovery can look mixed for up to about 2 s — the live check therefore polls
  instead of trusting a single request.
- **Local mode is not an outage.** An empty `REDIS_URL` means rate limits, lockout and blacklist
  live inside the process and no `503` is produced. That mode is meant for development and tests,
  not for a multi-worker deployment.
- **Limit of `/auth/logout-refresh`.** It has no auth dependency, stays reachable (`200`) during an
  outage and clears the cookies, but it does **not** invalidate the access token — that token stays
  valid until it expires. Only `/auth/logout` writes the blacklist and therefore answers `503`.
- **No cleanup of old keys.** Keys written before this phase (`auth:rate:*`, `ai:<date>:*`) expire
  through their TTL. A `FLUSHDB` would also wipe the JWT blacklist and the provider cache, so it is
  deliberately not part of the migration.

Do **not** read the local mode as an outage fallback in production, and do **not** expect
`REDIS_URL` to change at runtime: like the rate-limit numbers it is read when the module is
imported, so a change needs a container restart.

### Docker-only environment variables

These are set inside `docker/docker-compose.yml` (mostly not meant to be edited via `.env`):

| Variable | Value | Description |
|----------|-------|-------------|
| `PYTHONPATH` | `/workspace` | Python import path in the API container. |
| `PYTHONUNBUFFERED` | `1` | Unbuffered Python output. |
| `WATCHFILES_FORCE_POLLING` | `true` | Forces watchfiles polling for uvicorn reload under Docker. |
| `CHOKIDAR_USEPOLLING` | `true` | Forces chokidar polling for the Vite dev server under Docker. |
| `VITE_PROXY_TARGET` | `http://api:8000` | API upstream used by the Vite dev/preview proxy inside Docker. |
| `VITE_TURNSTILE_SITE_KEY` | `${VITE_TURNSTILE_SITE_KEY:-}` | Pass-through of the Turnstile site key to the frontend. |

## Config file format

### `.env` (repository root)

Plain `KEY=VALUE` lines; `#` starts a comment. Loaded by:
- `app/config.py` — `dotenv_values()` with a manual parser fallback
- `app/main.py` — `load_dotenv(env_path)`; startup **fails** with `RuntimeError` if `.env` is missing
- Docker Compose — `env_file: ../.env`
- Vite (`app/frontend/vite.config.js`) — `envDir: '../..'`, so `import.meta.env.VITE_*` reads from the repo root

### `alembic.ini`

Alembic migration config. The `sqlalchemy.url` is intentionally empty — `alembic/env.py` injects the
real URL at runtime from `DATABASE_URL`. Migration revisions are timestamped via
`file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s`.

### `app/frontend/vite.config.js`

No config file is required beyond the `.env` variables `VITE_PROXY_TARGET`
(default `http://localhost:8000`) and `VITE_ALLOWED_HOSTS` (default `localhost,127.0.0.1`).
The dev/preview server runs on port `5173` and proxies the API routes
(`/horoscope`, `/transits`, `/houses`, `/auth`, `/locations`, `/getPosition`, `/solar-return`,
`/age-points`, `/interpretations`, `/persons`, `/timezone`, `/wiki`, `/nodes`, `/synastry`).

### `app/wiki/astro.config.mjs`

The Astro wiki is configured for static output only:

```js
export default defineConfig({
  output: 'static',
})
```

No runtime server is configured; the wiki is built to `dist/` and served by Nginx under
`/astro-wiki/`. The `wiki-builder` container runs `docker/wiki-build-server.js`, which listens on
port `9000` and rebuilds on `POST /build` (`npm install --legacy-peer-deps` + `npm run build`).

## Required vs optional settings

Settings that fail at startup when missing or invalid:

- **`.env` file must exist** — `app/main.py` raises `RuntimeError` if the file is absent.
- **`SECRET_KEY`** — must be at least 32 characters; `app/config.py` raises `ValueError` if shorter
  and `DEBUG` is not `true`.
- **`TURNSTILE_SECRET_KEY`** — a placeholder value raises `ValueError` at startup in `app/main.py`
  unless `DEBUG=true` (dev mode logs a warning and disables captcha).
- **`DATABASE_URL`** — required by `scripts/docker_init_postgres.sh` (`:?` expansion fails the
  script if unset); Docker Compose always provides it for the API container.

Everything else has a default or degrades gracefully (e.g. missing `API_KEY`/`MISTRAL_API_KEY`
only fails when the respective AI provider is actually called).

## Defaults

Defaults not already listed in the environment-variable table above:

| Setting | Default | Where defined |
|---------|---------|---------------|
| Swiss Ephemeris search path | `SWISS_EPHE_PATH` → `astronex/resources` → `resources` → repo root | `app/config.py:init_swisseph_path()` |
| Nginx rate-limit zone `api` | `10r/s`, `burst=50`, `nodelay` (derived from the measured 1-s peak of API requests per client — 24 req/s → 2× = 48, rounded to 50, min 40, cap 50 — `nodelay` retained). Gilt auch für `/api/health` — es gibt genau **eine** Zone | `docker/nginx.conf`, `docker/nginx.https.conf.template`, `docker/nginx.http.conf.template` |
| Nginx `client_max_body_size` | `20m` | `docker/nginx.https.conf.template`, `docker/nginx.http.conf.template` |
| Nginx TLS versions | `TLSv1.2 TLSv1.3` | `docker/nginx.https.conf.template` |
| Nginx HSTS | `max-age=31536000; includeSubDomains` | `docker/nginx.https.conf.template` |
| Docker Compose network | `astronex_internal`, subnet `172.28.0.0/16` (both via `NETWORK_NAME` / `NETWORK_SUBNET` übersteuerbar) | `docker/docker-compose.yml` |
| Host DB port mapping | `5433:5432` | `docker/docker-compose.yml` |
| Vite dev/preview port | `5173` | `app/frontend/vite.config.js` |
| Wiki build server port | `9000` (container-internal) | `docker/wiki-build-server.js` |
| Certbot renew schedule | daily at `03:17` (`17 3 * * *`) | `docker/nginx-entrypoint.sh` |

The nginx rate-limit zones key on `$binary_remote_addr` **after** the `real_ip` module has run, so
`limit_req` counts per real client IP — not per Cloudflare edge and not per proxy hop. The zone is
only the volume brake in front of the API; the authoritative login protection is the backend limit
plus lockout (see `TRUSTED_PROXIES` above).

## Per-environment overrides

Astronex does not ship `.env.development` / `.env.production` files. Environment switching is done
through variables in the single `.env` file:

- **Development vs production API/frontend:** `DEBUG=true` runs uvicorn with `--reload` and the
  Vite dev server (`npm run dev -- --host 0.0.0.0 --port 5173`); `DEBUG=false` runs uvicorn with
  `--workers 4` and a built frontend (`npm run build && npm run preview`).
- **HTTPS mode:** with `DEBUG=true`, Nginx uses local mkcert certificates from
  `DEV_SSL_CERT_PATH`/`DEV_SSL_KEY_PATH` (hosts from `DEV_HTTPS_HOSTS`). In production it requests
  Let's Encrypt certificates for `LETSENCRYPT_DOMAINS`; `LETSENCRYPT_STAGING=1` switches to the
  staging CA for testing. Without mkcert files the entrypoint falls back to HTTP only.
- **Local host names:** with `DEBUG=true` the canonical `apex → www` redirect blocks are not
  rendered, so `http(s)://astro-magister.local` (or any host in `DEV_HTTPS_HOSTS` /
  `VITE_ALLOWED_HOSTS`) is served directly. With `DEBUG=false` the same requests are 301-redirected
  to `NGINX_CANONICAL_HOST` (default `www.astro-magister.de`).
- **Certificate bootstrap:** the Nginx entrypoint starts with HTTP-only, requests a certificate via
  `certbot certonly --webroot`, then renders the HTTPS config. If the request fails it keeps running
  in HTTP-only mode.
- **E2E testing:** set `DISABLE_AI=true`, `BYPASS_CAPTCHA=true`, `SEED_E2E_USER=1` and start the
  Docker stack; the browser suite and its configuration live in the private repository.

### Docker Compose

All services read `../.env` via `env_file`; Compose interpolation (`${VAR}`) resolves against the
same file. The stack (`docker/docker-compose.yml`, project name `astronex`) consists of:

- `db` — `postgres:16-alpine`, static IP `<NETWORK_IP_PREFIX>.10` (default `172.28.0.10`), host port `5433`
- `redis` — `redis:7-alpine`, static IP `…​.11`, append-only persistence
- `api` — built from `docker/api.Dockerfile`, static IP `…​.12`, health check against
  `http://localhost:8000/health`, runs `scripts/docker_init_postgres.sh` before uvicorn
- `frontend` — `node:20-alpine`, static IP `…​.13`, Vite dev or preview server on `5173`
- `wiki-builder` — `node:20-alpine`, static IP `…​.14`, build server on port `9000`
- `nginx` — built from `docker/nginx.Dockerfile` (`alpine:3.24` + certbot + curl),
  static IP `…​.15`, exposes ports `80` and `443`

Network name, subnet and IP block come from `NETWORK_NAME` / `NETWORK_SUBNET` / `NETWORK_IP_PREFIX`
in the `.env`; the defaults are `astronex_internal`, `172.28.0.0/16` and `172.28.0`.

The helper scripts `docker/build.sh`, `docker/start.sh`, `docker/stop.sh`, `docker/restart.sh`
and `docker/update.sh` all wrap `docker compose --project-name astronex --env-file ../.env`;
`build.sh`, `start.sh` and `update.sh` additionally source `docker/compose-network-env.sh`, which
derives `NETWORK_IP_PREFIX` from `NETWORK_SUBNET` (if not set) and validates that the static IPs
lie inside the subnet.

### Nginx routing

- `/api/` → `http://api:8000` (rate limit `burst=50 nodelay`, `/api/` prefix stripped, buffering
  off, 300 s read/send timeout, `Connection ""` to the upstream)
- `/sitemap.xml` → `http://api:8000/sitemap.xml` (both templates)
- `/astro-wiki/` and `/astro-wiki/{slug}/` → static files from `/workspace/app/wiki/dist`
- `/_astro` and `/astro-wiki/_astro` → immutable, 1-year cache
- `/` → `http://frontend:5173` (WebSocket upgrade headers forwarded)
- HTTP port 80 → 301 redirect to HTTPS; `/.well-known/acme-challenge/` served from `/var/www/certbot`
- `@ratelimited` → JSON `429` response with `Retry-After: 60`

<!-- VERIFY: Production DNS records (astro-magister.de / www.astro-magister.de) must point to this host; the Nginx templates hardcode the redirect target www.astro-magister.de. -->
<!-- VERIFY: The Cloudflare IP ranges listed in docker/nginx.conf are the official published ranges at the time of writing and should be kept in sync with https://www.cloudflare.com/ips/. -->
<!-- VERIFY: Ports 80 and 443 must be publicly reachable for Let's Encrypt issuance. -->
