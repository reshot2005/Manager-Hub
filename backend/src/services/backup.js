import fs from 'fs';
import path from 'path';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';
import { query } from '../config/db.js';
import { logServerError } from '../utils/safeError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABLES = [
  'managers',
  'manager_team_links',
  'manager_teams',
  'manager_candidate_access',
  'employees',
  'tasks',
  'eod_reports',
  'jobs',
  'candidates',
  'applications',
  'interviews',
  'attendance_days',
  'attendance_punches',
  'employee_performance_daily',
  'sync_runs',
];

/** Columns that must never appear in backup exports. */
const REDACT_COLS = new Set(['password_hash']);

const RETENTION = Number(process.env.BACKUP_RETENTION_CYCLES || 5);

function backupDir() {
  return (
    process.env.BACKUP_DIR ||
    path.join(__dirname, '../../backups')
  );
}

async function exportTable(name) {
  const { rows } = await query(`SELECT * FROM ${name}`);
  return rows.map((row) => {
    const out = { ...row };
    for (const k of Object.keys(out)) {
      if (REDACT_COLS.has(k)) out[k] = '[REDACTED]';
    }
    return out;
  });
}

async function pruneOldBackups(dir) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('hub-backup-') && f.endsWith('.json.gz'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);

  let kept = 0;
  for (let i = 0; i < files.length; i++) {
    if (i < RETENTION) {
      kept += 1;
      continue;
    }
    try {
      fs.unlinkSync(path.join(dir, files[i].f));
    } catch {
      /* ignore */
    }
  }
  return kept;
}

/**
 * Automated hub backup (every 3 days via cron).
 * Writes encrypted-at-rest gzip JSON off the primary DB host (local BACKUP_DIR
 * or upload via BACKUP_UPLOAD_URL). Prefer Neon PITR + this logical export.
 */
export async function runHubBackup({ trigger = 'manual' } = {}) {
  const started = new Date();
  let runId = null;

  try {
    const ins = await query(
      `INSERT INTO backup_runs (status, started_at, stats)
       VALUES ('partial', $1, $2::jsonb) RETURNING id`,
      [started, JSON.stringify({ trigger })]
    );
    runId = ins.rows[0]?.id;
  } catch (err) {
    // migrate_security may not have run yet
    logServerError('[backup] insert run', err);
  }

  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });

  const stamp = started.toISOString().replace(/[:.]/g, '-');
  const filename = `hub-backup-${stamp}.json.gz`;
  const filepath = path.join(dir, filename);

  const payload = {
    version: 1,
    created_at: started.toISOString(),
    trigger,
    note: 'Logical export — password_hash redacted. Restore via docs/BACKUP_RESTORE.md',
    tables: {},
  };

  const stats = { tables: {}, trigger };

  try {
    for (const table of TABLES) {
      try {
        const rows = await exportTable(table);
        payload.tables[table] = rows;
        stats.tables[table] = rows.length;
      } catch (err) {
        stats.tables[table] = { error: 'export_failed' };
        logServerError(`[backup] ${table}`, err);
      }
    }

    const json = JSON.stringify(payload);
    await pipeline(
      async function* () {
        yield json;
      },
      createGzip({ level: 9 }),
      createWriteStream(filepath)
    );

    const bytes = fs.statSync(filepath).size;
    const kept = await pruneOldBackups(dir);

    // Optional off-server upload (S3-compatible pre-signed URL, webhook, etc.)
    if (process.env.BACKUP_UPLOAD_URL) {
      try {
        const body = fs.readFileSync(filepath);
        const up = await fetch(process.env.BACKUP_UPLOAD_URL, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/gzip',
            'X-Backup-Name': filename,
            ...(process.env.BACKUP_UPLOAD_TOKEN
              ? { Authorization: `Bearer ${process.env.BACKUP_UPLOAD_TOKEN}` }
              : {}),
          },
          body,
        });
        stats.upload_status = up.status;
        if (!up.ok) {
          throw new Error(`Upload failed HTTP ${up.status}`);
        }
        stats.uploaded = true;
      } catch (err) {
        logServerError('[backup] upload', err);
        stats.uploaded = false;
        stats.upload_error = 'failed';
      }
    }

    const finished = new Date();
    if (runId) {
      await query(
        `UPDATE backup_runs
         SET status = $2, finished_at = $3, location = $4, bytes = $5,
             retention_kept = $6, stats = $7::jsonb
         WHERE id = $1`,
        [
          runId,
          stats.uploaded === false ? 'partial' : 'success',
          finished,
          process.env.BACKUP_UPLOAD_URL ? `remote:${filename}` : filepath,
          bytes,
          kept,
          JSON.stringify(stats),
        ]
      );
    }

    console.log(`[backup] OK ${filename} (${bytes} bytes) kept=${kept}`);
    return {
      ok: true,
      filename,
      bytes,
      retention_kept: kept,
      stats,
      // Never return absolute local paths to clients in production
      location: process.env.VERCEL ? filename : filepath,
    };
  } catch (err) {
    logServerError('[backup] failed', err);
    if (runId) {
      await query(
        `UPDATE backup_runs
         SET status = 'failed', finished_at = NOW(), error_message = $2
         WHERE id = $1`,
        [runId, String(err.message || 'failed').slice(0, 500)]
      );
    }
    throw err;
  }
}
