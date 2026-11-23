FROM ubuntu:24.04
# Phase 48 / D-01: Basis ist ubuntu:24.04 (noble) statt des bisherigen
# Debian-bookworm-Basis-Images. Gemessene Kandidaten (2026-11-18, `apt-cache
# policy` im Container): `python3 3.12.3-0ubuntu2.1`, `python3-gi 3.48.2-1`,
# `gir1.2-gtk-3.0 3.24.41-4ubuntu1.3`, `pycairo 1.25.1`. Der Grund ist der
# GTK-Pfad, nicht die Python-Version allein: `astronex/config.py:3-5` macht
# `from gi.repository import Gtk, Gdk` auf Modulebene, und
# `app/services/astro_env.py:9` zieht das beim API-Start — `gi` kann deshalb nur
# aus apt kommen, nicht aus PyPI.
# Gegenprobe D-02 (verworfen): `python:3.12-slim-bookworm` liefert Python
# `3.12.16`, aber Debian-`python3-gi` `3.42.2` ist für 3.11 gebaut — `import gi`
# wäre dort unmöglich, PyGObject müsste aus dem Quellcode gebaut werden.
#
# Phase 48 / D-03: `_pysw.so` bleibt unangetastet. Die SWIG-Extension ist
# unversioniert benannt, linkt nur gegen libc und lädt unter 3.12.3 unverändert
# (`import _pysw` → OK, gemessen 2026-11-18); kein Rebuild, kein `make` in
# `ext/ext64`.

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
# Phase 46 / CONT-05 / D-05: Bytecode entsteht weiterhin, aber in einem tmpfs-Spiegelbaum
# statt im Bind-Mount. `PYTHONDONTWRITEBYTECODE` ist bewusst NICHT gesetzt: es gewinnt
# gegen jeden Prefix (gemessen 2026-11-08: beides gesetzt -> 0 .pyc, nur Prefix -> 72 .pyc)
# und würde CONT-05 zu einer Scheinprüfung machen. Der Pfad liegt auf dem /tmp-tmpfs,
# das docker/docker-compose.yml für den api-Service mountet.
ENV PYTHONPYCACHEPREFIX=/tmp/pycache
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

# Phase 48 / D-08-Voraussetzung: `python3-pip` ist bewusst NICHT im Set. Es zieht
# ueber seine apt-Depends `python3-setuptools` (68.1.2) und `python3-wheel` (0.42.0)
# nach `/usr/lib/python3/dist-packages` (gemessen 2026-11-18 via
# `apt-cache depends python3-pip`); `pip freeze` liefert dann vier statt zwei
# Fremdeintraege, und das Audit-Gate erbt zehn zusaetzliche Build-Tooling-Findings.
# Gemessen im neuen Image: `pip freeze` = 85 Zeilen, davon genau
# `PyGObject==3.48.2` und `pycairo==1.25.1` als apt-Fremdeintraege; weder
# `setuptools` noch `wheel` erscheinen. `pip` bleibt verfuegbar, weil
# `python3-venv` ueber `ensurepip` `pip 24.0` in `/opt/venv` legt und
# `ENV PATH` es aufloest.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    python3 \
    python3-venv \
    python3-gi \
    python3-gi-cairo \
    gir1.2-gtk-3.0 \
    libcairo2 \
    libgirepository-1.0-1 \
    fontconfig \
    build-essential \
    swig \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv --system-site-packages /opt/venv

# Phase 48 / D-07: installiert wird ausschliesslich requirements.lock.txt — eine
# zweite Version-Quelle gibt es damit nicht mehr: requirements.txt wird nicht
# mehr ins Image kopiert, sie bleibt die Absichtsliste mit `>=`-Untergrenzen
# (D-06). Den Lock erzeugt `scripts/update-requirements-lock.sh` per pip-compile
# mit `--strip-extras --no-annotate --no-header` (M5); er wird nie von Hand
# editiert, jede Aenderung ist ein bewusster Generator-Lauf.
# Bewusst NICHT im Lock: PyGObject und pycairo — beide kommen aus
# `/usr/lib/python3/dist-packages` ueber `--system-site-packages` (D-08) und sind
# fuer den API-Start zwingend, weil `astronex/config.py:3-5` `Gtk`/`Gdk` auf
# Modulebene importiert und `app/services/astro_env.py:9` das beim Start zieht.
# Gemessen 2026-11-19 im neu gebauten Image: `pip freeze` = 86 Zeilen, also
# 84 Lock-Pins plus genau diese zwei apt-Bereitstellungen (D-08); numpy 2.4.6,
# fastapi 0.162.2 und h3 4.5.0 unveraendert — der Lock hat den Stand gehalten,
# nicht gehoben.
COPY requirements.lock.txt /tmp/requirements.lock.txt
RUN pip install --no-cache-dir -r /tmp/requirements.lock.txt

COPY astronex/resources/Astro-Nex.ttf /usr/local/share/fonts/astronex/Astro-Nex.ttf
RUN fc-cache -f -v

# Nicht-Root-Betrieb (Phase 45, D-01). UID 1000 ist der Host-Besitzer des
# beschreibbaren Bind-Mounts `../:/workspace`; die API schreibt dort real
# (app/static/wiki-covers, Caches), mit derselben UID bleiben diese Dateien auf
# dem Host ohne sudo editierbar. Der Passwd-Eintrag ist kein Kosmetik-Punkt: ohne
# ihn meldet libpq bei jeder Verbindung ohne expliziten User
# "local user with ID 1000 does not exist" (gemessen).
# `HOME` ist Pflicht, weil app/main.py:138-140 beim Import `Path.home()/.astronex`
# anlegt — ohne Passwd-Eintrag setzt Docker HOME=/ und der Import stirbt mit
# "PermissionError: [Errno 13] Permission denied: '/.astronex'" (gemessen).
# /opt/venv wird bewusst NICHT gechownt: es wird nur gelesen. Der Bytecode der
# Site-Packages wird seit Phase 46 (D-05) über PYTHONPYCACHEPREFIX nach /tmp/pycache
# umgeleitet (gemessen: 21 MB unter /tmp/pycache/opt/venv/...) statt unterdrückt.
# Phase 48 / Review 2026-11-18 (Build-Blocker): ubuntu:24.04 bringt einen
# Default-User `ubuntu` mit UID 1000 und GID 1000 mit (gemessen: `getent passwd
# 1000` → `ubuntu:x:1000:1000:Ubuntu:/home/ubuntu:/bin/bash`; `groupadd -g 1000
# app` scheitert mit `GID '1000' already exists`, rc=4). `userdel --remove`
# entfernt User und gleichnamige Gruppe (`USERGROUPS_ENAB yes`) vor dem
# `groupadd`. Bewusst kein `usermod`/`groupmod`: Name `app`, Home `/home/app` und
# Shell `/usr/sbin/nologin` sind Phase-45-Vertrag (tmpfs-Ziele in
# docker/docker-compose.yml und scripts/check-container-hardening.sh:414-446).
RUN userdel --remove ubuntu && groupadd -g 1000 app && useradd -u 1000 -g 1000 -m -d /home/app -s /usr/sbin/nologin app
ENV HOME=/home/app
USER 1000:1000

WORKDIR /workspace
