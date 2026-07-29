# Hub database backups & restore

## Schedule

- **Automatic:** Vercel cron `0 3 */3 * *` → `GET/POST /api/backup/cron` (authenticated with `CRON_SECRET` or Vercel cron header).
- **Manual:** `cd backend && node scripts/backup-hub.js`
- **Retention:** last **5** cycles (~2–3 weeks at 3-day interval) via `BACKUP_RETENTION_CYCLES`.

## What is stored

Logical JSON export (gzipped) of hub tables with `password_hash` redacted.  
Set `BACKUP_UPLOAD_URL` (+ optional `BACKUP_UPLOAD_TOKEN`) to push the file to off-server object storage (presigned PUT).

Also keep **Neon PITR / snapshots** enabled on the hub project — that is the primary disaster-recovery path.

## Verify a backup succeeded

1. Check API response / CLI JSON: `ok: true`, non-zero `bytes`.
2. Query hub: `SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 5;`
3. Confirm file exists under `BACKUP_DIR` or in object storage.
4. Failed runs set `status = 'failed'` and log `[backup] failed` — never silent.

## Restore procedure (logical export)

> Prefer Neon point-in-time restore for full cluster recovery. Use this for table-level recovery.

1. Create a **new** Neon branch/database (never restore over production blindly).
2. Run `npm run db:init` against the empty target (`DATABASE_URL` pointed at restore target).
3. Decompress: `gunzip -c hub-backup-….json.gz > restore.json`
4. Use a one-off restore script or `psql`/`COPY` to reload needed tables from `restore.json` → `tables.<name>`.
5. Re-seed admin if needed: set `SEED_MANAGER_PASSWORD` + `SEED_MANAGER_PASSWORD_FORCE=true`, run seed, then remove force flag.
6. Point staging app at restore DB and smoke-test login + dashboard + one AI question.
7. Only then cut over DNS / `DATABASE_URL` if validated.

## Test restore (recommended quarterly)

1. Run a manual backup.
2. Restore into a Neon branch.
3. Confirm row counts roughly match `backup_runs.stats`.
4. Record date of last successful test in your ops runbook.
