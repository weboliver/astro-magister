# Astronex API and APP
Astrology software for the Huber method, powered by Swiss Ephemeris.

## Übersicht
- GUI‑Anwendung (GTK3) und moderne FastAPI für Ephemeriden‑Berechnungen
- Swiss Ephemeris (2025) integriert (`pysw.py`, `_pysw.so`)
- Modularer API‑Aufbau mit Routern, Schemas und Services
- Tests mit `pytest` (25 Tests, alle grün)

Für die fachliche Aufteilung des Repos und schnelle Orientierung bei neuer Entwicklung siehe [DEVELOPMENT_MAP.md](DEVELOPMENT_MAP.md).

## Schnellstart
Siehe auch die ausführliche Installation in `INSTALL`.

### Abhängigkeiten installieren
```bash
# Ubuntu/Debian (GTK/GI + Build Tools)
sudo apt update
sudo apt install -y \
  python3 python3-pip python3-venv \
  python3-gi python3-gi-cairo libgtk-3-dev libgirepository1.0-dev gobject-introspection \
  libcairo2-dev pkg-config python3-dev build-essential swig

# Projekt-Abhängigkeiten
cd ~/Projects/astronex
python3 -m venv --system-site-packages .venv
source .venv/bin/activate
pip install -r requirements.txt

# Swiss Ephemeris bauen (64‑bit)
cd ext/ext64 && make && cp _pysw.so ../../ && cp pysw.py ../../ && cd ../..
```

### GUI starten
```bash
python nex.py
```

### API starten
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
# alternativ für Legacy-Start:
uvicorn api:app --host 0.0.0.0 --port 8000
```

### PostgreSQL in Docker initialisieren

Für Container-Deployments kann die DB (Schema + Seed-Daten) mit einem Skript vorbereitet werden:

```bash
export DATABASE_URL='postgresql+psycopg2://postgres:postgres@db:5432/astronex'
# optional:
# export DB_WAIT_TIMEOUT_SECONDS=180
# export SEED_USERS=1
# export SEED_LOCATIONS=1

./scripts/docker_init_postgres.sh
```

Das Skript wartet auf PostgreSQL, erstellt alle SQLAlchemy-Tabellen und importiert anschließend:
- Benutzerdaten aus `~/.astronex/users.db` (falls vorhanden)
- Ortsdaten aus `astronex/db/local.db`

Für reines Schema-Setup ohne Seed-Daten:

```bash
SEED_USERS=0 SEED_LOCATIONS=0 ./scripts/docker_init_postgres.sh
```

Interaktive Dokumentation: http://localhost:8000/docs

### Backend + Frontend (Entwicklung)

Kurzanleitung, um API und Frontend lokal parallel zu starten:

- Backend (API):
  ```bash
  cd ~/Projects/astronex
  source .venv/bin/activate
  # optional: setzen des EPHE-Pfads, falls benötigt
  export SWISS_EPHE_PATH="$PWD/astronex/resources"
  uvicorn app.main:app --host 0.0.0.0 --port 8000
  ```

- Frontend (Vite dev server):
  ```bash
  cd ~/Projects/astronex/app/frontend
  sudo apt-get install npm
  npm install
  npm run dev
  ```

Standardmäßig läuft der Vite‑Devserver auf http://localhost:5173 und die API auf http://localhost:8000. Für lokale Entwicklung kannst du im Browser die App auf Port 5173 öffnen; API‑Requests sollten an `http://localhost:8000` gehen.

npm run dev -- --host 0.0.0.0 --port 5173 - um von außen darauf zugreifen zu können.

## Font
https://astronomicon.co/en/astronomicon-fonts/
/astronex/resources/Astronomicon.ttf

## API‑Beispiele
- Julian Day berechnen
```bash
curl -X POST http://localhost:8000/julday \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12.0}'
```

- Julian Day zurück in Kalenderdatum (revjul)
```bash
curl -X POST http://localhost:8000/revjul \
  -H "Content-Type: application/json" \
  -d '{"julian_day":2451545.0,"gregorian_calendar":true}'
```

- Planetenposition (Sonne)
```bash
curl -X POST 'http://localhost:8000/calc?planet_id=0' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0}'
```

- Alle Planeten
```bash
curl -X POST 'http://localhost:8000/planets' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0}'
```

- Häuser (Placidus)
```bash
curl -X POST 'http://localhost:8000/houses?latitude=48.8566&longitude=2.3522' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12}'
```

- Alterspunkte (Progressionen)
```bash
curl -X POST http://localhost:8000/age-points \
  -H "Content-Type: application/json" \
  -d '{"year":1990,"month":6,"day":15,"hour":10,"minute":30,"kind":"radix"}'
```

- Fixstern (Sirius)
```bash
curl -X POST 'http://localhost:8000/fixstar?star_name=Sirius' \
  -H "Content-Type: application/json" \
  -d '{"year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0}'
```

- Solar Return (UTC)
```bash
curl -X POST http://localhost:8000/solar-return \
  -H "Content-Type: application/json" \
  -d '{"birth_year":1990,"birth_month":6,"birth_day":15,"birth_hour":10,"birth_minute":30,"target_year":2026}'
```

- Horoskop (kompakte Ausgabe mit Planeten, Häusern und Aspekten)
```bash
curl -X POST http://localhost:8000/horoscope \
  -H "Content-Type: application/json" \
  -d '{"year":2026,"month":1,"day":26,"hour":12,"minute":0,"second":0,"latitude":48.0,"longitude":11.0}'
```

- Transits (Vergleich Transit vs. Natal; `filterplanets` optional)
```bash
curl -X POST http://localhost:8000/transits \
  -H "Content-Type: application/json" \
  -d '{"birthday": {"year":1990,"month":6,"day":15,"hour":10,"minute":30,"second":0}, "birth_location": {"latitude":48.0,"longitude":11.0}, "transitdate": {"year":2026,"month":1,"day":26,"hour":12,"minute":0,"second":0}, "transit_location": {"latitude":48.0,"longitude":11.0}, "groupby":"aspect"}'
```

## Swiss Ephemeris Pfad & Fixsterne
Für Fixstern‑Berechnungen benötigt Swiss Ephemeris die Datei `sefstars.txt` im EPHE‑Pfad.

- Datei bereitstellen:
```bash
wget https://www.astro.com/ftp/swisseph/sefstars.txt -O astronex/resources/sefstars.txt
```
- Pfad optional setzen (ansonsten erkennt die API `astronex/resources` automatisch):
```bash
export SWISS_EPHE_PATH="~/Projects/astronex/astronex/resources"
```
- Diagnose:
```bash
curl http://localhost:8000/ephepath
# {"ephe_path": "/home/.../astronex/resources", "sefstars_present": true}
```

## Swiss Ephemeris Hinweise
Aktuelle Swiss Ephemeris Dokumentation:
https://github.com/aloistr/swisseph/blob/master/readme.md

## Lizenzen
- **Astro-Magister**: AGPL-3.0 (siehe LICENSE_ASTROMAGISTER)
- **Astronex-Integration**: MIT (siehe LICENSE_ASTRONEX)
- **Swiss Ephemeris**: AGPL-3.0 (siehe LICENSE_SWISS_EPHE)

## Build docker container
cd docker
docker compose --env-file ../.env up -d --build oder ./build.sh

Danach 

** Start your Website and create user (admin)

Then make him an admin:

docker exec -it astronex-db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "
INSERT INTO user_profiles (user_id, isadmin)
SELECT id, TRUE
FROM users
WHERE username = '\''admin'\''
ON CONFLICT (user_id)
DO UPDATE SET isadmin = EXCLUDED.isadmin;
"'

## Astronex als Dienst:

sudo cp ~/Projects/Python/astronex/docker/astronex.service /etc/systemd/system/astronex.service
sudo systemctl daemon-reload
sudo systemctl enable astronex.service
sudo systemctl start astronex.service
