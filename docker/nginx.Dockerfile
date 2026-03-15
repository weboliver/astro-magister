FROM alpine:3.20

ARG GEOIP2_ENABLED=0
ARG GEOIP2_LICENSE_KEY=
ARG MAXMIND_LICENSE_KEY=

RUN apk add --no-cache certbot curl libmaxminddb nginx nginx-mod-http-geoip2

RUN mkdir -p /etc/nginx/conf.d /etc/nginx/includes /etc/nginx/templates /usr/share/GeoIP

COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx.http.conf.template /etc/nginx/templates/nginx.http.conf.template
COPY nginx.https.conf.template /etc/nginx/templates/nginx.https.conf.template
COPY nginx-entrypoint.sh /usr/local/bin/nginx-entrypoint.sh
COPY update_geoip_db.sh /usr/local/bin/update_geoip_db.sh

RUN chmod +x /usr/local/bin/nginx-entrypoint.sh /usr/local/bin/update_geoip_db.sh

RUN set -eu; \
	GEOIP2_ENABLED_NORMALIZED="$(printf '%s' "$GEOIP2_ENABLED" | tr '[:upper:]' '[:lower:]')"; \
	case "$GEOIP2_ENABLED_NORMALIZED" in \
		1|true|yes|on) \
			GEOIP2_DB_PATH=/usr/share/GeoIP/GeoLite2-Country.mmdb \
			GEOIP2_LICENSE_KEY="$GEOIP2_LICENSE_KEY" \
			MAXMIND_LICENSE_KEY="$MAXMIND_LICENSE_KEY" \
			ENV_FILE=/dev/null \
			/usr/local/bin/update_geoip_db.sh \
			;; \
		*) \
			echo "[build] GeoIP2 deaktiviert, ueberspringe Datenbank-Download." \
			;; \
	esac

ENTRYPOINT ["/usr/local/bin/nginx-entrypoint.sh"]