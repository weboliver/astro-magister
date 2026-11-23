#!/usr/bin/env bash
# Prüfskript gegen Beispielwerte in der .env (Phase 50, SECR-02, D-16/D-17/D-18) —
# reiner Lese-Prüfer, der .env und .env.example in KEY/WERT-Paare zerlegt und
# ausschließlich die Schnittmenge vergleicht. Ausgabe und Exit-Code sind damit ein
# öffentlicher Vertrag.
#
# Dies ist ein DEPLOY-Gate, kein Dev-Gate: es ist bewusst NICHT Teil von
# scripts/check-gates.sh (D-20) und NICHT in docker/build.sh, docker/update.sh oder
# docker/astronex.service eingehängt (D-19) — eine lokale .env mit Platzhaltern ist
# im Entwicklungsweg erwartbar.
#
# Öffentlicher Vertrag (identisch zu scripts/check-container-hardening.sh):
#   Exit 0 — kein Beispielwert; letzte Zeile "ALLE PRÜFUNGEN GRÜN".
#   Exit 1 — mindestens ein Beispielwert; letzte Zeile "<n> Prüfung(en) rot".
#   Exit 2 — die Prüfung ist gar nicht möglich: .env oder .env.example fehlt,
#            oder es gibt keinen einzigen vergleichbaren Schlüssel.
#            Exit 2 ist Vorbedingung, nicht Befund.
#
# Präzedenz: die Regel "ein gezählter Befund gewinnt gegen eine fehlende
# Vorbedingung" ist aus scripts/check-requirements-lock.sh:15-18 geerbt und bleibt
# als Hausform stehen. In DIESEM Prüfer kann sie nicht greifen: es gibt genau eine
# `bad`-Stelle, und sie liegt hinter `compared=$((compared+1))`, während jede
# Vorbedingung davor oder an `compared == 0` hängt — `fails > 0` und
# PRECONDITION_REASON schließen sich hier also aus. Der Guard im Abschluss bleibt
# unverändert (harmlos, gleiche Form wie die Nachbarprüfer).
#
# Ausgabeverbot (D-18, AGENTS.md § .env-Sicherheit): dieses Skript gibt NIE einen
# Wert aus — weder den .env-Wert noch den Beispielwert, auch nicht gekürzt. Eine
# Befundzeile nennt nur Variablenname und Zeilennummer, damit ein Log oder ein
# Screenshot kein Secret weiterträgt. Der Schutz ist mechanisch, nicht bloß eine
# Absichtserklärung: `set +x 2>/dev/null` direkt nach der `set`-Zeile schaltet auch
# ein vom Operator gesetztes `bash -x` ab, und das Record-Protokoll von `read_pairs`
# stellt die Zeilennummer VOR den Wert, damit Wertbytes nie in einer Ausgabezeile
# landen können (HI-01/ME-02).
#
# Nur die Gleichheit gegen .env.example ist die Regel (D-16): keine eigene
# Platzhalter-Heuristik, keine Required-Liste (D-17) — beides wäre eine zweite
# Wahrheit über "was ein Platzhalter ist". Ausgenommen ist eine kurze, unten
# begründete Liste bewusst gleicher, im Betrieb korrekter Defaults; ein leerer
# Beispielwert wird übersprungen, weil er eine Abwesenheit und keinen
# Beispielwert beschreibt.
#
# Bewusst `set -uo pipefail` OHNE `-e`: der Prüfer muss nach einem Befund
# weiterlaufen, sonst bliebe jeder zweite Befund unsichtbar.
#
# Test-Hooks (Muster HEADER_CHECK_BASE_URL aus Phase 47 / LOCK_CHECK_FREEZE_FILE aus
# Phase 48): ENV_DEFAULTS_FILE (Default $ROOT/.env) und ENV_DEFAULTS_EXAMPLE
# (Default $ROOT/.env.example) biegen beide Seiten auf Fixture-Dateien um. Damit
# sind Rot- und Grün-Fall ohne Anfassen der echten .env belegbar; im Normalbetrieb
# sind beide Variablen ungesetzt.
#
# Aufruf:
#   scripts/check-env-defaults.sh
#   ENV_DEFAULTS_FILE=.env.example ENV_DEFAULTS_EXAMPLE=.env.example scripts/check-env-defaults.sh   # Rot-Beleg
set -uo pipefail
# Ein vom Operator gesetztes `bash -x` würde über die Array-Zuweisungen und die
# `[`-Tests jeden gelesenen Wert ausgeben. D-18 verbietet das in JEDEM Pfad, nicht
# nur in einem selbst gesetzten Trace — deshalb hier defensiv abschalten.
set +x 2>/dev/null

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fails=0

log()  { printf '[check-env-defaults] %s\n' "$*" >&2; }
ok()   { printf '  OK   %s\n' "$*"; }
# Kein Präfix vor "  FAIL": die `^  FAIL`-Gates der Verifikation hängen an dieser
# Form, und der Variablenname steht direkt hinter `FAIL ` (Gate `grep "FAIL $v "`).
bad()  { printf '  FAIL %s\n' "$*" >&2; fails=$((fails+1)); }

# Ungeprüftes `cd` würde jeden relativen Pfad gegen das falsche Verzeichnis auflösen
# (LO-09); ein Fehlschlag ist eine Vorbedingung, kein Befund.
cd "$ROOT" || { log "FEHLER: cd nach ${ROOT} fehlgeschlagen"; exit 2; }

ENV_FILE="${ENV_DEFAULTS_FILE:-$ROOT/.env}"
ENV_EXAMPLE="${ENV_DEFAULTS_EXAMPLE:-$ROOT/.env.example}"

# Gründe, die den Lauf zu Exit 2 machen — sofern kein Befund gezählt wurde.
PRECONDITION_REASON=""
precondition() {  # $* = Grund; der erste Grund wird gemerkt, jeder geloggt.
  if [ -z "$PRECONDITION_REASON" ]; then
    PRECONDITION_REASON="$*"
  fi
  log "FEHLER: Vorbedingung fehlt — $*"
}

# Zerlegt eine .env-Datei in Datensätze `KEY \037 ZEILENNUMMER \037 WERT`, getrennt
# durch \037 (\x1f). Kein TAB: TAB ist IFS-Whitespace und `read` würde bei einem
# LEEREN Wert die Felder zusammenziehen (Pitfall 4, in der Recherche gemessen).
#
# Die Zeilennummer steht VOR dem Wert: steht der Wert zuletzt, kann ein \x1f im Wert
# nur die (nie gedruckte) Vergleichsseite treffen und nicht das Zeilennummernfeld —
# sonst trüge die Befundzeile Wertbytes (ME-02, D-18 verbietet jeden Wertausgang).
#
# Unterstützte Bindungs- und Wertformen (Zusage: genau diese, nicht mehr):
#   - Bindungsformen: `KEY=value`, `export KEY=value` und `KEY: value`. Die
#     Doppelpunkt-Form bindet python-dotenv 1.2.4 (die Referenz in app/config.py)
#     NICHT; hier wird sie bewusst mitgeprüft, weil ein so geschriebener Schlüssel
#     sonst still aus dem Vergleich fiele (LO-01). An dieser Stelle ist der Prüfer
#     strenger als die App: ein Befund dafür ist gewollt, ein stilles Grün nie.
#   - \r am Zeilenende abschneiden (CRLF-Dateien); CR-only ist eine Vorbedingung,
#   - Zeilen, die mit optionalem Whitespace und `#` beginnen, zählen NICHT (Pitfall 7),
#   - am ERSTEN `=` trennen; enthält die Zeile kein `=`, am ersten `:` (YAML-Form),
#     Schlüssel und Wert trimmen,
#   - ZUERST einen Inline-Kommentar hinter einem GESCHLOSSENEN Quote entfernen
#     (`"wert"  # notiz`, dasselbe für einfache Quotes) — ohne diese Reihenfolge
#     bliebe der Wert samt Anführungszeichen stehen, wäre ungleich dem Beispielwert
#     und meldete grün (CR-01, T-50-01: ein gequoteter 37-Zeichen-Platzhalter),
#   - DANN die Quote-Regel; ein `#` INNERHALB eines geschlossenen Quotaars bleibt
#     Wertbestandteil (`"a # b"` → `a # b`), ein Kommentar NACH dem Quote fällt weg,
#   - bei nicht in Anführungszeichen stehenden Werten einen Inline-Kommentar
#     (Whitespace gefolgt von `#`) abschneiden — python-dotenv liest `DEBUG=true  # dev`
#     als `true`; innerhalb von Anführungszeichen bleibt `#` Teil des Werts,
#   - umschließende doppelte oder einfache Anführungszeichen entfernen,
#   - nur Schlüssel nach ^[A-Za-z_][A-Za-z0-9_]*$ akzeptieren,
#   - bei doppelten Zuweisungen gewinnt die LETZTE Zeile (Pitfall 8), die
#     Zeilennummer wandert mit.
# Bewusst NICHT dekodiert (LO-01): Escape-Sequenzen in doppelten Quotes (`"a\nb"`)
# und mehrzeilige Quote-Werte. Kein Beispielwert in .env.example verwendet sie, und
# .env.example bleibt die Referenz — eine Zusage ohne Deckung wäre ein falsches
# Abnahmekriterium (T-50-27).
# Die Werte werden ausschließlich als Daten behandelt: nie eine Shell-Auswertung
# der gelesenen Zeile (T-50-02, Vorbild scripts/check-requirements-lock.sh:137-140).
read_pairs() {
  awk '
    { sub(/\r$/, "") }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*export[[:space:]]+/, "", line)
      sep = index(line, "=")
      # python-dotenv akzeptiert auch `KEY: value`; ohne den `:`-Zweig fiele der
      # Schlüssel still aus dem Vergleich (LO-01) — ein False-Negative-Vektor.
      if (sep == 0) sep = index(line, ":")
      if (sep == 0) next
      k = substr(line, 1, sep - 1)
      v = substr(line, sep + 1)
      gsub(/^[[:space:]]+/, "", k); gsub(/[[:space:]]+$/, "", k)
      if (k !~ /^[A-Za-z_][A-Za-z0-9_]*$/) next
      gsub(/^[[:space:]]+/, "", v); gsub(/[[:space:]]+$/, "", v)
      # 1) Kommentar hinter einem GESCHLOSSENEN Quote entfernen: "…" # … bzw. '…' # …
      #    Vor der Quote-Regel, sonst fällt `"postgres"  # operator note` in den
      #    else-Zweig, verliert den Kommentar und behält die Anführungszeichen —
      #    der Vergleich läuft dann gegen `"postgres"` statt `postgres` und meldet
      #    grün (CR-01, exakte T-50-01-Bedrohung).
      if (v ~ /^"[^"]*"[[:space:]]+#/ || v ~ /^\047[^\047]*\047[[:space:]]+#/) {
        sub(/[[:space:]]+#.*$/, "", v)
        gsub(/[[:space:]]+$/, "", v)
      }
      # 2) Unveränderte Quote-Regel: umschließende Quotes entfernen; ein `#` INNERHALB
      #    des Quotes ist bereits durch die Reihenfolge oben geschützt (`"poly # 1"`
      #    matcht Schritt 1 nicht, weil hinter dem schließenden Quote kein `#` folgt).
      if (v ~ /^".*"$/ || v ~ /^\047.*\047$/) {
        v = substr(v, 2, length(v) - 2)
      } else {
        sub(/[[:space:]]+#.*$/, "", v)
        gsub(/[[:space:]]+$/, "", v)
      }
      val[k] = v; ln[k] = NR
    }
    END { for (k in val) printf "%s\037%d\037%s\n", k, ln[k], val[k] }
  ' "$1"
}

# Vorbedingungs-Prüfung für CR-only-Zeilenenden (ME-01): `sub(/\r$/, "")` schneidet
# nur ein \r AM ZEILENENDE ab; eine Datei mit reinen CR-Zeilenenden ist für awk und
# `read` genau EIN Datensatz, dessen Wert den Rest der Datei verschluckt — der Lauf
# meldete dann grün, obwohl ein Platzhalter in derselben Datei steht.
# Rückgabe 0 = ein \r mitten in einer Zeile gefunden (nicht parsebar).
# Eine CRLF-Datei trifft das NICHT: dort sitzt das \r am Zeilenende und wird
# abgeschnitten, bevor auf ein verbleibendes \r geprüft wird.
cr_embedded() {  # $1 = Datei
  local file="$1" line
  [ -r "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in *$'\r'*) return 0 ;; esac
  done < "$file"
  return 1
}

# Beispielwerte aus .env.example als Nachschlagetabelle (Schnittmenge, D-16).
declare -A ex_val=()

# Ausnahmen (D-16): bewusst gleiche, im Betrieb KORREKTE Defaults. Jeder Eintrag
# braucht einen Grund; wächst die Liste, ist das eine sichtbare Änderung, kein
# stiller Zuwachs. NICHT aufgenommen sind die Platzhalter DEBUG,
# LETSENCRYPT_DOMAINS/LETSENCRYPT_EMAIL/LETSENCRYPT_STAGING, NGINX_SERVER_NAME und
# die fünf Secret-Variablen — sie sind die Befund-Kandidaten.
EXEMPT=(
  API_HOST API_PORT API_WORKERS API_RELOAD      # von Compose gar nicht gelesen (CONFIGURATION.md:24-27)
  EPHEMERIS_PATH                                # Pfad, kein Geheimnis; SWISS_EPHE_PATH/astronex/resources als Fallback (CONFIGURATION.md:28-29)
  EPHEMERIS_YEAR_START EPHEMERIS_YEAR_END       # nicht von der FastAPI-App konsumiert (Legacy-Desktop, CONFIGURATION.md:30-31)
  LOG_LEVEL ACCESS_TOKEN_EXPIRE_MINUTES         # dokumentierte Defaults (CONFIGURATION.md:21, :23)
  API_BASE_URL                                  # der Perplexity-Client nutzt eine Konstante (CONFIGURATION.md:33)
  DB_HOST DB_NAME DB_USER                       # dokumentierte Defaults; DB_HOST überschreibt Compose (CONFIGURATION.md:60-62)
  PERPLEXITY_CACHE_MAX PERPLEXITY_CACHE_TTL     # Cache-Tuning, kein Geheimnis (CONFIGURATION.md:41-42)
  LOGIN_RATE_LIMIT_ATTEMPTS LOGIN_RATE_LIMIT_WINDOW_SECONDS        # dokumentierte Limits (CONFIGURATION.md:48-49)
  REGISTER_RATE_LIMIT_ATTEMPTS REGISTER_RATE_LIMIT_WINDOW_SECONDS  # dokumentierte Limits (CONFIGURATION.md:50-51)
  REFRESH_RATE_LIMIT_ATTEMPTS REFRESH_RATE_LIMIT_WINDOW_SECONDS    # dokumentierte Limits (CONFIGURATION.md:52-53)
  AI_RATE_LIMIT_ATTEMPTS AI_RATE_LIMIT_WINDOW_SECONDS   # nicht vom App-Code gelesen (CONFIGURATION.md:58-59)
  FAILED_LOGIN_LOCKOUT_THRESHOLD FAILED_LOGIN_LOCKOUT_SECONDS   # dokumentierte Limits (CONFIGURATION.md:54-55)
  NETWORK_NAME NETWORK_SUBNET                   # Betriebsparameter des Compose-Netzes (D-16 nennt NETWORK_*)
  BYPASS_CAPTCHA SEED_E2E_USER                  # D-16 nennt beide namentlich (E2E-Schalter, Default aus)
  CHAT_PROVIDER                                 # dokumentierter Default "perplexity" (CONFIGURATION.md:35, app/config.py:98)
  DEV_HTTPS_HOSTS DEV_SSL_CERT_PATH DEV_SSL_KEY_PATH   # nur im DEBUG=true-Zweig gelesen (docker/nginx-entrypoint.sh:168-187)
)

# Lineare Suche über das Array, keine Regex: die Namen bleiben Daten (T-50-02).
is_exempt() {  # $1 = Schlüssel
  local key="$1" entry
  for entry in "${EXEMPT[@]}"; do
    [ "$entry" = "$key" ] && return 0
  done
  return 1
}

compared=0
exempt_hits=0
empty_skipped=0
have_inputs=1
if [ ! -f "$ENV_FILE" ] || [ ! -r "$ENV_FILE" ]; then
  precondition "Datei fehlt oder ist nicht lesbar: ${ENV_FILE}"
  have_inputs=0
fi
if [ ! -f "$ENV_EXAMPLE" ] || [ ! -r "$ENV_EXAMPLE" ]; then
  precondition "Datei fehlt oder ist nicht lesbar: ${ENV_EXAMPLE}"
  have_inputs=0
fi
# CR-only ist eine Vorbedingung, kein Befund: die Datei ist so nicht parsebar.
if [ "$have_inputs" -eq 1 ] && cr_embedded "$ENV_FILE"; then
  precondition "${ENV_FILE} hat CR-only-Zeilenenden (\\r ohne \\n) — nicht parsebar"
  have_inputs=0
fi
if [ "$have_inputs" -eq 1 ] && cr_embedded "$ENV_EXAMPLE"; then
  precondition "${ENV_EXAMPLE} hat CR-only-Zeilenenden (\\r ohne \\n) — nicht parsebar"
  have_inputs=0
fi

if [ "$have_inputs" -eq 1 ]; then
  while IFS=$'\037' read -r k n v; do
    [ -n "${k:-}" ] || continue
    case "$n" in ''|*[!0-9]*) continue ;; esac   # Verteidigung in der Tiefe (ME-02)
    ex_val["$k"]="$v"
  done < <(read_pairs "$ENV_EXAMPLE")

  log "Vergleiche Schlüssel-Schnittmenge: ${ENV_FILE} gegen ${ENV_EXAMPLE} (nur Namen, nie Werte)"

  # Jede .env-Zeile, deren Schlüssel auch in .env.example steht, wird verglichen.
  # Gleichheit ist ein Befund; eine nur in .env vorhandene Variable ist keiner (D-17).
  while IFS=$'\037' read -r k n v; do
    [ -n "${k:-}" ] || continue
    case "$n" in ''|*[!0-9]*) continue ;; esac   # Verteidigung in der Tiefe (ME-02)
    [ -n "${ex_val[$k]+x}" ] || continue
    # Leerwert-Regel (Pitfall 5, D-17): ein leerer Beispielwert ist eine
    # Abwesenheit, kein Beispielwert. MISTRAL_API_KEY= ist leer, weil ein Operator
    # ohne Mistral-Zugang dieselbe Leere hat — sonst wäre der Deploy dauerhaft rot.
    if [ -z "${ex_val[$k]}" ]; then
      empty_skipped=$((empty_skipped+1))
      continue
    fi
    compared=$((compared+1))
    if [ "$v" = "${ex_val[$k]}" ]; then
      if is_exempt "$k"; then
        exempt_hits=$((exempt_hits+1))
      else
        bad "${k} (.env Zeile ${n}) trägt noch den Beispielwert aus .env.example"
      fi
    fi
  done < <(read_pairs "$ENV_FILE")

  # Ein Lauf ohne einen einzigen vergleichbaren Schlüssel darf nie grün melden:
  # ein Parserfehler oder die falsche Datei wäre sonst ein stilles Grün (T-50-04).
  if [ "$compared" -eq 0 ]; then
    precondition "keine vergleichbaren Schlüssel — .env und .env.example teilen keinen Schlüssel"
  fi
fi

# Gemessene Verteilung vor dem Abschluss (Hausform: gemessene Werte, nie erwartete).
log "compared=${compared} exempt=${exempt_hits} empty_skipped=${empty_skipped}"


# ---------------------------------------------------------------------------
# Abschluss — Vorbedingung vor dem Vertragsblock: fehlt eine Vorbedingung und wurde
# kein Befund gezählt, ist der Lauf Exit 2. Ein Befund gewinnt (Präzedenz oben).
# ---------------------------------------------------------------------------
if [ -n "$PRECONDITION_REASON" ] && [ "$fails" -eq 0 ]; then
  exit 2
fi

echo
if [ "$fails" -eq 0 ]; then
  ok "0 Beispielwerte in ${compared} verglichenen Schlüsseln"
  echo "ALLE PRÜFUNGEN GRÜN"
  exit 0
fi
echo "$fails Prüfung(en) rot"
exit 1
