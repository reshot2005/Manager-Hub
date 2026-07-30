import { query } from '../config/db.js';

/**
 * Attrition-risk scoring — rule-based, fully explainable.
 *
 * Formula (auditable — change weights only via env, never silently):
 *   attendance_score, task_completion_score, eod_consistency_score ∈ [0,100]
 *   composite = round(
 *     W_ATT * attendance + W_TASK * task + W_EOD * eod
 *   ) / (W_ATT + W_TASK + W_EOD)
 * Defaults: equal weights 1/1/1.
 *
 * Risk levels (configurable):
 *   composite < RISK_HIGH_BELOW → High
 *   composite < RISK_MEDIUM_BELOW → Medium
 *   else → Low
 *
 * Trailing window: RISK_WINDOW_DAYS (default 14).
 * Days with no attendance_days row are EXCLUDED from the window (not treated as zero/bad).
 */

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function weights() {
  return {
    att: Math.max(0.01, numEnv('RISK_WEIGHT_ATTENDANCE', 1)),
    task: Math.max(0.01, numEnv('RISK_WEIGHT_TASK', 1)),
    eod: Math.max(0.01, numEnv('RISK_WEIGHT_EOD', 1)),
  };
}

function riskLevel(composite) {
  const highBelow = numEnv('RISK_HIGH_BELOW', 50);
  const mediumBelow = numEnv('RISK_MEDIUM_BELOW', 75);
  if (composite < highBelow) return 'High';
  if (composite < mediumBelow) return 'Medium';
  return 'Low';
}

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * @returns {{ computed_date: string, employees: number, skipped: boolean }}
 */
export async function recomputeRiskScores({ force = false } = {}) {
  const windowDays = Math.min(Math.max(numEnv('RISK_WINDOW_DAYS', 14), 7), 60);
  const { rows: todayRows } = await query(
    `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`
  );
  const computedDate = todayRows[0].d;

  if (!force) {
    const { rows: existing } = await query(
      `SELECT 1 FROM employee_risk_scores WHERE computed_date = $1::date LIMIT 1`,
      [computedDate]
    );
    if (existing.length) {
      return { computed_date: computedDate, employees: 0, skipped: true };
    }
  }

  const { rows: employees } = await query(
    `SELECT id, name FROM employees WHERE COALESCE(is_active, TRUE) = TRUE`
  );

  const w = weights();
  const wSum = w.att + w.task + w.eod;
  let written = 0;

  for (const emp of employees) {
    const { rows: dayRows } = await query(
      `SELECT work_date::text AS work_date, status
       FROM attendance_days
       WHERE employee_id = $1
         AND work_date >= ($2::date - ($3::int || ' days')::interval)::date
         AND work_date <= $2::date
       ORDER BY work_date`,
      [emp.id, computedDate, windowDays]
    );

    // Only synced days count — missing days are excluded, not penalized
    const syncedDays = dayRows.length;
    const factors = [];

    let attendanceScore = 100;
    if (syncedDays === 0) {
      // No synced attendance in window — neutral score, do not invent bad performance
      attendanceScore = 70;
      factors.push('No synced attendance days in trailing window (score held neutral)');
    } else {
      const late = dayRows.filter((d) => d.status === 'Late').length;
      const absent = dayRows.filter((d) => d.status === 'Absent').length;
      // Approved leave already marked On Leave — not counted as absent
      attendanceScore = clampScore(100 - late * 8 - absent * 15);
      if (late) factors.push(`${late} late arrival(s) in ${syncedDays} synced day(s)`);
      if (absent) factors.push(`${absent} unexplained absent day(s) (not on approved leave)`);
    }

    const { rows: taskRows } = await query(
      `SELECT
         COUNT(*) FILTER (WHERE COALESCE(status,'') NOT IN ('Done'))::int AS open_count,
         COUNT(*) FILTER (
           WHERE COALESCE(status,'') NOT IN ('Done')
             AND due_date < $2::date
             AND due_date > DATE '2000-01-01'
         )::int AS overdue_count,
         COUNT(*) FILTER (WHERE COALESCE(status,'') = 'Done')::int AS done_count
       FROM tasks
       WHERE employee_id = $1`,
      [emp.id, computedDate]
    );
    const openCount = taskRows[0]?.open_count || 0;
    const overdue = taskRows[0]?.overdue_count || 0;
    const done = taskRows[0]?.done_count || 0;
    const totalKnown = openCount + done;
    const completionRate = totalKnown > 0 ? done / totalKnown : 1;
    let taskScore = clampScore(100 * completionRate - overdue * 10);
    if (overdue) factors.push(`${overdue} overdue task(s)`);
    if (totalKnown > 0 && completionRate < 0.7) {
      factors.push(`Task completion rate ${Math.round(completionRate * 100)}%`);
    }

    // EOD: only evaluate against synced attendance working days (Present/Late/Half Day)
    const workingDays = dayRows.filter((d) =>
      ['Present', 'Late', 'Half Day'].includes(d.status)
    );
    let eodScore = 100;
    if (workingDays.length === 0) {
      eodScore = 70;
    } else {
      const dates = workingDays.map((d) => d.work_date);
      const { rows: eodRows } = await query(
        `SELECT report_date::text AS report_date
         FROM eod_reports
         WHERE employee_id = $1 AND report_date = ANY($2::date[])`,
        [emp.id, dates]
      );
      const submitted = new Set(eodRows.map((r) => r.report_date));
      const missing = dates.filter((d) => !submitted.has(d)).length;
      eodScore = clampScore(100 - missing * (100 / Math.max(dates.length, 1)));
      if (missing) factors.push(`${missing} missing EOD(s) on synced working day(s)`);
    }

    const composite = clampScore(
      (w.att * attendanceScore + w.task * taskScore + w.eod * eodScore) / wSum
    );
    const level = riskLevel(composite);
    if (!factors.length) factors.push('No negative signals in trailing synced window');

    await query(
      `INSERT INTO employee_risk_scores (
         employee_id, computed_date, attendance_score, task_completion_score,
         eod_consistency_score, composite_score, risk_level, contributing_factors,
         window_days, synced_days, computed_at
       ) VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,NOW())
       ON CONFLICT (employee_id, computed_date) DO UPDATE SET
         attendance_score = EXCLUDED.attendance_score,
         task_completion_score = EXCLUDED.task_completion_score,
         eod_consistency_score = EXCLUDED.eod_consistency_score,
         composite_score = EXCLUDED.composite_score,
         risk_level = EXCLUDED.risk_level,
         contributing_factors = EXCLUDED.contributing_factors,
         window_days = EXCLUDED.window_days,
         synced_days = EXCLUDED.synced_days,
         computed_at = NOW()`,
      [
        emp.id,
        computedDate,
        attendanceScore,
        taskScore,
        eodScore,
        composite,
        level,
        JSON.stringify(factors),
        windowDays,
        syncedDays,
      ]
    );
    written += 1;
  }

  return { computed_date: computedDate, employees: written, skipped: false };
}
