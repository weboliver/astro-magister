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

exec docker compose --project-name "${PROJECT_NAME}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d --build "$@"