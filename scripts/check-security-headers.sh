#!/usr/bin/env bash
# Prüfskript der HTTP-Security-Header (Phase 47, D-10) — reiner Lese-Prüfer gegen den
# laufenden Stack. Es ist der CI-Einstieg, den Phase 50 aufruft; Ausgabe und Exit-Code
# sind damit ein öffentlicher Vertrag.
#
# Öffentlicher Vertrag (identisch zu scripts/check-container-hardening.sh):
#   Exit 0 — alle Prüfungen grün; letzte Zeile "ALLE PRÜFUNGEN GRÜN".
#   Exit 1 — mindestens eine Abweichung; letzte Zeile "<n> Prüfung(en) rot".
#   Exit 2 — die Prüfung ist gar nicht möglich: curl fehlt, der Stack ist nicht erreichbar
#            oder nginx läuft bewusst nur mit HTTP (kein `listen 443` im gerenderten
#            default.conf). Exit 2 ist Vorbedingung, nicht Befund.
#
# Bewusst `set -uo pipefail` OHNE `-e`: ein Prüfer muss nach einem Fehlschlag weiterlaufen,
# sonst bliebe jeder zweite Befund unsichtbar (Stil von scripts/test-spec.sh, dort mit `-e`,
# weil es ein Teststarter und kein Prüfer ist).
#
# Durchgehend GET, niemals HEAD: `HEAD /api/health` antwortet 405 (`Allow: GET`, gemessen
# 2026-11-09) — ein HEAD-basierter Check meldete dort grundlos rot.
#
# Jede Zeile gibt den GEMESSENEN Wert aus, nicht den erwarteten — nur so ist eine rote Zeile
# zitierbar.
#
# Das Skript mutiert nichts: kein Schreibzugriff, keine Testdaten, keine Probe-Datei. Der
# einzige Container-Aufruf (`exec -T nginx grep`) liest die gerenderte Config read-only.
# Die 429-Sonde am Ende erzeugt einen begrenzten Burst (70 GET /api/health) und fuellt damit
# kurzzeitig die Rate-Limit-Zone `api` — auch das ist ein reiner Lesevorgang, der Zustand
# heilt sich mit 10 r/s selbst.
#
# Aufruf:
#   scripts/check-security-headers.sh
#   HEADER_CHECK_BASE_URL=http://localhost scripts/check-security-headers.sh   # Rot-Beleg
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

COMPOSE=(docker compose --project-name astronex --env-file .env -f docker/docker-compose.yml)
BASE_URL="${HEADER_CHECK_BASE_URL:-https://localhost}"
fails=0

log()  { printf '[check-headers] %s\n' "$*" >&2; }
ok()   { printf '  OK   %s\n' "$*"; }
bad()  { printf '  FAIL %s\n' "$*" >&2; fails=$((fails+1)); }

# Wert eines Response-Headers aus dem rohen Header-Block ($1 = Header-Block, $2 = Name).
header_value() {
  printf '%s\n' "$1" | grep -i "^$2:" | head -n1 | sed 's/^[^:]*:[[:space:]]*//'
}

log "Prüfe die HTTP-Security-Header des Stacks unter ${BASE_URL}"

# ---------------------------------------------------------------------------
# Vorbedingungen — jeder Abbruch hier ist Exit 2, kein Befund.
# ---------------------------------------------------------------------------
command -v curl >/dev/null 2>&1 || {
  log "FEHLER: curl ist nicht im PATH."
  exit 2
}

# `curl -w '%{http_code}'` schreibt den Code AUCH bei fehlgeschlagener Verbindung (dann `000`);
# ein zusätzliches `|| echo 000` hängte ein zweites `000` an und ergäbe `000000`. Der Vergleich
# akzeptiert deshalb `000` UND die leere Ausgabe als nicht erreichbar.
probe_code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "${BASE_URL}/api/health" 2>/dev/null || true)
case "$probe_code" in
  000|"")
    log "FEHLER: Stack nicht erreichbar oder kein HTTPS — GET ${BASE_URL}/api/health -> ${probe_code:-<leer>}."
    log "        Für diesen Nachweis DEBUG=true mit mkcert-Zertifikaten verwenden (docker/README.md)."
    exit 2
    ;;
esac

# Ohne mkcert-Zertifikat rendert der nginx-Entrypoint ausschließlich das HTTP-Template; dann ist
# die HSTS-Zeile nicht messbar. Der Blick in die gerenderte Config ist ein reiner Lesevorgang —
# `grep` wird direkt aufgerufen (keine Shell im Container), damit hier nichts geschrieben werden
# kann. Fehlt docker, entfällt diese Prüfung mit einer Log-Zeile (kein stiller Skip).
if command -v docker >/dev/null 2>&1; then
  if [ -z "$("${COMPOSE[@]}" ps -a -q nginx 2>/dev/null | head -n1)" ]; then
    log "FEHLER: der nginx-Service wurde nie erstellt — der Stack ist nicht gestartet."
    log "        Start: docker/build.sh"
    exit 2
  fi
  # `ps -a` oben listet auch GESTOPPTE Container: ein gestoppter nginx käme dort vorbei und ließe
  # `exec` mit Exit 1 scheitern — der `case`-Zweig `1)` läse das als "kein 'listen 443'" und
  # schickte den Hinweis an die falsche Stelle. Deshalb wird der LAUFZUSTAND vor dem `exec`
  # geprüft (ohne `-a`); danach bleibt Exit 1 eindeutig `grep` (IN-18).
  if [ -z "$("${COMPOSE[@]}" ps -q nginx 2>/dev/null | head -n1)" ]; then
    log "FEHLER: der nginx-Container läuft nicht (er ist erstellt, aber gestoppt) — der Stack ist also nicht gestartet."
    log "        Start: docker/build.sh"
    exit 2
  fi
  # Exit 1 des folgenden Aufrufs heißt damit eindeutig "grep hat das Muster nicht gefunden" (→ nginx
  # läuft bewusst nur mit HTTP): dass der Container läuft, ist direkt darüber geprüft, ein
  # `exec`-Fehler kann also nicht mehr als HTTP-Rendering gelesen werden (IN-06, IN-18). Alle
  # anderen Codes bleiben echte Ausführungsfehler im `*)`-Zweig.
  rendered_status=0
  "${COMPOSE[@]}" exec -T nginx grep -q 'listen 443' /etc/nginx/conf.d/default.conf 2>/dev/null ||
    rendered_status=$?
  case "$rendered_status" in
    0) ok "gerenderte nginx-Config trägt 'listen 443' (HTTPS-Template aktiv)" ;;
    1)
      log "FEHLER: nginx läuft bewusst nur mit HTTP (kein 'listen 443' im gerenderten default.conf)."
      log "        Für diesen Nachweis DEBUG=true mit mkcert-Zertifikaten verwenden (docker/README.md)."
      exit 2
      ;;
    *)
      log "FEHLER: 'docker compose exec nginx grep' ist fehlgeschlagen (Exit ${rendered_status}) — der Container läuft nicht oder der Daemon ist nicht erreichbar."
      log "        Das ist KEIN Hinweis auf ein HTTP-only-Rendering; Stack-Status prüfen: docker compose … ps"
      exit 2
      ;;
  esac
else
  log "docker ist nicht im PATH — der Blick in die gerenderte nginx-Config entfällt, die Messung läuft trotzdem."
fi

# ---------------------------------------------------------------------------
# Messung je Pfadklasse: Statuscode, Header-Präsenz und Header-Werte.
#   check_path <pfad> [erwartete Header …]
#   check_headers <bezeichnung> <header-block> [erwartete Header …]
# check_headers ist der gemeinsame Kern: es bekommt einen bereits gemessenen Header-Block und
# beurteilt ihn. Die 429-Sonde unten nutzt ihn, weil dort der Statuscode 429 das Ziel ist und
# nicht 200 — der Header-Satz muss trotzdem derselbe sein.
# ---------------------------------------------------------------------------
check_headers() {
  local path="$1" hdrs="$2"; shift 2
  local name value shown csp rp xfo xcto pp hsts required script_src feature
  for name in "$@"; do
    value=$(header_value "$hdrs" "$name")
    case "$name" in
      content-security-policy) shown="${value%%;*}" ;;
      *)                       shown="$value" ;;
    esac
    if [ -n "$value" ]; then
      ok "${path} -> ${name}: ${shown}"
    else
      bad "${path} -> ${name} fehlt"
    fi
  done

  # Wert-Prüfungen, nicht nur Präsenz: ein vorhandener, aber falscher Header ist keine Erfüllung.
  csp=$(header_value "$hdrs" content-security-policy)
  rp=$(header_value "$hdrs" referrer-policy)
  xfo=$(header_value "$hdrs" x-frame-options)
  xcto=$(header_value "$hdrs" x-content-type-options)
  pp=$(header_value "$hdrs" permissions-policy)

  case "$csp" in
    *"frame-ancestors 'none'"*)          ok "${path} -> CSP nennt frame-ancestors 'none'" ;;
    *) bad "${path} -> CSP ohne frame-ancestors 'none' (gemessen: ${csp:-<leer>})" ;;
  esac
  case "$csp" in
    *challenges.cloudflare.com*)         ok "${path} -> CSP nennt challenges.cloudflare.com" ;;
    *) bad "${path} -> CSP ohne challenges.cloudflare.com (gemessen: ${csp:-<leer>})" ;;
  esac
  case "$csp" in
    *"style-src 'self' 'unsafe-inline'"*) ok "${path} -> CSP nennt style-src 'self' 'unsafe-inline'" ;;
    *) bad "${path} -> CSP ohne style-src 'self' 'unsafe-inline' (gemessen: ${csp:-<leer>})" ;;
  esac
  if [ "$rp" = "strict-origin-when-cross-origin" ]; then
    ok "${path} -> referrer-policy=${rp}"
  else
    bad "${path} -> referrer-policy=${rp:-<leer>} (erwartet strict-origin-when-cross-origin)"
  fi
  if [ "$xfo" = "DENY" ]; then
    ok "${path} -> x-frame-options=${xfo}"
  else
    bad "${path} -> x-frame-options=${xfo:-<leer>} (erwartet DENY)"
  fi
  if [ "$xcto" = "nosniff" ]; then
    ok "${path} -> x-content-type-options=${xcto}"
  else
    bad "${path} -> x-content-type-options=${xcto:-<leer>} (erwartet nosniff)"
  fi
  # Die vier Live-Fragmente oben decken nur einen Teil der Policy ab. `default-src` und
  # `form-action` fehlten ganz und sind die beiden Direktiven, deren Verlust am leisesten bliebe:
  # ohne `default-src` fallen media-src/worker-src/manifest-src/child-src auf "alles erlaubt"
  # zurück, ohne `form-action` darf ein entführtes Formular auf einen Fremd-Host posten (SC 2/3).
  # Der Sollwert wird deshalb als Pflichtliste gepinnt (WR-08) — der Playwright-Spec pinnt
  # dieselben Direktiven in `CSP_REQUIRED` (dort zusätzlich `style-src` und `frame-ancestors`,
  # die hier schon die Live-Fragmente oben abdecken), damit CI-Einstieg und Spec nicht
  # auseinanderlaufen.
  for required in "default-src 'self'" "object-src 'none'" \
                  "base-uri 'self'" "form-action 'self'" "img-src 'self' data: blob:" \
                  "font-src 'self'" "connect-src 'self'" \
                  "frame-src https://challenges.cloudflare.com"; do
    case "$csp" in
      *"$required"*) ok "${path} -> CSP nennt ${required}" ;;
      *)             bad "${path} -> CSP nennt ${required} nicht (gemessen: ${csp:-<leer>})" ;;
    esac
  done
  # `script-src` darf `'unsafe-inline'` nicht führen — sonst ist der per Request erzeugte Nonce
  # wirkungslos, und der Header sähe trotzdem vollständig aus.
  script_src=$(printf '%s\n' "$csp" | sed -n 's/.*script-src \([^;]*\);.*/\1/p')
  case "$script_src" in
    "")              bad "${path} -> CSP ohne script-src (gemessen: ${csp:-<leer>})" ;;
    *unsafe-inline*) bad "${path} -> CSP script-src führt 'unsafe-inline' (gemessen: ${script_src})" ;;
    *)               ok "${path} -> CSP script-src ohne 'unsafe-inline' (${script_src})" ;;
  esac
  # D-05 nennt 13 Features; die früheren Prüfungen deckten nur camera und geolocation ab —
  # die übrigen 11 waren in beiden Templates frei änderbar (`usb=(self)` blieb überall grün).
  # Jetzt wird der VOLLE Feature-Satz positiv gepinnt (WR-08), je Feature eine zitierbare Zeile —
  # die beiden Einzelprüfungen entfallen, sonst meldete ein Feature zwei rote Zeilen.
  for feature in camera microphone geolocation payment usb magnetometer gyroscope \
                 accelerometer display-capture serial hid bluetooth interest-cohort; do
    case "$pp" in
      *"${feature}=()"*) ok "${path} -> permissions-policy sperrt ${feature}" ;;
      *) bad "${path} -> permissions-policy sperrt ${feature} nicht (gemessen: ${pp:-<leer>})" ;;
    esac
  done

  # HSTS wird auf seinen WERT geprüft, nicht nur auf Präsenz (IN-07): die Präsenzschleife oben
  # meldet bereits ein fehlendes HSTS; ein auf `max-age=60` verkürztes oder um
  # `includeSubDomains` erleichtertes HSTS bliebe dort grün. Nur bei vorhandenem Header prüfen,
  # damit ein fehlender Header nicht zwei Zeilen erzeugt.
  hsts=$(header_value "$hdrs" strict-transport-security)
  if [ -n "$hsts" ]; then
    case "$hsts" in
      *"max-age=31536000; includeSubDomains"*) ok "${path} -> hsts=${hsts}" ;;
      *) bad "${path} -> hsts=${hsts} (erwartet max-age=31536000; includeSubDomains)" ;;
    esac
  fi
}

# R-01: Ein HTML-Dokument trägt einen pro Request erzeugten Nonce und MUSS deshalb revalidieren;
# ohne `private, no-cache` darf der Browser es cachen, und ein späteres 304 trüge einen frischen
# Nonce zum alten Body (gemessen: 3 blockierte Inline-Skripte, weiße Seite). Der Playwright-Spec
# prüft das seit WR-02 — dieses CI-Einstiegsskript (Phase 50 ruft es auf) prüfte nur den
# Sicherheitssatz, der Kern von R-01 war dort nicht messbar (IN-16).
check_revalidation() {
  local path="$1" hdrs="$2" cc
  cc=$(header_value "$hdrs" cache-control)
  case "$cc" in
    *"private, no-cache"*) ok "${path} -> cache-control revalidiert (${cc})" ;;
    *) bad "${path} -> cache-control ohne 'private, no-cache' (R-01, gemessen: ${cc:-<leer>})" ;;
  esac
}

check_path() {
  # Der Schalter steht VOR dem Pfad und wird deshalb vor `path` abgeräumt (sonst landete er
  # selbst in `path`, und der eigentliche Pfad würde als Headername geprüft).
  local revalidate=0
  if [ "${1:-}" = "--nonce-document" ]; then
    revalidate=1
    shift
  fi
  local path="$1"; shift
  local hdrs status
  # Optionaler Schalter (R-01, IN-16): die HTML-Pfade müssen zusätzlich `Cache-Control:
  # private, no-cache` tragen. /api/health und der Cover-Pfad sind keine HTML-Antworten und
  # werden ohne den Schalter aufgerufen — analog zu `nonceDocument` im Playwright-Spec.
  hdrs=$(curl -sk -D- -o /dev/null --max-time 10 "${BASE_URL}${path}" 2>/dev/null | tr -d '\r')
  status=$(printf '%s\n' "$hdrs" | head -n1 | awk '{print $2}')

  # Zuerst der Statuscode: ein /astro-wiki/ ohne Wiki-Build antwortet `try_files … =500` und
  # trüge trotzdem den vollen Header-Satz — ohne diese Zeile wäre das grün.
  if [ "$status" = "200" ]; then
    ok "${path} -> Status ${status}"
  else
    bad "${path} -> Status ${status:-<leer>} (erwartet 200)"
  fi

  check_headers "$path" "$hdrs" "$@"
  if [ "$revalidate" -eq 1 ]; then
    check_revalidation "$path" "$hdrs"
  fi
}

HEADERS=(content-security-policy x-content-type-options referrer-policy permissions-policy x-frame-options strict-transport-security)

log "Pfadklassen: / , /astro-wiki/ , /horoscope (HTML, R-01) , /api/health , Cover-Pfad"
check_path --nonce-document /            "${HEADERS[@]}"
check_path --nonce-document /astro-wiki/ "${HEADERS[@]}"
check_path --nonce-document /horoscope   "${HEADERS[@]}"
check_path /api/health  "${HEADERS[@]}"

# Der Cover-Pfad ist die eine Location mit eigener add_header-Zeile, die die Vererbungsfalle
# auslöst. Der Dateiname ist ein Hash über Glyph, Preset-Farben, Layout und Renderer-Version —
# er wird deshalb aus der Quelle abgeleitet und niemals als Literal notiert.
COVER=$(sed -n "s/.*DEFAULT_COVER_URL = '\([^']*\)'.*/\1/p" app/frontend/src/services/covers.js | head -1)
if [ -n "$COVER" ]; then
  check_path "$COVER" "${HEADERS[@]}"
else
  # Kein Skip: eine leere Ableitung heißt, die Quelle wurde verändert.
  bad "Cover-Pfad nicht ermittelbar (DEFAULT_COVER_URL fehlt in app/frontend/src/services/covers.js)"
fi

# ---------------------------------------------------------------------------
# 429-Pfad (`location @ratelimited`). Die Phase begruendet ausfuehrlich, dass ein 429 vorher
# OHNE jeden Security-Header ausging (gemessen: nur `retry-after`), und repariert das mit
# `always` in jeder Zeile des Handlers. Ohne eine Messung bliebe die Zusage ungeprueft: der
# Textcheck im Playwright-Spec sieht nur den Template-Text, und dort wuerde auch der Verlust
# eines `always` nicht auffallen.
#
# Die Sonde ist read-only und selbstheilend: die Zone `api` ist rate=10r/s burst=50
# (docker/nginx.conf), ein Burst von 70 parallelen GET auf /api/health ueberzieht das
# Kontingent und ruft den Handler. Direkt danach ist das Kontingent noch ueberzogen, die
# naechsten Anfragen werden abgelehnt — der Header-Block einer solchen 429-Antwort ist das
# Messobjekt. Sie steht deshalb am ENDE: eine erschoepfte Zone vor den Pfadklassen wuerde
# diese grundlos rot faerben.
# ---------------------------------------------------------------------------
probe_429_headers() {
  local i out status
  for i in $(seq 1 70); do
    curl -sk -o /dev/null --max-time 5 "${BASE_URL}/api/health" >/dev/null 2>&1 &
  done
  wait
  for i in $(seq 1 10); do
    out=$(curl -sk -D- -o /dev/null --max-time 5 "${BASE_URL}/api/health" 2>/dev/null | tr -d '\r')
    status=$(printf '%s\n' "$out" | head -n1 | awk '{print $2}')
    if [ "$status" = "429" ]; then
      printf '%s\n' "$out"
      return 0
    fi
  done
  return 1
}

log "429-Pfad: begrenzter Burst gegen die api-Zone (70 GET /api/health, read-only)"
if rate_headers=$(probe_429_headers); then
  ok "/api/health -> Status 429 erreicht (Zone api: rate=10r/s, burst=50)"
  check_headers "/api/health (429)" "$rate_headers" "${HEADERS[@]}" retry-after
  # Auch `retry-after` wird auf den Wert geprüft, nicht nur auf Präsenz (IN-07): der Handler sagt
  # 60 Sekunden zu (`return 429 '{"retry_after": 60}'`), eine 0 waere sonst grün. Nur bei
  # VORHANDENEM Header prüfen — dieselbe Begründung wie beim HSTS-Zweig: die Präsenzschleife in
  # `check_headers` (oben mit `retry-after` aufgerufen) meldet einen fehlenden Header bereits, und
  # ein zusätzlicher Wert-Zweig legte eine zweite rote Zeile für denselben Defekt nach. Die Zahl in
  # der letzten Zeile ("<n> Prüfung(en) rot") ist ein öffentlicher Vertrag — sie darf einen Defekt
  # nicht doppelt zählen (IN-19).
  retry_after=$(header_value "$rate_headers" retry-after)
  if [ -n "$retry_after" ]; then
    if [ "$retry_after" = "60" ]; then
      ok "/api/health (429) -> retry-after=${retry_after}"
    else
      bad "/api/health (429) -> retry-after=${retry_after} (erwartet 60)"
    fi
  fi
else
  bad "429-Handler @ratelimited nicht erreichbar — der Header-Satz des 429 bliebe ungeprüft (Zone api: rate=10r/s, burst=50)"
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "ALLE PRÜFUNGEN GRÜN"
  exit 0
fi
echo "$fails Prüfung(en) rot"
exit 1
