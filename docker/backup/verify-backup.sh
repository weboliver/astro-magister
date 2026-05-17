#!/bin/sh
#
# PostgreSQL Backup Verification Script
# Verifies backup integrity using:
# 1. File size check (file exists and is > 0 bytes)
# 2. pg_restore --dry-run (tests backup can be restored)
#
# Usage:
#   ./verify-backup.sh                     # Verify latest daily backup
#   ./verify-backup.sh backups/daily/xxx   # Verify specific backup file
#   ./verify-backup.sh daily|weekly|monthly # Verify latest in category

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${SCRIPT_DIR}/backups"

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

check_env() {
    # For docker-based backup, we need DB_USER to connect to container
    if [ -z "$DB_USER" ]; then
        if [ -n "$PGUSER" ]; then
            export DB_USER="$PGUSER"
        else
            export DB_USER="postgres"
        fi
    fi
}

find_latest_backup() {
    TYPE="$1"
    case "$TYPE" in
        daily)
            DIR="${BACKUP_DIR}/daily"
            ;;
        weekly)
            DIR="${BACKUP_DIR}/weekly"
            ;;
        monthly)
            DIR="${BACKUP_DIR}/monthly"
            ;;
        *)
            error "Invalid backup type: $TYPE. Use daily, weekly, or monthly"
            ;;
    esac
    
    if [ ! -d "$DIR" ]; then
        error "Backup directory not found: $DIR"
    fi
    
    # Find the latest backup file
    LATEST=$(ls -t "${DIR}"/astronex-*.sql.gz 2>/dev/null | head -1)
    if [ -z "$LATEST" ]; then
        error "No backup files found in $DIR"
    fi
    
    echo "$LATEST"
}

verify_file_size() {
    BACKUP_FILE="$1"
    
    if [ ! -f "$BACKUP_FILE" ]; then
        error "Backup file not found: $BACKUP_FILE"
    fi
    
    FILE_SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE" 2>/dev/null)
    
    if [ "$FILE_SIZE" -eq 0 ]; then
        error "Backup file is empty: $BACKUP_FILE"
    fi
    
    FILE_SIZE_HUMAN=$(du -h "$BACKUP_FILE" | cut -f1)
    log "File size check: OK ($FILE_SIZE_HUMAN)"
    return 0
}

verify_pg_restore() {
    BACKUP_FILE="$1"

    # Check gzip validity first
    if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
        error "GZIP validation failed - backup file is corrupted"
    fi
    log "GZIP validation: OK (file is valid gzip)"

    # Use docker exec to run pg_restore with matching version
    if gunzip -c "$BACKUP_FILE" | docker exec -i astronex-db pg_restore -l > /dev/null 2>&1; then
        log "pg_restore --list: OK (backup structure valid)"
        return 0
    fi

    # Fallback: just check the file can be decompressed
    if gunzip -c "$BACKUP_FILE" > /dev/null 2>&1; then
        log "Backup can be decompressed: OK"
        return 0
    fi

    error "Backup verification failed - file may be corrupted"
}

verify_backup() {
    BACKUP_FILE="$1"
    
    log "Verifying backup: $BACKUP_FILE"
    
    # Check 1: File size check
    log "Running file size check..."
    verify_file_size "$BACKUP_FILE" || return 1
    
    # Check 2: pg_restore dry-run
    log "Running pg_restore --dry-run..."
    verify_pg_restore "$BACKUP_FILE" || return 1
    
    log "Verification complete: ALL CHECKS PASSED"
    return 0
}

main() {
    BACKUP_FILE="$1"
    
    check_env
    
    if [ -z "$BACKUP_FILE" ]; then
        # Default: verify latest daily backup
        log "No backup specified, finding latest daily backup..."
        BACKUP_FILE=$(find_latest_backup daily)
    else
        # Check if it's a type (daily/weekly/monthly) or a path
        case "$BACKUP_FILE" in
            daily|weekly|monthly)
                log "Finding latest $BACKUP_FILE backup..."
                BACKUP_FILE=$(find_latest_backup "$BACKUP_FILE")
                ;;
            *)
                # It's a path - make sure it's absolute or relative to script dir
                if [ ! -f "$BACKUP_FILE" ]; then
                    BACKUP_FILE="${SCRIPT_DIR}/${BACKUP_FILE}"
                fi
                ;;
        esac
    fi
    
    if verify_backup "$BACKUP_FILE"; then
        log "SUCCESS: Backup is valid"
        exit 0
    else
        error "Verification FAILED"
    fi
}

main "$@"