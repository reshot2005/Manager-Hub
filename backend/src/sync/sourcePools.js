import pg from 'pg';
import { normalizeDatabaseUrl } from '../config/dbUrl.js';

const { Pool } = pg;

/**
 * Read-only source DB pools. Used ONLY by sync jobs — never by Gemini tools.
 */
function makePool(connectionString, label) {
  if (!connectionString) return null;
  const url = normalizeDatabaseUrl(connectionString);
  const pool = new Pool({
    connectionString: url,
    ssl: url.includes('localhost') || url.includes('127.0.0.1')
      ? false
      : {
          rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
        },
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    statement_timeout: 60_000,
    application_name: `manager-hub-sync-${label}`,
  });
  pool.on('error', (err) => console.error(`[source-db:${label}]`, err.message));
  return pool;
}
let sprintboardPool;
let atsPool;
let attendancePool;

export function getSprintboardPool() {
  if (sprintboardPool === undefined) {
    sprintboardPool = makePool(process.env.SPRINTBOARD_DATABASE_URL, 'sprintboard');
  }
  return sprintboardPool;
}

export function getAtsPool() {
  if (atsPool === undefined) {
    atsPool = makePool(process.env.ATS_DATABASE_URL, 'ats');
  }
  return atsPool;
}

export function getAttendancePool() {
  if (attendancePool === undefined) {
    attendancePool = makePool(process.env.ATTENDANCE_DATABASE_URL, 'attendance');
  }
  return attendancePool;
}

export async function sourceQuery(pool, text, params) {
  return pool.query(text, params);
}
