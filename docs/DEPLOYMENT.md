<!-- generated-by: gsd-doc-writer -->
# Deployment

This document describes how the Astronex web stack (API, frontend, wiki, nginx) is deployed. The deployment is a Docker Compose stack orchestrated through helper scripts in [`docker/`](../docker/), optionally managed as a systemd service on the host.

## Deployment Targets

### Docker Compose stack (primary)

The whole stack runs from [`docker/docker-compose.yml`](../docker/docker-compose.yml) with the compose project name `astronex`. All services join the internal bridge network (default name `astronex_internal`, default subnet `172.28.0.0/16`) with fixed IP addresses. Name, subnet and IP block are configurable in the `.env`:

| Variable | Default | Meaning |
|----------|---------|---------|
| `NETWORK_NAME` | `astronex_internal` | Docker network name |
| `NETWORK_SUBNET` | `172.28.0.0/16` | Subnet — change it when the range is already used on the host (`docker network ls`, `ip -4 addr show`) |
| `NETWORK_IP_PREFIX` | first three octets of `NETWORK_SUBNET` | Block for the static container IPs `.10`–`.15`; may be left empty, `docker/build.sh` / `start.sh` / `update.sh` derive and validate it |

`TRUSTED_PROXIES` for the API follows `NETWORK_IP_PREFIX` automatically (`<NETWORK_IP_PREFIX>.15`), so client-IP rate limiting keeps working after a subnet change.

| Service | Image / Build | Container name | Fixed IP | Exposed ports |
|---------|---------------|----------------|----------|---------------|
| `db` | `postgres:16-alpine` | `astronex-db` | `<NETWORK_IP_PREFIX>.10` | `5433:5432` (host:container) |
| `redis` | `redis:7-alpine` (AOF enabled) | `astronex-redis` | `…​.11` | — |
| `api` | built from `docker/api.Dockerfile` → `astronex-api:dev` | `astronex-api` | `…​.12` | — |
| `frontend` | `node:20-alpine` (Vite) | `astronex-frontend` | `…​.13` | — |
| `wiki-builder` | `node:20-alpine` | `astronex-wiki-builder` | `…​.14` | — |
| `nginx` | built from `docker/nginx.Dockerfile` → `astronex-nginx:letsencrypt` | `astronex-nginx` | `…​.15` | `80:80`, `443:443` |

Persistent data lives in named volumes: `docker_postgres_data`, `docker_redis_data`, `docker_letsencrypt_data`, `docker_certbot_webroot`.

Key wiring between services:

- The **api** container mounts the repository root at `/workspace`, waits for `db` and `redis` healthchecks, then runs `scripts/docker_init_postgres.sh` (schema creation, Alembic migrations, optional seeding) before starting uvicorn (`app.main:app` on port 8000, 4 workers in non-debug mode).
- The **frontend** container runs `npm ci`, which installs strictly from the versioned `app/frontend/package-lock.json` (Phase 48), then either the Vite dev server or `npm run build && npm run preview` (port 5173) depending on `DEBUG`.
- The **wiki-builder** container runs [`docker/wiki-build-server.js`](../docker/wiki-build-server.js), a small HTTP server on port 9000 that rebuilds the Astro wiki (`app/wiki`) when it receives `POST /build`. The API triggers it from `app/routers/wiki.py`.
- **nginx** terminates HTTP/HTTPS, serves the wiki static build from `/workspace/app/wiki/dist`, and reverse-proxies `/api/` and `/sitemap.xml` while forwarding everything else to the frontend container.

### systemd unit (host service)

[`docker/astronex.service`](../docker/astronex.service) wraps the compose stack as a `Type=oneshot` systemd service (`RemainAfterExit=yes`):

- `ExecStart` → `docker/start.sh`
- `ExecStop` → `docker/stop.sh`
- `ExecReload` → `docker/start.sh`

The unit file pins `User=oliver`, `Group=docker`, and `WorkingDirectory=~/Projects/Python/astronex/docker`. Install it with:

```bash
sudo cp docker/astronex.service /etc/systemd/system/astronex.service
sudo systemctl daemon-reload
sudo systemctl enable astronex.service
sudo systemctl start astronex.service
```

<!-- VERIFY: The systemd unit hardcodes user `oliver` and path `~/Projects/Python/astronex` — adjust both if deploying under a different user or directory. -->

## Build Pipeline

There is no external CI/CD pipeline in the repository. Image builds and container updates are done locally with the helper scripts in `docker/` (all of them require a `.env` file in the project root).

### Base images

- **api** ([`docker/api.Dockerfile`](../docker/api.Dockerfile)): `ubuntu:24.04` with Python 3, a virtualenv at `/opt/venv` (`--system-site-packages` for GTK/GI/Cairo bindings), `requirements.lock.txt` installed via pip, and the Astro-Nex font registered via `fc-cache`.
- **nginx** ([`docker/nginx.Dockerfile`](../docker/nginx.Dockerfile)): `alpine:3.24` with `nginx` and `certbot`.
- **db / redis / frontend / wiki-builder**: stock upstream images (`postgres:16-alpine`, `redis:7-alpine`, `node:20-alpine`).

### Scripts

| Script | What it does |
|--------|--------------|
| [`build.sh`](../docker/build.sh) | `compose build` → repair certificate-volume ownership → `compose up -d` — builds, fixes volume ownership, and (re)creates containers |
| [`start.sh`](../docker/start.sh) | `docker compose up -d` — starts existing containers |
| [`stop.sh`](../docker/stop.sh) | `docker compose stop` — stops containers (data volumes persist) |
| [`restart.sh`](../docker/restart.sh) | stop + start, optionally restricted to specific service names |
| [`update.sh`](../docker/update.sh) | pull (excluding `api`/`nginx`), rebuild with `--no-cache --pull`, then `up -d --force-recreate` |

All scripts use `docker compose --project-name astronex --env-file ../.env -f docker-compose.yml` internally.

### First start / build

```bash
cd docker
./build.sh          # or: ./start.sh after the first build
```

For fine-grained control (e.g., only rebuild nginx), pass service names as arguments: `./build.sh --no-deps nginx`.

## Environment Setup

The stack reads configuration exclusively from the `.env` file in the project root (passed via `--env-file ../.env` on the compose command line and via `env_file: ../.env` on the `db`, `api`, `frontend` and `nginx` services). Without it, the helper scripts abort with an error.

For production, at minimum set:

| Variable | Purpose |
|----------|---------|
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL database name/credentials (used by `db` and injected into `DATABASE_URL`) |
| `SECRET_KEY` | JWT signing secret — must be a long random value |
| `DEBUG` | `false` for production (uvicorn workers + built frontend) |
| `LETSENCRYPT_DOMAINS` | Comma-separated public domains (e.g. `example.com,www.example.com`) |
| `LETSENCRYPT_EMAIL` | Email address for Let's Encrypt certificate issuance/renewal |
| `LETSENCRYPT_STAGING` | `0` for production, `1` to use the Let's Encrypt staging environment |
| `NGINX_SERVER_NAME` | `server_name` for the nginx virtual host (falls back to `LETSENCRYPT_DOMAINS`) |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key for the frontend |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key for the API |

Before deploying, run `bash scripts/check-env-defaults.sh` from the repository root. It compares `.env` against `.env.example` and exits `1` as long as a value is still the shipped example; it prints **only variable names** — never a value — and it does **not** check for missing variables. Rotation steps for every secret are in [SECRETS.md](SECRETS.md).

Migrations run on the api container's startup and are controlled by `MIGRATE_IF_EMPTY_ONLY` (default `1`) and `FORCE_MIGRATIONS` (default `0`); seeding is controlled by `SEED_E2E_USER` (interpolated from `.env`, default `0`), while `SEED_USERS` (`0`) and `SEED_LOCATIONS` (`1`) are pinned in the compose file and override any value in `.env`.

See [CONFIGURATION.md](CONFIGURATION.md) for the full environment variable reference, including rate-limit tuning and AI-provider settings.

## HTTPS

**HTTPS is not optional for logins.** `AUTH_COOKIE_SECURE` defaults to `1` (`app/routers/auth.py:49`), so the auth cookies are `Secure` and the browser only sends them back over TLS. Over plain HTTP the session cookie is lost directly after the login and the user lands logged out. Chromium tolerates `Secure` cookies on `http://localhost` because it treats `localhost` as a trustworthy origin; real hosts and Safari do not. Use the HTTPS configuration below for anything users actually log in to.

**Visible CAPTCHA fallback:** for the fallback area in the login/register forms to show a real challenge, the widget mode of the Turnstile site key must be `Managed` or `Non-Interactive` (Cloudflare → Turnstile → Widget → Settings). With the mode `Invisible` the frontend still opens the fallback, but Cloudflare renders no interactive widget and the instruction sits above an empty area. This is a dashboard setting only — no redeploy required.

### Let's Encrypt (production)

The nginx container's entrypoint ([`docker/nginx-entrypoint.sh`](../docker/nginx-entrypoint.sh)) orchestrates certificate handling:

1. On first start it renders the HTTP-only config and starts nginx so the ACME webroot (`/var/www/certbot`, volume `docker_certbot_webroot`) is reachable.
2. If no certificate exists yet, it runs `certbot certonly --webroot` for all domains in `LETSENCRYPT_DOMAINS` (using `LETSENCRYPT_EMAIL`; `LETSENCRYPT_STAGING=1` adds `--staging`).
3. Once certificates are present (or issued), it renders the HTTPS config from [`docker/nginx.https.conf.template`](../docker/nginx.https.conf.template) and serves TLS 1.2/1.3 with HSTS.
4. Certificates persist in the `docker_letsencrypt_data` volume and are reused on subsequent starts.

Renewal is automatic: the nginx entrypoint starts a background loop that runs [`docker/certbot-renew.sh`](../docker/certbot-renew.sh) after about a minute and then every 12 hours; the script renews via webroot and reloads nginx via a deploy hook. A `crond` job is not used — busybox `crond` cannot run jobs as a non-root user. The renew log is written to `/var/log/certbot-renew.log` inside the container.

Requirements for Let's Encrypt: public domain(s) resolving to the host, ports 80 and 443 reachable from the internet, and `LETSENCRYPT_DOMAINS` + `LETSENCRYPT_EMAIL` set. It does not work for `localhost` or `.local` domains.

> Note: both nginx templates contain a canonical redirect block (apex → www) built from the placeholders `__CANONICAL_SOURCES__` and `__CANONICAL_HOST__`; the templates themselves hold no domain names. The defaults `astro-magister.de` → `https://www.astro-magister.de` are set in [`docker/nginx-entrypoint.sh`](../docker/nginx-entrypoint.sh) (`NGINX_CANONICAL_SOURCES` / `NGINX_CANONICAL_HOST`, lines 22-23) and injected by `render_http_conf`/`render_https_conf`, so set those environment variables in `.env` if your production domain differs — editing the templates is the wrong place. <!-- VERIFY: `astro-magister.de` / `www.astro-magister.de` are the live production hostnames; DNS and public IP records for this host are not in the repository. -->

### mkcert (local development HTTPS)

With `DEBUG=true`, the entrypoint uses locally generated mkcert certificates from `docker/certs/` (mounted read-only at `/etc/nginx/dev-certs`) instead of Let's Encrypt:

```bash
mkdir -p docker/certs
mkcert -key-file docker/certs/yourserver.local-key.pem \
       -cert-file docker/certs/yourserver.local.pem \
       yourserver.local localhost 127.0.0.1 ::1
```

Required `.env` values for dev HTTPS:

```bash
DEBUG=true
DEV_HTTPS_HOSTS=yourserver.local localhost
DEV_SSL_CERT_PATH=/etc/nginx/dev-certs/yourserver.local.pem
DEV_SSL_KEY_PATH=/etc/nginx/dev-certs/yourserver.local-key.pem
```

The mkcert CA must be trusted in the browser (run on the host, not inside the container). If the certificate files are missing, nginx falls back to plain HTTP even in dev mode. A pre-generated `raspissd.local` certificate pair exists in `docker/certs/`. <!-- VERIFY: `raspissd.local` is the development hostname used for the pre-generated mkcert certificates. -->

Nginx also trusts Cloudflare's published IP ranges as the source for the real client IP (`set_real_ip_from` in [`docker/nginx.conf`](../docker/nginx.conf)) and applies rate limits: 10 r/s on the API zone (`burst=50 nodelay`); excess requests receive a JSON `429` response.

## Nginx Routing

Both server templates ([`docker/nginx.https.conf.template`](../docker/nginx.https.conf.template) for TLS, [`docker/nginx.http.conf.template`](../docker/nginx.http.conf.template) for the HTTP-only first start) declare the same locations; the shared directives (`limit_req_zone`, the `$robots_tag` map, `set_real_ip_from`) live in [`docker/nginx.conf`](../docker/nginx.conf).

### One API entrance: `location ^~ /api/`

```nginx
location ^~ /api/ {
    limit_req zone=api burst=50 nodelay;
    rewrite ^/api/(.*)$ /$1 break;
    proxy_pass http://api:8000;
    …
}
```

The `^~` modifier locks the namespace against future regex locations; it is functionally inert today, because the only regex locations match `/astro-wiki/`. The `rewrite` strips the `/api` prefix, so `POST /api/horoscope` reaches the API as `POST /horoscope` — the backend stays prefix-free and the Vite dev proxy (`^/api/` with the same strip, `app/frontend/vite.config.js`) is byte-identical to the edge. There is no second API location and no separate `/theme/` location: theme requests are `/api/theme/...` like every other API path.

`/sitemap.xml` is the one exception: `location = /sitemap.xml` proxies explicitly to `http://api:8000/sitemap.xml`, because the sitemap is generated by the API but has to live at the root for crawlers.

### `robots.txt` and `X-Robots-Tag`

`robots.txt` has no location of its own — it is served by the SPA fallback `location /` from the frontend container, i.e. from `app/frontend/public/robots.txt`. Its content allows everything and only disallows `/api/` (there is no crawlable content there; blocking a page would cancel its `noindex`), and points to the absolute `Sitemap:` URL.

The `X-Robots-Tag` header comes from exactly one map in `docker/nginx.conf` (`map $uri $robots_tag`): default `noindex, nofollow`, with `index, follow` for `/`, for `^/astro-wiki(/|$)` and for `/sitemap.xml`. The server block freezes the value with `set $robots_header $robots_tag` before `add_header` reads it, because `add_header` is evaluated in the header filter — after `try_files` has rewritten `$uri` to a file path (`/astro-wiki/` → `/index.html`), which would otherwise mark the whole wiki `noindex`. Every location that declares its own `add_header` (`/_astro`, `/astro-wiki/_astro`, `/static/wiki-covers/`, `@cover_miss`) repeats the server-level headers (`Strict-Transport-Security`, `X-Robots-Tag`) — nginx replaces the inherited set completely in that case.

### Redirects and static paths

| Rule | Target | Purpose |
|---|---|---|
| apex → canonical host (301) | `https://<NGINX_CANONICAL_HOST>$request_uri` | `canonical-redirect` block, rendered from `NGINX_CANONICAL_SOURCES`/`NGINX_CANONICAL_HOST`; the entrypoint removes the block when `DEBUG=true` |
| `http://` → `https://` (301) | `https://$host$request_uri` | the port-80 server block |
| `= /astro-wiki` (301) | `https://$host/astro-wiki/` | missing trailing slash on the wiki index |
| `~ ^/astro-wiki/([^/]+)$` (301) | `https://$host/astro-wiki/$1/$is_args$args` | slug without trailing slash. The target is a fixed path — `$host` appears only as the host part and `$request_uri` never as the target, so it is not an open redirect; the query survives. The regex does not match `_astro/...` (further slashes) and loses against the exact `=` locations |
| `= /houses` (301) | `https://$host/` | the removed house chart page. The client-side `<Navigate replace>` in `app/frontend/src/routes.jsx` stays as the second line of defence |

Static delivery: `= /astro-wiki/` serves `dist/index.html`, the exact locations `= /astro-wiki/impressum/`, `…/datenschutz/`, `…/kontakt/` serve their `index.html`, and `~ ^/astro-wiki/([^/]+)/$` maps an entry to `dist/wiki/<slug>/index.html`. `/_astro` and `/astro-wiki/_astro` are cached for a year as `immutable`; `/static/wiki-covers/` serves the article covers and falls back to the named `@cover_miss` location, which lets the API render a missing (but whitelisted) cover. Everything else falls through to `location /` → `http://frontend:5173`, and `error_page 429` answers with the JSON `@ratelimited` handler.

<!-- VERIFY: which of these locations is live depends on the deployment mode — DEBUG=true renders the HTTP template with mkcert certificates, production renders the HTTPS template via certbot. The statements above are read from the two templates in the repository. -->

## Update Process

[`docker/update.sh`](../docker/update.sh) performs a full stack update:

1. Pulls new images for all services **except** `api` and `nginx` (those are always rebuilt from source).
2. Rebuilds all buildable services with `--no-cache --pull`.
3. Recreates containers with `docker compose up -d --force-recreate`.

```bash
cd docker
./update.sh
```

To update a single service, pass its name: `./update.sh frontend`. After updating the API, the container's startup migration logic decides whether Alembic migrations are applied (`MIGRATE_IF_EMPTY_ONLY`/`FORCE_MIGRATIONS`).

## Backups

Backup tooling lives in [`docker/backup/`](../docker/backup/) and backs up the PostgreSQL database using `docker exec astronex-db pg_dump` (custom format, gzip-compressed), so no host-side PostgreSQL client or network credentials are needed.

| Script | Purpose |
|--------|---------|
| [`backup.sh`](../docker/backup/backup.sh) | Creates a timestamped `astronex-YYYYMMDD-HHMMSS.sql.gz` backup in `backups/{daily,weekly,monthly}/` and prunes old files. Tier selection: 1st of month → monthly, Sunday → weekly, otherwise daily. Retention: 7 daily, 4 weekly, 12 monthly. Sources `DB_*` variables from `.env` only. |
| [`verify-backup.sh`](../docker/backup/verify-backup.sh) | Validates a backup (or the latest of a tier) via file-size check, gzip validity, and a `pg_restore --list` dry run. |
| [`restore.sh`](../docker/backup/restore.sh) | Restores a backup to `astronex_test` (default) or `astronex` (`--target=production`). Validates the file, terminates connections, drops/recreates the target database, restores via `pg_restore`, and reports the table count. |

Manual backup:

```bash
cd docker
./backup/backup.sh
```

Automated daily backup (recommended cron entry, from the project root):

```bash
0 2 * * * cd ~/Projects/Python/astronex && ./docker/backup/backup.sh >> /var/log/backup.log 2>&1
```

Backup directories are created relative to the project root (`backups/daily`, `backups/weekly`, `backups/monthly`) and are not Docker volumes — copy them off the host for off-site storage. Detailed restore steps and troubleshooting are in [`docker/backup/RESTORE.md`](../docker/backup/RESTORE.md).

## Rollback Procedure

There is no automated deployment and no automated rollback; the local check run checks the stack, it does not deploy or revert it. To revert a bad deployment:

1. **Stop the application** — `cd docker && ./stop.sh` (do not run `docker compose down` on a failed DB restore; that would remove the container, and data volumes persist only if untouched).
2. **Revert the code** — checkout the previous release on the host (e.g., `git checkout <previous-tag-or-commit>`), then rebuild and restart:
   ```bash
   cd docker
   ./build.sh
   ./start.sh
   ```
   The api/nginx images are always tagged `astronex-api:dev` / `astronex-nginx:letsencrypt`, so a rebuild from the reverted sources reproduces the previous stack.
3. **Restore the database if data was affected** — verify a known-good backup first, then restore:
   ```bash
   ./docker/backup/verify-backup.sh backups/weekly/astronex-<timestamp>.sql.gz
   ./docker/backup/restore.sh --filename=backups/weekly/astronex-<timestamp>.sql.gz --target=production
   ```
4. **Restart and sanity-check** — `./start.sh`, then check `docker compose ps` and the nginx/API health endpoints.

## Monitoring

No dedicated APM/error-tracking SDK (Sentry, Datadog, New Relic, OpenTelemetry) is configured in `requirements.txt` or the Docker images. Runtime observability relies on:

- **Docker healthchecks** — `db` (`pg_isready`), `redis` (`redis-cli ping`), `api` (HTTP GET `http://localhost:8000/health`), `wiki-builder` (`nc -z localhost 9000`). `nginx` waits for the api healthcheck and the frontend container before starting.
- **Logs** — `docker compose logs -f <service>`; nginx access/error logs are written inside the nginx container (`/var/log/nginx/`); certbot renewal logs to `/var/log/certbot-renew.log` in the container.
- **API health endpoint** — `GET /health` on the API (exposed via nginx at `/api/health`).
- **systemd** — `sudo journalctl -u astronex.service` and `systemctl status astronex.service` for host-level service state.

<!-- VERIFY: No external monitoring dashboards, alerting endpoints, or uptime services are referenced in the repository. -->
