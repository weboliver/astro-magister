<!-- Dies ist die öffentliche Variante dieser Datei für den Spiegel (astro-magister).
     Die private Fassung liegt im Entwicklungs-Repository; Abweichungen betreffen
     ausschließlich Verweise auf private Prüfskripte, Lock-Werkzeuge, Testdokumente
     und Agentenregeln. Der Betriebsteil — Container, Images, Volumes,
     Besitzverhältnisse, Zertifikate, Ports und die Build-/Update-Einstiege — ist
     inhaltlich unverändert übernommen. -->

# Docker Setup — Extended Guide

Basic Docker usage is documented in the main [README.md](../README.md).
This file covers advanced topics: the nginx reverse proxy, Let's Encrypt HTTPS and the non-root
hardening of the stack.

## Docker network

The stack joins a private bridge network whose name, subnet and IP block come from the `.env`:

```bash
# Name des Docker-Netzes
NETWORK_NAME=astronex_internal
# Subnetz — ändern, wenn es auf dem Host bereits belegt ist
NETWORK_SUBNET=172.28.0.0/16
# Erste drei Oktette von NETWORK_SUBNET; optional (wird sonst automatisch abgeleitet)
NETWORK_IP_PREFIX=172.28.0
```

Static container IPs are derived from `NETWORK_IP_PREFIX`: `db` `.10`, `redis` `.11`, `api` `.12`,
`frontend` `.13`, `wiki-builder` `.14`, `nginx` `.15`. `TRUSTED_PROXIES` for the API follows
automatically (`<NETWORK_IP_PREFIX>.15`), so rate limiting keeps working when the subnet changes.

Check whether the desired range is already taken:

```bash
docker network ls
docker network inspect <net> --format '{{range .IPAM.Config}}{{.Subnet}} {{end}}'
ip -4 addr show          # Host-Interfaces (LAN/VPN/Docker-Bridges)
```

If the subnet overlaps, pick a free one (e.g. `10.99.0.0/24` → `NETWORK_IP_PREFIX=10.99.0`) and
recreate the stack:

```bash
docker/build.sh          # build.sh/start.sh/update.sh leiten den IP-Block aus dem Subnetz ab
```

The helper scripts validate that `<NETWORK_IP_PREFIX>.10`–`.15` actually lie inside `NETWORK_SUBNET`
and abort with a clear message otherwise.

---

## Non-root & Ownership

### Who runs as what

`api` and `nginx` run as **UID 1000** — the same numeric user as the owner of this repository on the
host. The reason is the writable bind mount `../:/workspace`: the API writes
`app/static/wiki-covers/` and caches into it, and with UID 1000 those files stay yours on the host
and remain editable without `sudo`. The identity lives only in the Dockerfile (`USER 1000:1000`);
Compose deliberately has no `user:` key, so `up`, `run` and `exec` cannot drift apart.

`db`, `redis`, `frontend` and `wiki-builder` still run as root: their entrypoints (initdb,
`appendonly` files, `npm ci` into the bind mount) expect it. `npm ci` still deletes and rewrites
`node_modules` inside the bind mount, but it never writes the lockfile. That is a deliberate deferral,
not an oversight.

`security_opt: [no-new-privileges:true]` is set for **all six** services — `api`, `nginx`,
`frontend`, `db`, `redis` and `wiki-builder`. It prevents setuid/setcap binaries from regaining
privileges.

### One-time cleanup of root-owned artefacts

Earlier builds ran the API as root and left root-owned files inside the repository. Delete them
once instead of `chown`-ing hundreds of files: the wiki covers are regenerated on demand
(render-on-miss) from the database and are gitignored, so nothing is lost.

```bash
sudo rm -rf app/static/wiki-covers
```

Optional hygiene for stale bytecode caches left behind by the root API:

```bash
sudo find app -name __pycache__ -exec rm -rf {} +
```

### Read-only rootfs & bytecode cache

`read_only: true` applies to the `api` service only. The other services still need a writable rootfs
for their entrypoints, so widening the flag is a separate change with its own write-path inventory.
The flag is **container configuration, not an image layer**: a rebuild alone changes nothing, the
container has to be recreated, and the documented way to do that is

```bash
docker/build.sh api
```

Calling Compose directly is not a supported entry point: it needs the project name and the `.env`
the scripts already pass, otherwise a second, parallel container set appears. A full-stack call would
additionally skip the certificate-volume ownership step described under
[HTTPS with Let's Encrypt](#https-with-lets-encrypt); a service-scoped `api` call has no ownership
step of its own (`docker/build.sh` skips it for everything that does not involve `nginx`).

The writable paths are declared explicitly — no kernel or Docker default decides whether the process
can write. Measured need on 2026-11-08, on the recreated container:

| Path | Options | Measured need |
|------|---------|---------------|
| `/tmp` | `rw,size=256m,mode=1777` | 31 MB bytecode mirror (`/tmp/pycache`, 1280 `.pyc`) plus the heredoc temp files of the init script |
| `/run` | `rw,size=8m,mode=0755` | 0 B |
| `/var/tmp` | `rw,size=8m,mode=1777` | 0 B |
| `/home/app/.astronex` | `rw,size=8m,mode=0750,uid=1000,gid=1000` | 1 KB (`cfg.ini`, written on the first config read) |
| `/home/app/.cache` | `rw,size=16m,mode=0700,uid=1000,gid=1000` | 40 KB fontconfig cache, 0 B until the first cache scan (`fc-cache -f` writes 36 KB in 6 files) |

`size=` is an upper bound, not a reservation: tmpfs occupies only what is actually written, so these
values are headroom against measured demand rather than RAM set aside. The option-string form above
is the only Compose variant that can carry `uid`/`gid` — the `volumes:` long form rejects both and
does not appear in `HostConfig.Tmpfs` at all, which is exactly where the check script reads it.

**Volatile `~/.astronex`.** The directory is empty after every restart, by design. `cfg.ini` is
rewritten on the first config read (`astronex/config.py`, `read_config` → `conf.write()`), and
`charts.db`/`customloc.db` never appear in web operation because `app/services/astro_env.py`
replaces `astronex.database.connect` with a no-op adapter. Losing it costs nothing that cannot be
regenerated. An operator who needs durable data has to switch that path to a named volume **and** add
an ownership step to `docker/build.sh` — the same mechanism the certificate volumes use, see below.

**`~/.cache` is not optional.** fontconfig writes its per-user cache on the first scan; without the
mount it reports `Fontconfig error: No writable cache directories` on every scan. The container keeps
running (exit 0), so the line is easy to overlook in a busy log.

**Bytecode stays out of the repository.** `PYTHONPYCACHEPREFIX=/tmp/pycache` is set in
`docker/api.Dockerfile` — an image property, not a Compose `environment:` entry, so `docker inspect`
and `printenv` cannot disagree. The mirror lives on the `/tmp` tmpfs; the bind-mounted repository
stays bytecode-free even though it remains writable for covers and caches.

`PYTHONDONTWRITEBYTECODE` is deliberately **not** set: it wins against any prefix (measured: both set
→ 0 `.pyc`, prefix alone → 72), which would turn the requirement into a sham check — no bytecode
anywhere instead of bytecode in a tmpfs. Verify the environment with:

```bash
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' astronex-api | grep PYTHON
# Erwartet: PYTHONPYCACHEPREFIX=/tmp/pycache
# PYTHONDONTWRITEBYTECODE muss FEHLEN — sonst entsteht überhaupt kein Bytecode mehr
```

**One-time cleanup of bytecode in the working tree.** Host-side runs of the local `.venv` (Python
3.12) left `__pycache__` directories and `.pyc` files in the repository. The container also runs
Python 3.12.3 since Phase 48 (`ubuntu:24.04`), so the version no longer tells them apart — it never
writes or reads them because `PYTHONPYCACHEPREFIX` redirects the cache into the tmpfs. Delete them
once — the prune paths are mandatory, without them these two commands would wipe `.venv` and every
`node_modules`:

```bash
# Repo-weit, .venv und node_modules zwingend ausgenommen — sonst zerstört der Befehl das lokale Environment
find . -path ./.venv -prune -o -path '*/node_modules' -prune -o -name __pycache__ -type d \
  -exec rm -rf {} + 2>/dev/null
find . -name '*.pyc' -not -path './.venv/*' -not -path '*/node_modules/*' -delete
```

The removed files were `cpython-312` artefacts of the host `.venv` (measured 2026-11-08: 6
directories, 38 files, 1.3 MB); the next host-side import recreates whatever it needs.

**Optional extra hardening.** `noexec`, `nosuid` and `nodev` can be appended to the tmpfs options.
They are deliberately **not** part of the default: they are additional hardening outside the scope of
this change, and `noexec` can surprise third-party tooling that stages an executable in `/tmp`.

The maintainer's local check run verifies all of the above mechanically — `ReadonlyRootfs`, the
five tmpfs options, both write probes and the bytecode prefix — and is the automated evidence for
the container-hardening requirements.

### Ownership of the certificate volumes

Both certificate volumes stay named volumes and keep their content; only their ownership is set to
the container user. They are called literally `docker_letsencrypt_data` and
`docker_certbot_webroot`: they carry explicit `name:` keys in `docker/docker-compose.yml` and are
therefore **not** prefixed with the project name.

`docker/build.sh` repairs that ownership idempotently **before** the containers start, and skips the
step for service-scoped calls that do not involve `nginx` (for example `docker/build.sh api`). The
repair always runs `chown -R 1000:1000` and prints `[build] <volume>: setze Ownership auf 1000:1000`
per volume — checking the volume root's UID alone missed half-repaired volumes, where `live/` and
`archive/` were still root-owned.

Emergency manual repair — same image, same mechanism, only if `docker/build.sh` is not an option:

```bash
docker run --rm -u 0 --mount type=volume,source=docker_letsencrypt_data,target=/mnt,volume-nocopy \
  --entrypoint chown astronex-nginx:letsencrypt -R 1000:1000 /mnt
docker run --rm -u 0 --mount type=volume,source=docker_certbot_webroot,target=/mnt,volume-nocopy \
  --entrypoint chown astronex-nginx:letsencrypt -R 1000:1000 /mnt
```

`volume-nocopy` is not decoration: without it Docker resets the root metadata of an **empty** named
volume to the metadata of the container path on every mount, so the repair would be invisible and
not idempotent. On a filled volume (production) that reset does not happen anyway — there the repair
is needed as before.

`docker/update.sh` and `docker/start.sh` do **not** repair the ownership; they only pull, rebuild and
recreate. After a pure update run the ownership stays correct only because `docker/build.sh` set it
earlier. If it is missing, nginx aborts in production mode with
`[nginx] FEHLER: /etc/letsencrypt ist nicht schreibbar (Volume-Ownership nicht 1000:1000)` instead of
silently serving HTTP only. The remedy is `docker/build.sh`.

### Rollout prerequisites on an existing host

1. The owner of this repository must be UID 1000 — check with `id -u`. Otherwise the API cannot write
   into the bind mount.
2. The **first** run after this change goes through `docker/build.sh`, not through
   `docker/update.sh` and not through `docker/start.sh`: only `build.sh` repairs the volume
   ownership.

Afterwards, once, inside the running container and against the real certificate inventory:

```bash
docker exec -it astronex-nginx certbot renew --dry-run
```

If that reports `Another instance of Certbot is already running.`, the entrypoint's renewal loop
held the lock (`/var/lib/letsencrypt/.certbot.lock`) at that moment — the loop's first check runs
about a minute after container start. Retry a moment later; it is not a permissions problem.

That path cannot be verified on a development host — there is no certificate inventory here, and
issuing a real certificate is off limits for rate-limit reasons.

### Certificate renewal

Renewal no longer uses `crond`. Busybox `crond` cannot run jobs as a non-root user (measured:
`Permission denied` for a root-owned crontab, silently ignored jobs for a user-owned one, and
`can't set groups` for a root-owned world-readable one, because `initgroups()` needs `CAP_SETGID`).
The nginx entrypoint starts a background loop instead:

```sh
( sleep 60; while :; do /usr/local/bin/certbot-renew.sh || true; sleep 43200; done ) &
```

The first `certbot renew` runs about a minute after container start, then every 12 hours.
The lead-in matters: with the 12-hour sleep first, a container recreated more often than
every 12 hours (`docker/build.sh --force-recreate`) would never reach its first renewal.
The minute of grace keeps `exec nginx` ahead of the loop's `--deploy-hook 'nginx -s reload'`,
which needs the master to exist already.

The loop only starts when `LETSENCRYPT_DOMAINS` and `LETSENCRYPT_EMAIL` are set. Its log is
`/var/log/certbot-renew.log` and belongs to the container user (UID 1000), because the file is
created in the image *before* the recursive `chown`. Read it with:

```bash
docker exec -it astronex-nginx tail -n 50 /var/log/certbot-renew.log
```

### Binding ports 80 and 443

nginx binds the privileged ports via the sysctl `net.ipv4.ip_unprivileged_port_start=0`, set
explicitly in `docker/docker-compose.yml` and valid only inside the container's network namespace.
Do not rely on the kernel default: without that Compose key `HostConfig.Sysctls` is `null`, and the
binding would hang off a Docker daemon default instead of this repository's Compose file.

`cap_add: [NET_BIND_SERVICE]` is declared because the requirements ask for it literally. For a
non-root process under `no-new-privileges` it acts only as the bounding set — the effective
capability set stays empty (measured: `CapEff=0`). `setcap` is deliberately **not** used: under
`no-new-privileges` the kernel ignores file capabilities, and without `cap_add` `execve` would fail
on top of that.

### How the hardening is verified

The maintainer's local check run verifies all of this mechanically — `ReadonlyRootfs`, the five
tmpfs options, both write probes and the bytecode prefix — and is the automated evidence for the
container-hardening requirements. It lives in the private repository this tree is mirrored from.

Its exit contract: `0` — all checks green; `1` — at least one deviation; `2` — the check is not
possible at all (Docker unreachable, a service was never created, or nginx deliberately runs HTTP
only).

The target state is `DEBUG=true` with mkcert certificates. Without a certificate the nginx entrypoint
renders the HTTP template only, and the check stops with exit code `2` — `Server` header and HTTPS
health cannot be measured then.

---

## Dependencies

Two ecosystems, two locks, one rule: every lock is generated and checked by a script, never edited by
hand.

### Python

`requirements.txt` is the intent list: human-authored, `>=` lower bounds, three entries without a
version, and deliberately no `--require-hashes` (rejected in the milestone requirements). It is no
longer what the image installs.

`requirements.lock.txt` is the truth: 84 exact `name==version` pins, the only version source the api
image installs from. Never edit it by hand — it is produced and checked by the maintainers' lock
tooling in the private repository this tree is mirrored from. The generator runs `pip-compile` in a
throwaway `ubuntu:24.04` container and keeps the existing pins as a `--constraint`, so a plain re-run
cannot silently bump anything. A targeted bump raises the lower bound in `requirements.txt` for
exactly one package, regenerates the lock and reviews the diff; a full sweep is a deliberate step of
its own, not a routine one. A change to `requirements.txt` that excludes an existing pin ends with
exit `1`, in the generator as well as in the checker, until one of the two upgrade switches is used.

The checker compares in both directions — pin format, every requirement name has a pin, byte-identical
re-creation, `pip freeze` of the image against the lock with the two apt names excluded — and shares
the `--constraint` mechanics with the generator.

`PyGObject` and `pycairo` are deliberately not in the lock: they come from apt via
`--system-site-packages` (`/usr/lib/python3/dist-packages`). Without them the API does not start,
because `astronex/config.py:3-5` imports `Gtk`/`Gdk` at module level. The checker matches them by
name, prints their versions and never compares them.

### npm

Adding or changing a frontend dependency is a three-step change against the locked install:

```bash
cd app/frontend
npm install --package-lock-only <package>   # host: update package.json + package-lock.json only
# review and commit package.json + package-lock.json
docker/build.sh frontend --force-recreate
```

Measured on 2026-11-18/19: `app/frontend/node_modules` is owned by `root:root` (the container's
`npm ci` writes it into the bind mount), so a host `npm install <package>` without
`--package-lock-only` cannot write there (measured: a `touch` inside the directory fails with
`Permission denied`). `--package-lock-only` keeps the host run to the two files it is supposed to
touch.

The `--force-recreate` is not optional: a plain `docker/build.sh frontend` leaves a container whose
Compose configuration did not change running, so `npm ci` does not run again. `docker/build.sh` passes
the flag through to `up -d`, the same mechanism the mkcert flow documents. `npm ci` reads
`package-lock.json` only, never writes it, and aborts when `package.json` and the lock are out of sync;
measured on 2026-11-19 in `node:20-alpine`: `added 178 packages, and audited 179 packages in 4s`,
`node_modules` 79.9 MB.

There is deliberately **no** guard and **no** named volume for `node_modules`. Both would introduce
exactly the stale class this phase removes: a guard needs its own trust decision, and a named volume
would survive a lock change with old packages inside. Because `npm ci` deletes `node_modules` on every
start, recreating the container after a lock commit is mandatory rather than cosmetic.

### Audit

The dependency audit is part of the maintainers' local gate for the runtime path: exit `0` green,
exit `1` at least one runtime finding (lines prefixed `python:`/`npm:`), exit `2` precondition
missing. The Python section audits the image's site-packages in a throwaway container; the npm
section runs `npm audit --omit=dev` against the checked-in lock. The two justified advisory
exceptions are documented in the private repository this tree is mirrored from — this file
deliberately does not repeat them.

---

## HTTPS with Let's Encrypt

Requires:
- `LETSENCRYPT_DOMAINS=example.com,www.example.com`
- `LETSENCRYPT_EMAIL=admin@example.com`
- Ports 80 and 443 publicly reachable
- Domain resolving to this host (not `localhost`/`.local`)

First start with HTTPS:
```bash
docker/build.sh nginx
```

`docker/build.sh` is the documented entry point: it builds, repairs the ownership
of both certificate volumes and only then starts the service. Calling Compose directly would skip
the ownership step — exactly the failure mode described under
[Non-root & Ownership](#non-root--ownership).

Certificates persist in Docker volumes and are reused on subsequent starts.

---

## Local HTTPS (development)

With `DEBUG=true`, the nginx container uses local mkcert certificates instead of Let's Encrypt.

```bash
mkdir -p docker/certs
mkcert -key-file docker/certs/yourserver.local-key.pem \
       -cert-file docker/certs/yourserver.local.pem \
       yourserver.local localhost 127.0.0.1 ::1
docker/build.sh nginx --force-recreate
```

Run these commands from the repository root: `docker/build.sh` resolves its own paths, and the
mkcert files live under `docker/certs`. The `--force-recreate` flag is required here — a rebuild
produces the same image hash, so a plain restart would see no change and keep the container whose
`default.conf` was rendered from the *old* certificates. Recreating it runs the entrypoint again and
picks up the freshly generated mkcert files.

Required `.env` values:
```bash
DEBUG=true
DEV_HTTPS_HOSTS=yourserver.local localhost
DEV_SSL_CERT_PATH=/etc/nginx/dev-certs/yourserver.local.pem
DEV_SSL_KEY_PATH=/etc/nginx/dev-certs/yourserver.local-key.pem
# Vite must accept the host as well, otherwise the dev server answers with 403:
VITE_ALLOWED_HOSTS=localhost,127.0.0.1,yourserver.local
# Optional, matches BASE_URL of the frontend:
BASE_URL=https://yourserver.local
```

With `DEBUG=true` the canonical `apex → www` redirect blocks from the templates are not rendered,
so a local host like `astro-magister.local` is served directly instead of being 301-redirected to
the production domain. In production the redirect target comes from `NGINX_CANONICAL_HOST`
(default `www.astro-magister.de`), the matched hosts from `NGINX_CANONICAL_SOURCES`
(default `astro-magister.de`).

The mkcert CA must be trusted in the browser (run on host, not in container).
If cert files are missing, nginx starts with HTTP only in dev mode.

---

## Migration notes

- Migrations run only on empty tables by default (`MIGRATE_IF_EMPTY_ONLY=1`, `FORCE_MIGRATIONS=0`).
- Users are seeded from `~/.astronex/users.db` only if `SEED_USERS=1`.
- Locations are seeded from `astronex/db/local.db` only if `SEED_LOCATIONS=1`.
- These values are fixed in the `environment:` block of `docker/docker-compose.yml` — a shell prefix
  in front of a command never reaches the container. To force a migration, temporarily set
  `FORCE_MIGRATIONS` to `"1"` in that block, run `docker/build.sh api`, then revert the value and run
  `docker/build.sh api` once more. For a schema-only start, do the same with `SEED_USERS` and
  `SEED_LOCATIONS` set to `"0"`.
