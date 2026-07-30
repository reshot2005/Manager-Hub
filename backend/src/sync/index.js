import cron from 'node-cron';
import { query } from '../config/db.js';
import { syncSprintboard } from './sprintboard.js';
import { syncAts } from './ats.js';
import { syncSprintboardFromDb } from './sprintboardDb.js';
import { syncAtsFromDb } from './atsDb.js';
import { syncAttendanceFromDb } from './attendanceDb.js';
import { ensureAdminTeamCoverage } from '../services/scope.js';
import { ensureBootstrap, linkAdminAcl } from '../services/bootstrap.js';
import { runIntelligenceJobs } from './intelligence.js';

let running = false;

async function syncSprintboardSmart() {
  if (process.env.SPRINTBOARD_DATABASE_URL) {
    return syncSprintboardFromDb();
  }
  return syncSprintboard();
}

async function syncAtsSmart() {
  if (process.env.ATS_DATABASE_URL) {
    return syncAtsFromDb();
  }
  return syncAts();
}

async function syncAttendanceSmart() {
  if (!process.env.ATTENDANCE_DATABASE_URL) {
    return { skipped: true, reason: 'ATTENDANCE_DATABASE_URL not set' };
  }
  return syncAttendanceFromDb();
}

/**
 * Prefer read-only DB sync when source DATABASE_URLs are set (faster + fuller).
 * Falls back to HTTP API sync otherwise (Sprintboard/ATS).
 * AI tools NEVER touch source DBs — only hub Postgres.
 */
export async function runFullSync({ sources = ['sprintboard', 'ats', 'attendance'] } = {}) {
  // Always keep schema + manager login ready before pulling source data
  try {
    await ensureBootstrap();
  } catch (err) {
    console.warn('[sync] bootstrap:', err.message);
  }

  if (running) {
    return { skipped: true, message: 'Sync already in progress' };
  }
  running = true;

  const { rows: runRows } = await query(
    `INSERT INTO sync_runs (source, status) VALUES ('all', 'running') RETURNING id`
  );
  const runId = runRows[0].id;
  const stats = {};
  const errors = [];

  try {
    const jobs = [];

    if (sources.includes('sprintboard')) {
      jobs.push(
        (async () => {
          try {
            console.log('[sync] Sprintboard starting…');
            stats.sprintboard = await syncSprintboardSmart();
            console.log('[sync] Sprintboard done', stats.sprintboard);
          } catch (err) {
            console.error('[sync] Sprintboard sync failed:', err.message);
            stats.sprintboard = { error: err.message };
            errors.push(`sprintboard: ${err.message}`);
          }
        })()
      );
    }

    if (sources.includes('ats')) {
      jobs.push(
        (async () => {
          try {
            console.log('[sync] ATS starting…');
            stats.ats = await syncAtsSmart();
            console.log('[sync] ATS done', stats.ats);
          } catch (err) {
            console.error('[sync] ATS sync failed:', err.message);
            stats.ats = { error: err.message };
            errors.push(`ats: ${err.message}`);
          }
        })()
      );
    }

    if (sources.includes('attendance')) {
      jobs.push(
        (async () => {
          try {
            console.log('[sync] Attendance starting…');
            stats.attendance = await syncAttendanceSmart();
            console.log('[sync] Attendance done', stats.attendance);
          } catch (err) {
            console.error('[sync] Attendance sync failed:', err.message);
            stats.attendance = { error: err.message };
            errors.push(`attendance: ${err.message}`);
          }
        })()
      );
    }

    await Promise.all(jobs);

    try {
      await ensureAdminTeamCoverage();
      await linkAdminAcl();
    } catch (err) {
      console.warn('[sync] ACL coverage:', err.message);
    }

    try {
      stats.intelligence = await runIntelligenceJobs({ force: false });
      console.log('[sync] Intelligence', stats.intelligence);
    } catch (err) {
      console.warn('[sync] intelligence:', err.message);
      stats.intelligence = { error: err.message };
    }

    const ok = errors.length === 0;
    await query(
      `UPDATE sync_runs SET status = $2, finished_at = NOW(), stats = $3, error_message = $4 WHERE id = $1`,
      [runId, ok ? 'success' : 'error', JSON.stringify(stats), errors.join(' | ') || null]
    );

    return { success: ok, partial: !ok && Object.keys(stats).length > 0, stats, errors };
  } catch (err) {
    console.error('[sync] unexpected:', err.message);
    try {
      await query(
        `UPDATE sync_runs SET status = 'error', finished_at = NOW(), stats = $2, error_message = $3 WHERE id = $1`,
        [runId, JSON.stringify(stats), err.message]
      );
    } catch {
      /* ignore */
    }
    return { success: false, stats, errors: [err.message] };
  } finally {
    running = false;
  }
}

export function startSyncCron() {
  const expr = process.env.SYNC_CRON || '*/5 * * * *';
  if (expr === 'off') {
    console.log('[sync] Cron disabled (SYNC_CRON=off)');
    return;
  }
  if (!cron.validate(expr)) {
    console.warn(`[sync] Invalid SYNC_CRON "${expr}", skipping scheduler`);
    return;
  }
  cron.schedule(expr, () => {
    runFullSync().then((r) => {
      if (!r.success) console.error('[sync] cron finished with errors:', r.errors);
      else console.log('[sync] cron OK — hub DATABASE_URL updated from sources');
    });
  });
  console.log(`[sync] Continuous sync: ${expr} → Sprintboard/ATS/Attendance → hub`);

  // Daily intelligence (leave overlay already runs after attendance; risk+alerts once/day)
  const intelExpr = process.env.INTEL_CRON || '15 2 * * *';
  if (intelExpr !== 'off' && cron.validate(intelExpr)) {
    cron.schedule(intelExpr, () => {
      runIntelligenceJobs({ force: true })
        .then((s) => console.log('[intel] daily OK', s))
        .catch((err) => console.error('[intel] daily failed:', err.message));
    });
    console.log(`[intel] Daily risk/alerts cron: ${intelExpr}`);
  }
}
