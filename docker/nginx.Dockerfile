FROM alpine:3.24

RUN apk add --no-cache certbot curl nginx

# Zweite non-root-Identität der Phase (CONT-01): UID 1000 mit Passwd-Eintrag, damit
# `id -un`/`$HOME` stimmen. Bewusst ohne `libcap`/`setcap` (D-09): unter
# `no-new-privileges` ignoriert der Kernel Datei-Capabilities (gemessen: CapEff=0);
# gebunden wird über den Sysctl `net.ipv4.ip_unprivileged_port_start=0` in Compose.
RUN adduser -D -u 1000 -h /home/app app

# Alle Pfade, in die der Container-User zur Laufzeit schreibt.
# /var/cache/nginx fehlt absichtlich: den Pfad gibt es im Alpine-Paket nicht, die
# Buffer-Temp-Pfade liegen laut `nginx -V` unter /var/lib/nginx/tmp.
# /etc/crontabs fehlt ebenfalls: mit D-05a gibt es keinen Cron-Pfad mehr (die
# Erneuerung läuft als Entrypoint-Schleife); ein vorbereitetes, gechowntes
# Verzeichnis wäre eine falsche Fährte.
RUN mkdir -p /etc/nginx/conf.d /etc/nginx/templates /etc/letsencrypt /var/www/certbot \
        /var/lib/letsencrypt /var/log/letsencrypt /var/lib/nginx/tmp \
        /home/app /var/log/nginx

COPY nginx.conf /etc/nginx/nginx.conf
COPY nginx.http.conf.template /etc/nginx/templates/nginx.http.conf.template
COPY nginx.https.conf.template /etc/nginx/templates/nginx.https.conf.template
COPY nginx-entrypoint.sh /usr/local/bin/nginx-entrypoint.sh
COPY certbot-renew.sh /usr/local/bin/certbot-renew.sh

RUN chmod +x /usr/local/bin/nginx-entrypoint.sh /usr/local/bin/certbot-renew.sh

# Reihenfolge-Regel: jede Datei, die der Container-User später schreibt, entsteht VOR
# dem rekursiven `chown` — sonst legt sie der Build als root:root an und ist für
# UID 1000 nur lesbar (0644 → "other = r--"). `touch` muss deshalb über dem `chown`
# stehen; certbot-renew.sh appends als uid 1000 in genau diese Datei.
# /run trägt das PID-File (`pid /run/nginx.pid;`), /var/lib/nginx die Buffer-Temp-Pfade —
# beide sind sonst harte Startfehler (`[emerg] open() "/run/nginx.pid" failed (13: Permission denied)`).
RUN touch /var/log/certbot-renew.log
RUN chown -R 1000:1000 /run /var/log /etc/nginx/conf.d /etc/letsencrypt /var/www/certbot \
        /var/lib/letsencrypt /var/log/letsencrypt /var/lib/nginx /home/app

ENV HOME=/home/app
USER 1000:1000

ENTRYPOINT ["/usr/local/bin/nginx-entrypoint.sh"]
