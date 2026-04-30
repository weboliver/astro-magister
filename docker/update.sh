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

# Zuerst versuchen, die Images zu pullen.
# Wenn keine Services als Argument übergeben wurden, dann pull für alle buildbaren Services
# außer `api` / `nginx` (auch Varianten `astronex-api` / `astronex-nginx`) —
# so vermeiden wir Fehler beim Pull der api/nginx-Images, da deren Update durch Rebuild erfolgt.
if [ "$#" -eq 0 ]; then
  services=$(docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" config --services)
  exclude=(api nginx astronex-api astronex-nginx)
  to_pull=()
  for s in $services; do
    skip=false
    for e in "${exclude[@]}"; do
      if [ "$s" = "$e" ]; then
        skip=true
        break
      fi
    done
    if ! $skip; then
      to_pull+=("$s")
    fi
  done
  if [ ${#to_pull[@]} -gt 0 ]; then
    docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull "${to_pull[@]}" || true
  else
    echo "Keine Services zum Pullen (api/nginx ausgeschlossen)."
  fi
else
  docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" pull "$@" || true
fi

# Anschließend für buildbare Services neu bauen (kein Cache, mit Pull der Basisimages).
docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build --no-cache --pull "$@" || true

# Zum Schluss Container (re)starten
exec docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --force-recreate "$@"
