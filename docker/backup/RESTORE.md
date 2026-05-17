# PostgreSQL Restore Guide

## Overview

This guide provides step-by-step instructions for restoring the Astronex PostgreSQL database from backups.

**IMPORTANT:** Always test restore to a test database first before restoring to production!

---

## Prerequisites

### Required Tools
- PostgreSQL client (`psql`, `pg_restore`)
- `gunzip` (for .gz compressed backups)
- Sufficient disk space for the restored database

### Required Permissions
- Read access to backup files
- CREATE DATABASE privilege (for test restore)
- CONNECT and CREATE on the target database (for production restore)

### Environment Variables

The backup script sources `.env` automatically. For manual restore, only DB_USER is needed:

```bash
export DB_USER=postgres
```

For Docker-based restore:

```bash
docker exec -i astronex-db pg_restore -U postgres -d <database> < backup.sql
```

## Quick Restore with restore.sh

Use the automated restore script for simpler restore operations:

```bash
# Restore to test database (default)
./docker/backup/restore.sh --filename=backups/weekly/astronex-20260517-020000.sql.gz

# Restore to production database
./docker/backup/restore.sh --filename=backups/weekly/astronex-20260517-020000.sql.gz --target=production
```

**restore.sh features:**
- Validates backup file exists
- Checks file size (>100 bytes)
- Verifies gzip format
- Creates target database automatically
- Reports table count after restore

---

## Time Estimates

| Database Size | Estimated Restore Time |
|--------------|----------------------|
| < 10 MB      | < 1 minute           |
| 10-100 MB    | 1-5 minutes          |
| 100-500 MB   | 5-20 minutes         |
| 500 MB - 1 GB| 20-45 minutes        |
| > 1 GB       | 45+ minutes          |

*Times are estimates and vary based on hardware and network.*

---

## Step-by-Step Restore Procedure

### Step 1: Identify the Backup to Restore

Backups are stored in tiered directories at the project root:

```bash
# List available backups (project root)
ls -la backups/daily/
ls -la backups/weekly/
ls -la backups/monthly/
```

**Recommended restore strategy:**
- Use a **daily** backup for most recent data
- Use a **weekly** backup if daily is corrupted or from the past week
- Use a **monthly** backup as a last resort

**Note:** Backup files are located in `backups/` (project root), not in `docker/backup/backups/`.

### Step 2: Verify the Backup (Recommended)

Before restoring, verify the backup integrity:

```bash
cd docker/backup

# Verify the latest daily backup
./verify-backup.sh daily

# Or verify weekly backup
./verify-backup.sh weekly

# Or verify a specific file (use path from project root)
./verify-backup.sh backups/weekly/astronex-20250517-020000.sql.gz
```

### Step 3: Stop the Application

```bash
# If running via Docker Compose
docker-compose down

# Or if running the API directly, stop the process
# (adjust based on your deployment)
```

### Step 4: Test Restore to a Test Database

**ALWAYS test restore first!** This verifies the backup works without affecting production data.

```bash
# Create a test database in Docker container
docker exec astronex-db psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS astronex_test;"
docker exec astronex-db psql -U postgres -d postgres -c "CREATE DATABASE astronex_test;"

# Restore to test database using Docker
gunzip -c backups/weekly/astronex-YYYYMMDD-HHMMSS.sql.gz | docker exec -i astronex-db pg_restore -U postgres -d astronex_test
```

### Step 5: Verify Test Restore

```bash
# Connect to the test database and verify data exists
psql -d astronex_test -c "SELECT COUNT(*) FROM information_schema.tables;"

# Or check specific tables (adjust to your schema)
psql -d astronex_test -c "\dt"
```

If test restore fails, see the Troubleshooting section below.

### Step 6: Restore to Production Database

**Only proceed if test restore succeeded!**

```bash
# Drop and recreate the production database in Docker
docker exec astronex-db psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS astronex;"
docker exec astronex-db psql -U postgres -d postgres -c "CREATE DATABASE astronex;"

# Restore to production using Docker
gunzip -c backups/weekly/astronex-YYYYMMDD-HHMMSS.sql.gz | docker exec -i astronex-db pg_restore -U postgres -d astronex
```

### Step 7: Verify Production Restore

```bash
# Check database is accessible
psql -d astronex -c "SELECT 1;"

# Verify table count
psql -d astronex -c "SELECT COUNT(*) FROM information_schema.tables;"
```

### Step 8: Restart the Application

```bash
# If using Docker Compose
docker-compose up -d

# Or start the API manually
```

---

## Backup Formats

### Gzip Compressed SQL (Default from backup.sh)

The backup script uses this format:
```bash
pg_dump --format=custom ... | gzip -c > backup.sql.gz
```

**Restore command:**
```bash
gunzip -c backup.sql.gz | psql -d astronex
# or
zcat backup.sql.gz | psql -d astronex
```

### Custom Format (pg_dump --format=custom)

**Restore command:**
```bash
pg_restore -d astronex backup.dump
```

Advantages: Allows selective restore, faster for large databases

### Plain SQL (pg_dump --format=plain)

**Restore command:**
```bash
psql -d astronex < backup.sql
```

---

## Troubleshooting

### "pg_restore: error: could not read from input file: Invalid argument"

**Cause:** Trying to use `gunzip` output directly with `pg_restore`

**Solution:** Decompress first, then restore:
```bash
gunzip -c backup.sql.gz > backup.sql
pg_restore -d astronex backup.sql
```

### "ERROR: database "astronex" is being accessed by other users"

**Cause:** Other connections are using the database

**Solution:**
```bash
# Terminate all connections to the database
psql -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'astronex';"
```

### "Out of disk space"

**Cause:** Not enough disk space for restore

**Solution:**
```bash
# Check available space
df -h

# Free up space or restore to a different volume
```

### Restore fails with "invalid byte sequence for encoding UTF8"

**Cause:** Database encoding mismatch

**Solution:**
```bash
# Specify encoding during restore
psql -d astronex --encoding=UTF8 < backup.sql
```

### "Connection refused" / "Could not connect to server"

**Cause:** PostgreSQL not running or wrong host/port

**Solution:**
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Verify connection settings
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres
```

---

## Test Restore Results

**Date:** 2026-05-17

**Backup file used:** backups/weekly/astronex-20260517-143008.sql.gz

**Verification result:** PASSED
- File size check: OK (3.9M)
- GZIP validation: OK
- pg_restore --list: OK (backup structure valid)

**Test restore result:** PASSED (Docker container)
- Created test database: astronex_test (in Docker container)
- Restored using: `gunzip -c backup.sql.gz | docker exec -i astronex-db pg_restore -d astronex_test`
- Tables/views restored: 230
- Restore time: ~1 second

**Database size restored:** 3.9M (compressed), ~12M uncompressed

**Notes:**
- Test restore completed successfully to Docker container
- Used Docker's pg_restore for version matching (PostgreSQL 16)
- Backup script now uses `docker exec astronex-db pg_dump` to ensure version match

---

## Rollback Procedure

If something goes wrong after restore:

1. **Stop the application immediately**
2. **Do NOT run docker-compose down** (this would delete the bad restore)
3. **Restore from a known-good backup** using the steps above
4. **If no good backup exists**, check if the old data is still in the database by querying

---

## Automation

To automate verify-after-backup, add this to your crontab or backup script:

```bash
# Verify latest daily backup after backup completes
cd docker/backup
./verify-backup.sh daily || echo "Backup verification failed!" | mail admin@example.com
```

---

*Last updated: 2026-05-17*
*For questions, refer to docker/backup/README.md and the main project documentation.*