import { query } from '../config/db.js';

/**
 * Force attendance_days.status = 'On Leave' for every calendar day covered by an
 * Approved leave_requests row. Runs AFTER AttendanceLog/punch upserts so leave
 * wins over Absent/Present/Late from the biometric source.
 *
 * Does not invent leave — only explicit Approved rows in leave_requests.
 */
export async function applyApprovedLeaveToAttendance(lookbackDays = 90) {
  const days = Math.min(Math.max(Number(lookbackDays) || 90, 1), 366);

  const { rows } = await query(
    `
    WITH bounds AS (
      SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS today
    ),
    covered AS (
      SELECT
        lr.employee_id,
        gs::date AS work_date
      FROM leave_requests lr
      CROSS JOIN bounds b
      CROSS JOIN LATERAL generate_series(lr.start_date, lr.end_date, INTERVAL '1 day') AS gs
      WHERE lr.status = 'Approved'
        AND lr.end_date >= (b.today - ($1::int || ' days')::interval)::date
        AND lr.start_date <= b.today + INTERVAL '30 days'
    )
    INSERT INTO attendance_days (employee_id, work_date, status, first_in, last_out, hours_worked, late_minutes, punch_count, synced_at)
    SELECT c.employee_id, c.work_date, 'On Leave', NULL, NULL, 0, 0, 0, NOW()
    FROM covered c
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
      status = 'On Leave',
      late_minutes = 0,
      synced_at = NOW()
    RETURNING 1
    `,
    [days]
  );

  return { days_marked_on_leave: rows.length };
}
