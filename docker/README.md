# Docker Setup — Extended Guide

Basic Docker usage is documented in the main [README.md](../README.md).
This file covers advanced topics: GeoIP2 blocking and Let's Encrypt HTTPS.

## GeoIP2 Blocking for `/api/`

The setup blocks non-EU traffic to `/api/` by default (DE, AT, CH allowed).

Requirements in `.env`:
```bash
GEOIP2_ENABLED=1
GEOIP2_ALLOWED_COUNTRIES=DE,AT,CH
GEOIP2_LICENSE_KEY=your_maxmind_download_license_key
```

GeoIP2 database is downloaded during the nginx image build and updated monthly.
Database persists in Docker volume `docker_geoip_data`.

Manual download:
```bash
cd docker
./update_geoip_db.sh
```

Rebuild nginx after enabling:
```bash
cd docker
./build.sh --no-deps nginx
docker compose --env-file ../.env exec nginx nginx -t
```

---

## HTTPS with Let's Encrypt

Requires:
- `LETSENCRYPT_DOMAINS=example.com,www.example.com`
- `LETSENCRYPT_EMAIL=admin@example.com`
- Ports 80 and 443 publicly reachable
- Domain resolving to this host (not `localhost`/`.local`)

First start with HTTPS:
```bash
cd docker
docker compose --env-file ../.env up --build -d nginx
```

Certificates persist in Docker volumes and are reused on subsequent starts.

---

## Local HTTPS (development)

With `DEBUG=true`, the nginx container uses local mkcert certificates instead of Let's Encrypt.

```bash
mkdir -p docker/certs
mkcert -key-file docker/certs/yourserver.local-key.pem \
       -cert-file docker/certs/yourserver.local.pem \
       yourserver.local localhost 127.0.0.1 ::1
cd docker
docker compose --env-file ../.env up -d --build --force-recreate nginx
```

Required `.env` values:
```bash
DEBUG=true
DEV_HTTPS_HOSTS=yourserver.local localhost
DEV_SSL_CERT_PATH=/etc/nginx/dev-certs/yourserver.local.pem
DEV_SSL_KEY_PATH=/etc/nginx/dev-certs/yourserver.local-key.pem
```

The mkcert CA must be trusted in the browser (run on host, not in container).
If cert files are missing, nginx starts with HTTP only in dev mode.

---

## Migration notes

- Migrations run only on empty tables by default (`MIGRATE_IF_EMPTY_ONLY=1`, `FORCE_MIGRATIONS=0`).
- Users are seeded from `~/.astronex/users.db` only if `SEED_USERS=1`.
- Locations are seeded from `astronex/db/local.db` only if `SEED_LOCATIONS=1`.
- Force migration: `FORCE_MIGRATIONS=1 docker compose up -d api`
- Schema only (no seed): `SEED_USERS=0 SEED_LOCATIONS=0 docker compose up -d api`