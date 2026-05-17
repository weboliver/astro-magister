#!/bin/sh
#
# PostgreSQL Backup Script
# Runs pg_dump, compresses with gzip, and maintains tiered retention:
# - 7 daily backups in backups/daily/
# - 4 weekly backups in backups/weekly/
# - 12 monthly backups in backups/monthly/
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATE_FORMAT=%Y%m%d-%H%M%S
RETENTION_DAILY=7
RETENTION_WEEKS=4
RETENTION_MONTHS=12

# Source only DB_* variables from .env file
if [ -f "${SCRIPT_DIR}/.env" ]; then
    eval "$(grep '^DB_' "${SCRIPT_DIR}/.env" | sed 's/^/export /')"
fi

log() {
    echo "[$(date -u +'%Y-%m-%d %H:%M:%S UTC')] $*"
}

run_pg_dump() {
    docker exec astronex-db pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom 2>/dev/null
}

check_env() {
    if [ -z "$DB_USER" ] || [ -z "$DB_NAME" ]; then
        log "ERROR: Missing required environment variables (DB_USER, DB_NAME)"
        exit 2
    fi
}

get_backup_type() {
    DAY_OF_WEEK=$(date -u +%u)
    DAY_OF_MONTH=$(date -u +%d)

    if [ "$DAY_OF_MONTH" = "01" ]; then
        echo "monthly"
    elif [ "$DAY_OF_WEEK" = "7" ]; then
        echo "weekly"
    else
        echo "daily"
    fi
}

create_backup() {
    BACKUP_TYPE="$1"
    TIMESTAMP=$(date -u +"$DATE_FORMAT")
    FILENAME="astronex-${TIMESTAMP}.sql.gz"

    case "$BACKUP_TYPE" in
        daily)
            BACKUP_DIR="${SCRIPT_DIR}/backups/daily"
            ;;
        weekly)
            BACKUP_DIR="${SCRIPT_DIR}/backups/weekly"
            ;;
        monthly)
            BACKUP_DIR="${SCRIPT_DIR}/backups/monthly"
            ;;
    esac

    mkdir -p "$BACKUP_DIR"
    FULL_PATH="${BACKUP_DIR}/${FILENAME}"

    log "Creating $BACKUP_TYPE backup: $FILENAME"

    run_pg_dump | gzip -c > "$FULL_PATH"

    if [ $? -eq 0 ] && [ -f "$FULL_PATH" ]; then
        FILESIZE=$(du -h "$FULL_PATH" | cut -f1)
        log "Backup created: $FILENAME ($FILESIZE)"
    else
        log "ERROR: Backup failed"
        exit 2
    fi
}

cleanup_backups() {
    BACKUP_TYPE="$1"
    case "$BACKUP_TYPE" in
        daily)
            BACKUP_DIR="${SCRIPT_DIR}/backups/daily"
            RETENTION=$RETENTION_DAILY
            log "Cleaning up daily backups older than $RETENTION days..."
            ;;
        weekly)
            BACKUP_DIR="${SCRIPT_DIR}/backups/weekly"
            RETENTION=$((RETENTION_WEEKS * 7))
            log "Cleaning up weekly backups older than $RETENTION days..."
            ;;
        monthly)
            BACKUP_DIR="${SCRIPT_DIR}/backups/monthly"
            RETENTION=$((RETENTION_MONTHS * 30))
            log "Cleaning up monthly backups older than $RETENTION days..."
            ;;
    esac

    if [ -d "$BACKUP_DIR" ]; then
        find "$BACKUP_DIR" -name "astronex-*.sql.gz" -mtime +$RETENTION -delete
        COUNT=$(find "$BACKUP_DIR" -name "astronex-*.sql.gz" | wc -l)
        log "Cleanup complete. Total $BACKUP_TYPE backups: $COUNT"
    fi
}

main() {
    check_env

    BACKUP_TYPE=$(get_backup_type)
    log "Backup type: $BACKUP_TYPE"

    create_backup "$BACKUP_TYPE"
    cleanup_backups "$BACKUP_TYPE"

    log "Backup completed successfully"
    exit 0
}

main "$@"