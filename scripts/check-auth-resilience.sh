#!/usr/bin/env bash
# Prüfskript der Auth-Resilienz (Phase 49, D-23) — der MUTIERENDE Beleg gegen den laufenden
# Compose-Stack. Es ist die Ausnahme unter den Prüfern: alle anderen lesen nur, dieses Skript
# stoppt und startet den redis-Service. Die API bleibt dabei stehen.
#
# Öffentlicher Vertrag (wörtlich wie scripts/check-container-hardening.sh):
#   Exit 0 — alle Prüfungen grün; letzte Zeile "ALLE PRÜFUNGEN GRÜN".
#   Exit 1 — mindestens eine Abweichung; letzte Zeile "<n> Prüfung(en) rot".
#   Exit 2 — die Prüfung ist gar nicht möglich: curl fehlt, /api/health antwortet nicht mit 200,
#            BYPASS_CAPTCHA ist nicht true, redis antwortet nicht mit PONG, oder `stop redis` ist
#            selbst gescheitert. Exit 2 ist Vorbedingung, nicht Befund.
#
# Bewusst `set -uo pipefail` OHNE `-e`: ein Prüfer muss nach einem Fehlschlag weiterlaufen, sonst
# bliebe jeder zweite Befund unsichtbar (Stil von scripts/test-spec.sh, dort mit `-e`, weil es
# ein Teststarter und kein Prüfer ist).
#
# Jede Zeile gibt den GEMESSENEN Wert aus, nicht den erwarteten — nur so ist eine rote Zeile
# zitierbar.
#
# Reihenfolge ist bindend (Pitfall 10): erst registrieren, einloggen und ausloggen (Blacklist
# schreiben), DANN redis stoppen. Würde während des Ausfalls ausgeloggt, fände der Blacklist-Teil
# keinen entwerteten Token. Die drei Vorbedingungen laufen vor dem ersten mutierenden Schritt
# (Pitfall 12); der `trap` steht vor dem ersten `stop` und startet redis in JEDEM Fall wieder —
# auch bei Befund, Fehler oder Abbruch. Verwendet werden ausschließlich `stop` und `start` des
# redis-Service; ein Neustart der API oder ein Neubau der Container findet hier nicht statt.
#
# Wegwerf-Daten (D-25, AGENTS.md § "Nie mit Daten testen, die die KI nicht selbst erzeugt hat"):
# Das Skript legt seinen Nutzer selbst an (resilience_probe_<zeitstempel>_<pid>) und baut ihn auf
# JEDEM Exit-Pfad wieder ab — Normalabschluss, Befund, Exit 2 und SIGTERM/INT —, weil der Abbau in
# `cleanup_throwaway_user` lebt und der EXIT-Trap ihn aufruft; der lineare Abschluss ruft dieselbe
# idempotente Funktion. Reihenfolge immer refresh_tokens -> user_profiles -> users.
# auth_audit_logs-Zeilen dieses Namens bleiben stehen (Audit-Historie, kein Personenbezug) und
# werden als solche benannt. Kein FLUSHDB, kein DEL auf fremde Keys, kein Zugriff auf bestehende
# Nutzerdaten.
#
# Auswertung ohne JSON-Werkzeug (auf diesem Host ist keines installiert): Statuscode über
# `curl -w '%{http_code}'`, Header über grep/sed, der Access-Token über die Cookie-Jar-Datei
# unter einem mktemp-Verzeichnis. Ausgegeben werden nur Statuscodes, Header-Werte, der gemessene
# Redis-Key und die generierte username — keine Tokens, keine Passwörter, keine .env-Inhalte.
#
# Aufruf:
#   scripts/check-auth-resilience.sh
#   AUTH_RESILIENCE_BASE_URL=http://localhost scripts/check-auth-resilience.sh   # Gegenprobe: Exit 2
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

COMPOSE=(docker compose --project-name astronex --env-file .env -f docker/docker-compose.yml)
BASE_URL="${AUTH_RESILIENCE_BASE_URL:-https://localhost}"
fails=0

log()  { printf '[check-auth-resilience] %s\n' "$*" >&2; }
ok()   { printf '  OK   %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*" >&2; fails=$((fails+1)); }

# Wert eines Response-Headers aus dem rohen Header-Block ($1 = Header-Block, $2 = Name).
# Der Header-Block wird beim Einlesen von CR entfernt (wie scripts/check-security-headers.sh),
# sonst hinge an jedem Wert ein \r und jeder Vergleich wäre still falsch.
header_value() {
  printf '%s\n' "$1" | grep -i "^$2:" | head -n1 | sed 's/^[^:]*:[[:space:]]*//'
}

# Abschluss mit dem Exit-Vertrag der Hausprüfer.
finish() {
  echo
  if [ "$fails" -eq 0 ]; then
    echo "ALLE PRÜFUNGEN GRÜN"
    exit 0
  fi
  echo "$fails Prüfung(en) rot"
  exit 1
}

log "Prüfe die Auth-Resilienz des Stacks unter ${BASE_URL} (mutierend: redis stop/start)"

# ---------------------------------------------------------------------------
# Vorbedingungen — jeder Abbruch hier ist Exit 2, kein Befund. Keine davon mutiert etwas.
# ---------------------------------------------------------------------------
command -v curl >/dev/null 2>&1 || {
  log "FEHLER: curl ist nicht im PATH."
  exit 2
}

# `curl -w '%{http_code}'` schreibt den Code AUCH bei fehlgeschlagener Verbindung (dann `000`);
# ein zusätzliches `|| echo 000` hängte ein zweites `000` an und ergäbe `000000`. Der Vergleich
# akzeptiert deshalb `000` UND die leere Ausgabe als nicht erreichbar.
health_code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/api/health" 2>/dev/null || true)
if [ "$health_code" != "200" ]; then
  log "FEHLER: GET ${BASE_URL}/api/health -> ${health_code:-<leer>} (erwartet 200)."
  log "        Der Live-Beleg braucht den laufenden Stack samt HTTPS (docker/README.md)."
  log "        Ein Aufruf gegen http://localhost endet hier bewusst mit Exit 2: nginx antwortet"
  log "        dort mit 301, nicht mit 200 — und es wurde nichts gestoppt."
  exit 2
fi
ok "Vorbedingung: GET ${BASE_URL}/api/health -> ${health_code}"

captcha_bypass=$(docker exec astronex-api printenv BYPASS_CAPTCHA 2>/dev/null | tr -d '\r')
if [ "$captcha_bypass" != "true" ]; then
  log "FEHLER: BYPASS_CAPTCHA im API-Container ist '${captcha_bypass:-<leer>}' (erwartet true)."
  log "        Ohne Captcha-Bypass lässt sich kein Wegwerf-Nutzer anlegen."
  exit 2
fi
ok "Vorbedingung: BYPASS_CAPTCHA=${captcha_bypass}"

redis_ping=$(docker exec astronex-redis redis-cli ping 2>/dev/null | tr -d '\r')
if [ "$redis_ping" != "PONG" ]; then
  log "FEHLER: docker exec astronex-redis redis-cli ping -> '${redis_ping:-<leer>}' (erwartet PONG)."
  exit 2
fi
ok "Vorbedingung: docker exec astronex-redis redis-cli ping -> ${redis_ping}"

# Gemessener API-Modus statt Behauptung (Pitfall 11): dieser Stack läuft mit DEBUG=true und damit
# im --reload-Zweig mit EINEM Worker; die Vier-Worker-Zeile aus docker/docker-compose.yml gilt nur
# im Compose-Default und wird hier nicht gemessen. Der Erholungs-Poll bleibt trotzdem korrekt.
debug_mode=$(docker exec astronex-api printenv DEBUG 2>/dev/null | tr -d '\r')
log "API-Modus: DEBUG=${debug_mode:-<leer>} — DEBUG=true startet uvicorn --reload mit EINEM Worker;"
log "           --workers 4 gilt nur im Compose-Default (in diesem Stack nicht gemessen)."

# ---------------------------------------------------------------------------
# Abbau des Wegwerf-Nutzers (D-25) — auf Dateiebene, damit der EXIT-Trap ihn rufen kann.
# Gelöscht wird ausschließlich über die selbst erzeugte username, Kinder zuerst; kein TRUNCATE,
# kein DELETE ohne WHERE, auth_audit_logs bleibt unangetastet (Audit-Historie).
# ---------------------------------------------------------------------------
# Postgres-Zugang, absichtlich erst beim ersten Bedarf gelesen: ein Lauf, der vor dem Register
# abbricht, fasst den db-Container gar nicht an.
PG_USER=''
PG_DB=''

# Liest POSTGRES_USER/POSTGRES_DB aus dem db-Container nach PG_USER/PG_DB. Gibt 1 zurück, wenn
# eine der beiden Angaben leer bleibt — dann ist kein Abbau möglich.
db_read_credentials() {
  PG_USER=$(docker exec astronex-db printenv POSTGRES_USER 2>/dev/null | tr -d '\r')
  PG_DB=$(docker exec astronex-db printenv POSTGRES_DB 2>/dev/null | tr -d '\r')
  [ -n "$PG_USER" ] && [ -n "$PG_DB" ]
}

psql_stmt() {  # $1=SQL — gibt die Ausgabe aus, Fehler über den Exit-Code
  docker exec astronex-db psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null
}

# Baut den Wegwerf-Nutzer ab und ist idempotent: ohne angelegten Nutzer (`user_created=0`) kehrt
# die Funktion sofort zurück, nach vollständigem Erfolg setzt sie das Flag auf 0. Damit räumt der
# EXIT-Trap nach dem linearen Abschluss nicht ein zweites Mal ab. Der Rückgabewert ist der Status,
# nicht die Ausgabe: 0 = alles weg, 1 = etwas blieb zurück (der Aufrufer im Trap ignoriert ihn).
cleanup_throwaway_user() {
  [ "${user_created:-0}" -eq 1 ] || return 0
  if [ -z "$PG_USER" ] || [ -z "$PG_DB" ]; then
    if ! db_read_credentials; then
      log "Aufräumen nicht möglich: POSTGRES_USER/POSTGRES_DB im db-Container nicht lesbar — '${USERNAME}' bleibt zurück"
      return 1
    fi
  fi
  local rc=0
  if psql_stmt "DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username = '${USERNAME}')" >/dev/null; then
    ok "DELETE refresh_tokens für ${USERNAME}"
  else
    bad "DELETE refresh_tokens für ${USERNAME} gescheitert — der Name bleibt zurück"
    rc=1
  fi
  if psql_stmt "DELETE FROM user_profiles WHERE user_id IN (SELECT id FROM users WHERE username = '${USERNAME}')" >/dev/null; then
    ok "DELETE user_profiles für ${USERNAME}"
  else
    bad "DELETE user_profiles für ${USERNAME} gescheitert — der Name bleibt zurück"
    rc=1
  fi
  if psql_stmt "DELETE FROM users WHERE username = '${USERNAME}'" >/dev/null; then
    ok "DELETE users für ${USERNAME}"
  else
    bad "DELETE users für ${USERNAME} gescheitert — der Name bleibt zurück"
    rc=1
  fi
  [ "$rc" -eq 0 ] && user_created=0
  return "$rc"
}

# ---------------------------------------------------------------------------
# Ab hier mutierend: Trap VOR dem ersten stop registrieren (Pitfall 12).
# ---------------------------------------------------------------------------
RUN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/check-auth-resilience.XXXXXX")
JAR="$RUN_DIR/cookies.txt"
LAST_HDR_FILE="$RUN_DIR/last_headers"
LAST_BODY_FILE="$RUN_DIR/last_body"

redis_stopped=0
user_created=0
# Reihenfolge im Trap ist bindend: redis zuerst (der Stack steht wieder, bevor irgendetwas anderes
# passiert), dann der Wegwerf-Abbau, zuletzt das Temp-Verzeichnis. `|| true` beim Cleanup, damit
# ein fehlgeschlagener DELETE weder den Redis-Start noch den Exit-Code des Abbruchs verändert.
restore_redis() {
  if [ "$redis_stopped" -eq 1 ]; then
    log "trap: starte redis wieder (das Skript endet vor dem regulären start)"
    "${COMPOSE[@]}" start redis >/dev/null 2>&1 || true
    redis_stopped=0
  fi
  cleanup_throwaway_user || true
  rm -rf "$RUN_DIR"
}
trap restore_redis EXIT
trap 'exit 130' INT TERM

# http_request <methode> <pfad> [curl-Argumente …] — gibt nur den Statuscode aus. Header-Block und
# Body landen in festen Dateien unter $RUN_DIR, weil der Aufruf in einer Kommando-Substitution
# läuft: Variablen, die die Funktion setzt, gingen mit der Subshell verloren (gemessen: 503 kam an,
# Retry-After und Body waren leer). Der Header-Block wird von CR befreit, sonst hinge an jedem Wert
# ein \r und jeder Vergleich wäre still falsch.
http_request() {
  local method="$1" path="$2" code
  shift 2
  : > "$LAST_HDR_FILE"
  : > "$LAST_BODY_FILE"
  code=$(curl -sk -X "$method" -D "$LAST_HDR_FILE" -o "$LAST_BODY_FILE" -w '%{http_code}' --max-time 15 "$@" "${BASE_URL}${path}" 2>/dev/null || true)
  printf '%s' "$code"
}

# ---------------------------------------------------------------------------
# Wegwerf-Nutzer (D-25): eigener Name, eigenes Passwort, keine echten Nutzerdaten.
# ---------------------------------------------------------------------------
USERNAME="resilience_probe_$(date +%s)_$$"
PASSWORD='Resilience123!'

log "Vorbedingung: lege den Wegwerf-Nutzer ${USERNAME} an"
register_code=$(http_request POST /api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\",\"captcha_token\":\"\"}")
case "$register_code" in
  201)
    ok "POST /api/auth/register -> 201 (${USERNAME})"
    # Genau hier existiert der Nutzer sicher; ab jetzt räumt jeder Exit-Pfad ihn über den Trap ab.
    user_created=1
    ;;
  429)
    # Kein Befund: hinter nginx teilen sich alle lokalen Läufe eine Client-IP, und nach fünf
    # Versuchen pro Stunde wäre jeder weitere Lauf ein falsches Rot. Der Zähler verfällt über
    # seine TTL von selbst — kein DEL auf den Key.
    log "FEHLER: POST /api/auth/register -> 429 — das Register-Kontingent dieser Client-IP ist"
    log "        erschöpft (REGISTER_RATE_LIMIT_ATTEMPTS=5 pro 3600 s, gemessen in dieser .env)."
    log "        Das ist eine Vorbedingung, kein Befund. Nach Ablauf des Fensters erneut starten;"
    log "        der Zähler verfällt über seine TTL von selbst, es wird kein Key gelöscht."
    exit 2
    ;;
  *)
    bad "POST /api/auth/register -> ${register_code:-<leer>} (erwartet 201): $(cat "$LAST_BODY_FILE")"
    finish
    ;;
esac

# ---------------------------------------------------------------------------
# Login + Grundlinie: ein gültiges Token, die Key-Form live, die Blacklist auf der gesunden Seite.
# ---------------------------------------------------------------------------
login_code=$(http_request POST /api/auth/login \
  -H 'Content-Type: application/json' \
  -c "$JAR" \
  -d "{\"username\":\"${USERNAME}\",\"password\":\"${PASSWORD}\",\"captcha_token\":\"\"}")
if [ "$login_code" = "200" ]; then
  ok "POST /api/auth/login -> 200 (Cookie-Jar unter mktemp geschrieben)"
else
  bad "POST /api/auth/login -> ${login_code:-<leer>} (erwartet 200): $(cat "$LAST_BODY_FILE")"
fi

ACCESS_TOKEN=$(awk '$6 == "astronex_access_token" { print $7 }' "$JAR" 2>/dev/null | tail -n1)
if [ -z "$ACCESS_TOKEN" ]; then
  bad "kein astronex_access_token im Cookie-Jar — ohne Access-Token ist kein Blacklist-Nachweis möglich"
  finish
fi
ok "Access-Token aus dem Cookie-Jar gelesen (${#ACCESS_TOKEN} Zeichen, Inhalt wird nicht ausgegeben)"

profile_code=$(http_request GET /api/auth/profile -H "Authorization: Bearer ${ACCESS_TOKEN}")
if [ "$profile_code" = "200" ]; then
  ok "GET /api/auth/profile mit Bearer -> 200 (Grundlinie: Token gültig, Store gesund)"
else
  bad "GET /api/auth/profile mit Bearer -> ${profile_code:-<leer>} (erwartet 200): $(cat "$LAST_BODY_FILE")"
fi

# Key-Form am echten Store (SC 4): das Muster ist auf das heutige UTC-Datum eingeengt, weil ein
# bloßes login:ip:* auch einen Key eines anderen Clients oder — kurz nach Mitternacht — den des
# Vortags liefern könnte. Der Login von eben hat den Key geschrieben.
TODAY=$(date -u +%Y%m%d)
measured_key=$(docker exec astronex-redis redis-cli --scan --pattern "login:ip:*:${TODAY}" 2>/dev/null | head -n1 | tr -d '\r')
if [ -z "$measured_key" ]; then
  bad "kein Redis-Key login:ip:*:${TODAY} nach dem Login gefunden — die Key-Form ist nicht belegt"
else
  key_ttl=$(docker exec astronex-redis redis-cli ttl "$measured_key" 2>/dev/null | tr -d '\r')
  if printf '%s' "$measured_key" | grep -Eq '^login:ip:[^:]+:[0-9]{8}$'; then
    ok "Redis-Key login:ip:*:${TODAY} -> ${measured_key}"
  else
    bad "Redis-Key hat nicht die Form login:ip:<subject>:<YYYYMMDD> (gemessen: ${measured_key})"
  fi
  case "$key_ttl" in
    ''|*[!0-9]*) bad "TTL von ${measured_key} ist keine positive Ganzzahl (gemessen: '${key_ttl}')" ;;
    0)           bad "TTL von ${measured_key} ist 0 — der Key wäre sofort weg (erwartet > 0)" ;;
    *)           ok "TTL von ${measured_key} -> ${key_ttl} s (> 0)" ;;
  esac
fi

logout_code=$(http_request POST /api/auth/logout -H "Authorization: Bearer ${ACCESS_TOKEN}")
if [ "$logout_code" = "200" ]; then
  ok "POST /api/auth/logout -> 200 (Access-Token in die Blacklist geschrieben)"
else
  bad "POST /api/auth/logout -> ${logout_code:-<leer>} (erwartet 200): $(cat "$LAST_BODY_FILE")"
fi

blacklisted_healthy=$(http_request GET /api/auth/profile -H "Authorization: Bearer ${ACCESS_TOKEN}")
if [ "$blacklisted_healthy" = "401" ]; then
  ok "GET /api/auth/profile mit entwertetem Bearer -> 401 (gesunder Store, Token abgelehnt)"
else
  bad "GET /api/auth/profile mit entwertetem Bearer -> ${blacklisted_healthy:-<leer>} (erwartet 401 bei gesundem Store)"
fi

# ---------------------------------------------------------------------------
# Ausfall: redis stoppen. Erst nach erfolgreichem stop wird redis_stopped gesetzt — scheitert der
# stop, ist das eine Vorbedingungsverletzung (Exit 2), kein Befund.
# ---------------------------------------------------------------------------
log "Stoppe den redis-Service (die API bleibt stehen)"
if "${COMPOSE[@]}" stop redis >/dev/null 2>&1; then
  redis_stopped=1
  ok "redis gestoppt"
else
  log "FEHLER: 'stop redis' ist gescheitert — der Stack ist unverändert, das ist keine Messung."
  exit 2
fi

# Drei Auth-Pfade, je eine eigene Messung: Statuscode, Retry-After und die feste Meldung.
measure_fail_closed() {  # $1=bezeichnung  $2=statuscode
  local label="$1" code="$2" retry_after hdrs body
  hdrs=$(tr -d '\r' < "$LAST_HDR_FILE")
  body=$(cat "$LAST_BODY_FILE")
  case "$code" in
    503)
      ok "${label} -> 503"
      retry_after=$(header_value "$hdrs" retry-after)
      case "$retry_after" in
        ''|*[!0-9]*) bad "${label} -> Retry-After '${retry_after:-<leer>}' (erwartet Ganzzahl >= 1)" ;;
        0)           bad "${label} -> Retry-After: 0 (keine gültige Wartezeit)" ;;
        *)           ok "${label} -> Retry-After: ${retry_after}" ;;
      esac
      case "$body" in
        *"Authentifizierung ist vorübergehend nicht verfügbar"*)
          ok "${label} -> Body nennt die feste Meldung" ;;
        *)
          bad "${label} -> Body ohne feste Meldung (gemessen: ${body})" ;;
      esac
      ;;
    000|"")
      bad "${label} -> ${code:-<leer>} — keine Verbindung (mindestens nginx/API weg, nicht 'nicht verfügbar')"
      ;;
    *)
      bad "${label} -> ${code} (erwartet 503): ${body}"
      ;;
  esac
}

outage_login=$(http_request POST /api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"resilience_probe_nobody","password":"Wrong123!","captcha_token":""}')
measure_fail_closed 'POST /api/auth/login (falsche Daten)' "$outage_login"

outage_register=$(http_request POST /api/auth/register \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"${USERNAME}_outage\",\"password\":\"${PASSWORD}\",\"captcha_token\":\"\"}")
measure_fail_closed 'POST /api/auth/register (zweiter Wegwerf-Name)' "$outage_register"

outage_refresh=$(http_request POST /api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"invalid"}')
measure_fail_closed 'POST /api/auth/refresh (ungültiges Token)' "$outage_refresh"

# Blacklist auf der Ausfallseite: dasselbe entwertete Token darf NICHT durchgelassen werden.
blacklisted_outage=$(http_request GET /api/auth/profile -H "Authorization: Bearer ${ACCESS_TOKEN}")
case "$blacklisted_outage" in
  503) ok "GET /api/auth/profile mit entwertetem Bearer -> 503 (fail-closed, Token wird nicht akzeptiert)" ;;
  200) bad "GET /api/auth/profile mit entwertetem Bearer -> 200 — FAIL-OPEN: ein entwertetes Token wird durchgelassen" ;;
  401) bad "GET /api/auth/profile mit entwertetem Bearer -> 401 — irreführend: der Store ist weg, nicht das Token" ;;
  *)   bad "GET /api/auth/profile mit entwertetem Bearer -> ${blacklisted_outage:-<leer>} (erwartet 503): $(cat "$LAST_BODY_FILE")" ;;
esac

# ---------------------------------------------------------------------------
# Erholung (SC 2): redis starten, dann pollen — ohne die API neu zu starten.
# ---------------------------------------------------------------------------
log "Starte den redis-Service wieder (die API wurde nicht neu gestartet)"
if "${COMPOSE[@]}" start redis >/dev/null 2>&1; then
  redis_stopped=0
  ok "redis gestartet"
else
  bad "'start redis' ist gescheitert — der trap versucht es beim Beenden erneut"
fi

# Der Poll nutzt /api/auth/refresh mit ungültigem Token (30/300 s) statt Login (5/900 s), damit
# das Login-Budget nicht verbrennt (Pitfall 8). JEDER Code außer 503 und 000 zählt als erholt:
# 401 und 429 beweisen beide, dass der Store wieder antwortet.
rounds=0
recovered_code=''
while [ "$rounds" -lt 30 ]; do
  rounds=$((rounds+1))
  recovered_code=$(http_request POST /api/auth/refresh \
    -H 'Content-Type: application/json' \
    -d '{"refresh_token":"invalid"}')
  case "$recovered_code" in
    503|000|"") sleep 1 ;;
    *) break ;;
  esac
done

case "$recovered_code" in
  503|000|"")
    bad "Erholung: nach ${rounds} Runde(n) antwortet POST /api/auth/refresh weiter ${recovered_code:-<leer>} — der Pfad ist nicht zurück"
    ;;
  *)
    ok "Erholung nach ${rounds} Runde(n): POST /api/auth/refresh -> ${recovered_code} (401 und 429 zählen als erholt, 503 und 000 nicht)"
    ;;
esac

# Abschlussbeweis genau einmal: der Login-Pfad antwortet wieder, ohne API-Neustart.
final_login=$(http_request POST /api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"resilience_probe_nobody","password":"Wrong123!","captcha_token":""}')
case "$final_login" in
  401) ok "Abschlussbeweis: POST /api/auth/login mit falschen Daten -> 401 (Login-Pfad zurück, kein 503)" ;;
  429) bad "Abschlussbeweis: POST /api/auth/login -> 429 — der Store antwortet, aber das Login-Kontingent dieser IP ist erschöpft; der Plan verlangt an dieser Stelle 401" ;;
  *)   bad "Abschlussbeweis: POST /api/auth/login mit falschen Daten -> ${final_login:-<leer>} (erwartet 401, nicht 503): $(cat "$LAST_BODY_FILE")" ;;
esac

# ---------------------------------------------------------------------------
# Aufräumen (D-25): ausschließlich die selbst erzeugte username, Kinder zuerst.
# auth_audit_logs bleibt unangetastet (Audit-Historie); kein TRUNCATE, kein DELETE ohne WHERE.
# Der Abbau selbst lebt in cleanup_throwaway_user (der EXIT-Trap ruft dieselbe Funktion); hier
# bleibt die Erfolgs-/Fehlermeldung auf stdout und der Befund über die verbleibenden Zeilen —
# die Zählung ist kein Cleanup-Schritt, sondern der Beleg, dass wirklich nichts zurückblieb.
# ---------------------------------------------------------------------------
log "Räume den Wegwerf-Nutzer ${USERNAME} ab (refresh_tokens -> user_profiles -> users)"
if cleanup_throwaway_user; then
  ok "Wegwerf-Nutzer ${USERNAME} abgebaut"
else
  bad "Aufräumen von ${USERNAME} unvollständig — der EXIT-Trap versucht es beim Beenden erneut"
fi
remaining=$(psql_stmt "SELECT count(*) FROM users WHERE username = '${USERNAME}'" | tr -d '[:space:]')
case "$remaining" in
  0) ok "Wegwerf-Nutzer ist weg (verbleibende Zeilen: 0)" ;;
  *) bad "Wegwerf-Nutzer ${USERNAME} ist noch in der Datenbank (verbleibende Zeilen: ${remaining:-<leer>})" ;;
esac
log "auth_audit_logs-Zeilen zu ${USERNAME} bleiben stehen (Audit-Historie) — kein DELETE dort."

finish
