import { query } from '../config/db.js';

/**
 * Access scope for a manager.
 *
 * ADMIN → unrestricted (all hub data).
 * MANAGER → only rows reachable via manager_teams / manager_candidate_access.
 * Legacy manager_team_links with scope ALL still grants unrestricted.
 *
 * AI tools MUST use this — never trust LLM args for managerId.
 */
export async function getManagerScope(manager) {
  if (manager.role === 'ADMIN') {
    return {
      unrestricted: true,
      managerId: manager.id,
      employeeIds: null,
      candidateIds: null,
      teamIds: null,
      atsAll: true,
    };
  }

  const { rows: links } = await query(
    `SELECT sprintboard_team_id, scope FROM manager_team_links WHERE manager_id = $1`,
    [manager.id]
  );

  if (links.some((r) => r.scope === 'ALL')) {
    return {
      unrestricted: true,
      managerId: manager.id,
      employeeIds: null,
      candidateIds: null,
      teamIds: null,
      atsAll: true,
    };
  }

  const { rows: teamRows } = await query(
    `SELECT employee_id FROM manager_teams WHERE manager_id = $1`,
    [manager.id]
  );
  const employeeIds = teamRows.map((r) => r.employee_id);

  const { rows: candRows } = await query(
    `SELECT candidate_id FROM manager_candidate_access WHERE manager_id = $1`,
    [manager.id]
  );
  let candidateIds = candRows.map((r) => r.candidate_id);

  const teamIds = links
    .filter((r) => r.scope === 'TEAM' && r.sprintboard_team_id)
    .map((r) => r.sprintboard_team_id);

  // If only team links exist (no manager_teams rows yet), fall back to team_ids on employees
  if (!employeeIds.length && teamIds.length) {
    const { rows: empFromTeams } = await query(
      `SELECT id FROM employees WHERE team_ids && $1::text[]`,
      [teamIds]
    );
    return {
      unrestricted: false,
      managerId: manager.id,
      employeeIds: empFromTeams.map((r) => r.id),
      candidateIds: candidateIds.length ? candidateIds : [],
      teamIds,
      atsAll: links.some((r) => r.scope === 'ATS_ALL'),
      viaTeamIds: true,
    };
  }

  // Deny-by-default: ATS only if explicit ATS_ALL link or candidate ACL rows
  const atsAll = links.some((r) => r.scope === 'ATS_ALL');

  return {
    unrestricted: false,
    managerId: manager.id,
    employeeIds,
    candidateIds: candidateIds.length ? candidateIds : [],
    teamIds,
    atsAll,
  };
}

/** SQL fragment for candidate ACL (deny-by-default for non-admin). */
export function candidateAclClause(scope, alias = 'c', paramStart = 1) {
  if (scope.unrestricted || scope.atsAll) {
    return { clause: 'TRUE', params: [], nextParam: paramStart };
  }
  if (!scope.candidateIds?.length) {
    return { clause: 'FALSE', params: [], nextParam: paramStart };
  }
  return {
    clause: `${alias}.id = ANY($${paramStart}::uuid[])`,
    params: [scope.candidateIds],
    nextParam: paramStart + 1,
  };
}

/** SQL fragment: employee must be on this manager's team (or unrestricted). */
export function employeeAclClause(scope, alias = 'e', paramStart = 1) {
  if (scope.unrestricted) {
    return { clause: 'TRUE', params: [], nextParam: paramStart };
  }
  if (!scope.employeeIds?.length) {
    return { clause: 'FALSE', params: [], nextParam: paramStart };
  }
  return {
    clause: `${alias}.id = ANY($${paramStart}::uuid[])`,
    params: [scope.employeeIds],
    nextParam: paramStart + 1,
  };
}

/** Ensure every synced employee is visible to ADMIN managers (bootstrap ACL). */
export async function ensureAdminTeamCoverage() {
  await query(`
    INSERT INTO manager_teams (manager_id, employee_id)
    SELECT m.id, e.id
    FROM managers m
    CROSS JOIN employees e
    WHERE m.role = 'ADMIN' AND m.is_active = TRUE
    ON CONFLICT DO NOTHING
  `);
}

export async function linkEmployeeToManagersByTeam(employeeId, teamIds = []) {
  if (!teamIds?.length) return;
  // Managers with TEAM scope matching any of these sprintboard team ids
  await query(
    `
    INSERT INTO manager_teams (manager_id, employee_id)
    SELECT DISTINCT mtl.manager_id, $1::uuid
    FROM manager_team_links mtl
    WHERE mtl.scope = 'TEAM' AND mtl.sprintboard_team_id = ANY($2::text[])
    ON CONFLICT DO NOTHING
    `,
    [employeeId, teamIds.map(String)]
  );
  // Also all ADMIN managers
  await query(
    `
    INSERT INTO manager_teams (manager_id, employee_id)
    SELECT m.id, $1::uuid FROM managers m WHERE m.role = 'ADMIN' AND m.is_active = TRUE
    ON CONFLICT DO NOTHING
    `,
    [employeeId]
  );
}
