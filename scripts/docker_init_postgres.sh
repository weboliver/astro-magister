#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export PYTHONPATH="${ROOT_DIR}:${PYTHONPATH:-}"

PYTHON_BIN=""
if [[ -x "/opt/venv/bin/python" ]]; then
  PYTHON_BIN="/opt/venv/bin/python"
fi

for candidate in python python3; do
  if [[ -n "$PYTHON_BIN" ]]; then
    break
  fi
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c "import sqlalchemy" >/dev/null 2>&1; then
      PYTHON_BIN="$candidate"
      break
    fi
  fi
done

if [[ -z "$PYTHON_BIN" ]]; then
  echo "[init-postgres] no usable python interpreter with sqlalchemy found (tried: python, python3)"
  exit 1
fi

: "${DATABASE_URL:?DATABASE_URL is required (e.g. postgresql+psycopg2://user:pass@db:5432/astronex)}"

DB_WAIT_TIMEOUT_SECONDS="${DB_WAIT_TIMEOUT_SECONDS:-120}"
SEED_USERS="${SEED_USERS:-1}"
SEED_LOCATIONS="${SEED_LOCATIONS:-1}"
USERS_DB_PATH="${ASTRONEX_HOME:-$HOME/.astronex}/users.db"
MIGRATE_IF_EMPTY_ONLY="${MIGRATE_IF_EMPTY_ONLY:-1}"
FORCE_MIGRATIONS="${FORCE_MIGRATIONS:-0}"

table_row_count() {
  local table_name="$1"
  TABLE_NAME="$table_name" "$PYTHON_BIN" - <<'PY'
import os
import re
from sqlalchemy import text
from app.db.session import get_engine

table = os.getenv("TABLE_NAME", "").strip()
if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", table):
    raise SystemExit("Invalid table name")

engine = get_engine()
with engine.connect() as conn:
    count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
print(int(count))
PY
}

should_run_migration_for_table() {
  local table_name="$1"

  if [[ "$FORCE_MIGRATIONS" == "1" ]]; then
    return 0
  fi

  if [[ "$MIGRATE_IF_EMPTY_ONLY" != "1" ]]; then
    return 0
  fi

  local row_count
  row_count="$(table_row_count "$table_name")"
  if [[ "$row_count" == "0" ]]; then
    return 0
  fi

  echo "[init-postgres] table '$table_name' already has $row_count rows -> skipping migration"
  return 1
}

echo "[init-postgres] waiting for database ..."
"$PYTHON_BIN" - <<'PY'
import os
import time
from sqlalchemy import text
from app.db.session import get_engine

timeout = int(os.getenv("DB_WAIT_TIMEOUT_SECONDS", "120"))
deadline = time.time() + timeout
last_error = None

while time.time() < deadline:
    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("[init-postgres] database is reachable")
        break
    except Exception as exc:
        last_error = exc
        time.sleep(2)
else:
    raise SystemExit(f"[init-postgres] database not reachable after {timeout}s: {last_error}")
PY

echo "[init-postgres] creating SQLAlchemy tables ..."
"$PYTHON_BIN" - <<'PY'
from app.db.session import Base, get_engine
import app.db.models  # ensure all ORM models are imported

engine = get_engine()
Base.metadata.create_all(bind=engine)
print("[init-postgres] schema ready")
PY

if [[ "$SEED_USERS" == "1" ]]; then
  if [[ -f "$USERS_DB_PATH" ]] && should_run_migration_for_table "users"; then
    echo "[init-postgres] migrating users/profile/persons/tokens ..."
    "$PYTHON_BIN" scripts/migrate_users_sqlite_to_sqlalchemy.py || {
      echo "[init-postgres] users migration failed"
      exit 1
    }
  elif [[ ! -f "$USERS_DB_PATH" ]]; then
    echo "[init-postgres] users DB not found at $USERS_DB_PATH -> skipping users migration"
  else
    echo "[init-postgres] skipping users migration"
  fi
else
  echo "[init-postgres] skipping users migration (SEED_USERS=$SEED_USERS)"
fi

if [[ "$SEED_LOCATIONS" == "1" ]]; then
  if should_run_migration_for_table "locations"; then
    echo "[init-postgres] migrating location metadata/cities ..."
    "$PYTHON_BIN" scripts/migrate_localdb_to_postgres.py || {
      echo "[init-postgres] locations migration failed"
      exit 1
    }
  else
    echo "[init-postgres] skipping locations migration"
  fi
else
  echo "[init-postgres] skipping locations migration (SEED_LOCATIONS=$SEED_LOCATIONS)"
fi

echo "[init-postgres] done"
