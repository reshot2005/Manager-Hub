import { query } from '../config/db.js';
import { getAttendancePool, sourceQuery } from './sourcePools.js';
import {
  DEFAULT_SHIFT,
  evaluateLogin,
  resolveShift,
} from '../utils/shifts.js';

/**
 * Attendance Tracker Neon → hub.
 * Source tables: Candidate, User, AttendanceLog, RawPunchLog
 * Late = first punch after employee.late_after (IST). Default shift 09:30–19:00.
 */

function lookbackDays() {
  return Math.max(1, Number(process.env.SYNC_ATTENDANCE_LOOKBACK_DAYS || 45));
}

function punchTypeFrom(raw) {
  const t = String(raw || '').toUpperCase();
  if (t.includes('IN') || t === '0' || t === 'CHECKIN' || t === 'CHECK_IN') return 'IN';
  if (t.includes('OUT') || t === '1' || t === 'CHECKOUT' || t === 'CHECK_OUT') return 'OUT';
  return 'UNKNOWN';
}

function normalizeDayStatus(status, isLate) {
  const s = String(status || '').toLowerCase();
  if (s.includes('absent') || s === 'a') return 'Absent';
  if (s.includes('half')) return 'Half Day';
  if (s.includes('leave')) return 'On Leave';
  if (s.includes('holiday')) return 'Holiday';
  if (s.includes('late') || isLate) return 'Late';
  if (s.includes('present') || s === 'p' || s.includes('wfh') || s.includes('work from')) {
    return isLate ? 'Late' : 'Present';
  }
  return isLate ? 'Late' : 'Present';
}

function dateOnly(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  // Prefer IST calendar date
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(dt);
}

async function upsertEmployeeShift(hubId, shift) {
  const s = resolveShift(shift);
  await query(
    `UPDATE employees SET
       shift_start = $2,
       shift_end = $3,
       late_after = $4,
       synced_at = NOW()
     WHERE id = $1`,
    [hubId, s.shift_start, s.shift_end, s.late_after]
  );
}

/**
 * Resolve hub employee id for an attendance Candidate.
 * Prefer email via User.candidateId, then fuzzy name match, else upsert att:{id} employee.
 */
async function resolveEmployeeMap(candidates, emailByCandidateId) {
  const map = new Map();
  const shiftByHub = new Map();

  for (const c of candidates) {
    const email = emailByCandidateId.get(c.id);
    const shift = resolveShift({
      shift_start: c.shift_start,
      shift_end: c.shift_end,
      late_max_time: c.late_max_time,
    });
    let hubId = null;

    if (email) {
      const { rows } = await query(
        `SELECT id FROM employees WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
      );
      if (rows[0]) hubId = rows[0].id;
    }

    if (!hubId && c.name) {
      const { rows } = await query(
        `SELECT id FROM employees
         WHERE LOWER(name) = LOWER($1)
            OR LOWER(SPLIT_PART(name, ' ', 1)) = LOWER(SPLIT_PART($1, ' ', 1))
         ORDER BY CASE WHEN LOWER(name) = LOWER($1) THEN 0 ELSE 1 END
         LIMIT 1`,
        [c.name]
      );
      if (rows[0]) hubId = rows[0].id;
    }

    if (!hubId) {
      const externalId = `att:${c.id}`;
      const { rows } = await query(
        `INSERT INTO employees (
           external_id, name, email, role, department, is_active,
           shift_start, shift_end, late_after, synced_at
         )
         VALUES ($1,$2,$3,$4,$5,COALESCE($6, TRUE),$7,$8,$9,NOW())
         ON CONFLICT (external_id) DO UPDATE SET
           name = EXCLUDED.name,
           email = COALESCE(EXCLUDED.email, employees.email),
           role = COALESCE(EXCLUDED.role, employees.role),
           department = COALESCE(EXCLUDED.department, employees.department),
           is_active = EXCLUDED.is_active,
           shift_start = EXCLUDED.shift_start,
           shift_end = EXCLUDED.shift_end,
           late_after = EXCLUDED.late_after,
           synced_at = NOW()
         RETURNING id`,
        [
          externalId,
          c.name || 'Unknown',
          email || null,
          c.designation || null,
          c.department || null,
          c.active !== false,
          shift.shift_start,
          shift.shift_end,
          shift.late_after,
        ]
      );
      hubId = rows[0].id;
    } else {
      await upsertEmployeeShift(hubId, shift);
    }

    map.set(c.id, hubId);
    shiftByHub.set(hubId, shift);
  }

  return { map, shiftByHub };
}

async function recomputePerformance(lookback) {
  const since = new Date();
  since.setDate(since.getDate() - lookback);
  const sinceStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(since);

  await query(
    `
    INSERT INTO employee_performance_daily (
      employee_id, work_date, open_tasks, done_tasks, eod_submitted,
      attendance_status, blockers_flag, score, synced_at
    )
    SELECT
      e.id AS employee_id,
      d.work_date,
      COALESCE((
        SELECT COUNT(*)::int FROM tasks t
        WHERE t.employee_id = e.id AND COALESCE(t.status,'') NOT IN ('Done')
      ), 0) AS open_tasks,
      COALESCE((
        SELECT COUNT(*)::int FROM tasks t
        WHERE t.employee_id = e.id AND t.status = 'Done'
          AND t.updated_at::date = d.work_date
      ), 0) AS done_tasks,
      EXISTS (
        SELECT 1 FROM eod_reports r
        WHERE r.employee_id = e.id AND r.report_date = d.work_date
      ) AS eod_submitted,
      d.status AS attendance_status,
      EXISTS (
        SELECT 1 FROM eod_reports r
        WHERE r.employee_id = e.id AND r.report_date = d.work_date
          AND r.blockers_data IS NOT NULL
          AND r.blockers_data::text NOT IN ('[]', 'null', '{}')
      ) AS blockers_flag,
      LEAST(100, GREATEST(0,
        (CASE WHEN d.status IN ('Present','Late','Half Day') THEN 40 ELSE 0 END)
        + (CASE WHEN EXISTS (
             SELECT 1 FROM eod_reports r WHERE r.employee_id = e.id AND r.report_date = d.work_date
           ) THEN 25 ELSE 0 END)
        + (CASE WHEN d.status = 'Late' THEN -10 ELSE 0 END)
        + LEAST(20, COALESCE((
            SELECT COUNT(*)::int FROM tasks t
            WHERE t.employee_id = e.id AND t.status = 'Done' AND t.updated_at::date = d.work_date
          ), 0) * 5)
        + (CASE WHEN EXISTS (
             SELECT 1 FROM eod_reports r
             WHERE r.employee_id = e.id AND r.report_date = d.work_date
               AND r.blockers_data IS NOT NULL
               AND r.blockers_data::text NOT IN ('[]', 'null', '{}')
           ) THEN -15 ELSE 10 END)
      ))::int AS score,
      NOW()
    FROM attendance_days d
    JOIN employees e ON e.id = d.employee_id
    WHERE d.work_date >= $1::date
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      open_tasks = EXCLUDED.open_tasks,
      done_tasks = EXCLUDED.done_tasks,
      eod_submitted = EXCLUDED.eod_submitted,
      attendance_status = EXCLUDED.attendance_status,
      blockers_flag = EXCLUDED.blockers_flag,
      score = EXCLUDED.score,
      synced_at = NOW()
    `,
    [sinceStr]
  );
}

export async function syncAttendanceFromDb() {
  const pool = getAttendancePool();
  if (!pool) throw new Error('ATTENDANCE_DATABASE_URL not set');

  const days = lookbackDays();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = since.toISOString();

  const stats = { candidates: 0, punches: 0, days: 0, linked: 0 };

  const { rows: candidates } = await sourceQuery(
    pool,
    `SELECT id, name, "deviceUserId" AS device_user_id, department, designation,
            active, "lateMaxTime" AS late_max_time,
            "shiftStartTime" AS shift_start, "shiftEndTime" AS shift_end
     FROM "Candidate"`
  );

  const { rows: users } = await sourceQuery(
    pool,
    `SELECT email, "candidateId" AS candidate_id FROM "User" WHERE "candidateId" IS NOT NULL`
  );
  const emailByCandidateId = new Map();
  for (const u of users) {
    if (u.candidate_id && u.email) emailByCandidateId.set(u.candidate_id, u.email);
  }

  const { map: employeeMap, shiftByHub } = await resolveEmployeeMap(candidates, emailByCandidateId);
  stats.candidates = candidates.length;
  stats.linked = employeeMap.size;

  const deviceToCandidate = new Map();
  for (const c of candidates) {
    if (c.device_user_id) deviceToCandidate.set(String(c.device_user_id), c.id);
  }

  const { rows: punches } = await sourceQuery(
    pool,
    `SELECT id, "deviceUserId" AS device_user_id, timestamp, "punchType" AS punch_type,
            source, processed
     FROM "RawPunchLog"
     WHERE timestamp >= $1::timestamp
     ORDER BY timestamp ASC`,
    [sinceTs]
  );

  for (const p of punches) {
    const candId = deviceToCandidate.get(String(p.device_user_id || ''));
    const hubEmpId = candId ? employeeMap.get(candId) : null;
    const cand = candidates.find((c) => c.id === candId);
    const type = punchTypeFrom(p.punch_type);

    await query(
      `INSERT INTO attendance_punches
         (external_id, employee_id, employee_external_id, employee_name, punch_time, punch_type, device_sn, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         employee_id = COALESCE(EXCLUDED.employee_id, attendance_punches.employee_id),
         employee_external_id = EXCLUDED.employee_external_id,
         employee_name = EXCLUDED.employee_name,
         punch_time = EXCLUDED.punch_time,
         punch_type = EXCLUDED.punch_type,
         device_sn = EXCLUDED.device_sn,
         raw = EXCLUDED.raw,
         synced_at = NOW()`,
      [
        `punch:${p.id}`,
        hubEmpId || null,
        candId || p.device_user_id || null,
        cand?.name || null,
        p.timestamp,
        type,
        p.source || null,
        JSON.stringify(p),
      ]
    );
    stats.punches += 1;
  }

  const { rows: logs } = await sourceQuery(
    pool,
    `SELECT id, "candidateId" AS candidate_id, date, "loginTime" AS login_time,
            "logoutTime" AS logout_time, status::text AS status,
            "workingHours" AS working_hours, source::text AS source, note
     FROM "AttendanceLog"
     WHERE date >= $1::timestamp
     ORDER BY date ASC`,
    [sinceTs]
  );

  for (const log of logs) {
    const hubEmpId = employeeMap.get(log.candidate_id);
    if (!hubEmpId) continue;
    const workDate = dateOnly(log.date);
    if (!workDate) continue;

    const shift = shiftByHub.get(hubEmpId) || DEFAULT_SHIFT;
    const evalLogin = log.login_time ? evaluateLogin(log.login_time, shift) : null;
    const lateMinutes = evalLogin?.late_minutes || 0;
    const status = normalizeDayStatus(log.status, evalLogin?.is_late);

    const punchCount = [log.login_time, log.logout_time].filter(Boolean).length;

    await query(
      `INSERT INTO attendance_days
         (employee_id, work_date, status, first_in, last_out, hours_worked, late_minutes, punch_count, synced_at)
       VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (employee_id, work_date) DO UPDATE SET
         status = EXCLUDED.status,
         first_in = EXCLUDED.first_in,
         last_out = EXCLUDED.last_out,
         hours_worked = EXCLUDED.hours_worked,
         late_minutes = EXCLUDED.late_minutes,
         punch_count = EXCLUDED.punch_count,
         synced_at = NOW()`,
      [
        hubEmpId,
        workDate,
        status,
        log.login_time || null,
        log.logout_time || null,
        Number(log.working_hours || 0),
        lateMinutes,
        punchCount,
      ]
    );
    stats.days += 1;
  }

  // Fill days from punches using each employee's late_after (default 09:30)
  await query(
    `
    INSERT INTO attendance_days (employee_id, work_date, status, first_in, last_out, hours_worked, late_minutes, punch_count, synced_at)
    SELECT
      p.employee_id,
      (p.punch_time AT TIME ZONE 'Asia/Kolkata')::date AS work_date,
      CASE
        WHEN (
          EXTRACT(HOUR FROM MIN(p.punch_time) AT TIME ZONE 'Asia/Kolkata') * 60
          + EXTRACT(MINUTE FROM MIN(p.punch_time) AT TIME ZONE 'Asia/Kolkata')
        ) > (
          COALESCE(NULLIF(split_part(COALESCE(e.late_after, e.shift_start, '09:30'), ':', 1), '')::int, 9) * 60
          + COALESCE(NULLIF(split_part(COALESCE(e.late_after, e.shift_start, '09:30'), ':', 2), '')::int, 30)
        )
        THEN 'Late'
        ELSE 'Present'
      END,
      MIN(p.punch_time),
      MAX(p.punch_time),
      ROUND(EXTRACT(EPOCH FROM (MAX(p.punch_time) - MIN(p.punch_time))) / 3600.0, 2),
      GREATEST(0,
        (
          EXTRACT(HOUR FROM MIN(p.punch_time) AT TIME ZONE 'Asia/Kolkata') * 60
          + EXTRACT(MINUTE FROM MIN(p.punch_time) AT TIME ZONE 'Asia/Kolkata')
        )::int
        - (
          COALESCE(NULLIF(split_part(COALESCE(e.late_after, e.shift_start, '09:30'), ':', 1), '')::int, 9) * 60
          + COALESCE(NULLIF(split_part(COALESCE(e.late_after, e.shift_start, '09:30'), ':', 2), '')::int, 30)
        )
      ),
      COUNT(*)::int,
      NOW()
    FROM attendance_punches p
    JOIN employees e ON e.id = p.employee_id
    WHERE p.employee_id IS NOT NULL
      AND p.punch_time >= $1::timestamptz
    GROUP BY p.employee_id, e.late_after, e.shift_start, (p.punch_time AT TIME ZONE 'Asia/Kolkata')::date
    ON CONFLICT (employee_id, work_date) DO NOTHING
    `,
    [sinceTs]
  );

  await recomputePerformance(days);

  await query(`
    INSERT INTO manager_teams (manager_id, employee_id)
    SELECT m.id, e.id FROM managers m
    CROSS JOIN employees e
    WHERE m.role = 'ADMIN' AND m.is_active = TRUE
      AND e.external_id LIKE 'att:%'
    ON CONFLICT DO NOTHING
  `);

  return stats;
}
