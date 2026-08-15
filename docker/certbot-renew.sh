#!/bin/sh
set -u

LOG=/var/log/certbot-renew.log
WEBROOT="${CERTBOT_WEBROOT:-/var/www/certbot}"

echo "[$(date -Iseconds)] Starte certbot renew" >> "$LOG"

if certbot renew \
    --webroot -w "$WEBROOT" \
    --no-random-sleep-on-renew \
    --quiet \
    --deploy-hook "nginx -s reload" >> "$LOG" 2>&1; then
    echo "[$(date -Iseconds)] certbot renew abgeschlossen" >> "$LOG"
else
    echo "[$(date -Iseconds)] certbot renew fehlgeschlagen (Exit $?)" >> "$LOG"
fi
