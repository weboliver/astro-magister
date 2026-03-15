# Docker Setup (Dev + Optional HTTPS)

Dieses Setup startet vier Container:

- `db` (PostgreSQL)
- `api` (FastAPI/Uvicorn)
- `frontend` (Vite via npm)
- `nginx` (Reverse Proxy für Frontend + API, optional mit Let's Encrypt)

Der `frontend`-Service reagiert auf `DEBUG` aus der `.env`:

- `DEBUG=true`: `npm run dev -- --host 0.0.0.0 --port 5173`
- `DEBUG=false`: `npm run build && npm run preview -- --host 0.0.0.0 --port 5173`

## Start

```bash
cd docker
docker compose up --build
```

Der API-Service wird aus `docker/api.Dockerfile` gebaut (inkl. GTK/GI und Astro-Nex Font).

Danach erreichbar unter:

- App: `http://localhost/`
- API (via Nginx): `http://localhost/api/`
- API Docs (via Nginx): `http://localhost/api/docs`

Mit konfiguriertem Let's Encrypt zusätzlich unter:

- App: `https://<deine-domain>/`
- API: `https://<deine-domain>/api/`

## GeoIP2-Geoblocking fuer `/api/`

Das Setup ist fuer Geoblocking im `nginx`-Container vorbereitet. Die Sperre greift auf Anfragen unter `/api/` und laesst standardmaessig nur `DE`, `AT` und `CH` zu.

Vorbereitete Konfiguration:

- GeoIP2-Modul wird im Container installiert und in [docker/nginx.conf](docker/nginx.conf) geladen.
- Die GeoIP-Datenbank wird beim `nginx`-Image-Build heruntergeladen und beim ersten Start in ein persistentes Docker-Volume unter `/usr/share/GeoIP` uebernommen.
- Das eigentliche Geoblocking wird beim Containerstart von [docker/nginx-entrypoint.sh](docker/nginx-entrypoint.sh) erzeugt.
- Solange `nginx` laeuft, wird die GeoIP-Datenbank einmal pro 30 Tage automatisch aktualisiert und danach `nginx` neu geladen.

Benötigte `.env`-Werte:

```bash
GEOIP2_ENABLED=1
GEOIP2_ALLOWED_COUNTRIES=DE,AT,CH
GEOIP2_LICENSE_KEY=dein_maxmind_key
```

Die Datenbank-Datei wird nicht ins Repository gelegt. Du brauchst dafuer einen MaxMind-Download-Lizenzschluessel von MaxMind.

Schritte:

1. MaxMind-Account anlegen und einen `GeoLite2`-Lizenzschluessel erzeugen.
2. `GEOIP2_ENABLED=1` und `GEOIP2_LICENSE_KEY=...` in `.env` setzen.
3. `nginx` neu bauen und starten.

Beispiel:

```bash
cd docker
./build.sh --no-deps nginx
docker compose --env-file ../.env exec nginx nginx -t
```

Beim Build wird die GeoIP-Datenbank direkt in das `nginx`-Image geladen. Beim ersten Containerstart landet sie dann im Docker-Volume `docker_geoip_data`, damit spaetere Monats-Updates persistent bleiben.

Optional kannst du den Download weiterhin manuell anstossen, zum Beispiel fuer Tests ausserhalb von Docker:

```bash
cd docker
./update_geoip_db.sh
```

Wenn die Datenbank fehlt, startet `nginx` weiter ohne Geoblocking und schreibt einen Hinweis ins Log.

## Hinweise

- Beim Start führt der `api`-Container `scripts/docker_init_postgres.sh` aus und startet danach Uvicorn.
- Tabellen werden bei jedem Start mit SQLAlchemy sichergestellt (`create_all`).
- Migrationen laufen **standardmäßig nur bei leeren Tabellen**:
  - `MIGRATE_IF_EMPTY_ONLY="1"`
  - `FORCE_MIGRATIONS="0"`
- Users-Migration läuft nur, wenn zusätzlich `SEED_USERS="1"` und `~/.astronex/users.db` vorhanden ist.
- Locations-Migration läuft nur, wenn `SEED_LOCATIONS="1"` und `locations` leer ist.

## HTTPS mit Let's Encrypt

Der Nginx-Container kann Zertifikate automatisch per Certbot im Webroot-Modus erzeugen und erneuern.

Benötigte `.env`-Werte:

```bash
LETSENCRYPT_DOMAINS=example.com,www.example.com
LETSENCRYPT_EMAIL=admin@example.com
# Optional für Tests gegen die Staging-Umgebung von Let's Encrypt
LETSENCRYPT_STAGING=0
# Optional: eigener server_name, Standard ist LETSENCRYPT_DOMAINS
NGINX_SERVER_NAME=example.com www.example.com
```

Wichtig:

- Die Domain muss öffentlich auf den Host zeigen.
- Port `80` und `443` müssen von außen erreichbar sein.
- Für lokale Hosts wie `localhost` oder `.local` funktioniert Let's Encrypt nicht.
- Wenn die Let's-Encrypt-Werte fehlen, startet Nginx weiterhin nur mit HTTP.

Erster Start mit HTTPS:

```bash
cd docker
docker compose up --build -d nginx
```

Die Zertifikate werden in Docker-Volumes gespeichert und bei späteren Starts wiederverwendet.

## Lokales HTTPS im DEV-Modus mit mkcert

Wenn `DEBUG=true` gesetzt ist, bevorzugt der Nginx-Container lokale Zertifikate fuer die Entwicklung und versucht kein Let's Encrypt.

Standardpfade im Container:

- Zertifikat: `/etc/nginx/dev-certs/raspissd.local.pem`
- Schluessel: `/etc/nginx/dev-certs/raspissd.local-key.pem`

Diese Dateien werden aus dem Projektordner `docker/certs/` eingebunden.

Beispiel mit `mkcert` auf dem Host:

```bash
mkdir -p docker/certs
mkcert -key-file docker/certs/raspissd.local-key.pem -cert-file docker/certs/raspissd.local.pem raspissd.local localhost 127.0.0.1 ::1
cd docker
docker compose up -d --build --force-recreate nginx
```

Optionale `.env`-Werte fuer DEV-HTTPS:

```bash
DEV_HTTPS_HOSTS=raspissd.local localhost
DEV_SSL_CERT_PATH=/etc/nginx/dev-certs/raspissd.local.pem
DEV_SSL_KEY_PATH=/etc/nginx/dev-certs/raspissd.local-key.pem
```

Hinweise:

- `mkcert` muss auf dem Host laufen, nicht im Container, damit das lokale CA-Zertifikat im Browser vertraut wird.
- Mit `DEBUG=true` hat DEV-HTTPS Vorrang vor Let's Encrypt.
- Wenn die mkcert-Dateien fehlen, startet Nginx in DEV nur mit HTTP.

Migration bewusst erzwingen:

```bash
FORCE_MIGRATIONS=1 docker compose up -d api
```

Reines Schema ohne Datenmigration:

```bash
SEED_USERS=0 SEED_LOCATIONS=0 docker compose up -d api
```

## Stoppen

```bash
docker compose down
```

Mit Löschen des DB-Volumes:

```bash
docker compose down -v
```
