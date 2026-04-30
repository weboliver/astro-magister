#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -eq 0 ]]; then
  echo "Starte alle Services neu..."
  "${SCRIPT_DIR}/stop.sh"
  "${SCRIPT_DIR}/start.sh"
else
  echo "Starte Service(s) neu: $*"
  "${SCRIPT_DIR}/stop.sh" "$@"
  "${SCRIPT_DIR}/start.sh" "$@"
fi

exit 0
