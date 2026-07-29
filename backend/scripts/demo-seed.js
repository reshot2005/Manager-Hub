import dotenv from 'dotenv';
import { query } from '../src/config/db.js';

dotenv.config();

/**
 * Inserts sample employees / tasks / EODs / candidates so chat tools
 * can be exercised without Sprintboard/ATS being online.
 */
async function demoSeed() {
  await query(
    `INSERT INTO employees (external_id, name, email, role, team_ids, department)
     VALUES
       ('demo-emp-jeevan', 'Jeevan Kumar', 'jeevan@company.local', 'Member', ARRAY['demo-team-1'], 'Engineering'),
       ('demo-emp-priya', 'Priya Sharma', 'priya@company.local', 'Member', ARRAY['demo-team-1'], 'Engineering'),
       ('demo-emp-arun', 'Arun Patel', 'arun@company.local', 'Team Lead', ARRAY['demo-team-1'], 'Engineering')
     ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, synced_at = NOW()`
  );

  const { rows: emps } = await query(
    `SELECT id, external_id, name FROM employees WHERE external_id LIKE 'demo-emp-%'`
  );
  const byExt = Object.fromEntries(emps.map((e) => [e.external_id, e]));

  await query(
    `INSERT INTO tasks (external_id, employee_id, assignee_external_id, title, status, priority, due_date, team_id, project_name, updated_at)
     VALUES
       ('demo-task-1', $1, 'demo-emp-jeevan', 'Finish onboarding dashboard API', 'In Progress', 'High', CURRENT_DATE + 2, 'demo-team-1', 'Manager Hub', NOW()),
       ('demo-task-2', $1, 'demo-emp-jeevan', 'Write EOD automation tests', 'To Do', 'Medium', CURRENT_DATE + 5, 'demo-team-1', 'Manager Hub', NOW()),
       ('demo-task-3', $2, 'demo-emp-priya', 'ATS interview calendar polish', 'Review', 'High', CURRENT_DATE, 'demo-team-1', 'ATS', NOW()),
       ('demo-task-4', $3, 'demo-emp-arun', 'Sprint planning for next week', 'Done', 'Medium', CURRENT_DATE - 1, 'demo-team-1', 'Sprintboard', NOW())
     ON CONFLICT (external_id) DO UPDATE SET
       title = EXCLUDED.title, status = EXCLUDED.status, employee_id = EXCLUDED.employee_id, synced_at = NOW()`,
    [byExt['demo-emp-jeevan'].id, byExt['demo-emp-priya'].id, byExt['demo-emp-arun'].id]
  );

  await query(
    `INSERT INTO eod_reports (external_id, employee_id, employee_external_id, report_date, status, achievements, tasks_data, blockers_data, working_mode, submitted_at)
     VALUES
       ('demo-eod-1', $1, 'demo-emp-jeevan', (NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'Submitted',
        'Completed auth middleware and started dashboard API endpoints. Synced sample Sprintboard tasks.',
        '[{"title":"Finish onboarding dashboard API","progress":"60%"}]'::jsonb,
        '[{"blocker":"Waiting on Gemini API key for chat QA"}]'::jsonb,
        'Office', NOW()),
       ('demo-eod-2', $2, 'demo-emp-priya', (NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'Submitted',
        'Polished interview list UI and fixed timezone display bugs.',
        '[{"title":"ATS interview calendar polish","progress":"in review"}]'::jsonb,
        '[]'::jsonb, 'Office', NOW())
     ON CONFLICT (external_id) DO UPDATE SET
       report_date = EXCLUDED.report_date,
       achievements = EXCLUDED.achievements, status = EXCLUDED.status, synced_at = NOW()`,
    [byExt['demo-emp-jeevan'].id, byExt['demo-emp-priya'].id]
  );

  await query(
    `INSERT INTO jobs (external_id, title, department, location, is_active, openings_count)
     VALUES ('demo-job-1', 'Full Stack Engineer', 'Engineering', 'Remote', TRUE, 2)
     ON CONFLICT (external_id) DO UPDATE SET title = EXCLUDED.title`
  );
  const { rows: jobs } = await query(`SELECT id FROM jobs WHERE external_id = 'demo-job-1'`);

  await query(
    `INSERT INTO candidates (external_id, name, email, phone, status, category, current_company)
     VALUES
       ('demo-cand-1', 'Sneha Reddy', 'sneha@example.com', '9999900001', 'ACTIVE', 'Company', 'Acme Corp'),
       ('demo-cand-2', 'Rahul Mehta', 'rahul@example.com', '9999900002', 'ACTIVE', 'Company', 'Globex')
     ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name`
  );
  const { rows: cands } = await query(
    `SELECT id, external_id FROM candidates WHERE external_id LIKE 'demo-cand-%'`
  );
  const cByExt = Object.fromEntries(cands.map((c) => [c.external_id, c]));

  await query(
    `INSERT INTO applications (external_id, candidate_id, candidate_external_id, job_id, job_external_id, job_title, status, stage_name, shortlisted)
     VALUES
       ('demo-app-1', $1, 'demo-cand-1', $3, 'demo-job-1', 'Full Stack Engineer', 'IN_PIPELINE', 'Interview', TRUE),
       ('demo-app-2', $2, 'demo-cand-2', $3, 'demo-job-1', 'Full Stack Engineer', 'IN_PIPELINE', 'Screening', FALSE)
     ON CONFLICT (external_id) DO UPDATE SET stage_name = EXCLUDED.stage_name, status = EXCLUDED.status`,
    [cByExt['demo-cand-1'].id, cByExt['demo-cand-2'].id, jobs[0].id]
  );

  const { rows: apps } = await query(`SELECT id FROM applications WHERE external_id = 'demo-app-1'`);

  await query(
    `INSERT INTO interviews (
       external_id, application_id, candidate_id, candidate_name, job_title,
       scheduled_start, scheduled_end, mode, result, round_no, round_label, interviewer_names
     ) VALUES (
       'demo-iv-1', $1, $2, 'Sneha Reddy', 'Full Stack Engineer',
       date_trunc('day', NOW()) + interval '15 hours',
       date_trunc('day', NOW()) + interval '16 hours',
       'ONLINE', 'PENDING', 1, 'Technical', ARRAY['Arun Patel']
     )
     ON CONFLICT (external_id) DO UPDATE SET scheduled_start = EXCLUDED.scheduled_start`,
    [apps[0].id, cByExt['demo-cand-1'].id]
  );

  // ACL: every manager (esp. ADMIN) can see demo employees
  await query(`
    INSERT INTO manager_teams (manager_id, employee_id)
    SELECT m.id, e.id
    FROM managers m
    CROSS JOIN employees e
    WHERE e.external_id LIKE 'demo-emp-%'
    ON CONFLICT DO NOTHING
  `);

  await query(`
    INSERT INTO manager_candidate_access (manager_id, candidate_id)
    SELECT m.id, c.id
    FROM managers m
    CROSS JOIN candidates c
    WHERE c.external_id LIKE 'demo-cand-%'
    ON CONFLICT DO NOTHING
  `);

  console.log('Demo data seeded (Jeevan, Priya, Arun, Sneha, Rahul) + manager_teams ACL.');
  process.exit(0);
}

demoSeed().catch((err) => {
  console.error(err);
  process.exit(1);
});
