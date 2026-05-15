#!/bin/sh

set -eu

HTTP_TEMPLATE=/etc/nginx/templates/nginx.http.conf.template
HTTPS_TEMPLATE=/etc/nginx/templates/nginx.https.conf.template
TARGET_CONF=/etc/nginx/conf.d/default.conf
GEOIP2_CONF=/etc/nginx/conf.d/geoip2.conf
GEOIP2_GUARD_CONF=/etc/nginx/includes/geoip2-api-guard.conf
CERTBOT_WEBROOT=/var/www/certbot
DEBUG_MODE="${DEBUG:-false}"
DEV_SERVER_NAME_RAW="${DEV_HTTPS_HOSTS:-localhost}"
DEV_SSL_CERT_PATH="${DEV_SSL_CERT_PATH:-/etc/nginx/dev-certs/localhost.local.pem}"
DEV_SSL_KEY_PATH="${DEV_SSL_KEY_PATH:-/etc/nginx/dev-certs/localhost.local-key.pem}"
GEOIP2_ENABLED="${GEOIP2_ENABLED:-0}"
GEOIP2_DB_PATH="${GEOIP2_DB_PATH:-/usr/share/GeoIP/GeoLite2-Country.mmdb}"
GEOIP2_ALLOWED_COUNTRIES_RAW="${GEOIP2_ALLOWED_COUNTRIES:-DE,AT,CH}"
GEOIP2_LICENSE_KEY="${GEOIP2_LICENSE_KEY:-${MAXMIND_LICENSE_KEY:-}}"
GEOIP2_UPDATE_INTERVAL_SECONDS="${GEOIP2_UPDATE_INTERVAL_SECONDS:-2592000}"

LETSENCRYPT_DOMAINS_RAW="${LETSENCRYPT_DOMAINS:-${LETSENCRYPT_DOMAIN:-}}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
LETSENCRYPT_STAGING="${LETSENCRYPT_STAGING:-0}"
SERVER_NAME="${NGINX_SERVER_NAME:-${LETSENCRYPT_DOMAINS_RAW:-_}}"

mkdir -p "$CERTBOT_WEBROOT" /etc/nginx/includes

normalize_domains() {
    echo "$1" | tr ',' ' ' | xargs
}

normalize_country_codes() {
    echo "$1" | tr ',;' '  ' | xargs
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
    sed "s/__SERVER_NAME__/$1/g" "$HTTP_TEMPLATE" > "$TARGET_CONF"
}

render_https_conf() {
    sed \
        -e "s#__SERVER_NAME__#$1#g" \
        -e "s#__PRIMARY_DOMAIN__#$2#g" \
        -e "s#__SSL_CERT_PATH__#$3#g" \
        -e "s#__SSL_KEY_PATH__#$4#g" \
        "$HTTPS_TEMPLATE" > "$TARGET_CONF"
}

geoip_db_is_stale() {
    [ -f "$GEOIP2_DB_PATH" ] || return 0
    find "$GEOIP2_DB_PATH" -mtime +30 | grep -q .
}

update_geoip_database() {
    if ! is_truthy "$GEOIP2_ENABLED"; then
        return 1
    fi

    if [ -z "$GEOIP2_LICENSE_KEY" ]; then
        echo "[nginx] GeoIP2 aktiviert, aber kein Lizenzschluessel fuer automatische Updates gesetzt."
        return 1
    fi

    if GEOIP2_DB_PATH="$GEOIP2_DB_PATH" GEOIP2_LICENSE_KEY="$GEOIP2_LICENSE_KEY" ENV_FILE=/dev/null /usr/local/bin/update_geoip_db.sh; then
        return 0
    fi

    echo "[nginx] GeoIP2-Datenbank konnte nicht aktualisiert werden."
    return 1
}

ensure_geoip_database() {
    if ! is_truthy "$GEOIP2_ENABLED"; then
        return
    fi

    if geoip_db_is_stale; then
        update_geoip_database || true
    fi
}

start_geoip_update_loop() {
    if ! is_truthy "$GEOIP2_ENABLED"; then
        return
    fi

    if [ -z "$GEOIP2_LICENSE_KEY" ]; then
        return
    fi

    (
        while true; do
            sleep "$GEOIP2_UPDATE_INTERVAL_SECONDS"
            if update_geoip_database; then
                render_geoip_support_files
                nginx -s reload || true
            fi
        done
    ) &
}

render_geoip_support_files() {
    allowed_countries="$(normalize_country_codes "$GEOIP2_ALLOWED_COUNTRIES_RAW")"

    if is_truthy "$GEOIP2_ENABLED" && [ -f "$GEOIP2_DB_PATH" ]; then
        {
            echo 'geo $geoip2_bypass {'
            echo '    default 0;'
            echo '    127.0.0.1/32 1;'
            echo '    ::1/128 1;'
            echo '    10.0.0.0/8 1;'
            echo '    172.16.0.0/12 1;'
            echo '    192.168.0.0/16 1;'
            echo '}'
            echo
            echo "geoip2 $GEOIP2_DB_PATH {"
            echo "    auto_reload 5m;"
            echo '    $geoip2_country_iso country iso_code;'
            echo "}"
            echo
            echo 'map "$geoip2_bypass:$geoip2_country_iso" $allowed_country {'
            echo "    default no;"
            echo '    ~^1: yes;'
            for country_code in $allowed_countries; do
                printf '    0:%s yes;\n' "$(printf '%s' "$country_code" | tr '[:lower:]' '[:upper:]')"
            done
            echo "}"
        } > "$GEOIP2_CONF"

        cat > "$GEOIP2_GUARD_CONF" <<'EOF'
if ($allowed_country = no) {
    return 403 "Dieses private Astrologie-Portal ist nur für DACH-Nutzer.";
}
EOF

        echo "[nginx] GeoIP2-Geoblocking aktiv fuer Laender: $allowed_countries"
        return
    fi

    cat > "$GEOIP2_CONF" <<'EOF'
map $request_uri $allowed_country {
    default yes;
}
EOF
    : > "$GEOIP2_GUARD_CONF"

    if is_truthy "$GEOIP2_ENABLED" && [ ! -f "$GEOIP2_DB_PATH" ]; then
        echo "[nginx] GeoIP2 aktiviert, aber Datenbank fehlt: $GEOIP2_DB_PATH"
        echo "[nginx] Geoblocking wird deaktiviert, bis die GeoLite2-Datei vorhanden ist."
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

start_renew_loop() {
    if [ -z "$DOMAIN_LIST" ] || [ -z "$LETSENCRYPT_EMAIL" ]; then
        return
    fi

    (
        while true; do
            sleep 12h
            certbot renew --webroot -w "$CERTBOT_WEBROOT" --quiet || true
            nginx -s reload || true
        done
    ) &
}

ACTIVE_SERVER_NAME="$SERVER_NAME"

if is_truthy "$DEBUG_MODE"; then
    ACTIVE_SERVER_NAME="$DEV_SERVER_NAME"
fi

ensure_geoip_database
render_geoip_support_files
render_http_conf "$ACTIVE_SERVER_NAME"

if is_truthy "$DEBUG_MODE"; then
    if have_dev_certificate; then
        DEV_PRIMARY_DOMAIN="${DEV_SERVER_NAME%% *}"
        render_https_conf "$DEV_SERVER_NAME" "$DEV_PRIMARY_DOMAIN" "$DEV_SSL_CERT_PATH" "$DEV_SSL_KEY_PATH"
        start_geoip_update_loop
        exec nginx -g 'daemon off;'
    fi

    echo "[nginx] DEBUG=true aktiv, aber mkcert-Dateien fehlen:"
    echo "[nginx]   Zertifikat: $DEV_SSL_CERT_PATH"
    echo "[nginx]   Schluessel: $DEV_SSL_KEY_PATH"
    echo "[nginx] Starte deshalb nur mit HTTP."
    start_geoip_update_loop
    exec nginx -g 'daemon off;'
fi

if have_certificate; then
    render_https_conf "$SERVER_NAME" "$PRIMARY_DOMAIN" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem"
else
    nginx
    if request_certificate; then
        nginx -s quit
        render_https_conf "$SERVER_NAME" "$PRIMARY_DOMAIN" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/fullchain.pem" "/etc/letsencrypt/live/$PRIMARY_DOMAIN/privkey.pem"
    else
        echo "[nginx] Starte ohne HTTPS-Zertifikat; HTTP bleibt aktiv."
        nginx -s quit || true
        render_http_conf "$SERVER_NAME"
    fi
fi

start_geoip_update_loop
start_renew_loop

exec nginx -g 'daemon off;'