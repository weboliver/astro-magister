#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../.env}"
GEOIP2_DB_PATH="${GEOIP2_DB_PATH:-$SCRIPT_DIR/geoip/GeoLite2-Country.mmdb}"

if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
fi

LICENSE_KEY="${GEOIP2_LICENSE_KEY:-${MAXMIND_LICENSE_KEY:-}}"

if [ -z "$LICENSE_KEY" ]; then
    echo "GEOIP2_LICENSE_KEY oder MAXMIND_LICENSE_KEY ist nicht gesetzt."
    echo "Erzeuge zuerst einen GeoLite2-Lizenzschluessel bei MaxMind und setze ihn in .env oder als Umgebungsvariable."
    exit 1
fi

TARGET_DIR=$(dirname "$GEOIP2_DB_PATH")
TMP_DIR=$(mktemp -d)
ARCHIVE_PATH="$TMP_DIR/GeoLite2-Country.tar.gz"
DOWNLOAD_URL="https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=$LICENSE_KEY&suffix=tar.gz"

cleanup() {
    rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

mkdir -p "$TARGET_DIR"

if [ ! -w "$TARGET_DIR" ]; then
    echo "Keine Schreibrechte auf $TARGET_DIR"
    echo "Setze den Besitz z. B. mit: sudo chown -R $(id -un):$(id -gn) $TARGET_DIR"
    exit 1
fi

curl -fL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"
tar -xzf "$ARCHIVE_PATH" -C "$TMP_DIR"

MMDB_PATH=$(find "$TMP_DIR" -type f -name 'GeoLite2-Country.mmdb' | head -n 1)
if [ -z "$MMDB_PATH" ]; then
    echo "GeoLite2-Country.mmdb wurde im Archiv nicht gefunden."
    exit 1
fi

cp "$MMDB_PATH" "$GEOIP2_DB_PATH"

echo "GeoIP-Datenbank aktualisiert: $GEOIP2_DB_PATH"