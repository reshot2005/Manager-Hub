import { query } from '../config/db.js';
import { apiFetch, loginSprintboard } from './http.js';

function dateOffset(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function upsertEmployee(user, teamIds = []) {
  const { rows } = await query(
    `INSERT INTO employees (external_id, name, email, role, is_active, team_ids, department, raw, synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (external_id) DO UPDATE SET
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       role = EXCLUDED.role,
       is_active = EXCLUDED.is_active,
       team_ids = (
         SELECT ARRAY(SELECT DISTINCT unnest(employees.team_ids || EXCLUDED.team_ids))
       ),
       department = COALESCE(EXCLUDED.department, employees.department),
       raw = EXCLUDED.raw,
       synced_at = NOW()
     RETURNING id`,
    [
      String(user.id),
      user.name || user.email || 'Unknown',
      user.email || null,
      user.role || null,
      user.is_active !== false,
      teamIds.map(String),
      user.department_name || user.department || null,
      JSON.stringify(user),
    ]
  );
  return rows[0].id;
}

async function upsertTask(task, employeeIdByExternal) {
  const assigneeId = task.assignee_id || (task.assignee_ids && task.assignee_ids[0]) || null;
  const employeeId = assigneeId ? employeeIdByExternal.get(String(assigneeId)) || null : null;

  await query(
    `INSERT INTO tasks (
       external_id, employee_id, assignee_external_id, title, description,
       status, priority, due_date, team_id, project_name, updated_at, raw, synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
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
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      String(task.id),
      employeeId,
      assigneeId ? String(assigneeId) : null,
      task.title || 'Untitled',
      task.description || null,
      task.status || null,
      task.priority || null,
      task.due_date || null,
      task.team_id ? String(task.team_id) : null,
      task.project_name || null,
      task.updated_at || null,
      JSON.stringify(task),
    ]
  );
}

async function upsertEod(report, employeeIdByExternal) {
  const userId = report.user_id || report.userId;
  const employeeId = userId ? employeeIdByExternal.get(String(userId)) || null : null;

  await query(
    `INSERT INTO eod_reports (
       external_id, employee_id, employee_external_id, report_date, status,
       achievements, tasks_data, pending_tasks_data, blockers_data,
       tomorrow_plan, self_evaluation, working_mode, submitted_at, raw, synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
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
       raw = EXCLUDED.raw,
       synced_at = NOW()`,
    [
      String(report.id),
      employeeId,
      userId ? String(userId) : null,
      report.date || report.report_date,
      report.status || null,
      report.achievements || null,
      JSON.stringify(report.tasks_data || null),
      JSON.stringify(report.pending_tasks_data || null),
      JSON.stringify(report.blockers_data || null),
      JSON.stringify(report.tomorrow_plan || null),
      JSON.stringify(report.self_evaluation || null),
      report.working_mode || null,
      report.submitted_at || null,
      JSON.stringify(report),
    ]
  );
}

export async function syncSprintboard() {
  const baseUrl = process.env.SPRINTBOARD_URL;
  const email = process.env.SPRINTBOARD_EMAIL;
  const password = process.env.SPRINTBOARD_PASSWORD;

  if (!baseUrl || !email || !password) {
    throw new Error('SPRINTBOARD_URL / SPRINTBOARD_EMAIL / SPRINTBOARD_PASSWORD required');
  }

  const { token } = await loginSprintboard(baseUrl, email, password);
  const stats = { teams: 0, employees: 0, tasks: 0, eods: 0 };

  // Teams
  let teamsData = await apiFetch(baseUrl, '/teams', { token });
  const teams = Array.isArray(teamsData) ? teamsData : teamsData.teams || teamsData.data || [];
  stats.teams = teams.length;

  const employeeIdByExternal = new Map();
  const memberTeamMap = new Map(); // userId -> Set of teamIds

  for (const team of teams) {
    const teamId = String(team.id);
    let membersData;
    try {
      membersData = await apiFetch(baseUrl, `/teams/${teamId}/members`, { token });
    } catch (err) {
      console.warn(`[sync:sb] members for team ${teamId}:`, err.message);
      continue;
    }
    const members = Array.isArray(membersData)
      ? membersData
      : membersData.members || membersData.data || [];

    for (const m of members) {
      const uid = String(m.id || m.user_id);
      if (!memberTeamMap.has(uid)) memberTeamMap.set(uid, new Set());
      memberTeamMap.get(uid).add(teamId);
      const hubId = await upsertEmployee(
        {
          id: uid,
          name: m.name || m.user_name,
          email: m.email || m.user_email,
          role: m.role,
          is_active: m.is_active !== false,
          department_name: m.department_name,
        },
        [teamId]
      );
      employeeIdByExternal.set(uid, hubId);
      try {
        const { linkEmployeeToManagersByTeam } = await import('../services/scope.js');
        await linkEmployeeToManagersByTeam(hubId, [teamId]);
      } catch {
        /* ACL best-effort */
      }
      stats.employees += 1;
    }
  }

  // Also try admin users list if available
  try {
    const usersData = await apiFetch(baseUrl, '/admin/users', { token });
    const users = Array.isArray(usersData) ? usersData : usersData.users || usersData.data || [];
    for (const u of users) {
      const uid = String(u.id);
      const teamIds = [...(memberTeamMap.get(uid) || [])];
      const hubId = await upsertEmployee(u, teamIds);
      employeeIdByExternal.set(uid, hubId);
    }
  } catch {
    // Admin route may be forbidden for Team Lead — ignore
  }

  // Tasks per team
  for (const team of teams) {
    const teamId = String(team.id);
    try {
      const tasksData = await apiFetch(baseUrl, `/teams/${teamId}/tasks`, { token });
      const tasks = Array.isArray(tasksData) ? tasksData : tasksData.tasks || tasksData.data || [];
      for (const t of tasks) {
        await upsertTask({ ...t, team_id: teamId }, employeeIdByExternal);
        stats.tasks += 1;
      }
    } catch (err) {
      console.warn(`[sync:sb] tasks for team ${teamId}:`, err.message);
    }
  }

  // EOD reports — lookback days
  const lookback = Number(process.env.SYNC_EOD_LOOKBACK_DAYS || 14);
  for (let i = 0; i <= lookback; i++) {
    const date = dateOffset(i);
    try {
      const eodData = await apiFetch(baseUrl, `/daily-reports/team?date=${date}`, { token });
      const reports = Array.isArray(eodData) ? eodData : eodData.reports || eodData.data || [];
      for (const r of reports) {
        await upsertEod(r, employeeIdByExternal);
        stats.eods += 1;
      }
    } catch (err) {
      console.warn(`[sync:sb] eod ${date}:`, err.message);
    }
  }

  return stats;
}
