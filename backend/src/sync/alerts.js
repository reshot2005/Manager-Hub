import { query } from '../config/db.js';
import { notifyAlert } from '../services/alertNotify.js';

/**
 * Daily proactive alerts — evaluated after risk scores + leave overlay.
 * Dedupes by (manager, alert_type, employee) within ALERT_COOLDOWN_HOURS (default 48).
 * High-risk fires only on transition into High (not every day it stays High).
 */

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

async function todayIst() {
  const { rows } = await query(`SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`);
  return rows[0].d;
}

async function recentlyFired(managerId, alertType, employeeId, cooldownHours) {
  const { rows } = await query(
    `SELECT 1 FROM alerts
     WHERE manager_id = $1
       AND alert_type = $2
       AND (($3::uuid IS NULL AND employee_id IS NULL) OR employee_id = $3)
       AND created_at >= NOW() - ($4::int || ' hours')::interval
     LIMIT 1`,
    [managerId, alertType, employeeId, cooldownHours]
  );
  return rows.length > 0;
}

async function createAlert({ managerId, employeeId, alertType, message, severity, meta }) {
  const cooldown = Math.max(1, numEnv('ALERT_COOLDOWN_HOURS', 48));
  if (await recentlyFired(managerId, alertType, employeeId || null, cooldown)) {
    return null;
  }
  const { rows } = await query(
    `INSERT INTO alerts (manager_id, employee_id, alert_type, message, severity, meta)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)
     RETURNING id, manager_id, employee_id, alert_type, message, severity, created_at, acknowledged`,
    [managerId, employeeId || null, alertType, message, severity, JSON.stringify(meta || {})]
  );
  const alert = rows[0];
  try {
    await notifyAlert(alert);
  } catch (err) {
    console.warn('[alerts] notify:', err.message?.slice(0, 120));
  }
  return alert;
}

async function managersForEmployee(employeeId) {
  const { rows } = await query(
    `SELECT DISTINCT m.id
     FROM managers m
     WHERE m.is_active = TRUE AND (
       m.role = 'ADMIN'
       OR EXISTS (SELECT 1 FROM manager_team_links l WHERE l.manager_id = m.id AND l.scope = 'ALL')
       OR EXISTS (SELECT 1 FROM manager_teams mt WHERE mt.manager_id = m.id AND mt.employee_id = $1)
     )`,
    [employeeId]
  );
  return rows.map((r) => r.id);
}

async function allActiveManagers() {
  const { rows } = await query(`SELECT id FROM managers WHERE is_active = TRUE`);
  return rows.map((r) => r.id);
}

export async function evaluateDailyAlerts() {
  const today = await todayIst();
  const cooldown = Math.max(1, numEnv('ALERT_COOLDOWN_HOURS', 48));
  const teamAbsencePct = numEnv('ALERT_TEAM_ABSENCE_PCT', 15);
  let created = 0;

  // 1) 4+ late arrivals in trailing 7 synced days
  const { rows: lateHeavy } = await query(
    `SELECT e.id AS employee_id, e.name, COUNT(*)::int AS late_count
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.status = 'Late'
       AND d.work_date >= ($1::date - INTERVAL '7 days')::date
       AND d.work_date <= $1::date
       AND COALESCE(e.is_active, TRUE) = TRUE
     GROUP BY e.id, e.name
     HAVING COUNT(*) >= 4`,
    [today]
  );
  for (const row of lateHeavy) {
    for (const managerId of await managersForEmployee(row.employee_id)) {
      const a = await createAlert({
        managerId,
        employeeId: row.employee_id,
        alertType: 'late_streak',
        severity: 'Warning',
        message: `${row.name} has ${row.late_count} late arrivals in the last 7 days.`,
        meta: { late_count: row.late_count },
      });
      if (a) created += 1;
    }
  }

  // 2) 3+ consecutive missing EODs on synced working days ending today
  const { rows: activeEmps } = await query(
    `SELECT id, name FROM employees WHERE COALESCE(is_active, TRUE) = TRUE`
  );
  for (const emp of activeEmps) {
    const { rows: days } = await query(
      `SELECT work_date::text AS work_date, status
       FROM attendance_days
       WHERE employee_id = $1
         AND work_date <= $2::date
         AND status IN ('Present', 'Late', 'Half Day')
       ORDER BY work_date DESC
       LIMIT 10`,
      [emp.id, today]
    );
    let streak = 0;
    for (const d of days) {
      const { rows: eod } = await query(
        `SELECT 1 FROM eod_reports WHERE employee_id = $1 AND report_date = $2::date LIMIT 1`,
        [emp.id, d.work_date]
      );
      if (eod.length) break;
      streak += 1;
    }
    if (streak >= 3) {
      for (const managerId of await managersForEmployee(emp.id)) {
        const a = await createAlert({
          managerId,
          employeeId: emp.id,
          alertType: 'missing_eod_streak',
          severity: 'Warning',
          message: `${emp.name} has ${streak} consecutive missing EODs on synced working days.`,
          meta: { streak },
        });
        if (a) created += 1;
      }
    }
  }

  // 3) Risk newly moved to High (transition only)
  const { rows: highToday } = await query(
    `SELECT r.employee_id, e.name, r.composite_score, r.contributing_factors
     FROM employee_risk_scores r
     JOIN employees e ON e.id = r.employee_id
     WHERE r.computed_date = $1::date AND r.risk_level = 'High'`,
    [today]
  );
  for (const row of highToday) {
    const { rows: prev } = await query(
      `SELECT risk_level FROM employee_risk_scores
       WHERE employee_id = $1 AND computed_date < $2::date
       ORDER BY computed_date DESC LIMIT 1`,
      [row.employee_id, today]
    );
    const wasHigh = prev[0]?.risk_level === 'High';
    if (wasHigh) continue;
    for (const managerId of await managersForEmployee(row.employee_id)) {
      const a = await createAlert({
        managerId,
        employeeId: row.employee_id,
        alertType: 'risk_high_transition',
        severity: 'Critical',
        message: `${row.name} moved to High attrition risk (score ${row.composite_score}). Factors: ${(row.contributing_factors || []).join('; ')}`,
        meta: { composite_score: row.composite_score, factors: row.contributing_factors },
      });
      if (a) created += 1;
    }
  }

  // 4) Unusually high team-wide absence (> threshold % of team with attendance row)
  const managers = await allActiveManagers();
  for (const managerId of managers) {
    const { rows: scopeRows } = await query(
      `SELECT
         (SELECT role FROM managers WHERE id = $1) AS role,
         EXISTS (SELECT 1 FROM manager_team_links WHERE manager_id = $1 AND scope = 'ALL') AS all_scope`,
      [managerId]
    );
    const unrestricted = scopeRows[0]?.role === 'ADMIN' || scopeRows[0]?.all_scope;

    let teamFilter = '';
    const params = [today, managerId];
    if (!unrestricted) {
      teamFilter = `AND d.employee_id IN (SELECT employee_id FROM manager_teams WHERE manager_id = $2)`;
    }

    const { rows: counts } = await query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE d.status = 'Absent')::int AS absent
       FROM attendance_days d
       WHERE d.work_date = $1::date
       ${teamFilter}`,
      unrestricted ? [today] : params
    );
    const total = counts[0]?.total || 0;
    const absent = counts[0]?.absent || 0;
    if (total >= 5 && (absent / total) * 100 >= teamAbsencePct) {
      const a = await createAlert({
        managerId,
        employeeId: null,
        alertType: 'team_absence_spike',
        severity: 'Warning',
        message: `Team absence spike on ${today}: ${absent}/${total} (${Math.round((absent / total) * 100)}%) marked Absent (approved leave excluded).`,
        meta: { absent, total, date: today, threshold_pct: teamAbsencePct },
      });
      if (a) created += 1;
    }
  }

  // 5) Interviews within 24h with no interviewer names (ATS support)
  const { rows: interviews } = await query(
    `SELECT id, candidate_name, scheduled_start, interviewer_names, job_title
     FROM interviews
     WHERE scheduled_start IS NOT NULL
       AND scheduled_start >= NOW()
       AND scheduled_start <= NOW() + INTERVAL '24 hours'
       AND (
         interviewer_names IS NULL
         OR cardinality(interviewer_names) = 0
       )`
  );
  for (const iv of interviews) {
    for (const managerId of await allActiveManagers()) {
      const a = await createAlert({
        managerId,
        employeeId: null,
        alertType: 'interview_no_interviewer',
        severity: 'Info',
        message: `Interview for ${iv.candidate_name || 'candidate'} (${iv.job_title || 'role'}) within 24h has no interviewer confirmation.`,
        meta: { interview_id: iv.id, scheduled_start: iv.scheduled_start },
      });
      if (a) created += 1;
    }
  }

  return { created, today, cooldown_hours: cooldown };
}
