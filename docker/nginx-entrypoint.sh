#!/bin/sh

set -eu

HTTP_TEMPLATE=/etc/nginx/templates/nginx.http.conf.template
HTTPS_TEMPLATE=/etc/nginx/templates/nginx.https.conf.template
TARGET_CONF=/etc/nginx/conf.d/default.conf
CERTBOT_WEBROOT=/var/www/certbot
DEBUG_MODE="${DEBUG:-false}"
DEV_SERVER_NAME_RAW="${DEV_HTTPS_HOSTS:-localhost}"
DEV_SSL_CERT_PATH="${DEV_SSL_CERT_PATH:-/etc/nginx/dev-certs/localhost.local.pem}"
DEV_SSL_KEY_PATH="${DEV_SSL_KEY_PATH:-/etc/nginx/dev-certs/localhost.local-key.pem}"

LETSENCRYPT_DOMAINS_RAW="${LETSENCRYPT_DOMAINS:-${LETSENCRYPT_DOMAIN:-}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
LETSENCRYPT_STAGING="${LETSENCRYPT_STAGING:-0}"
SERVER_NAME="${NGINX_SERVER_NAME:-${LETSENCRYPT_DOMAINS_RAW:-_}}"

# Kanonischer Produktions-Redirect (Apex -> www): nur aktiv, wenn DEBUG nicht gesetzt ist.
# Mit DEBUG=true entfaellt der Redirect, damit lokale Hosts (z. B. astro-magister.local)
# direkt bedient werden statt auf die Produktionsdomain umzuleiten.
CANONICAL_SOURCES_RAW="${NGINX_CANONICAL_SOURCES:-astro-magister.de}"
CANONICAL_HOST="${NGINX_CANONICAL_HOST:-www.astro-magister.de}"

mkdir -p "$CERTBOT_WEBROOT"

normalize_domains() {
    echo "$1" | tr ',' ' ' | xargs
}

DOMAIN_LIST="$(normalize_domains "$LETSENCRYPT_DOMAINS_RAW")"
PRIMARY_DOMAIN="${DOMAIN_LIST%% *}"
SERVER_NAME="$(normalize_domains "$SERVER_NAME")"
DEV_SERVER_NAME="$(normalize_domains "$DEV_SERVER_NAME_RAW")"

is_truthy() {
    case "$(echo "$1" | tr '[:upper:]' '[:lower:]')" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

render_http_conf() {
    sed \
        -e "s/__SERVER_NAME__/$1/g" \
        -e "s/__CANONICAL_SOURCES__/$2/g" \
        -e "s/__CANONICAL_HOST__/$3/g" \
        "$HTTP_TEMPLATE" > "$TARGET_CONF"
    apply_canonical_mode "$4"
}

render_https_conf() {
    sed \
        -e "s#__SERVER_NAME__#$1#g" \
        -e "s#__PRIMARY_DOMAIN__#$2#g" \
        -e "s#__SSL_CERT_PATH__#$3#g" \
        -e "s#__SSL_KEY_PATH__#$4#g" \
        -e "s#__CANONICAL_SOURCES__#$5#g" \
        -e "s#__CANONICAL_HOST__#$6#g" \
        "$HTTPS_TEMPLATE" > "$TARGET_CONF"
    apply_canonical_mode "$7"
}

# keep = Produktions-Redirect behalten, strip = Bloecke entfernen (DEBUG-Modus)
apply_canonical_mode() {
    if [ "$1" = "strip" ]; then
        sed -i '/# BEGIN canonical-redirect/,/# END canonical-redirect/d' "$TARGET_CONF"
    fi
}

have_certificate() {
    [ -n "$PRIMARY_DOMAIN" ] && [ -f "/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem" ] && [ -f "/etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem" ]
}

have_dev_certificate() {
    [ -f "$DEV_SSL_CERT_PATH" ] && [ -f "$DEV_SSL_KEY_PATH" ]
}

request_certificate() {
    if [ -z "$DOMAIN_LIST" ] || [ -z "$LETSENCRYPT_EMAIL" ]; then
        echo "[nginx] LetsEncrypt nicht aktiviert: LETSENCRYPT_DOMAINS und/oder LETSENCRYPT_EMAIL fehlen."
        return 1
    fi

    set --
    for domain in $DOMAIN_LIST; do
        set -- "$@" -d "$domain"
    done

    staging_args=
    if [ "$LETSENCRYPT_STAGING" = "1" ]; then
        staging_args="--staging"
    fi

    certbot certonly \
        --webroot \
        -w "$CERTBOT_WEBROOT" \
        --email "$LETSENCRYPT_EMAIL" \
        --agree-tos \
        --non-interactive \
        --keep-until-expiring \
        $staging_args \
        "$@"
}

# Warum keine crond-Crontab mehr: busybox-crond kann als Nicht-Root keine Jobs
# ausführen (gemessen in drei Varianten — root-eigene Crontab mit 600: "Permission
# denied"; user-eigene Crontab: stilles Ignorieren; lesbare root-eigene Crontab: der
# Job-Child stirbt an "can't set groups"). Die Erneuerung läuft deshalb als
# Hintergrund-Schleife dieses Entrypoints, als UID 1000.
#
# `|| true` ist Pflicht: das Entrypoint erbt `set -e`, ein Exit != 0 beendete sonst die
# Subshell und damit still die Erneuerung. PID 1 ist davon nicht betroffen — die
# Subshell läuft nach dem `exec` als Kind des nginx-Masters (gemessen; `docker stop`
# bleibt unter einer Sekunde). docker/certbot-renew.sh bleibt unverändert, weil es
# Fehler intern abfängt.
start_renew_loop() {
    if [ -z "$DOMAIN_LIST" ] || [ -z "$LETSENCRYPT_EMAIL" ]; then
        return
    fi

    # Ein fehlschlagendes `touch` darf PID 1 nicht abwürgen: unter `set -eu` endete das
    # Entrypoint sonst VOR `exec nginx` und legte den ganzen Stack lahm. Die
    # Schreibbarkeit selbst sichern die Build-Zeit-Ownership im Image und der
    # Prüfblock des Prüfskripts ab, nicht dieses `touch`.
    touch /var/log/certbot-renew.log 2>/dev/null || echo "[nginx] WARN: /var/log/certbot-renew.log nicht schreibbar"

    (
        # Der erste Prüflauf kommt KURZ nach dem Start, nicht erst nach 12 h. Vorher
        # stand `sleep 43200` am Schleifenanfang: ein Container, der öfter als alle
        # 12 h neu erstellt wird (jeder `docker/build.sh --force-recreate`), erreichte
        # den ersten `certbot renew` nie — die Erneuerung wäre komplett ausgefallen,
        # und beim Boot prüft das Entrypoint nur `have_certificate`, es erneuert nicht.
        # Die kurze Anlaufzeit statt eines sofortigen Laufs: `certbot renew` ist nur
        # dann nicht folgenlos, wenn das Zertifikat fällig ist — dann läuft der
        # Deploy-Hook `nginx -s reload`, und der braucht den Master, den dieses Skript
        # erst mit dem `exec nginx` am Ende startet.
        sleep 60
        while :; do
            /usr/local/bin/certbot-renew.sh || true
            sleep 43200
        done
    ) &
}

# Begrenztes Warten auf das Ende des Bootstrap-Masters (maximal 10 s). Grund: im
# Fallback-Zweig meldete `nginx -s reload` gemessen `invalid PID number "" in
# "/run/nginx.pid"` — plausibel ein Rennen, bei dem der alte Master beim Beenden das
# PID-File des direkt danach gestarteten neuen Masters löscht. Der Zweig betrifft den
# Erststart mit Zertifikatsausstellung; dort bliebe der `--deploy-hook` sonst wirkungslos.
stop_bootstrap_nginx() {
    # Ein fehlendes /run/nginx.pid (Master schon weg, PID-Race) lässt `nginx -s quit` mit
    # Exit 1 enden. Unter `set -eu` risse das PID 1 VOR `exec nginx` mit — die Funktion
    # meldet den Zustand deshalb nur und lässt die Aufrufer weiterlaufen (beide sichern
    # zusätzlich mit `|| true` ab).
    nginx -s quit 2>/dev/null || { echo "[nginx] Bootstrap-Master nicht erreichbar, fahre fort"; return 1; }
    _waited=0
    while [ -f /run/nginx.pid ] && [ "$_waited" -lt 10 ]; do
        sleep 1
        _waited=$((_waited + 1))
    done
}

CANONICAL_SOURCES="$(normalize_domains "$CANONICAL_SOURCES_RAW")"
CANONICAL_MODE="keep"
ACTIVE_SERVER_NAME="$SERVER_NAME"

if is_truthy "$DEBUG_MODE"; then
    ACTIVE_SERVER_NAME="$DEV_SERVER_NAME"
    CANONICAL_MODE="strip"
fi

render_http_conf "$ACTIVE_SERVER_NAME" "$CANONICAL_SOURCES" "$CANONICAL_HOST" "$CANONICAL_MODE"

if is_truthy "$DEBUG_MODE"; then
    if have_dev_certificate; then
        DEV_PRIMARY_DOMAIN="${DEV_SERVER_NAME%% *}"
        render_https_conf "$DEV_SERVER_NAME" "$DEV_PRIMARY_DOMAIN" "$DEV_SSL_CERT_PATH" "$DEV_SSL_KEY_PATH" "$CANONICAL_SOURCES" "$CANONICAL_HOST" "$CANONICAL_MODE"
        exec nginx -g 'daemon off;'
    fi

    echo "[nginx] DEBUG=true aktiv, aber mkcert-Dateien fehlen:"
    echo "[nginx]   Zertifikat: $DEV_SSL_CERT_PATH"
    echo "[nginx]   Schluessel: $DEV_SSL_KEY_PATH"
    echo "[nginx] Starte deshalb nur mit HTTP."
    exec nginx -g 'daemon off;'
fi

# D-10: Ein root-eigenes Volume macht `live/`/`archive/` (Modus 700) für uid 1000
# unsichtbar, `have_certificate` meldet "kein Zertifikat" und der Container liefe grün,
# aber still nur mit HTTP weiter (irreführende Zeile "LetsEncrypt nicht aktiviert").
# docker/update.sh und docker/start.sh reparieren die Ownership nicht — ein lauter
# Abbruch ist hier besser als ein stiller HTTPS-Verlust. Geprüft werden BEIDE zur
# Laufzeit beschriebenen Volumes: ohne schreibbares /var/www/certbot scheitert die
# ACME-Challenge und damit die Erneuerung später still im Hintergrund-Log.
if [ -n "$DOMAIN_LIST" ]; then
    for _dir in /etc/letsencrypt /var/www/certbot; do
        if [ ! -w "$_dir" ]; then
            echo "[nginx] FEHLER: $_dir ist nicht schreibbar (Volume-Ownership nicht 1000:1000)."
            echo "[nginx]         docker/build.sh ausführen und den Container neu erstellen."
            exit 1
        fi
    done
fi

if have_certificate; then
    render_https_conf "$SERVER_NAME" "$PRIMARY_DOMAIN" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem" "$CANONICAL_SOURCES" "$CANONICAL_HOST" "$CANONICAL_MODE"
else
    nginx
    if request_certificate; then
        stop_bootstrap_nginx || true
        render_https_conf "$SERVER_NAME" "$PRIMARY_DOMAIN" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem" "$CANONICAL_SOURCES" "$CANONICAL_HOST" "$CANONICAL_MODE"
    else
        echo "[nginx] Starte ohne HTTPS-Zertifikat; HTTP bleibt aktiv."
        stop_bootstrap_nginx || true
        render_http_conf "$SERVER_NAME" "$CANONICAL_SOURCES" "$CANONICAL_HOST" "$CANONICAL_MODE"
    fi
fi

start_renew_loop

exec nginx -g 'daemon off;'