#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/../.env"
PROJECT_NAME="astronex"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Fehler: .env nicht gefunden: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck source=docker/compose-network-env.sh
source "${SCRIPT_DIR}/compose-network-env.sh"
astronex_network_env "${ENV_FILE}"

# Kanonische Compose-Langform — ein Ort für Projektname, .env und Compose-Datei
# (ohne diese Parameter entstünde ein zweiter Container-Satz, siehe AGENTS.md).
COMPOSE=(docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

# Image-Name aus dem nginx-Block von docker/docker-compose.yml. Die beiden
# Zertifikats-Volumes heißen deshalb LITERAL `docker_letsencrypt_data` und
# `docker_certbot_webroot`: sie tragen explizite `name:`-Keys im `volumes:`-Block
# von docker/docker-compose.yml, sind also NICHT projektpräfigiert. (Bewusst ohne
# Zeilennummer: die hat schon einmal auf den `networks:`-Block gezeigt, nachdem
# die Compose-Datei Zeilen bekommen hat.)
NGINX_IMAGE="astronex-nginx:letsencrypt"

# Ownership der Named Volumes (D-03/D-04, Mechanik D-04a).
#
# Drei gemessene Gründe für genau diese Form:
#  1. `docker compose run` scheitert an der statischen `ipv4_address` des nginx
#     (${NETWORK_IP_PREFIX}.15): `Address already in use`, solange der Stack läuft
#     (45-RESEARCH.md, Pitfall 3). Ein `compose run` ist hier also nicht verwendbar.
#  2. `-u 0` ist nötig, weil im Container `CAP_CHOWN` gedroppt ist — als UID 1000
#     kann der Wegwerf-Container nicht chownen.
#  3. Die Reparatur muss VOR `up` laufen, sonst startet nginx als UID 1000 gegen
#     root-eigene Volumes: `live/`/`archive/` sind Modus 700 und damit unsichtbar,
#     der Container liefe still nur mit HTTP weiter (D-10).
#
# `--entrypoint chown` überschreibt den Image-ENTRYPOINT — ohne das würde statt des
# Befehls der nginx-Entrypoint starten.
#
# `--mount …,volume-nocopy` statt `-v`: gemessen setzt Docker beim Mounten eines
# LEEREN Named Volume dessen Wurzelverzeichnis bei jedem `-v`-Mount auf die
# Metadaten des Container-Pfads zurück (Populate-Schritt, hier `/mnt` → root:root).
# Ein `-v`-basiertes `chown` wäre beim nächsten Mount wieder weg — die Reparatur wäre
# damit nicht idempotent. `volume-nocopy` schaltet diesen Schritt ab. Bei einem
# gefüllten Volume (Produktion) greift er ohnehin nicht, dort bleibt die Reparatur
# unverändert nötig (D-03).
repair_volume_owner() {
  local vol="$1" mount_spec
  mount_spec="type=volume,source=${vol},target=/mnt,volume-nocopy"
  # Immer rekursiv reparieren. Die UID der Volume-WURZEL sagt nichts über `live/` und
  # `archive/` (Modus 700) — genau dort sitzt die D-10-Fehlerklasse. Ein abgebrochenes
  # `chown -R`, ein `docker cp` oder ein manuelles `chown` nur der Wurzel hinterlässt
  # ein halb repariertes Volume, das eine Wurzel-Prüfung als "bereits 1000" meldete.
  # Der rekursive Lauf ist billig und idempotent; ein UID-only-Vergleich übersähe
  # zusätzlich eine falsche GID.
  echo "[build] ${vol}: setze Ownership auf 1000:1000"
  docker run --rm -u 0 --mount "${mount_spec}" --entrypoint chown "${NGINX_IMAGE}" -R 1000:1000 /mnt
}

# Entscheidet, OB die Reparatur in diesem Aufruf läuft — und ist der Grund, warum
# `docker/build.sh api` weiter funktioniert. `repair_volume_owner` läuft mit
# "${NGINX_IMAGE}"; bei einem service-gezielten Aufruf baut
# `compose build "${BUILD_ARGS[@]}"` dieses Image nicht mit. Auf einem frischen
# Checkout existiert es dann nicht, `docker run` scheitert und `set -e` bricht den
# Build ab, obwohl die Volumes für den gestarteten Service irrelevant sind.
#
# Geprüft wird gegen BUILD_ARGS, nicht gegen die Argumentanzahl: ein Aufruf nur mit
# Flags (z. B. `--force-recreate`) betrifft alle Services und darf die Reparatur
# nicht still verlieren.
needs_volume_repair() {
  if [[ ${#BUILD_ARGS[@]} -eq 0 ]]; then
    return 0
  fi
  local svc
  for svc in "${BUILD_ARGS[@]}"; do
    if [[ "${svc}" == "nginx" ]]; then
      return 0
    fi
  done
  return 1
}

# Service-Liste aus Compose selbst — dieselbe Quelle wie in docker/update.sh,
# damit es keine zweite, von Hand gepflegte Liste gibt. BUILD_ARGS übernimmt aus
# "$@" ausschließlich Service-Namen: `docker compose build` kennt die `up`-Flags
# (`--force-recreate` & Co.) nicht und bricht mit `unknown flag` ab, während `up`
# sie braucht. Konkret hängt daran der dokumentierte mkcert-Ablauf:
# `docker/build.sh nginx --force-recreate` erzeugt denselben Image-Hash, `up -d`
# allein würde den Container also nicht neu erstellen — erst der Flag startet den
# Entrypoint erneut und rendert die frisch erzeugten Zertifikate.
#
# Service-Liste portabel einlesen, nicht mit `mapfile`: das ist eine bash-4-Builtin
# und fehlt in der bash 3.2, die macOS als /bin/bash mitbringt (`#!/usr/bin/env bash`
# löst dort darauf auf) — der Einstiegspunkt bräche unter `set -e` ab, bevor irgendetwas
# gebaut wird. docker/update.sh vermeidet `mapfile` genauso, liest die Liste aber per
# Command-Substitution + `for` (Wort-Splitting an Leerraum); hier steht bewusst die
# zeilenweise Variante, weil sie auch Service-Namen mit Leerzeichen trägt.
ALL_SERVICES=()
while IFS= read -r svc; do
  if [ -n "$svc" ]; then
    ALL_SERVICES+=("$svc")
  fi
done < <("${COMPOSE[@]}" config --services)
BUILD_ARGS=()
for arg in "$@"; do
  for svc in ${ALL_SERVICES[@]+"${ALL_SERVICES[@]}"}; do
    if [[ "${arg}" == "${svc}" ]]; then
      BUILD_ARGS+=("${arg}")
      break
    fi
  done
done

# Leere Arrays sind unter `set -u` in bash < 4.4 ein Fehler ("unbound variable"):
# `"${BUILD_ARGS[@]}"` bricht den dokumentierten Standardaufruf `docker/build.sh`
# (ohne Service-Namen) auf der bash 3.2 ab, die macOS mitbringt — genau der Plattform,
# für die die Service-Liste oben portabel gelesen wird. Die Form
# `${ARR[@]+"${ARR[@]}"}` expandiert nur, wenn das Array gesetzt ist, und ist auf
# jeder bash-Version ein No-op bei leerem Array.
"${COMPOSE[@]}" build ${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}

# Nach dem Build, vor dem Start: nur dann ist das nginx-Image für die Reparatur da.
if needs_volume_repair; then
  repair_volume_owner docker_letsencrypt_data
  repair_volume_owner docker_certbot_webroot
fi

exec "${COMPOSE[@]}" up -d "$@"
