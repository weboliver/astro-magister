#!/bin/sh
#
# PostgreSQL Restore Script
# Restores a backup to a test or production database
#
# Usage:
#   ./restore.sh --filename=backups/daily/astronex-20260517-020000.sql.gz
#   ./restore.sh --filename=backups/weekly/astronex-20260517-020000.sql.gz --target=production

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATE_FORMAT=%Y%m%d-%H%M%S

# Source .env file to get DB_USER
if [ -f "${SCRIPT_DIR}/.env" ]; then
    eval "$(grep '^DB_' "${SCRIPT_DIR}/.env" | sed 's/^/export /')"
fi

# Set default DB_USER if not set
DB_USER="${DB_USER:-postgres}"

log() {
    echo "[$(date -u +'%Y-%m-%d %H:%M:%S UTC')] $*"
}

error() {
    echo "[$(date -u +'%Y-%m-%d %H:%M:%S UTC')] ERROR: $*" >&2
    exit 1
}

usage() {
    echo "Usage: $0 --filename=<backup-file> [--target=production|test]"
    echo ""
    echo "Options:"
    echo "  --filename     Path to backup file (required)"
    echo "  --target       Target database: 'test' (default) or 'production'"
    echo ""
    echo "Examples:"
    echo "  $0 --filename=backups/daily/astronex-20260517-020000.sql.gz"
    echo "  $0 --filename=backups/weekly/astronex-20260517-020000.sql.gz --target=production"
    exit 1
}

# Parse arguments
BACKUP_FILE=""
TARGET="test"

while [ $# -gt 0 ]; do
    case "$1" in
        --filename=*)
            BACKUP_FILE="${1#--filename=}"
            ;;
        --target=*)
            TARGET="${1#--target=}"
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

# Gzip validation check
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    error "Backup file is not a valid gzip file: $BACKUP_FILE"
fi

# Determine target database
case "$TARGET" in
    test)
        DB_NAME="astronex_test"
        ;;
    production)
        DB_NAME="astronex"
        ;;
    *)
        error "Invalid target: $TARGET. Use 'test' or 'production'"
        ;;
esac

log "Starting restore: $BACKUP_FILE -> $DB_NAME"

# Create the database
log "Creating database: $DB_NAME"
docker exec astronex-db psql -U "$DB_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}';" 2>/dev/null || true
docker exec astronex-db psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"
docker exec astronex-db psql -U "$DB_USER" -d postgres -c "CREATE DATABASE ${DB_NAME};"

# Restore the backup
log "Restoring backup..."
gunzip -c "$BACKUP_FILE" | docker exec -i astronex-db pg_restore -U "$DB_USER" -d "$DB_NAME"

# Verify restore
TABLE_COUNT=$(docker exec astronex-db psql -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')
log "Restore complete! Tables restored: $TABLE_COUNT"

log "SUCCESS: Database '$DB_NAME' restored from $BACKUP_FILE"