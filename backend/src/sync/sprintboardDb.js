import { query } from '../config/db.js';
import { getSprintboardPool, sourceQuery } from './sourcePools.js';
import { linkEmployeeToManagersByTeam, ensureAdminTeamCoverage } from '../services/scope.js';

/**
 * Fast read-only sync: Sprintboard production Postgres → hub DB.
 * AI never connects here — only this sync job does.
 */
export async function syncSprintboardFromDb() {
  const pool = getSprintboardPool();
  if (!pool) throw new Error('SPRINTBOARD_DATABASE_URL not set');

  const stats = { employees: 0, tasks: 0, eods: 0, teams: 0 };
  const lookback = Number(process.env.SYNC_EOD_LOOKBACK_DAYS || 30);

  // Team memberships
  const { rows: memberships } = await sourceQuery(
    pool,
    `SELECT tm.team_id::text AS team_id, tm.user_id::text AS user_id
     FROM team_members tm`
  );
  const teamsByUser = new Map();
  for (const m of memberships) {
    if (!teamsByUser.has(m.user_id)) teamsByUser.set(m.user_id, []);
    teamsByUser.get(m.user_id).push(m.team_id);
  }
  stats.teams = new Set(memberships.map((m) => m.team_id)).size;

  // Users / employees
  const { rows: users } = await sourceQuery(
    pool,
    `SELECT u.id::text AS id, u.name, u.email, u.role,
            COALESCE(u.is_active, TRUE) AS is_active,
            d.name AS department
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id`
  );

  const employeeIdByExternal = new Map();
  for (const u of users) {
    const teamIds = teamsByUser.get(u.id) || [];
    const { rows } = await query(
      `INSERT INTO employees (external_id, name, email, role, is_active, team_ids, department, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         role = EXCLUDED.role,
         is_active = EXCLUDED.is_active,
         team_ids = EXCLUDED.team_ids,
         department = COALESCE(EXCLUDED.department, employees.department),
         synced_at = NOW()
       RETURNING id`,
      [u.id, u.name || u.email || 'Unknown', u.email, u.role, u.is_active !== false, teamIds, u.department]
    );
    employeeIdByExternal.set(u.id, rows[0].id);
    await linkEmployeeToManagersByTeam(rows[0].id, teamIds);
    stats.employees += 1;
  }

  // Tasks (active + recent)
  const { rows: tasks } = await sourceQuery(
    pool,
    `SELECT t.id::text AS id,
            t.assignee_id::text AS assignee_id,
            t.title,
            t.description,
            t.status,
            t.priority,
            t.due_date,
            t.team_id::text AS team_id,
            p.name AS project_name,
            t.updated_at
     FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.updated_at > NOW() - INTERVAL '180 days'
        OR t.status IS DISTINCT FROM 'Done'
     ORDER BY t.updated_at DESC NULLS LAST
     LIMIT 20000`
  );

  for (const t of tasks) {
    const employeeId = t.assignee_id ? employeeIdByExternal.get(t.assignee_id) || null : null;
    await query(
      `INSERT INTO tasks (
         external_id, employee_id, assignee_external_id, title, description,
         status, priority, due_date, team_id, project_name, updated_at, synced_at
       ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id,
         assignee_external_id = EXCLUDED.assignee_external_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         status = EXCLUDED.status,
         priority = EXCLUDED.priority,
         due_date = EXCLUDED.due_date,
         team_id = EXCLUDED.team_id,
         project_name = EXCLUDED.project_name,
         updated_at = EXCLUDED.updated_at,
         synced_at = NOW()`,
      [
        t.id,
        employeeId,
        t.assignee_id,
        t.title || 'Untitled',
        t.description,
        t.status,
        t.priority,
        t.due_date,
        t.team_id,
        t.project_name,
        t.updated_at,
      ]
    );
    stats.tasks += 1;
  }

  // EOD reports
  const { rows: eods } = await sourceQuery(
    pool,
    `SELECT dr.id::text AS id,
            dr.user_id::text AS user_id,
            dr.date AS report_date,
            dr.status,
            dr.achievements,
            dr.tasks_data,
            dr.pending_tasks_data,
            dr.blockers_data,
            dr.tomorrow_plan,
            dr.self_evaluation,
            dr.working_mode,
            dr.submitted_at
     FROM daily_reports dr
     WHERE dr.date >= (CURRENT_DATE - $1::int)
     ORDER BY dr.date DESC
     LIMIT 10000`,
    [lookback]
  );

  for (const r of eods) {
    const employeeId = r.user_id ? employeeIdByExternal.get(r.user_id) || null : null;
    await query(
      `INSERT INTO eod_reports (
         external_id, employee_id, employee_external_id, report_date, status,
         achievements, tasks_data, pending_tasks_data, blockers_data,
         tomorrow_plan, self_evaluation, working_mode, submitted_at, synced_at
       ) VALUES ($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         employee_id = EXCLUDED.employee_id,
         employee_external_id = EXCLUDED.employee_external_id,
         report_date = EXCLUDED.report_date,
         status = EXCLUDED.status,
         achievements = EXCLUDED.achievements,
         tasks_data = EXCLUDED.tasks_data,
         pending_tasks_data = EXCLUDED.pending_tasks_data,
         blockers_data = EXCLUDED.blockers_data,
         tomorrow_plan = EXCLUDED.tomorrow_plan,
         self_evaluation = EXCLUDED.self_evaluation,
         working_mode = EXCLUDED.working_mode,
         submitted_at = EXCLUDED.submitted_at,
         synced_at = NOW()`,
      [
        r.id,
        employeeId,
        r.user_id,
        r.report_date,
        r.status,
        r.achievements,
        JSON.stringify(r.tasks_data),
        JSON.stringify(r.pending_tasks_data),
        JSON.stringify(r.blockers_data),
        JSON.stringify(r.tomorrow_plan),
        JSON.stringify(r.self_evaluation),
        r.working_mode,
        r.submitted_at,
      ]
    );
    stats.eods += 1;
  }

  await ensureAdminTeamCoverage();
  return { mode: 'database', ...stats };
}
