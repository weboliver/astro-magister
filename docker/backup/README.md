# PostgreSQL Backup Setup

## Prerequisites

The backup script uses Docker to run pg_dump with the matching PostgreSQL version. Ensure Docker is running.

```bash
# Ensure Docker is running
docker ps | grep astronex-db
```

## Setup

1. **Copy files to production server:**
   ```bash
   scp -r docker/backup user@your-server:/home/astronex/
   ```

2. **Copy .env file:**
   ```bash
   scp .env user@your-server:/home/astronex/
   ```

3. **No .env changes needed** — The backup script uses `docker exec` to run pg_dump inside the container, so it uses the internal PostgreSQL port 5432 automatically.

4. **Create backup directories:**
   ```bash
   mkdir -p /home/astronex/backups/daily
   mkdir -p /home/astronex/backups/weekly
   mkdir -p /home/astronex/backups/monthly
   ```

5. **Test the backup:**
   ```bash
   cd /home/astronex
   source .env
   ./docker/backup/backup.sh
   ```

5. **Verify backup created:**
   ```bash
   ls -la /home/astronex/backups/daily/
   ls -la /home/astronex/backups/weekly/
   ls -la /home/astronex/backups/monthly/
   ```

## Automated Daily Backups

Add a cron job to run backups automatically:

```bash
# Edit crontab
crontab -e

# Add this line (runs daily at 2am UTC):
0 2 * * * cd /home/astronex && ./docker/backup/backup.sh >> /var/log/backup.log 2>&1
```

**Note:** Ensure Docker is running before the backup executes. The script uses `docker exec` to run pg_dump from the PostgreSQL container.

The script automatically creates:
- **Daily backups** - every day to `backups/daily/`
- **Weekly backups** - every Sunday to `backups/weekly/`
- **Monthly backups** - 1st of each month to `backups/monthly/`

## Manual Backup

```bash
cd /home/astronex
source .env
./docker/backup/backup.sh
```

## Restore from Backup

Use the automated restore script:

```bash
# Restore to test database (default)
./docker/backup/restore.sh --filename=backups/weekly/astronex-20260517-020000.sql.gz

# Restore to production database
./docker/backup/restore.sh --filename=backups/weekly/astronex-20260517-020000.sql.gz --target=production

# Custom-format dump (pg_dump -Fc) from another machine
./docker/backup/restore.sh --filename=backups/astronex_20261102_145050.dump --target=production
```

**restore.sh features:**
- File existence validation
- File size check (>100 bytes)
- Format detection: pg_dump custom archive (`.dump`, also gzipped) → `pg_restore`,
  plain SQL (`.sql`, also gzipped) → `psql` — override with `--format=dump|sql`
- `--no-owner --no-privileges` for `pg_restore`, so dumps from another machine/user restore cleanly
- Auto-creates target database
- Reports table count and `alembic_version` after restore
- After a production restore: `./docker/restart.sh api`

For manual restore, see `RESTORE.md`.

## Retention Policy

- **7 daily backups** in `backups/daily/`
- **4 weekly backups** in `backups/weekly/`
- **12 monthly backups** in `backups/monthly/`

The script automatically cleans up old backups based on the retention policy.
