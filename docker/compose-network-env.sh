#!/usr/bin/env bash
# Docker-Netzwerk-Einstellungen aus der .env ableiten (wird von den Compose-Skripten gesourced).
#
# docker-compose.yml liest NETWORK_NAME, NETWORK_SUBNET und NETWORK_IP_PREFIX direkt
# aus der .env (Compose-Interpolation). NETWORK_IP_PREFIX sind die ersten drei Oktette
# von NETWORK_SUBNET; daraus werden die statischen Container-IPs .10 bis .15 gebildet
# (db .10, redis .11, api .12, frontend .13, wiki-builder .14, nginx .15).
#
# Ist NETWORK_IP_PREFIX in der .env nicht gesetzt, wird er hier aus NETWORK_SUBNET
# abgeleitet und exportiert — so genügt es, nur das Subnetz zu ändern.
#
# Verwendung:
#   source "${SCRIPT_DIR}/compose-network-env.sh"
#   astronex_network_env "${ENV_FILE}"

# Liest einen Wert aus einer .env-Datei (einfacher KEY=VALUE-Parser, keine Ausführung
# der Datei). Der Wert aus der Shell-Umgebung hat Vorrang.
_astronex_env_value() {
  local key="$1" file="$2" value
  value=$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "${file}" 2>/dev/null | tail -n1 | cut -d= -f2- || true)
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "${value}"
}

# Setzt NETWORK_SUBNET und NETWORK_IP_PREFIX und exportiert sie für docker compose.
astronex_network_env() {
  local env_file="$1" subnet prefix

  subnet="${NETWORK_SUBNET:-}"
  [ -n "${subnet}" ] || subnet="$(_astronex_env_value NETWORK_SUBNET "${env_file}")"
  subnet="${subnet:-172.28.0.0/16}"

  prefix="${NETWORK_IP_PREFIX:-}"
  [ -n "${prefix}" ] || prefix="$(_astronex_env_value NETWORK_IP_PREFIX "${env_file}")"
  if [ -z "${prefix}" ]; then
    prefix=$(printf '%s' "${subnet}" | awk -F. '{print $1"."$2"."$3}')
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "${subnet}" "${prefix}" <<'PY' || exit 1
import ipaddress
import re
import sys

subnet, prefix = sys.argv[1], sys.argv[2]

try:
    network = ipaddress.ip_network(subnet, strict=False)
except ValueError as exc:
    print(f"Fehler: NETWORK_SUBNET='{subnet}' ist kein gültiges Netzwerk ({exc}).", file=sys.stderr)
    sys.exit(1)

if not re.fullmatch(r"\d{1,3}\.\d{1,3}\.\d{1,3}", prefix):
    print(
        f"Fehler: NETWORK_IP_PREFIX='{prefix}' ist kein gültiger Adressblock. "
        "Erwartet werden die ersten drei Oktette von NETWORK_SUBNET, z. B. '172.28.0'.",
        file=sys.stderr,
    )
    sys.exit(1)

if network.version != 4:
    print("Fehler: Nur IPv4-Netze werden unterstützt (NETWORK_SUBNET/NETWORK_IP_PREFIX).", file=sys.stderr)
    sys.exit(1)

for last_octet in range(10, 16):
    try:
        addr = ipaddress.IPv4Address(f"{prefix}.{last_octet}")
    except ValueError:
        print(f"Fehler: NETWORK_IP_PREFIX='{prefix}' ergibt keine gültige IPv4-Adresse.", file=sys.stderr)
        sys.exit(1)
    if addr not in network:
        print(
            f"Fehler: {addr} (aus NETWORK_IP_PREFIX='{prefix}') liegt nicht in "
            f"NETWORK_SUBNET='{subnet}'. Bitte NETWORK_IP_PREFIX an die ersten drei "
            "Oktette des Subnetzes anpassen oder leer lassen (wird dann automatisch abgeleitet).",
            file=sys.stderr,
        )
        sys.exit(1)
PY
  fi

  export NETWORK_SUBNET="${subnet}"
  export NETWORK_IP_PREFIX="${prefix}"
}
