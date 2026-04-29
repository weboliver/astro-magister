#!/usr/bin/env bash
set -euo pipefail

# Copy job for WSL: kopiert aktuellen Repo-Inhalt nach ~/Projects/astro-magister
# und ersetzt in Textdateien alle Vorkommen von "~" bzw. "~" durch "~".
# Usage:
#   ./scripts/copy_to_astro_magister_wsl.sh [SOURCE_DIR] [DEST_DIR]
# Defaults: SOURCE_DIR = PWD, DEST_DIR = "$HOME/Projects/astro-magister"

SRC="${1:-$(pwd)}"
DEST="${2:-"$HOME/Projects/astro-magister"}"

echo "Source: $SRC"
echo "Destination: $DEST"

# Minimaler WSL-Check
if ! grep -qi microsoft /proc/version 2>/dev/null && [ -z "${WSL_DISTRO_NAME-}" ]; then
  echo "Hinweis: Diese Umgebung scheint kein WSL zu sein." >&2
  read -r -p "Weiter trotzdem? (y/N) " ans || true
  case "$ans" in
    y*|Y*) echo "Fortfahren..." ;;
    *) echo "Abbruch."; exit 1 ;;
  esac
fi

mkdir -p "$DEST"

echo "Synchronisiere Dateien (rsync)..."
rsync -av --delete \
  --exclude='.venv' \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='ext/ext64' \
  --exclude='*.pyc' \
  --exclude='__pycache__' \
  "$SRC/" "$DEST/"

echo "Sanitizing: Ersetze '~' -> '~' in Textdateien unter $DEST"
# Grep -I (ignore binary), -l (list files), -R (recursive)
IFS=$'\n'
for f in $(grep -RIl --exclude-dir=.git --exclude-dir=node_modules '~' "$DEST" 2>/dev/null || true); do
  if [ -f "$f" ]; then
    echo "Bearbeite: $f"
    # ersetze sowohl mit führendem Slash als auch ohne
    sed -i 's|~|~|g; s|~|~|g' "$f" || true
  fi
done
unset IFS

echo "Fertig. Zielpfad: $DEST"
echo "Hinweis: Falls Dateien ausführbar sein müssen, setze Berechtigungen mit 'chmod' nach Bedarf."

exit 0
