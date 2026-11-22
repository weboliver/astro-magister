#!/bin/sh
#
# PostgreSQL Restore Script
# Restores a backup to a test or production database
#
# Supported backup formats (auto-detected):
#   - PostgreSQL custom archive (pg_dump -Fc, optionally gzip-compressed)  -> pg_restore
#   - Plain SQL script (pg_dump plain, optionally gzip-compressed)         -> psql
#
# Usage:
#   ./restore.sh --filename=backups/daily/astronex-20260517-020000.sql.gz
#   ./restore.sh --filename=backups/astronex_20261102_145050.dump --target=production
#
#   --format=auto|dump|sql   Force a format instead of auto-detection

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATE_FORMAT=%Y%m%d-%H%M%S
DB_CONTAINER="${DB_CONTAINER:-astronex-db}"

# Source .env file to get DB_USER / DB_NAME
if [ -f "${SCRIPT_DIR}/.env" ]; then
    eval "$(grep '^DB_' "${SCRIPT_DIR}/.env" | sed 's/^/export /')"
fi

# Set default DB_USER if not set
DB_USER="${DB_USER:-postgres}"
# Database name from .env, used for --target=production
DB_NAME_PROD="${DB_NAME:-astronex}"

log() {
    echo "[$(date -u +'%Y-%m-%d %H:%M:%S UTC')] $*"
}

error() {
    echo "[$(date -u +'%Y-%m-%d %H:%M:%S UTC')] ERROR: $*" >&2
    exit 1
}

usage() {
    echo "Usage: $0 --filename=<backup-file> [--target=production|test] [--format=auto|dump|sql]"
    echo ""
    echo "Options:"
    echo "  --filename     Path to backup file (required)"
    echo "  --target       Target database: 'test' (default) or 'production'"
    echo "  --format       'auto' (default) detects pg_dump custom archives vs. plain SQL,"
    echo "                 also inside gzip files. Force with 'dump' or 'sql'."
    echo ""
    echo "Supported files:"
    echo "  astronex-*.sql.gz        gzip + custom archive (created by backup.sh)"
    echo "  *.dump / *.backup        pg_dump custom archive (optionally gzipped)"
    echo "  *.sql / *.sql.gz         plain SQL script (optionally gzipped)"
    echo ""
    echo "Examples:"
    echo "  $0 --filename=backups/daily/astronex-20260517-020000.sql.gz"
    echo "  $0 --filename=backups/astronex_20261102_145050.dump --target=production"
    exit 1
}

# Parse arguments
BACKUP_FILE=""
TARGET="test"
FORMAT="auto"

while [ $# -gt 0 ]; do
    case "$1" in
        --filename=*)
            BACKUP_FILE="${1#--filename=}"
            ;;
        --target=*)
            TARGET="${1#--target=}"
            ;;
        --format=*)
            FORMAT="${1#--format=}"
            ;;
        --help|-h)
            usage
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
    shift
done

# Validate arguments
if [ -z "$BACKUP_FILE" ]; then
    error "Missing --filename parameter"
fi

case "$FORMAT" in
    auto|dump|sql) ;;
    *) error "Invalid format: $FORMAT. Use 'auto', 'dump' or 'sql'" ;;
esac

# Resolve to absolute path if relative
case "$BACKUP_FILE" in
    /*) ;;
    *) BACKUP_FILE="${SCRIPT_DIR}/${BACKUP_FILE}" ;;
esac

# File existence check
if [ ! -f "$BACKUP_FILE" ]; then
    error "Backup file not found: $BACKUP_FILE"
fi

# File size check (must be > 100 bytes)
FILE_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)
if [ "$FILE_SIZE" -lt 100 ]; then
    error "Backup file too small ($FILE_SIZE bytes) - likely corrupted: $BACKUP_FILE"
fi

# Container must be running (pg_restore/psql run inside it)
if [ "$(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null)" != "true" ]; then
    error "Container '$DB_CONTAINER' is not running - start the stack first (docker/start.sh db)"
fi

# Detect the backup format:
#   dump        pg_dump custom archive (uncompressed)      -> pg_restore
#   dump-gzip   pg_dump custom archive inside gzip         -> gunzip | pg_restore
#   sql         plain SQL script                           -> psql
#   sql-gzip    plain SQL script inside gzip               -> gunzip | psql
is_custom_archive() {
    # pg_dump custom archives start with the magic "PGDMP"
    [ "$(head -c 5 "$1" 2>/dev/null)" = "PGDMP" ]
}

detect_format() {
    if is_custom_archive "$1"; then
        echo "dump"
        return
    fi
    if gzip -t "$1" 2>/dev/null; then
        if [ "$(gunzip -c "$1" | head -c 5 2>/dev/null)" = "PGDMP" ]; then
            echo "dump-gzip"
        else
            echo "sql-gzip"
        fi
        return
    fi
    echo "sql"
}

if [ "$FORMAT" = "auto" ]; then
    BACKUP_FORMAT=$(detect_format "$BACKUP_FILE")
else
    BACKUP_FORMAT="$FORMAT"
    # A forced format still has to be told apart from its gzip variant
    if [ "$FORMAT" = "dump" ] && ! is_custom_archive "$BACKUP_FILE"; then
        if gzip -t "$BACKUP_FILE" 2>/dev/null; then
            BACKUP_FORMAT="dump-gzip"
        fi
    elif [ "$FORMAT" = "sql" ] && ! is_custom_archive "$BACKUP_FILE"; then
        if gzip -t "$BACKUP_FILE" 2>/dev/null; then
            BACKUP_FORMAT="sql-gzip"
        fi
    fi
fi

case "$BACKUP_FORMAT" in
    dump|dump-gzip|sql|sql-gzip) ;;
    *) error "Unsupported backup format: $BACKUP_FORMAT" ;;
esac

# Determine target database
case "$TARGET" in
    test)
        DB_NAME="astronex_test"
        ;;
    production)
        DB_NAME="$DB_NAME_PROD"
        ;;
    *)
        error "Invalid target: $TARGET. Use 'test' or 'production'"
        ;;
esac

log "Starting restore: $BACKUP_FILE -> $DB_NAME (format: $BACKUP_FORMAT)"

# Recreate the database
log "Recreating database: $DB_NAME"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}';" >/dev/null 2>&1 || true
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME};" >/dev/null

# Restore the backup
log "Restoring backup..."
case "$BACKUP_FORMAT" in
    dump)
        docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges < "$BACKUP_FILE"
        ;;
    dump-gzip)
        gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges
        ;;
    sql)
        docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --quiet < "$BACKUP_FILE" || \
            error "psql restore failed - see messages above (plain SQL dumps that reassign owners may need a custom archive instead)"
        ;;
    sql-gzip)
        gunzip -c "$BACKUP_FILE" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 --quiet || \
            error "psql restore failed - see messages above (plain SQL dumps that reassign owners may need a custom archive instead)"
        ;;
esac

# Verify restore
TABLE_COUNT=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')
case "$TABLE_COUNT" in
    ''|*[!0-9]*)
        error "Restore finished but no table count could be read from '$DB_NAME'"
        ;;
esac
if [ "$TABLE_COUNT" -lt 1 ]; then
    error "Restore finished but no tables were found in '$DB_NAME'"
fi

ALEMBIC_VERSION=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT version_num FROM alembic_version;" 2>/dev/null | tr -d ' ' || true)

log "Restore complete! Tables restored: $TABLE_COUNT"
if [ -n "$ALEMBIC_VERSION" ]; then
    log "Alembic revision: $ALEMBIC_VERSION"
fi

if [ "$TARGET" = "production" ] && [ "$(docker inspect -f '{{.State.Running}}' astronex-api 2>/dev/null)" = "true" ]; then
    log "NOTE: the api container still holds connections to the old database - restart it: docker/restart.sh api"
fi

log "SUCCESS: Database '$DB_NAME' restored from $BACKUP_FILE"
