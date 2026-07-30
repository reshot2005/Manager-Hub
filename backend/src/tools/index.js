import { query } from '../config/db.js';
import { getManagerScope, employeeAclClause } from '../services/scope.js';
import { sanitizeForAi } from '../utils/sanitize.js';
import { logAiToolCall } from '../utils/auditLog.js';

function fuzzyNameClause(column, paramIndex) {
  return `(
    LOWER(${column}) = LOWER($${paramIndex})
    OR LOWER(${column}) LIKE LOWER('%' || $${paramIndex} || '%')
    OR LOWER(SPLIT_PART(${column}, ' ', 1)) = LOWER($${paramIndex})
  )`;
}

async function findEmployeesByName(name, scope, limit = 5) {
  const acl = employeeAclClause(scope, 'e', 2);
  if (acl.clause === 'FALSE') return [];

  const params = [name, ...acl.params];
  const { rows } = await query(
    `SELECT e.id, e.external_id, e.name, e.email, e.role, e.team_ids, e.department,
            e.shift_start, e.shift_end, e.late_after
     FROM employees e
     WHERE ${fuzzyNameClause('e.name', 1)}
       AND ${acl.clause}
       AND COALESCE(e.is_active, TRUE) = TRUE
     ORDER BY
       CASE WHEN LOWER(e.name) = LOWER($1) THEN 0
            WHEN LOWER(SPLIT_PART(e.name, ' ', 1)) = LOWER($1) THEN 1
            ELSE 2 END,
       e.name
     LIMIT ${limit}`,
    params
  );
  return rows;
}

async function findCandidatesByName(name, scope, limit = 5) {
  const params = [name];
  let candClause = 'TRUE';
  if (scope.unrestricted || scope.atsAll) {
    candClause = 'TRUE';
  } else if (scope.candidateIds?.length) {
    params.push(scope.candidateIds);
    candClause = `c.id = ANY($${params.length}::uuid[])`;
  } else {
    return [];
  }

  const { rows } = await query(
    `SELECT c.id, c.external_id, c.name, c.email, c.phone, c.status, c.category, c.current_company
     FROM candidates c
     WHERE ${fuzzyNameClause('c.name', 1)} AND ${candClause}
     ORDER BY
       CASE WHEN LOWER(c.name) = LOWER($1) THEN 0
            WHEN LOWER(SPLIT_PART(c.name, ' ', 1)) = LOWER($1) THEN 1
            ELSE 2 END,
       c.name
     LIMIT ${limit}`,
    params
  );
  return rows;
}

/** Tool names Gemini may call (snake + camel aliases). */
export const toolDeclarations = [
  {
    name: 'getEmployeeStatus',
    description:
      "Employee today: shift, attendance today, open/overdue tasks, EOD submitted flag, latest EOD. Use for 'what is X working on' / is task done.",
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING', description: 'Employee name' },
      },
      required: ['employeeName'],
    },
  },
  {
    name: 'getPendingTasks',
    description:
      "Incomplete/pending tasks. Pass employeeName for one person; omit employeeName for the whole team's pending tasks (team-wide). Returns tasks, count, total_count, truncated.",
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING', description: 'Optional employee name; omit for full team' },
      },
    },
  },
  {
    name: 'getMissingEODs',
    description:
      "Full list of active employees who have NOT submitted an EOD for the given date (default today IST). Use for missing EODs / who hasn't reported. Returns missing_eods, total_count, truncated — list every name when asked for all.",
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'YYYY-MM-DD IST; default today' },
      },
    },
  },
  {
    name: 'getLeaveStatus',
    description:
      'Approved and pending leave for one employee in a date range. Use before labeling anyone absent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
        startDate: { type: 'STRING', description: 'YYYY-MM-DD' },
        endDate: { type: 'STRING', description: 'YYYY-MM-DD' },
      },
      required: ['employeeName'],
    },
  },
  {
    name: 'getTeamOnLeave',
    description:
      'Who is on approved leave on a date (default today) or this week (range=week). Never call these people Absent.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'YYYY-MM-DD IST' },
        range: { type: 'STRING', description: 'day|week' },
      },
    },
  },
  {
    name: 'getRiskReport',
    description:
      'Attrition-risk score breakdown for one employee with contributing_factors. Always present factors with the score — never bare numbers or personal speculation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
      },
      required: ['employeeName'],
    },
  },
  {
    name: 'getTeamRiskSummary',
    description:
      'Medium/High risk employees on the latest computed scores, sorted by severity. Include contributing_factors for each.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'getActiveAlerts',
    description:
      'Unacknowledged proactive alerts for this manager. Call first for "how is my team" / daily briefing / session open.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'getLatestEod',
    description: 'Fetch recent EOD / daily reports for an employee.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
        days: { type: 'NUMBER', description: 'How many recent reports (default 3)' },
      },
      required: ['employeeName'],
    },
  },
  {
    name: 'getTeamSummary',
    description: "Daily digest of the current manager's team: pending tasks, EODs today, interviews today.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'getTeamWorkBoard',
    description:
      "ALL employees in the manager's team: EOD submitted/missing for a date, open/assigned tasks, completed (Done) tasks, overdue count — one row per person. Use for 'all employee EODs', 'who completed tasks', 'assigned vs completed', team work tracking. Returns employees[], total_count, totals.",
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'EOD date YYYY-MM-DD IST; default today' },
      },
    },
  },
  {
    name: 'getInterviewSchedule',
    description: 'Get interviews filtered by candidate name and/or date range (YYYY-MM-DD). Defaults to today.',
    parameters: {
      type: 'OBJECT',
      properties: {
        candidateName: { type: 'STRING' },
        startDate: { type: 'STRING' },
        endDate: { type: 'STRING' },
        date: { type: 'STRING', description: 'Single day YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'getCandidateStatus',
    description: 'Get a candidate application pipeline status and interviews.',
    parameters: {
      type: 'OBJECT',
      properties: {
        candidateName: { type: 'STRING' },
      },
      required: ['candidateName'],
    },
  },
  {
    name: 'searchPeople',
    description: 'Search employees and candidates by partial name to disambiguate.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING' },
      },
      required: ['query'],
    },
  },
  {
    name: 'getAttendanceToday',
    description:
      "Who is present, absent, or late TODAY only (IST). Do NOT use for week ranges or week-vs-week comparisons.",
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'getAttendanceComparison',
    description:
      "Compare team attendance across two periods (default this_week vs last_week, Mon–Sun IST). Returns counts, attendance %, absent %, synced day coverage, and deltas. Use for 'compare this week vs last week', 'attendance percentage this week', weekly trends.",
    parameters: {
      type: 'OBJECT',
      properties: {
        periodA: {
          type: 'STRING',
          description: 'this_week | last_week | YYYY-MM-DD:YYYY-MM-DD',
        },
        periodB: {
          type: 'STRING',
          description: 'this_week | last_week | YYYY-MM-DD:YYYY-MM-DD (omit for single-period stats)',
        },
      },
    },
  },
  {
    name: 'getEmployeeAttendance',
    description:
      "Get an employee's attendance days, punches, days worked, late count for a date range.",
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
        startDate: { type: 'STRING', description: 'YYYY-MM-DD' },
        endDate: { type: 'STRING', description: 'YYYY-MM-DD' },
        days: { type: 'NUMBER', description: 'Lookback days if range omitted (default 14)' },
      },
      required: ['employeeName'],
    },
  },
  {
    name: 'getAbsentees',
    description:
      "List employees marked Absent. Use date=YYYY-MM-DD for one day; range=this_week or last_week (Mon–Sun IST) for weekly absentees; or startDate+endDate. Never use getAttendanceToday for weekly absent lists.",
    parameters: {
      type: 'OBJECT',
      properties: {
        date: { type: 'STRING', description: 'YYYY-MM-DD (single day; defaults today IST)' },
        range: {
          type: 'STRING',
          description: 'this_week | last_week',
        },
        week: { type: 'STRING', description: 'true = this_week (alias)' },
        startDate: { type: 'STRING' },
        endDate: { type: 'STRING' },
      },
    },
  },
  {
    name: 'getLoginTiming',
    description: 'First punch / late minutes for a person or whole team on a date.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
        date: { type: 'STRING', description: 'YYYY-MM-DD defaults today IST' },
      },
    },
  },
  {
    name: 'getPerformanceReport',
    description:
      'Combined performance: tasks + EOD + attendance score for an employee or team.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
        days: { type: 'NUMBER', description: 'Lookback days default 7' },
      },
    },
  },
  {
    name: 'getWorkedDaysSummary',
    description: 'Days worked / absent / late counts for an employee in a month.',
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING' },
        month: { type: 'STRING', description: 'YYYY-MM or month number' },
        year: { type: 'NUMBER' },
      },
      required: ['employeeName'],
    },
  },
  {
    name: 'getDailyBriefing',
    description:
      'One-shot morning brief: absentees, late arrivals, missing EODs, overdue tasks, interviews today. Use for standup / "who needs attention".',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'getEmployeeFullProfile',
    description:
      "God-level single-employee snapshot for today: shift, attendance today, open/overdue tasks, latest EOD, week attendance summary, performance score if available. Use for 'status of X', 'tell me about X today', 1:1 prep.",
    parameters: {
      type: 'OBJECT',
      properties: {
        employeeName: { type: 'STRING', description: 'Employee name' },
      },
      required: ['employeeName'],
    },
  },
];

const ALIASES = {
  get_employee_status: 'getEmployeeStatus',
  get_pending_tasks: 'getPendingTasks',
  get_missing_eods: 'getMissingEODs',
  get_leave_status: 'getLeaveStatus',
  get_team_on_leave: 'getTeamOnLeave',
  get_risk_report: 'getRiskReport',
  get_team_risk_summary: 'getTeamRiskSummary',
  get_active_alerts: 'getActiveAlerts',
  get_team_pending_tasks: 'getPendingTasks',
  getTeamPendingTasks: 'getPendingTasks',
  get_latest_eod: 'getLatestEod',
  get_team_summary: 'getTeamSummary',
  get_team_work_board: 'getTeamWorkBoard',
  getTeamTaskBoard: 'getTeamWorkBoard',
  get_interview_schedule: 'getInterviewSchedule',
  get_candidate_status: 'getCandidateStatus',
  search_people: 'searchPeople',
  get_attendance_today: 'getAttendanceToday',
  get_attendance_comparison: 'getAttendanceComparison',
  getAttendanceWeekCompare: 'getAttendanceComparison',
  get_employee_attendance: 'getEmployeeAttendance',
  get_absentees: 'getAbsentees',
  get_login_timing: 'getLoginTiming',
  get_performance_report: 'getPerformanceReport',
  get_worked_days_summary: 'getWorkedDaysSummary',
  get_daily_briefing: 'getDailyBriefing',
  get_employee_full_profile: 'getEmployeeFullProfile',
  employee_full_profile: 'getEmployeeFullProfile',
};

/**
 * Execute a tool. manager comes from JWT — NEVER from LLM args.
 */
export async function executeTool(name, args, manager) {
  const resolved = ALIASES[name] || name;
  const scope = await getManagerScope(manager);
  // Strip any spoofed managerId from model args
  const a = { ...(args || {}) };
  delete a.managerId;
  delete a.manager_id;

  let result;
  let success = true;
  try {
    switch (resolved) {
      case 'getEmployeeStatus':
        result = await getEmployeeStatus(a.employeeName || a.name, scope);
        break;
      case 'getPendingTasks':
        result = await getPendingTasks(a.employeeName || a.name, scope);
        break;
      case 'getMissingEODs':
        result = await getMissingEODs(a.date, scope);
        break;
      case 'getLeaveStatus':
        result = await getLeaveStatus(a, scope);
        break;
      case 'getTeamOnLeave':
        result = await getTeamOnLeave(a, scope);
        break;
      case 'getRiskReport':
        result = await getRiskReport(a.employeeName || a.name, scope);
        break;
      case 'getTeamRiskSummary':
        result = await getTeamRiskSummary(scope);
        break;
      case 'getActiveAlerts':
        result = await getActiveAlerts(manager);
        break;
      case 'getLatestEod':
        result = await getLatestEod(a.employeeName || a.name, a.days, scope);
        break;
      case 'getTeamSummary':
        result = await getTeamSummary(scope);
        break;
      case 'getTeamWorkBoard':
        result = await getTeamWorkBoard(a, scope);
        break;
      case 'getInterviewSchedule':
        result = await getInterviewSchedule(a, scope);
        break;
      case 'getCandidateStatus':
        result = await getCandidateStatus(a.candidateName || a.name, scope);
        break;
      case 'searchPeople':
        result = await searchPeople(a.query || a.name, scope);
        break;
      case 'getAttendanceToday':
        result = await getAttendanceToday(scope);
        break;
      case 'getAttendanceComparison':
        result = await getAttendanceComparison(a, scope);
        break;
      case 'getEmployeeAttendance':
        result = await getEmployeeAttendance(a, scope);
        break;
      case 'getAbsentees':
        result = await getAbsentees(a, scope);
        break;
      case 'getLoginTiming':
        result = await getLoginTiming(a, scope);
        break;
      case 'getPerformanceReport':
        result = await getPerformanceReport(a, scope);
        break;
      case 'getWorkedDaysSummary':
        result = await getWorkedDaysSummary(a, scope);
        break;
      case 'getDailyBriefing':
        result = await getDailyBriefing(scope);
        break;
      case 'getEmployeeFullProfile':
        result = await getEmployeeFullProfile(a.employeeName || a.name, scope);
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
        success = false;
    }
  } catch (err) {
    success = false;
    result = { error: 'Tool failed' };
  }

  await logAiToolCall({
    managerId: manager?.id,
    toolName: resolved,
    args: a,
    success,
  });

  return sanitizeForAi(result);
}

async function searchPeople(q, scope) {
  if (!q) return { employees: [], candidates: [] };
  const employees = await findEmployeesByName(q, scope, 8);
  const candidates = await findCandidatesByName(q, scope, 8);
  return {
    employees: employees.map((e) => ({ name: e.name, email: e.email, role: e.role })),
    candidates: candidates.map((c) => ({ name: c.name, email: c.email, status: c.status })),
  };
}

async function getEmployeeStatus(name, scope) {
  if (!name) return { error: 'employeeName required' };
  const matches = await findEmployeesByName(name, scope, 5);
  if (!matches.length) {
    return { found: false, message: `No employee matching "${name}" in your team.` };
  }
  if (matches.length > 1 && !matches.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    return {
      found: false,
      ambiguous: true,
      matches: matches.map((m) => m.name),
      message: 'Multiple employees matched. Ask the manager to clarify.',
    };
  }
  const emp = matches.find((m) => m.name.toLowerCase() === name.toLowerCase()) || matches[0];
  const today = await todayIst();

  const [tasksRes, eodsRes, attRes] = await Promise.all([
    query(
      `SELECT title, status, priority, due_date, project_name, updated_at
       FROM tasks WHERE employee_id = $1
       ORDER BY
         CASE WHEN status = 'Done' THEN 1 ELSE 0 END,
         due_date NULLS LAST,
         updated_at DESC NULLS LAST
       LIMIT 15`,
      [emp.id]
    ),
    query(
      `SELECT report_date, status, achievements, tasks_data, pending_tasks_data,
              blockers_data, tomorrow_plan, self_evaluation, working_mode, submitted_at
       FROM eod_reports WHERE employee_id = $1
       ORDER BY report_date DESC LIMIT 1`,
      [emp.id]
    ),
    query(
      `SELECT work_date, status, first_in, last_out, hours_worked, late_minutes, punch_count
       FROM attendance_days WHERE employee_id = $1 AND work_date = $2::date`,
      [emp.id, today]
    ),
  ]);

  const tasks = tasksRes.rows;
  const eods = eodsRes.rows;
  const attendanceToday = attRes.rows[0] || null;

  const openTasks = tasks.filter((t) => t.status && t.status !== 'Done' && t.status !== 'Backlog');
  const overdueTasks = openTasks.filter(
    (t) => t.due_date && String(t.due_date).slice(0, 10) < today
  );
  const latestEod = eods[0] || null;
  const eodToday =
    latestEod && String(latestEod.report_date).slice(0, 10) === today ? latestEod : null;

  return {
    found: true,
    as_of_date: today,
    timezone: 'Asia/Kolkata',
    employee: {
      name: emp.name,
      email: emp.email,
      role: emp.role,
      department: emp.department,
      shift_start: emp.shift_start || '09:30',
      shift_end: emp.shift_end || '19:00',
      late_after: emp.late_after || emp.shift_start || '09:30',
    },
    attendance_today: attendanceToday,
    open_tasks: openTasks,
    overdue_tasks: overdueTasks,
    open_task_count: openTasks.length,
    overdue_count: overdueTasks.length,
    recent_tasks: tasks,
    eod_submitted_today: Boolean(eodToday),
    latest_eod: latestEod
      ? {
          date: latestEod.report_date,
          status: latestEod.status,
          achievements: latestEod.achievements,
          tasks_worked: latestEod.tasks_data,
          pending: latestEod.pending_tasks_data,
          blockers: latestEod.blockers_data,
          tomorrow_plan: latestEod.tomorrow_plan,
          self_evaluation: latestEod.self_evaluation,
          working_mode: latestEod.working_mode,
          submitted_at: latestEod.submitted_at,
        }
      : null,
  };
}

async function getPendingTasks(name, scope) {
  const params = [];
  let employeeFilter = '';

  if (name) {
    const matches = await findEmployeesByName(name, scope, 3);
    if (!matches.length) {
      return {
        tasks: [],
        count: 0,
        total_count: 0,
        truncated: false,
        message: `No employee matching "${name}" in your team.`,
      };
    }
    params.push(matches[0].id);
    employeeFilter = `AND t.employee_id = $${params.length}`;
  } else {
    const acl = employeeAclClause(scope, 'e', params.length + 1);
    if (acl.clause === 'FALSE') return { tasks: [], count: 0, total_count: 0, truncated: false };
    if (!scope.unrestricted) {
      params.push(...acl.params);
      employeeFilter = `AND t.employee_id = ANY($${params.length}::uuid[])`;
    }
  }

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS c
     FROM tasks t
     WHERE COALESCE(t.status, '') NOT IN ('Done')
     ${employeeFilter}`,
    params
  );
  const total_count = countRows[0]?.c || 0;
  const LIST_CAP = 500;

  const { rows } = await query(
    `SELECT t.title, t.status, t.priority, t.due_date, t.project_name, e.name AS employee_name
     FROM tasks t
     LEFT JOIN employees e ON e.id = t.employee_id
     WHERE COALESCE(t.status, '') NOT IN ('Done')
     ${employeeFilter}
     ORDER BY t.due_date NULLS LAST, t.priority DESC
     LIMIT ${LIST_CAP}`,
    params
  );
  return {
    tasks: rows,
    count: rows.length,
    total_count,
    truncated: total_count > rows.length,
    scope: name ? 'employee' : 'team',
  };
}

async function getMissingEODs(date, scope) {
  const today = await todayIst();
  const target = date && /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? String(date) : today;
  const acl = teamEmpFilter(scope, 'e', 2);
  if (acl.clause === 'FALSE') {
    return {
      date: target,
      missing_eods: [],
      count: 0,
      total_count: 0,
      truncated: false,
      message: 'No team linked to this manager.',
    };
  }

  const params = [target, ...acl.params];
  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS c
     FROM employees e
     WHERE COALESCE(e.is_active, TRUE) = TRUE
       AND ${acl.clause}
       AND NOT EXISTS (
         SELECT 1 FROM eod_reports r
         WHERE r.employee_id = e.id AND r.report_date = $1::date
       )`,
    params
  );
  const total_count = countRows[0]?.c || 0;
  const LIST_CAP = 500;

  const { rows } = await query(
    `SELECT e.name, e.email
     FROM employees e
     WHERE COALESCE(e.is_active, TRUE) = TRUE
       AND ${acl.clause}
       AND NOT EXISTS (
         SELECT 1 FROM eod_reports r
         WHERE r.employee_id = e.id AND r.report_date = $1::date
       )
     ORDER BY e.name
     LIMIT ${LIST_CAP}`,
    params
  );

  return {
    date: target,
    timezone: 'Asia/Kolkata',
    missing_eods: rows,
    count: rows.length,
    total_count,
    truncated: total_count > rows.length,
  };
}

async function getLeaveStatus(args, scope) {
  const name = args?.employeeName || args?.name;
  if (!name) return { error: 'employeeName required' };
  const matches = await findEmployeesByName(name, scope, 3);
  if (!matches.length) return { found: false, message: `No employee matching "${name}" in your team.` };
  if (matches.length > 1) {
    return { found: false, ambiguous: true, matches: matches.map((m) => m.name) };
  }
  const emp = matches[0];
  const today = await todayIst();
  const start = args?.startDate && /^\d{4}-\d{2}-\d{2}$/.test(args.startDate) ? args.startDate : today;
  const end = args?.endDate && /^\d{4}-\d{2}-\d{2}$/.test(args.endDate) ? args.endDate : start;

  const { rows } = await query(
    `SELECT leave_type, start_date, end_date, status, notes, requested_at
     FROM leave_requests
     WHERE employee_id = $1
       AND end_date >= $2::date
       AND start_date <= $3::date
     ORDER BY start_date`,
    [emp.id, start, end]
  );
  return {
    found: true,
    employee: emp.name,
    start_date: start,
    end_date: end,
    leaves: rows,
    count: rows.length,
    approved_count: rows.filter((r) => r.status === 'Approved').length,
    pending_count: rows.filter((r) => r.status === 'Pending').length,
  };
}

async function getTeamOnLeave(args, scope) {
  const today = await todayIst();
  const range = String(args?.range || 'day').toLowerCase();
  const start =
    args?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date)) ? String(args.date) : today;
  const end =
    range === 'week'
      ? (
          await query(`SELECT ($1::date + INTERVAL '6 days')::date::text AS d`, [start])
        ).rows[0].d
      : start;

  const acl = teamEmpFilter(scope, 'e', 3);
  if (acl.clause === 'FALSE') {
    return { start_date: start, end_date: end, on_leave: [], total_count: 0 };
  }
  const params = [start, end, ...acl.params];
  const { rows } = await query(
    `SELECT e.name, e.email, lr.leave_type, lr.start_date, lr.end_date, lr.status, lr.notes
     FROM leave_requests lr
     JOIN employees e ON e.id = lr.employee_id
     WHERE lr.status = 'Approved'
       AND lr.end_date >= $1::date
       AND lr.start_date <= $2::date
       AND ${acl.clause}
     ORDER BY e.name, lr.start_date`,
    params
  );
  return {
    start_date: start,
    end_date: end,
    timezone: 'Asia/Kolkata',
    on_leave: rows,
    count: rows.length,
    total_count: rows.length,
    note: 'These employees must NOT be reported as Absent for covered dates.',
  };
}

async function getRiskReport(name, scope) {
  if (!name) return { error: 'employeeName required' };
  const matches = await findEmployeesByName(name, scope, 3);
  if (!matches.length) return { found: false, message: `No employee matching "${name}" in your team.` };
  if (matches.length > 1) {
    return { found: false, ambiguous: true, matches: matches.map((m) => m.name) };
  }
  const emp = matches[0];
  const { rows } = await query(
    `SELECT * FROM employee_risk_scores
     WHERE employee_id = $1
     ORDER BY computed_date DESC LIMIT 1`,
    [emp.id]
  );
  if (!rows.length) {
    return {
      found: true,
      employee: emp.name,
      message: 'No risk score computed yet — wait for the daily intelligence job.',
    };
  }
  const r = rows[0];
  return {
    found: true,
    employee: emp.name,
    computed_date: r.computed_date,
    attendance_score: r.attendance_score,
    task_completion_score: r.task_completion_score,
    eod_consistency_score: r.eod_consistency_score,
    composite_score: r.composite_score,
    risk_level: r.risk_level,
    contributing_factors: r.contributing_factors,
    synced_days_in_window: r.synced_days,
    window_days: r.window_days,
    explanation:
      'Present factors only — do not speculate about personal reasons beyond this list.',
  };
}

async function getTeamRiskSummary(scope) {
  const acl = teamEmpFilter(scope, 'e', 1);
  if (acl.clause === 'FALSE') {
    return { risks: [], total_count: 0, message: 'No team linked.' };
  }
  const params = [...acl.params];
  const { rows } = await query(
    `SELECT DISTINCT ON (r.employee_id)
       e.name, r.computed_date, r.composite_score, r.risk_level,
       r.attendance_score, r.task_completion_score, r.eod_consistency_score,
       r.contributing_factors, r.synced_days, r.window_days
     FROM employee_risk_scores r
     JOIN employees e ON e.id = r.employee_id
     WHERE ${acl.clause}
     ORDER BY r.employee_id, r.computed_date DESC`,
    params
  );
  const flagged = rows
    .filter((r) => r.risk_level === 'High' || r.risk_level === 'Medium')
    .sort((a, b) => {
      const rank = { High: 0, Medium: 1, Low: 2 };
      return rank[a.risk_level] - rank[b.risk_level] || a.composite_score - b.composite_score;
    });
  return {
    risks: flagged,
    count: flagged.length,
    total_count: flagged.length,
    high_count: flagged.filter((r) => r.risk_level === 'High').length,
    medium_count: flagged.filter((r) => r.risk_level === 'Medium').length,
  };
}

async function getActiveAlerts(manager) {
  if (!manager?.id) return { alerts: [], total_count: 0 };
  const { rows } = await query(
    `SELECT a.id, a.alert_type, a.message, a.severity, a.created_at, a.employee_id,
            e.name AS employee_name, a.meta
     FROM alerts a
     LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.manager_id = $1 AND a.acknowledged = FALSE
     ORDER BY
       CASE a.severity WHEN 'Critical' THEN 0 WHEN 'Warning' THEN 1 ELSE 2 END,
       a.created_at DESC
     LIMIT 50`,
    [manager.id]
  );
  return {
    alerts: rows,
    count: rows.length,
    total_count: rows.length,
    note: 'Surface these first for "how is my team" / briefing questions.',
  };
}

async function getLatestEod(name, days, scope) {
  const matches = await findEmployeesByName(name, scope, 3);
  if (!matches.length) return { found: false, message: `No employee matching "${name}" in your team.` };
  const emp = matches[0];
  const limit = Math.min(Number(days) || 3, 14);

  const { rows } = await query(
    `SELECT report_date, status, achievements, tasks_data, pending_tasks_data,
            blockers_data, tomorrow_plan, self_evaluation, working_mode, submitted_at
     FROM eod_reports WHERE employee_id = $1
     ORDER BY report_date DESC LIMIT $2`,
    [emp.id, limit]
  );

  return { found: true, employee: emp.name, reports: rows };
}

async function getCandidateStatus(name, scope) {
  const matches = await findCandidatesByName(name, scope, 5);
  if (!matches.length) return { found: false, message: `No candidate matching "${name}".` };
  if (matches.length > 1 && !matches.some((m) => m.name.toLowerCase() === name.toLowerCase())) {
    return { found: false, ambiguous: true, matches: matches.map((m) => m.name) };
  }
  const c = matches.find((m) => m.name.toLowerCase() === name.toLowerCase()) || matches[0];

  const { rows: apps } = await query(
    `SELECT job_title, status, stage_name, shortlisted FROM applications WHERE candidate_id = $1`,
    [c.id]
  );
  const { rows: interviews } = await query(
    `SELECT scheduled_start, scheduled_end, mode, result, round_no, round_label,
            interviewer_names, job_title, meeting_link
     FROM interviews WHERE candidate_id = $1
     ORDER BY scheduled_start DESC NULLS LAST LIMIT 10`,
    [c.id]
  );

  return {
    found: true,
    candidate: {
      name: c.name,
      email: c.email,
      phone: c.phone,
      status: c.status,
      category: c.category,
      current_company: c.current_company,
    },
    applications: apps,
    interviews,
  };
}

async function getInterviewSchedule(args, scope) {
  const { candidateName, startDate, endDate, date, name } = args || {};
  const candName = candidateName || name;
  const params = [];
  const clauses = [];

  if (!scope.unrestricted && !scope.atsAll) {
    if (!scope.candidateIds?.length) {
      return { interviews: [], count: 0, message: 'No candidate access for this manager.' };
    }
    params.push(scope.candidateIds);
    clauses.push(`candidate_id = ANY($${params.length}::uuid[])`);
  }

  if (startDate && endDate) {
    params.push(startDate, endDate);
    clauses.push(
      `(scheduled_start AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $${params.length - 1}::date AND $${params.length}::date`
    );
  } else if (date) {
    params.push(date);
    clauses.push(`(scheduled_start AT TIME ZONE 'Asia/Kolkata')::date = $${params.length}::date`);
  } else if (!candName) {
    const { rows } = await query(
      `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`
    );
    params.push(rows[0].d);
    clauses.push(`(scheduled_start AT TIME ZONE 'Asia/Kolkata')::date = $${params.length}::date`);
  }

  if (candName) {
    params.push(candName);
    clauses.push(`(
      LOWER(candidate_name) LIKE LOWER('%' || $${params.length} || '%')
      OR candidate_id IN (
        SELECT id FROM candidates WHERE LOWER(name) LIKE LOWER('%' || $${params.length} || '%')
      )
    )`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT candidate_name, job_title, scheduled_start, scheduled_end, mode, result,
            round_no, round_label, interviewer_names, meeting_link
     FROM interviews
     ${where}
     ORDER BY scheduled_start ASC NULLS LAST
     LIMIT 50`,
    params
  );
  return {
    interviews: rows,
    count: rows.length,
    filter: { startDate, endDate, date, candidateName: candName || null },
  };
}

async function getTeamSummary(scope) {
  const { rows: todayRows } = await query(
    `SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`
  );
  const today = todayRows[0].d;

  const acl = employeeAclClause(scope, 'e', 1);
  if (acl.clause === 'FALSE') {
    return {
      date: today,
      message: 'No team linked to this manager.',
      open_tasks: 0,
      overdue_tasks: [],
      eods_today: [],
      interviews_today: [],
    };
  }

  const teamParams = acl.params;
  const empInTeam = scope.unrestricted
    ? 'TRUE'
    : `e.id = ANY($1::uuid[])`;
  const taskInTeam = scope.unrestricted
    ? 'TRUE'
    : `t.employee_id = ANY($1::uuid[])`;

  const { rows: openCount } = await query(
    `SELECT COUNT(*)::int AS c FROM tasks t
     WHERE COALESCE(t.status,'') NOT IN ('Done') AND ${taskInTeam}`,
    teamParams
  );

  const { rows: overdueCountRows } = await query(
    `SELECT COUNT(*)::int AS c FROM tasks t
     WHERE COALESCE(t.status,'') NOT IN ('Done')
       AND t.due_date < CURRENT_DATE
       AND t.due_date > DATE '2000-01-01'
       AND ${taskInTeam}`,
    teamParams
  );
  const overdue_total_count = overdueCountRows[0]?.c ?? 0;

  const { rows: overdue } = await query(
    `SELECT t.title, t.status, t.due_date, e.name AS employee_name
     FROM tasks t LEFT JOIN employees e ON e.id = t.employee_id
     WHERE COALESCE(t.status,'') NOT IN ('Done')
       AND t.due_date < CURRENT_DATE
       AND t.due_date > DATE '2000-01-01'
       AND ${taskInTeam}
     ORDER BY t.due_date ASC LIMIT 500`,
    teamParams
  );

  const eodParams = scope.unrestricted ? [today] : [...teamParams, today];
  const dateIdx = scope.unrestricted ? 1 : 2;
  const { rows: eodsToday } = await query(
    `SELECT e.name AS employee_name, r.report_date, r.status, r.achievements,
            r.blockers_data, r.submitted_at
     FROM eod_reports r
     JOIN employees e ON e.id = r.employee_id
     WHERE r.report_date = $${dateIdx}::date AND ${empInTeam}
     ORDER BY e.name`,
    eodParams
  );

  let interviews = [];
  if (scope.unrestricted || scope.atsAll) {
    const { rows } = await query(
      `SELECT candidate_name, job_title, scheduled_start, mode, interviewer_names, result
       FROM interviews
       WHERE (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date = $1::date
       ORDER BY scheduled_start ASC`,
      [today]
    );
    interviews = rows;
  } else if (scope.candidateIds?.length) {
    const { rows } = await query(
      `SELECT candidate_name, job_title, scheduled_start, mode, interviewer_names, result
       FROM interviews
       WHERE (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date = $1::date
         AND candidate_id = ANY($2::uuid[])
       ORDER BY scheduled_start ASC`,
      [today, scope.candidateIds]
    );
    interviews = rows;
  }

  return {
    date: today,
    open_tasks: openCount[0]?.c ?? 0,
    overdue_tasks: overdue,
    overdue_count: overdue.length,
    overdue_total_count,
    overdue_truncated: overdue_total_count > overdue.length,
    eods_today: eodsToday,
    eod_submitted_count: eodsToday.filter((r) => r.status && r.status !== 'Draft').length,
    interviews_today: interviews,
  };
}

/**
 * Per-employee EOD + task board for the whole team (ACL-scoped).
 */
async function getTeamWorkBoard(args, scope) {
  const today = await todayIst();
  const date =
    args?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.date)) ? String(args.date) : today;
  const acl = teamEmpFilter(scope, 'e', 2);
  if (acl.clause === 'FALSE') {
    return {
      date,
      employees: [],
      total_count: 0,
      totals: {},
      message: 'No team linked to this manager.',
    };
  }

  const params = [date, ...acl.params];
  const { rows } = await query(
    `SELECT
       e.id,
       e.name,
       e.email,
       e.department,
       EXISTS (
         SELECT 1 FROM eod_reports r
         WHERE r.employee_id = e.id
           AND r.report_date = $1::date
           AND COALESCE(r.status, '') <> 'Draft'
       ) AS eod_submitted,
       (
         SELECT COUNT(*)::int FROM tasks t
         WHERE t.employee_id = e.id AND COALESCE(t.status, '') NOT IN ('Done')
       ) AS open_tasks,
       (
         SELECT COUNT(*)::int FROM tasks t
         WHERE t.employee_id = e.id AND COALESCE(t.status, '') = 'Done'
       ) AS completed_tasks,
       (
         SELECT COUNT(*)::int FROM tasks t
         WHERE t.employee_id = e.id
           AND COALESCE(t.status, '') NOT IN ('Done')
           AND t.due_date < $1::date
           AND t.due_date > DATE '2000-01-01'
       ) AS overdue_tasks,
       (
         SELECT COUNT(*)::int FROM tasks t WHERE t.employee_id = e.id
       ) AS assigned_tasks_total
     FROM employees e
     WHERE COALESCE(e.is_active, TRUE) = TRUE
       AND ${acl.clause}
     ORDER BY e.name`,
    params
  );

  const employees = rows.map((r) => ({
    name: r.name,
    email: r.email,
    department: r.department,
    eod_submitted: Boolean(r.eod_submitted),
    eod_status: r.eod_submitted ? 'submitted' : 'missing',
    open_tasks: r.open_tasks || 0,
    completed_tasks: r.completed_tasks || 0,
    overdue_tasks: r.overdue_tasks || 0,
    assigned_tasks_total: r.assigned_tasks_total || 0,
  }));

  const totals = {
    employees: employees.length,
    eod_submitted: employees.filter((e) => e.eod_submitted).length,
    eod_missing: employees.filter((e) => !e.eod_submitted).length,
    open_tasks: employees.reduce((s, e) => s + e.open_tasks, 0),
    completed_tasks: employees.reduce((s, e) => s + e.completed_tasks, 0),
    overdue_tasks: employees.reduce((s, e) => s + e.overdue_tasks, 0),
    assigned_tasks_total: employees.reduce((s, e) => s + e.assigned_tasks_total, 0),
  };

  return {
    date,
    timezone: 'Asia/Kolkata',
    employees,
    count: employees.length,
    total_count: employees.length,
    totals,
    missing_eod_names: employees.filter((e) => !e.eod_submitted).map((e) => e.name),
    note: 'List every employee when asked for all — total_count must match rows shown.',
  };
}

async function todayIst() {
  const { rows } = await query(`SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`);
  return rows[0].d;
}

function teamEmpFilter(scope, alias = 'e', startIdx = 1) {
  const acl = employeeAclClause(scope, alias, startIdx);
  return acl;
}

async function getAttendanceToday(scope) {
  const today = await todayIst();
  const acl = teamEmpFilter(scope, 'e', 2);
  if (acl.clause === 'FALSE') return { date: today, present: [], absent: [], late: [], message: 'No team linked.' };

  const params = [today, ...acl.params];
  const { rows } = await query(
    `SELECT e.name, e.email, e.shift_start, e.shift_end, e.late_after,
            d.status, d.first_in, d.last_out, d.hours_worked, d.late_minutes
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.work_date = $1::date AND ${acl.clause}
     ORDER BY e.name`,
    params
  );

  const withShift = rows.map((r) => ({
    ...r,
    shift: `${r.shift_start || '09:30'}–${r.shift_end || '19:00'} IST`,
    late_after: r.late_after || r.shift_start || '09:30',
  }));

  return {
    date: today,
    timezone: 'Asia/Kolkata',
    shift_defaults: {
      standard: '09:30–19:00 (late after 09:30)',
      late_start: '10:30–20:00 (late after 10:30)',
      early: '08:00–18:00 (late after 08:00)',
    },
    counts: {
      present: withShift.filter((r) => r.status === 'Present').length,
      late: withShift.filter((r) => r.status === 'Late').length,
      absent: withShift.filter((r) => r.status === 'Absent').length,
      half_day: withShift.filter((r) => r.status === 'Half Day').length,
      on_leave: withShift.filter((r) => r.status === 'On Leave').length,
      total: withShift.length,
    },
    present: withShift.filter((r) => ['Present', 'Late', 'Half Day'].includes(r.status)),
    late: withShift.filter((r) => r.status === 'Late'),
    absent: withShift.filter((r) => r.status === 'Absent'),
    note: withShift.length ? null : 'No attendance synced for today yet.',
  };
}

/** ISO week Mon–Sun bounds relative to an IST calendar date. */
async function resolveWeekBounds(anchorDate, which = 'this_week') {
  const { rows } = await query(
    `WITH a AS (
       SELECT $1::date AS d
     ),
     this_start AS (
       SELECT date_trunc('week', d::timestamp)::date AS start FROM a
     )
     SELECT
       CASE WHEN $2 = 'last_week' THEN (start - 7) ELSE start END AS start_date,
       CASE WHEN $2 = 'last_week' THEN (start - 1) ELSE (start + 6) END AS end_date
     FROM this_start`,
    [anchorDate, which === 'last_week' ? 'last_week' : 'this_week']
  );
  return {
    start: rows[0].start_date,
    end: rows[0].end_date,
    label: which === 'last_week' ? 'last_week' : 'this_week',
  };
}

async function resolvePeriodBounds(period, today) {
  const p = String(period || 'this_week').trim().toLowerCase();
  if (p === 'this_week' || p === 'week') return resolveWeekBounds(today, 'this_week');
  if (p === 'last_week') return resolveWeekBounds(today, 'last_week');
  const m = p.match(/^(\d{4}-\d{2}-\d{2})\s*:\s*(\d{4}-\d{2}-\d{2})$/);
  if (m) return { start: m[1], end: m[2], label: `${m[1]}_to_${m[2]}` };
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return { start: p, end: p, label: p };
  return resolveWeekBounds(today, 'this_week');
}

async function summarizeAttendanceRange(scope, start, end, label) {
  const acl = teamEmpFilter(scope, 'e', 3);
  if (acl.clause === 'FALSE') {
    return {
      label,
      start_date: start,
      end_date: end,
      synced_rows: 0,
      present: 0,
      late: 0,
      absent: 0,
      half_day: 0,
      on_leave: 0,
      holiday: 0,
      attendance_pct: null,
      absent_pct: null,
      by_day: [],
      note: 'No team linked.',
    };
  }
  const params = [start, end, ...acl.params];
  const { rows: totals } = await query(
    `SELECT
       COUNT(*)::int AS synced_rows,
       COUNT(*) FILTER (WHERE d.status = 'Present')::int AS present,
       COUNT(*) FILTER (WHERE d.status = 'Late')::int AS late,
       COUNT(*) FILTER (WHERE d.status = 'Absent')::int AS absent,
       COUNT(*) FILTER (WHERE d.status = 'Half Day')::int AS half_day,
       COUNT(*) FILTER (WHERE d.status = 'On Leave')::int AS on_leave,
       COUNT(*) FILTER (WHERE d.status = 'Holiday')::int AS holiday,
       COUNT(DISTINCT d.work_date)::int AS synced_days,
       COUNT(DISTINCT d.employee_id)::int AS employees_with_data
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.work_date BETWEEN $1::date AND $2::date
       AND ${acl.clause}`,
    params
  );
  const t = totals[0] || {};
  const synced = t.synced_rows || 0;
  const inOffice = (t.present || 0) + (t.late || 0) + (t.half_day || 0);
  const attendance_pct =
    synced > 0 ? Math.round((inOffice / synced) * 1000) / 10 : null;
  const absent_pct =
    synced > 0 ? Math.round(((t.absent || 0) / synced) * 1000) / 10 : null;

  const { rows: byDay } = await query(
    `SELECT
       d.work_date::text AS work_date,
       COUNT(*)::int AS synced_rows,
       COUNT(*) FILTER (WHERE d.status = 'Present')::int AS present,
       COUNT(*) FILTER (WHERE d.status = 'Late')::int AS late,
       COUNT(*) FILTER (WHERE d.status = 'Absent')::int AS absent,
       COUNT(*) FILTER (WHERE d.status = 'On Leave')::int AS on_leave
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.work_date BETWEEN $1::date AND $2::date
       AND ${acl.clause}
     GROUP BY d.work_date
     ORDER BY d.work_date`,
    params
  );

  return {
    label,
    start_date: start,
    end_date: end,
    timezone: 'Asia/Kolkata',
    synced_rows: synced,
    synced_days: t.synced_days || 0,
    employees_with_data: t.employees_with_data || 0,
    present: t.present || 0,
    late: t.late || 0,
    absent: t.absent || 0,
    half_day: t.half_day || 0,
    on_leave: t.on_leave || 0,
    holiday: t.holiday || 0,
    attendance_pct,
    absent_pct,
    by_day: byDay,
    note:
      synced === 0
        ? `No attendance_days rows synced for ${start} → ${end} (IST). That is not the same as 0% attendance.`
        : null,
  };
}

async function getAttendanceComparison(args, scope) {
  const today = await todayIst();
  const periodA = await resolvePeriodBounds(args?.periodA || 'this_week', today);
  const wantsB = args?.periodB != null && String(args.periodB).trim() !== '';
  const periodB = wantsB
    ? await resolvePeriodBounds(args.periodB || 'last_week', today)
    : args?.periodA
      ? null
      : await resolvePeriodBounds('last_week', today);

  const a = await summarizeAttendanceRange(scope, periodA.start, periodA.end, periodA.label);
  const b = periodB
    ? await summarizeAttendanceRange(scope, periodB.start, periodB.end, periodB.label)
    : null;

  let delta = null;
  if (b && a.attendance_pct != null && b.attendance_pct != null) {
    delta = {
      attendance_pct_points: Math.round((a.attendance_pct - b.attendance_pct) * 10) / 10,
      absent_count: a.absent - b.absent,
      late_count: a.late - b.late,
      present_count: a.present - b.present,
      synced_rows: a.synced_rows - b.synced_rows,
    };
  }

  return {
    timezone: 'Asia/Kolkata',
    today_ist: today,
    period_a: a,
    period_b: b,
    delta,
    formula:
      'attendance_pct = (Present + Late + Half Day) / synced attendance_days rows × 100. Unsynced days are excluded, not treated as absent.',
  };
}

async function getEmployeeAttendance(args, scope) {
  const name = args.employeeName || args.name;
  if (!name) return { error: 'employeeName required' };
  const matches = await findEmployeesByName(name, scope, 5);
  if (!matches.length) return { found: false, message: `No employee matching "${name}".` };
  const emp = matches.find((m) => m.name.toLowerCase() === name.toLowerCase()) || matches[0];

  const days = Math.min(Number(args.days) || 14, 90);
  let start = args.startDate;
  let end = args.endDate;
  if (!start || !end) {
    const today = await todayIst();
    end = end || today;
    const d = new Date(end);
    d.setDate(d.getDate() - days);
    start = start || d.toISOString().slice(0, 10);
  }

  const { rows: dayRows } = await query(
    `SELECT work_date, status, first_in, last_out, hours_worked, late_minutes, punch_count
     FROM attendance_days
     WHERE employee_id = $1 AND work_date BETWEEN $2::date AND $3::date
     ORDER BY work_date DESC`,
    [emp.id, start, end]
  );

  const { rows: punches } = await query(
    `SELECT punch_time, punch_type, device_sn
     FROM attendance_punches
     WHERE employee_id = $1 AND punch_time::date BETWEEN $2::date AND $3::date
     ORDER BY punch_time DESC LIMIT 100`,
    [emp.id, start, end]
  );

  const worked = dayRows.filter((d) => ['Present', 'Late', 'Half Day'].includes(d.status)).length;
  const absent = dayRows.filter((d) => d.status === 'Absent').length;
  const late = dayRows.filter((d) => d.status === 'Late').length;

  return {
    found: true,
    employee: {
      name: emp.name,
      email: emp.email,
      role: emp.role,
      department: emp.department,
      shift_start: emp.shift_start || '09:30',
      shift_end: emp.shift_end || '19:00',
      late_after: emp.late_after || emp.shift_start || '09:30',
      shift_label: `${emp.shift_start || '09:30'}–${emp.shift_end || '19:00'} IST`,
    },
    range: { start, end },
    summary: { days_worked: worked, absent, late, records: dayRows.length },
    days: dayRows,
    recent_punches: punches.slice(0, 30),
  };
}

async function getAbsentees(args, scope) {
  const acl = teamEmpFilter(scope, 'e', 3);
  if (acl.clause === 'FALSE') return { absentees: [], total_count: 0, message: 'No team linked.' };

  const today = await todayIst();
  const rangeRaw = String(args?.range || '').toLowerCase();
  const weekFlag =
    String(args?.week || '').toLowerCase() === 'true' ||
    args?.week === true ||
    rangeRaw === 'week' ||
    rangeRaw === 'this_week';
  const lastWeek = rangeRaw === 'last_week';

  let start = args?.startDate;
  let end = args?.endDate;
  let label = 'custom';

  if (weekFlag || lastWeek) {
    const bounds = await resolveWeekBounds(today, lastWeek ? 'last_week' : 'this_week');
    start = bounds.start;
    end = bounds.end;
    label = bounds.label;
  } else if (start && end) {
    label = `${start}_to_${end}`;
  } else if (args?.date) {
    start = args.date;
    end = args.date;
    label = 'day';
  } else {
    start = today;
    end = today;
    label = 'day';
  }

  const params = [start, end, ...acl.params];
  const { rows } = await query(
    `SELECT e.name, e.email, d.work_date::text AS work_date, d.status
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.status = 'Absent'
       AND d.work_date BETWEEN $1::date AND $2::date
       AND ${acl.clause}
     ORDER BY d.work_date DESC, e.name
     LIMIT 500`,
    params
  );

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS c
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.status = 'Absent'
       AND d.work_date BETWEEN $1::date AND $2::date
       AND ${acl.clause}`,
    params
  );
  const total_count = countRows[0]?.c || 0;

  // Unique people absent at least once in range
  const byPerson = new Map();
  for (const r of rows) {
    const key = r.name;
    if (!byPerson.has(key)) byPerson.set(key, { name: r.name, email: r.email, dates: [] });
    byPerson.get(key).dates.push(r.work_date);
  }

  return {
    range: label,
    start_date: start,
    end_date: end,
    timezone: 'Asia/Kolkata',
    absentees: rows,
    by_person: [...byPerson.values()],
    count: rows.length,
    total_count,
    unique_people: byPerson.size,
    truncated: total_count > rows.length,
    note:
      total_count === 0
        ? `No Absent rows synced for ${start} → ${end}. If unexpected, sync Attendance — not the same as inventing absentees.`
        : null,
  };
}

async function getLoginTiming(args, scope) {
  const date = args.date || (await todayIst());
  const name = args.employeeName || args.name;

  if (name) {
    const matches = await findEmployeesByName(name, scope, 3);
    if (!matches.length) return { found: false, message: `No employee matching "${name}".` };
    const emp = matches[0];
    const { rows } = await query(
      `SELECT work_date, status, first_in, last_out, late_minutes, hours_worked
       FROM attendance_days WHERE employee_id = $1 AND work_date = $2::date`,
      [emp.id, date]
    );
    const { rows: punches } = await query(
      `SELECT punch_time, punch_type FROM attendance_punches
       WHERE employee_id = $1 AND (punch_time AT TIME ZONE 'Asia/Kolkata')::date = $2::date
       ORDER BY punch_time ASC`,
      [emp.id, date]
    );
    return {
      found: true,
      employee: emp.name,
      shift_start: emp.shift_start || '09:30',
      shift_end: emp.shift_end || '19:00',
      late_after: emp.late_after || emp.shift_start || '09:30',
      date,
      day: rows[0] || null,
      punches,
      note: rows[0] ? null : 'No attendance record for this date.',
    };
  }

  const acl = teamEmpFilter(scope, 'e', 2);
  if (acl.clause === 'FALSE') return { date, timings: [] };
  const params = [date, ...acl.params];
  const { rows } = await query(
    `SELECT e.name, e.shift_start, e.shift_end, e.late_after,
            d.status, d.first_in, d.late_minutes, d.last_out
     FROM attendance_days d
     JOIN employees e ON e.id = d.employee_id
     WHERE d.work_date = $1::date AND ${acl.clause}
     ORDER BY d.first_in NULLS LAST, e.name`,
    params
  );
  return {
    date,
    timezone: 'Asia/Kolkata',
    note: 'Late minutes are vs each employee late_after (default 09:30 IST).',
    timings: rows.map((r) => ({
      ...r,
      shift: `${r.shift_start || '09:30'}–${r.shift_end || '19:00'}`,
      late_after: r.late_after || r.shift_start || '09:30',
    })),
    count: rows.length,
  };
}

async function getPerformanceReport(args, scope) {
  const days = Math.min(Number(args.days) || 7, 60);
  const today = await todayIst();
  const name = args.employeeName || args.name;

  if (name) {
    const matches = await findEmployeesByName(name, scope, 3);
    if (!matches.length) return { found: false, message: `No employee matching "${name}".` };
    const emp = matches[0];
    const { rows } = await query(
      `SELECT work_date, open_tasks, done_tasks, eod_submitted, attendance_status, blockers_flag, score
       FROM employee_performance_daily
       WHERE employee_id = $1 AND work_date >= ($2::date - ($3::int || ' days')::interval)
       ORDER BY work_date DESC`,
      [emp.id, today, days]
    );
    const avg =
      rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.score || 0), 0) / rows.length) : null;
    return {
      found: true,
      employee: emp.name,
      days,
      average_score: avg,
      daily: rows,
      note: rows.length ? null : 'No performance cache yet — run attendance sync.',
    };
  }

  const acl = teamEmpFilter(scope, 'e', 3);
  if (acl.clause === 'FALSE') return { team: [] };
  const params = [today, days, ...acl.params];
  const { rows } = await query(
    `SELECT e.name,
            ROUND(AVG(p.score))::int AS avg_score,
            COUNT(*)::int AS days_scored,
            SUM(CASE WHEN p.attendance_status = 'Absent' THEN 1 ELSE 0 END)::int AS absent_days,
            SUM(CASE WHEN p.eod_submitted THEN 1 ELSE 0 END)::int AS eod_days
     FROM employee_performance_daily p
     JOIN employees e ON e.id = p.employee_id
     WHERE p.work_date >= ($1::date - ($2::int || ' days')::interval)
       AND ${acl.clause}
     GROUP BY e.id, e.name
     ORDER BY avg_score DESC NULLS LAST
     LIMIT 50`,
    params
  );
  return { days, team: rows };
}

async function getWorkedDaysSummary(args, scope) {
  const name = args.employeeName || args.name;
  if (!name) return { error: 'employeeName required' };
  const matches = await findEmployeesByName(name, scope, 3);
  if (!matches.length) return { found: false, message: `No employee matching "${name}".` };
  const emp = matches[0];

  const today = await todayIst();
  let year = Number(args.year) || Number(today.slice(0, 4));
  let month = args.month;
  if (!month) month = today.slice(0, 7);
  else if (/^\d{1,2}$/.test(String(month))) {
    month = `${year}-${String(month).padStart(2, '0')}`;
  } else if (/^\d{4}-\d{2}$/.test(String(month))) {
    year = Number(String(month).slice(0, 4));
  }

  const { rows } = await query(
    `SELECT status, COUNT(*)::int AS c
     FROM attendance_days
     WHERE employee_id = $1 AND to_char(work_date, 'YYYY-MM') = $2
     GROUP BY status`,
    [emp.id, month]
  );
  const map = Object.fromEntries(rows.map((r) => [r.status, r.c]));
  const worked = (map.Present || 0) + (map.Late || 0) + (map['Half Day'] || 0);

  return {
    found: true,
    employee: emp.name,
    month,
    days_worked: worked,
    present: map.Present || 0,
    late: map.Late || 0,
    half_day: map['Half Day'] || 0,
    absent: map.Absent || 0,
    on_leave: map['On Leave'] || 0,
    holiday: map.Holiday || 0,
    by_status: map,
  };
}

async function getDailyBriefing(scope) {
  const today = await todayIst();
  const attendance = await getAttendanceToday(scope);
  const team = await getTeamSummary(scope);
  const missing = await getMissingEODs(today, scope);
  const missingEod = missing.missing_eods || [];

  const istHour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hour12: false,
    }).format(new Date())
  );
  const partOfDay = istHour < 12 ? 'morning' : istHour < 17 ? 'afternoon' : 'evening';

  return {
    date: today,
    timezone: 'Asia/Kolkata',
    part_of_day: partOfDay,
    attendance: attendance.counts,
    absentees: attendance.absent || [],
    late_arrivals: attendance.late || [],
    present_sample: (attendance.present || []).slice(0, 20),
    missing_eods: missingEod,
    missing_eod_count: missing.total_count ?? missingEod.length,
    missing_eod_truncated: Boolean(missing.truncated),
    overdue_tasks: team.overdue_tasks || [],
    overdue_count: (team.overdue_tasks || []).length,
    open_tasks: team.open_tasks,
    interviews_today: team.interviews_today || [],
    interview_count: (team.interviews_today || []).length,
    eods_submitted_today: team.eod_submitted_count || 0,
    attention_priority: {
      absent_with_overdue: (attendance.absent || [])
        .filter((a) =>
          (team.overdue_tasks || []).some(
            (t) => t.employee_name?.toLowerCase() === a.name?.toLowerCase()
          )
        )
        .map((a) => a.name),
      late_names: (attendance.late || []).map(
        (r) =>
          `${r.name} (in ${r.first_in ? new Date(r.first_in).toISOString() : '—'}, ${r.late_minutes || 0}m after ${r.late_after || r.shift_start || '09:30'})`
      ),
      missing_eod_names: missingEod.map((m) => m.name),
    },
  };
}

async function getEmployeeFullProfile(name, scope) {
  if (!name) return { error: 'employeeName required' };
  const status = await getEmployeeStatus(name, scope);
  if (!status.found) return status;

  const matches = await findEmployeesByName(name, scope, 3);
  const emp = matches.find((m) => m.name.toLowerCase() === name.toLowerCase()) || matches[0];
  if (!emp) return status;

  const today = await todayIst();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const weekStart = weekAgo.toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  const [weekAtt, monthSummary, perf] = await Promise.all([
    query(
      `SELECT work_date, status, first_in, last_out, late_minutes, hours_worked
       FROM attendance_days
       WHERE employee_id = $1 AND work_date BETWEEN $2::date AND $3::date
       ORDER BY work_date DESC`,
      [emp.id, weekStart, today]
    ),
    query(
      `SELECT status, COUNT(*)::int AS c
       FROM attendance_days
       WHERE employee_id = $1 AND to_char(work_date, 'YYYY-MM') = $2
       GROUP BY status`,
      [emp.id, month]
    ),
    query(
      `SELECT work_date, score, attendance_status, eod_submitted, open_tasks, done_tasks, blockers_flag
       FROM employee_performance_daily
       WHERE employee_id = $1 AND work_date >= $2::date
       ORDER BY work_date DESC LIMIT 7`,
      [emp.id, weekStart]
    ),
  ]);

  const monthMap = Object.fromEntries(monthSummary.rows.map((r) => [r.status, r.c]));
  const daysWorked =
    (monthMap.Present || 0) + (monthMap.Late || 0) + (monthMap['Half Day'] || 0);
  const avgScore =
    perf.rows.length > 0
      ? Math.round(perf.rows.reduce((s, r) => s + (r.score || 0), 0) / perf.rows.length)
      : null;

  return {
    ...status,
    profile: 'full',
    week_attendance: weekAtt.rows,
    month: month,
    month_summary: {
      days_worked: daysWorked,
      present: monthMap.Present || 0,
      late: monthMap.Late || 0,
      half_day: monthMap['Half Day'] || 0,
      absent: monthMap.Absent || 0,
      on_leave: monthMap['On Leave'] || 0,
      by_status: monthMap,
    },
    performance_last_7_days: perf.rows,
    average_score_7d: avgScore,
    health_flags: {
      absent_today: status.attendance_today?.status === 'Absent',
      late_today: status.attendance_today?.status === 'Late',
      missing_eod_today: !status.eod_submitted_today,
      has_overdue_tasks: (status.overdue_count || 0) > 0,
      has_blockers: Boolean(
        status.latest_eod?.blockers &&
          JSON.stringify(status.latest_eod.blockers) !== '[]' &&
          JSON.stringify(status.latest_eod.blockers) !== 'null'
      ),
    },
  };
}
