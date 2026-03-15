# Astronex FastAPI Server

REST-API für astronomische Berechnungen mit Swiss Ephemeris 2025.

## Installation

Die FastAPI-Abhängigkeiten sind bereits installiert:
- fastapi
- uvicorn[standard]
- pydantic
- httpx

## Server starten

```bash
# Von der Project-Root aus:
cd ~/Projects/astronex

# Server mit uvicorn starten
python -m uvicorn api:app --host 0.0.0.0 --port 8000

# Oder mit Autoreload für Entwicklung:
python -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

Der Server wird dann verfügbar unter: **http://localhost:8000**

## API-Dokumentation

Interaktive API-Dokumentation:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Verfügbare Endpoints

### Datum/Zeit-Umwandlung

#### POST `/julday`
Konvertiert Kalenderdatum zu Julianische Tageszahl (JD)

```bash
curl -X POST "http://localhost:8000/julday" \
  -H "Content-Type: application/json" \
  -d '{"year": 2000, "month": 1, "day": 1, "hour": 12.0}'
```

Antwort:
```json
{
  "julian_day": 2451545.0,
  "year": 2000,
  "month": 1,
  "day": 1,
  "hour": 12.0
}
```

#### POST `/revjul`
Konvertiert Julianische Tageszahl zu Kalenderdatum

```bash
curl -X POST "http://localhost:8000/revjul" \
  -H "Content-Type: application/json" \
  -d '{"julian_day": 2451545.0, "gregorian_calendar": true}'
```

Antwort:
```json
{
  "year": 2000,
  "month": 1,
  "day": 1,
  "hour": 12.0
}
```

#### GET `/sidtime/{julian_day}`
Berechnet Sternzeit für einen bestimmten Zeitpunkt

```bash
curl "http://localhost:8000/sidtime/2451545.0"
```

Antwort:
```json
{
  "julian_day": 2451545.0,
  "sidereal_time": 18.697138
}
```

### Planetenpositionen

#### GET `/calc/{julian_day}/{planet_id}`
Berechnet Position eines Planeten

**Planet-IDs:**
- 0: Sonne
- 1: Mond
- 2: Merkur
- 3: Venus
- 4: Mars
- 5: Jupiter
- 6: Saturn
- 7: Uranus
- 8: Neptun
- 9: Pluto
- 10: Chiron
- 11: Lilith

```bash
# Sonnenposition (Planet 0) am 1. Januar 2000 12:00 UT
curl "http://localhost:8000/calc/2451545.0/0"
```

Antwort:
```json
{
  "julian_day": 2451545.0,
  "planets": [
    {
      "planet_id": 0,
      "planet_name": "Sun",
      "longitude": 280.3689
    }
  ],
  "status": 0
}
```

#### GET `/planets/{julian_day}`
Berechnet Positionen aller Planeten

```bash
curl "http://localhost:8000/planets/2451545.0"
```

Antwort:
```json
{
  "julian_day": 2451545.0,
  "planets": [
    {"planet_id": 0, "planet_name": "Sun", "longitude": 280.3689},
    {"planet_id": 1, "planet_name": "Moon", "longitude": 283.4162},
    {...}
  ],
  "status": 0
}
```

### Häusersystem

#### POST `/houses`
Berechnet Hausspitzen für einen Ort und Zeitpunkt

```bash
curl -X POST "http://localhost:8000/houses" \
  -H "Content-Type: application/json" \
  -d '{
    "julian_day": 2451545.0,
    "latitude": 40.7128,
    "longitude": -74.0060
  }'
```

Antwort:
```json
{
  "julian_day": 2451545.0,
  "latitude": 40.7128,
  "longitude": -74.0060,
  "houses": [
    106.5432, 140.2156, 170.8834, 257.3421, 260.5123, 280.1234,
    286.5432, 320.2156, 0.8834, 87.3421, 110.5123, 80.1234
  ]
}
```

### Fixsterne

#### POST `/fixstar`
Berechnet Position eines Fixsterns

```bash
curl -X POST "http://localhost:8000/fixstar" \
  -H "Content-Type: application/json" \
  -d '{
    "star_name": "Sirius",
    "julian_day": 2451545.0
  }'
```

Antwort:
```json
{
  "star_name": "Sirius",
  "julian_day": 2451545.0,
  "longitude": 103.2456,
  "latitude": -39.1234,
  "speed_lon": -0.005,
  "speed_lat": 0.002
}
```

### Gesundheitsprüfung

#### GET `/health`
Einfcher Health-Check

```bash
curl "http://localhost:8000/health"
```

Antwort:
```json
{
  "status": "ok",
  "timestamp": "2026-01-24T15:30:45.123456"
}
```

## Python-Beispiele

```python
import requests

BASE_URL = "http://localhost:8000"

# Julian Day berechnen
response = requests.post(f"{BASE_URL}/julday", json={
    "year": 2000,
    "month": 1,
    "day": 1,
    "hour": 12.0
})
jd = response.json()["julian_day"]

# Planetenpositionen abrufen
response = requests.get(f"{BASE_URL}/planets/{jd}")
planets = response.json()["planets"]

for planet in planets:
  print(f"{planet['planet_name']}: {planet['longitude']:.2f}°")

# Hausspitzen berechnen
response = requests.post(f"{BASE_URL}/houses", json={
    "julian_day": jd,
    "latitude": 48.8566,
    "longitude": 2.3522
})
houses = response.json()["houses"]
print(f"House 1 (Ascendant): {houses[0]:.2f}°")
```

## Entwicklung

### Mit Autoreload (für aktive Entwicklung)

```bash
python -m uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

Der Server wird automatisch neu geladen, wenn sich api.py ändert.

### Tests durchführen

```bash
python -m pytest tests/ -v
```

## Architektur

Die API basiert auf:
- **FastAPI**: Modernes Python Web-Framework
- **Pydantic**: Datenvalidierung
- **Uvicorn**: ASGI-Server
- **Swiss Ephemeris 2025**: Astronomische Berechnungen (C-Extension)

## Fehlerbehandlung

Die API gibt aussagekräftige HTTP-Status-Codes zurück:
- **200 OK**: Erfolgreiche Berechnung
- **400 Bad Request**: Ungültige Parameter oder Berechnungsfehler
- **422 Unprocessable Entity**: Validierungsfehler in den Eingabedaten

Fehlerresponse-Format:
```json
{
  "detail": "Error message describing what went wrong"
}
```

## Limits und Besonderheiten

- **Datumsbereich**: -5000 bis +5000 (empfohlen: 1900-2100)
- **Genauigkeit**: ±0.1 Bogensekunde für die Sonnenposition
- **Häusersystem**: Placidus (Standard)
- **Fixsterne**: Muss mit exaktem Name eingegeben werden (z.B. "Sirius,2025")
