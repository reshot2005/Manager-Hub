/**
 * Express-free data API for Vercel.
 * serverless-http + Express hangs on this runtime; these handlers use Neon query only.
 */
import { query } from './config/db.js';
import { getManagerScope, candidateAclClause } from './services/scope.js';

function parseUrl(url) {
  const raw = String(url || '');
  const [pathname, qs = ''] = raw.split('?');
  const path = pathname.replace(/\/+$/, '') || '/';
  const queryParams = Object.fromEntries(new URLSearchParams(qs));
  return { path, queryParams };
}

function canAccessEmployee(scope, employeeId) {
  if (scope.unrestricted) return true;
  return Boolean(employeeId && scope.employeeIds?.includes(employeeId));
}

function canAccessCandidate(scope, candidateId) {
  if (scope.unrestricted || scope.atsAll) return true;
  return Boolean(candidateId && scope.candidateIds?.includes(candidateId));
}

async function listEmployees(manager, q) {
  const scope = await getManagerScope(manager);
  const params = [];
  const clauses = ['COALESCE(e.is_active, TRUE) = TRUE'];
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) return { employees: [] };
    params.push(scope.employeeIds);
    clauses.push(`e.id = ANY($${params.length}::uuid[])`);
  }
  if (q) {
    params.push(q);
    clauses.push(
      `(LOWER(e.name) LIKE LOWER('%' || $${params.length} || '%') OR LOWER(e.email) LIKE LOWER('%' || $${params.length} || '%'))`
    );
  }
  const { rows } = await query(
    `SELECT e.id, e.name, e.email, e.role, e.department, e.team_ids,
            (SELECT COUNT(*)::int FROM tasks t
             WHERE t.employee_id = e.id AND COALESCE(t.status,'') NOT IN ('Done')) AS open_tasks,
            (SELECT r.report_date FROM eod_reports r
             WHERE r.employee_id = e.id ORDER BY r.report_date DESC LIMIT 1) AS last_eod_date,
            (SELECT r.status FROM eod_reports r
             WHERE r.employee_id = e.id ORDER BY r.report_date DESC LIMIT 1) AS last_eod_status
     FROM employees e
     WHERE ${clauses.join(' AND ')}
     ORDER BY e.name
     LIMIT 200`,
    params
  );
  return { employees: rows };
}

async function employeeDetail(manager, id) {
  const scope = await getManagerScope(manager);
  if (!scope.unrestricted && !scope.employeeIds?.includes(id)) {
    return { status: 404, body: { message: 'Not found' } };
  }
  const { rows } = await query(
    `SELECT id, name, email, role, department, team_ids, shift_start, shift_end, late_after, is_active
     FROM employees WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return { status: 404, body: { message: 'Not found' } };
  const { rows: tasks } = await query(
    `SELECT title, status, priority, due_date, project_name, updated_at
     FROM tasks WHERE employee_id = $1 ORDER BY updated_at DESC NULLS LAST LIMIT 30`,
    [id]
  );
  const { rows: eods } = await query(
    `SELECT report_date, status, achievements, tasks_data, blockers_data, submitted_at
     FROM eod_reports WHERE employee_id = $1 ORDER BY report_date DESC LIMIT 10`,
    [id]
  );
  return { status: 200, body: { employee: rows[0], tasks, eods } };
}

async function dashboardStats(manager) {
  const scope = await getManagerScope(manager);
  const empParams = [];
  let employeeFilter = '';
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) employeeFilter = 'AND FALSE';
    else {
      empParams.push(scope.employeeIds);
      employeeFilter = 'AND e.id = ANY($1::uuid[])';
    }
  }
  let candFilter = '';
  let candInterviewFilter = '';
  const candParams = [];
  if (!scope.unrestricted && !scope.atsAll) {
    if (!scope.candidateIds?.length) {
      candFilter = 'AND FALSE';
      candInterviewFilter = 'AND FALSE';
    } else {
      candParams.push(scope.candidateIds);
      candFilter = 'AND c.id = ANY($1::uuid[])';
      candInterviewFilter = 'AND i.candidate_id = ANY($1::uuid[])';
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const countParams = [...empParams];
  const todayIdx = countParams.push(today);
  const weekIdx = countParams.push(weekAgo);
  const empRef = empParams.length ? '$1' : null;
  const ef = empRef ? employeeFilter.replace('$1', empRef) : employeeFilter;
  const tRef = `$${todayIdx}`;
  const wRef = `$${weekIdx}`;
  const counts = await query(
    `SELECT
      (SELECT COUNT(*)::int FROM employees e WHERE COALESCE(e.is_active,TRUE)=TRUE ${ef}) AS total_employees,
      (SELECT COUNT(*)::int FROM tasks t JOIN employees e ON e.id=t.employee_id WHERE COALESCE(t.status,'') NOT IN ('Done') ${ef}) AS open_tasks,
      (SELECT COUNT(*)::int FROM tasks t JOIN employees e ON e.id=t.employee_id WHERE t.status='Done' ${ef}) AS done_tasks,
      (SELECT COUNT(*)::int FROM eod_reports r JOIN employees e ON e.id=r.employee_id WHERE r.report_date::text=${tRef} ${ef}) AS eod_today,
      (SELECT COUNT(*)::int FROM eod_reports r JOIN employees e ON e.id=r.employee_id WHERE r.report_date::text>=${wRef} ${ef}) AS eod_this_week,
      (SELECT COUNT(*)::int FROM interviews i WHERE i.scheduled_start >= NOW() ${candInterviewFilter.replace('$1', `$${countParams.length + 1}`)}) AS upcoming_interviews,
      (SELECT COUNT(*)::int FROM candidates c WHERE TRUE ${candFilter.replace('$1', `$${countParams.length + 1}`)}) AS total_candidates,
      (SELECT COUNT(*)::int FROM jobs WHERE is_active=TRUE) AS open_jobs,
      (SELECT COUNT(*)::int FROM attendance_days d JOIN employees e ON e.id=d.employee_id
        WHERE d.work_date::text=${tRef} AND d.status IN ('Present','Late','Half Day') ${ef}) AS present_today,
      (SELECT COUNT(*)::int FROM attendance_days d JOIN employees e ON e.id=d.employee_id
        WHERE d.work_date::text=${tRef} AND d.status='Absent' ${ef}) AS absent_today,
      (SELECT COUNT(*)::int FROM attendance_days d JOIN employees e ON e.id=d.employee_id
        WHERE d.work_date::text=${tRef} AND d.status='Late' ${ef}) AS late_today`,
    candParams.length ? [...countParams, ...candParams] : countParams
  );
  const eodTrend = await query(
    `SELECT r.report_date::text AS date, COUNT(*)::int AS count
     FROM eod_reports r JOIN employees e ON e.id = r.employee_id
     WHERE r.report_date >= $1::date ${empParams.length ? 'AND e.id = ANY($2::uuid[])' : employeeFilter}
     GROUP BY r.report_date ORDER BY r.report_date`,
    empParams.length ? [weekAgo, empParams[0]] : [weekAgo]
  );
  const taskStatus = await query(
    `SELECT COALESCE(t.status,'Unknown') AS status, COUNT(*)::int AS count
     FROM tasks t JOIN employees e ON e.id = t.employee_id
     WHERE TRUE ${empParams.length ? 'AND e.id = ANY($1::uuid[])' : employeeFilter}
     GROUP BY t.status ORDER BY count DESC`,
    empParams
  );
  const topByTasks = await query(
    `SELECT e.name, e.email,
      COUNT(t.id) FILTER (WHERE COALESCE(t.status,'') NOT IN ('Done'))::int AS open_tasks,
      MAX(r.report_date)::text AS last_eod
     FROM employees e
     LEFT JOIN tasks t ON t.employee_id = e.id
     LEFT JOIN eod_reports r ON r.employee_id = e.id
     WHERE COALESCE(e.is_active,TRUE)=TRUE ${empParams.length ? 'AND e.id = ANY($1::uuid[])' : employeeFilter}
     GROUP BY e.id, e.name, e.email
     ORDER BY open_tasks DESC LIMIT 10`,
    empParams
  );
  const blockers = await query(
    `SELECT COUNT(*)::int AS count
     FROM eod_reports r JOIN employees e ON e.id = r.employee_id
     WHERE r.report_date >= $1::date
       AND r.blockers_data IS NOT NULL
       AND r.blockers_data != '[]'::jsonb
       AND r.blockers_data != 'null'::jsonb
       ${empParams.length ? 'AND e.id = ANY($2::uuid[])' : employeeFilter}`,
    empParams.length ? [weekAgo, empParams[0]] : [weekAgo]
  );
  return {
    counts: counts.rows[0],
    eodTrend: eodTrend.rows,
    taskStatus: taskStatus.rows,
    topByTasks: topByTasks.rows,
    blockersThisWeek: blockers.rows[0]?.count || 0,
  };
}

async function listTasks(manager, qp) {
  const scope = await getManagerScope(manager);
  const q = String(qp.q || '').trim();
  const status = String(qp.status || '').trim();
  const employeeId = String(qp.employee_id || '').trim();
  const params = [];
  const clauses = ['TRUE'];
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) return { tasks: [] };
    params.push(scope.employeeIds);
    clauses.push(`t.employee_id = ANY($${params.length}::uuid[])`);
  }
  if (q) {
    params.push(q);
    clauses.push(`LOWER(t.title) LIKE LOWER('%' || $${params.length} || '%')`);
  }
  if (status) {
    params.push(status);
    clauses.push(`t.status = $${params.length}`);
  }
  if (employeeId) {
    params.push(employeeId);
    clauses.push(`t.employee_id = $${params.length}::uuid`);
  }
  const { rows } = await query(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_name, t.team_id,
            t.updated_at, e.name AS employee_name, e.email AS employee_email, e.id AS employee_id
     FROM tasks t
     LEFT JOIN employees e ON e.id = t.employee_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.updated_at DESC NULLS LAST
     LIMIT 500`,
    params
  );
  return { tasks: rows };
}

async function patchTaskStatus(manager, id, status) {
  const allowed = ['To Do', 'In Progress', 'Done', 'Blocked', 'Cancelled'];
  if (!id || !allowed.includes(status)) {
    return { status: 400, body: { message: 'Invalid id or status' } };
  }
  const scope = await getManagerScope(manager);
  const { rows: owned } = await query(`SELECT id, employee_id FROM tasks WHERE id = $1`, [id]);
  if (!owned[0] || !canAccessEmployee(scope, owned[0].employee_id)) {
    return { status: 404, body: { message: 'Not found' } };
  }
  const { rows } = await query(
    `UPDATE tasks SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, title, status`,
    [status, id]
  );
  return { status: 200, body: { task: rows[0] } };
}

async function listEods(manager, qp) {
  const scope = await getManagerScope(manager);
  const params = [];
  const clauses = ['TRUE'];
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) return { reports: [] };
    params.push(scope.employeeIds);
    clauses.push(`r.employee_id = ANY($${params.length}::uuid[])`);
  }
  if (qp.employee_id) {
    params.push(qp.employee_id);
    clauses.push(`r.employee_id = $${params.length}::uuid`);
  }
  if (qp.from) {
    params.push(qp.from);
    clauses.push(`r.report_date >= $${params.length}::date`);
  }
  if (qp.to) {
    params.push(qp.to);
    clauses.push(`r.report_date <= $${params.length}::date`);
  }
  if (qp.q) {
    params.push(qp.q);
    clauses.push(`LOWER(e.name) LIKE LOWER('%' || $${params.length} || '%')`);
  }
  const { rows } = await query(
    `SELECT r.id, r.report_date, r.status, r.achievements, r.tasks_data, r.blockers_data,
            r.submitted_at, e.name AS employee_name, e.email AS employee_email, e.id AS employee_id
     FROM eod_reports r
     JOIN employees e ON e.id = r.employee_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY r.report_date DESC, e.name
     LIMIT 300`,
    params
  );
  return { reports: rows };
}

async function listCandidates(manager, q) {
  const scope = await getManagerScope(manager);
  const params = [];
  const clauses = [];
  const acl = candidateAclClause(scope, 'c', 1);
  if (acl.clause === 'FALSE') return { candidates: [] };
  if (acl.params.length) {
    params.push(...acl.params);
    clauses.push(acl.clause);
  } else if (acl.clause !== 'TRUE') {
    clauses.push(acl.clause);
  }
  if (q) {
    params.push(q);
    clauses.push(
      `(LOWER(c.name) LIKE LOWER('%' || $${params.length} || '%') OR LOWER(c.email) LIKE LOWER('%' || $${params.length} || '%'))`
    );
  }
  const where = clauses.length ? clauses.join(' AND ') : 'TRUE';
  const { rows } = await query(
    `SELECT c.id, c.name, c.email, c.phone, c.status, c.category, c.current_company,
            (SELECT a.job_title FROM applications a WHERE a.candidate_id = c.id ORDER BY a.synced_at DESC LIMIT 1) AS job_title,
            (SELECT a.stage_name FROM applications a WHERE a.candidate_id = c.id ORDER BY a.synced_at DESC LIMIT 1) AS stage_name,
            (SELECT a.status FROM applications a WHERE a.candidate_id = c.id ORDER BY a.synced_at DESC LIMIT 1) AS application_status,
            (SELECT i.scheduled_start FROM interviews i WHERE i.candidate_id = c.id AND i.scheduled_start >= NOW()
             ORDER BY i.scheduled_start ASC LIMIT 1) AS next_interview
     FROM candidates c
     WHERE ${where}
     ORDER BY c.name
     LIMIT 200`,
    params
  );
  return { candidates: rows };
}

async function candidateDetail(manager, id) {
  const scope = await getManagerScope(manager);
  if (!canAccessCandidate(scope, id)) return { status: 404, body: { message: 'Not found' } };
  const { rows } = await query(
    `SELECT id, name, email, phone, status, category, current_company, synced_at FROM candidates WHERE id = $1`,
    [id]
  );
  if (!rows[0]) return { status: 404, body: { message: 'Not found' } };
  const { rows: applications } = await query(
    `SELECT id, job_title, stage_name, status, synced_at FROM applications WHERE candidate_id = $1`,
    [id]
  );
  const { rows: interviews } = await query(
    `SELECT id, candidate_name, job_title, scheduled_start, scheduled_end, mode, result, round_no, round_label
     FROM interviews WHERE candidate_id = $1 ORDER BY scheduled_start DESC NULLS LAST`,
    [id]
  );
  return { status: 200, body: { candidate: rows[0], applications, interviews } };
}

async function listInterviews(manager) {
  const scope = await getManagerScope(manager);
  const params = [];
  let filter = '';
  if (!scope.unrestricted && !scope.atsAll) {
    if (!scope.candidateIds?.length) return { interviews: [] };
    params.push(scope.candidateIds);
    filter = `AND i.candidate_id = ANY($1::uuid[])`;
  }
  const { rows } = await query(
    `SELECT i.id, i.candidate_id, i.candidate_name, i.job_title, i.scheduled_start, i.scheduled_end,
            i.mode, i.result, i.round_no, i.round_label, c.email AS candidate_email
     FROM interviews i
     LEFT JOIN candidates c ON c.id = i.candidate_id
     WHERE i.scheduled_start >= NOW() - INTERVAL '7 days' ${filter}
     ORDER BY i.scheduled_start ASC
     LIMIT 200`,
    params
  );
  return { interviews: rows };
}

async function attendanceRange(manager, qp) {
  const scope = await getManagerScope(manager);
  const params = [];
  const clauses = ['TRUE'];
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) return { days: [], punches: [] };
    params.push(scope.employeeIds);
    clauses.push(`d.employee_id = ANY($${params.length}::uuid[])`);
  }
  const employeeId = String(qp.employee_id || '').trim();
  const from = String(qp.from || '').trim();
  const to = String(qp.to || '').trim();
  if (employeeId) {
    params.push(employeeId);
    clauses.push(`d.employee_id = $${params.length}::uuid`);
  }
  if (from) {
    params.push(from);
    clauses.push(`d.work_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    clauses.push(`d.work_date <= $${params.length}::date`);
  }
  const { rows: days } = await query(
    `SELECT d.*, e.name AS employee_name, e.email AS employee_email
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY d.work_date DESC, e.name
     LIMIT 500`,
    params
  );
  let punches = [];
  if (employeeId) {
    if (!canAccessEmployee(scope, employeeId)) {
      return { status: 404, body: { message: 'Not found' } };
    }
    const punchParams = [employeeId];
    let punchClause = 'p.employee_id = $1::uuid';
    if (from) {
      punchParams.push(from);
      punchClause += ` AND p.punch_time::date >= $${punchParams.length}::date`;
    }
    if (to) {
      punchParams.push(to);
      punchClause += ` AND p.punch_time::date <= $${punchParams.length}::date`;
    }
    const { rows } = await query(
      `SELECT p.id, p.punch_time, p.punch_type, p.device_sn, p.employee_name
       FROM attendance_punches p
       WHERE ${punchClause}
       ORDER BY p.punch_time DESC
       LIMIT 200`,
      punchParams
    );
    punches = rows;
  }
  return { days, punches };
}

async function attendanceSummary(manager, month) {
  const scope = await getManagerScope(manager);
  const m = month || new Date().toISOString().slice(0, 7);
  const params = [m];
  let clause = 'TRUE';
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) {
      return { month: m, by_status: {}, employees: [] };
    }
    params.push(scope.employeeIds);
    clause = `d.employee_id = ANY($${params.length}::uuid[])`;
  }
  const { rows: byStatus } = await query(
    `SELECT d.status, COUNT(*)::int AS count
     FROM attendance_days d
     WHERE to_char(d.work_date, 'YYYY-MM') = $1 AND ${clause}
     GROUP BY d.status`,
    params
  );
  const { rows: employees } = await query(
    `SELECT e.id, e.name, e.email,
       COUNT(*) FILTER (WHERE d.status IN ('Present','Late','Half Day'))::int AS days_worked,
       COUNT(*) FILTER (WHERE d.status = 'Absent')::int AS days_absent,
       COUNT(*) FILTER (WHERE d.status = 'Late')::int AS days_late,
       ROUND(AVG(d.hours_worked)::numeric, 1) AS avg_hours
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE to_char(d.work_date, 'YYYY-MM') = $1 AND ${clause}
     GROUP BY e.id, e.name, e.email
     ORDER BY days_worked DESC
     LIMIT 100`,
    params
  );
  return {
    month: m,
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    employees,
  };
}

async function attendanceToday(manager) {
  const scope = await getManagerScope(manager);
  const { rows: todayRows } = await query(
    `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`
  );
  const today = todayRows[0].d;
  const params = [today];
  let clause = 'TRUE';
  if (!scope.unrestricted) {
    if (!scope.employeeIds?.length) {
      return { date: today, rows: [], counts: { present: 0, absent: 0, late: 0 } };
    }
    params.push(scope.employeeIds);
    clause = `d.employee_id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await query(
    `SELECT d.*, e.name AS employee_name, e.email AS employee_email, e.role AS employee_role
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.work_date = $1::date AND ${clause}
     ORDER BY e.name`,
    params
  );
  return {
    date: today,
    rows,
    counts: {
      present: rows.filter((r) => ['Present', 'Late', 'Half Day'].includes(r.status)).length,
      absent: rows.filter((r) => r.status === 'Absent').length,
      late: rows.filter((r) => r.status === 'Late').length,
      on_leave: rows.filter((r) => r.status === 'On Leave').length,
      total: rows.length,
    },
  };
}

async function syncStatus(manager) {
  if (manager.role !== 'ADMIN') {
    return { status: 403, body: { message: 'Admin access required' } };
  }
  const { rows } = await query(
    `SELECT id, source, status, started_at, finished_at, stats, error_message
     FROM sync_runs ORDER BY started_at DESC LIMIT 10`
  );
  const counts = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM employees) AS employees,
      (SELECT COUNT(*)::int FROM tasks) AS tasks,
      (SELECT COUNT(*)::int FROM eod_reports) AS eod_reports,
      (SELECT COUNT(*)::int FROM candidates) AS candidates,
      (SELECT COUNT(*)::int FROM applications) AS applications,
      (SELECT COUNT(*)::int FROM interviews) AS interviews,
      (SELECT COUNT(*)::int FROM jobs) AS jobs,
      (SELECT COUNT(*)::int FROM attendance_punches) AS attendance_punches,
      (SELECT COUNT(*)::int FROM attendance_days) AS attendance_days
  `);
  const runs = rows.map((r) => ({
    ...r,
    error_message: r.error_message
      ? String(r.error_message)
          .replace(/postgresql:\/\/[^\s]+/gi, '[REDACTED]')
          .slice(0, 300)
      : null,
  }));
  return { status: 200, body: { runs, counts: counts.rows[0] } };
}

/**
 * @returns {{ handled: boolean, status?: number, body?: any }}
 */
export async function handleDirectDataApi(req, manager) {
  const method = (req.method || 'GET').toUpperCase();
  const { path, queryParams } = parseUrl(req.url);

  try {
    if (method === 'GET' && path === '/api/employees') {
      return { handled: true, status: 200, body: await listEmployees(manager, queryParams.q) };
    }
    {
      const m = path.match(/^\/api\/employees\/([^/]+)$/);
      if (method === 'GET' && m) {
        const result = await employeeDetail(manager, m[1]);
        return { handled: true, status: result.status || 200, body: result.body || result };
      }
    }
    if (method === 'GET' && path === '/api/dashboard/stats') {
      return { handled: true, status: 200, body: await dashboardStats(manager) };
    }
    if (method === 'GET' && path === '/api/tasks') {
      return { handled: true, status: 200, body: await listTasks(manager, queryParams) };
    }
    {
      const m = path.match(/^\/api\/tasks\/([^/]+)\/status$/);
      if (method === 'PATCH' && m) {
        const body = typeof req.body === 'object' && req.body ? req.body : {};
        const result = await patchTaskStatus(manager, m[1], body.status);
        return { handled: true, status: result.status, body: result.body };
      }
    }
    if (method === 'GET' && path === '/api/eod-reports') {
      return { handled: true, status: 200, body: await listEods(manager, queryParams) };
    }
    if (method === 'GET' && path === '/api/candidates') {
      return { handled: true, status: 200, body: await listCandidates(manager, queryParams.q) };
    }
    {
      const m = path.match(/^\/api\/candidates\/([^/]+)$/);
      if (method === 'GET' && m) {
        const result = await candidateDetail(manager, m[1]);
        return { handled: true, status: result.status || 200, body: result.body || result };
      }
    }
    if (method === 'GET' && path === '/api/interviews') {
      return { handled: true, status: 200, body: await listInterviews(manager) };
    }
    if (method === 'GET' && path === '/api/attendance') {
      const data = await attendanceRange(manager, queryParams);
      if (data.status) return { handled: true, status: data.status, body: data.body };
      return { handled: true, status: 200, body: data };
    }
    if (method === 'GET' && path === '/api/attendance/summary') {
      return { handled: true, status: 200, body: await attendanceSummary(manager, queryParams.month) };
    }
    if (method === 'GET' && path === '/api/attendance/today') {
      return { handled: true, status: 200, body: await attendanceToday(manager) };
    }
    if (method === 'GET' && path === '/api/sync/status') {
      const result = await syncStatus(manager);
      return { handled: true, status: result.status, body: result.body };
    }
    if (method === 'POST' && path === '/api/sync/run') {
      if (manager.role !== 'ADMIN') {
        return { handled: true, status: 403, body: { message: 'Admin access required' } };
      }
      const body = typeof req.body === 'object' && req.body ? req.body : {};
      const source = String(body.source || '').trim();
      const allowed = ['sprintboard', 'ats', 'attendance'];
      const sources = allowed.includes(source) ? [source] : ['sprintboard', 'ats', 'attendance'];
      const { runFullSync } = await import('./sync/index.js');
      const result = await runFullSync({ sources });
      return { handled: true, status: 200, body: result };
    }
  } catch (err) {
    console.error('[directDataApi]', path, err?.message || err);
    return {
      handled: true,
      status: 500,
      body: { message: 'Failed to load data', detail: String(err?.message || err).slice(0, 180) },
    };
  }

  return { handled: false };
}
