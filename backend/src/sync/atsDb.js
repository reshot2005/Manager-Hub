import { query } from '../config/db.js';
import { getAtsPool, sourceQuery } from './sourcePools.js';

/**
 * Fast read-only sync: ATS production Postgres (Neon, Prisma camelCase) → hub DB.
 * Source columns use quoted camelCase: "isActive", "fullName", "candidateId", etc.
 */
export async function syncAtsFromDb() {
  const pool = getAtsPool();
  if (!pool) throw new Error('ATS_DATABASE_URL not set');

  const stats = { jobs: 0, candidates: 0, applications: 0, interviews: 0 };

  const { rows: jobs } = await sourceQuery(
    pool,
    `SELECT id::text AS id,
            title,
            department,
            location,
            "isActive" AS is_active,
            "openingsCount" AS openings_count
     FROM jobs`
  );
  const jobIdByExternal = new Map();
  for (const job of jobs) {
    const { rows } = await query(
      `INSERT INTO jobs (external_id, title, department, location, is_active, openings_count, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         title = EXCLUDED.title,
         department = EXCLUDED.department,
         location = EXCLUDED.location,
         is_active = EXCLUDED.is_active,
         openings_count = EXCLUDED.openings_count,
         synced_at = NOW()
       RETURNING id`,
      [
        job.id,
        job.title,
        job.department,
        job.location,
        job.is_active !== false,
        job.openings_count,
      ]
    );
    jobIdByExternal.set(job.id, rows[0].id);
    stats.jobs += 1;
  }

  const { rows: candidates } = await sourceQuery(
    pool,
    `SELECT id::text AS id,
            "fullName" AS full_name,
            email,
            phone,
            status::text AS status,
            category,
            source,
            "currentCompany" AS current_company
     FROM candidates
     WHERE COALESCE("isDeleted", FALSE) = FALSE`
  );
  const candidateIdByExternal = new Map();
  for (const c of candidates) {
    const { rows } = await query(
      `INSERT INTO candidates (external_id, name, email, phone, status, category, source, current_company, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         status = EXCLUDED.status,
         category = EXCLUDED.category,
         source = EXCLUDED.source,
         current_company = EXCLUDED.current_company,
         synced_at = NOW()
       RETURNING id`,
      [
        c.id,
        c.full_name || 'Unknown',
        c.email,
        c.phone,
        c.status,
        c.category,
        c.source,
        c.current_company,
      ]
    );
    candidateIdByExternal.set(c.id, rows[0].id);
    stats.candidates += 1;
  }

  await query(`
    INSERT INTO manager_candidate_access (manager_id, candidate_id)
    SELECT m.id, c.id FROM managers m
    CROSS JOIN candidates c
    WHERE m.role = 'ADMIN' AND m.is_active = TRUE
    ON CONFLICT DO NOTHING
  `);

  const { rows: applications } = await sourceQuery(
    pool,
    `SELECT a.id::text AS id,
            a."candidateId"::text AS candidate_id,
            a."jobId"::text AS job_id,
            a.status::text AS status,
            a.shortlisted,
            j.title AS job_title,
            ps.name AS stage_name
     FROM applications a
     LEFT JOIN jobs j ON j.id = a."jobId"
     LEFT JOIN pipeline_stages ps ON ps.id = a."currentStageId"
     WHERE COALESCE(a."isDeleted", FALSE) = FALSE`
  );

  for (const app of applications) {
    const candId = candidateIdByExternal.get(app.candidate_id);
    if (!candId) continue;
    await query(
      `INSERT INTO applications (
         external_id, candidate_id, candidate_external_id, job_id, job_external_id,
         job_title, status, stage_name, shortlisted, synced_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         candidate_id = EXCLUDED.candidate_id,
         job_id = EXCLUDED.job_id,
         job_external_id = EXCLUDED.job_external_id,
         job_title = EXCLUDED.job_title,
         status = EXCLUDED.status,
         stage_name = EXCLUDED.stage_name,
         shortlisted = EXCLUDED.shortlisted,
         synced_at = NOW()`,
      [
        app.id,
        candId,
        app.candidate_id,
        app.job_id ? jobIdByExternal.get(app.job_id) || null : null,
        app.job_id,
        app.job_title,
        app.status,
        app.stage_name,
        Boolean(app.shortlisted),
      ]
    );
    stats.applications += 1;
  }

  const { rows: interviews } = await sourceQuery(
    pool,
    `SELECT i.id::text AS id,
            i."applicationId"::text AS application_id,
            i."candidateId"::text AS candidate_id,
            i."candidateName" AS candidate_name,
            i."jobTitle" AS job_title,
            i."scheduledStart" AS scheduled_start,
            i."durationMinutes" AS duration_minutes,
            i.mode::text AS mode,
            i.result::text AS result,
            i."roundNo" AS round_no,
            i.round,
            i."meetingLink" AS meeting_link,
            i."interviewerNames" AS interviewer_names
     FROM interviews i
     WHERE i."scheduledStart" > NOW() - INTERVAL '90 days'
        OR i."scheduledStart" IS NULL
     ORDER BY i."scheduledStart" DESC NULLS LAST
     LIMIT 10000`
  );

  for (const iv of interviews) {
    let applicationId = null;
    let candidateId = iv.candidate_id
      ? candidateIdByExternal.get(iv.candidate_id) || null
      : null;

    if (iv.application_id) {
      const { rows: appRows } = await query(
        `SELECT id, candidate_id FROM applications WHERE external_id = $1`,
        [iv.application_id]
      );
      if (appRows[0]) {
        applicationId = appRows[0].id;
        candidateId = candidateId || appRows[0].candidate_id;
      }
    }

    let interviewerNames = [];
    if (Array.isArray(iv.interviewer_names)) {
      interviewerNames = iv.interviewer_names;
    } else if (typeof iv.interviewer_names === 'string' && iv.interviewer_names.trim()) {
      try {
        const parsed = JSON.parse(iv.interviewer_names);
        interviewerNames = Array.isArray(parsed)
          ? parsed
          : iv.interviewer_names.split(',').map((s) => s.trim()).filter(Boolean);
      } catch {
        interviewerNames = iv.interviewer_names.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    let scheduledEnd = null;
    if (iv.scheduled_start && iv.duration_minutes) {
      scheduledEnd = new Date(
        new Date(iv.scheduled_start).getTime() + Number(iv.duration_minutes) * 60_000
      );
    }

    await query(
      `INSERT INTO interviews (
         external_id, application_id, candidate_id, candidate_name, job_title,
         scheduled_start, scheduled_end, mode, result, round_no, round_label,
         interviewer_names, meeting_link, synced_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         application_id = EXCLUDED.application_id,
         candidate_id = EXCLUDED.candidate_id,
         candidate_name = EXCLUDED.candidate_name,
         job_title = EXCLUDED.job_title,
         scheduled_start = EXCLUDED.scheduled_start,
         scheduled_end = EXCLUDED.scheduled_end,
         mode = EXCLUDED.mode,
         result = EXCLUDED.result,
         round_no = EXCLUDED.round_no,
         round_label = EXCLUDED.round_label,
         interviewer_names = EXCLUDED.interviewer_names,
         meeting_link = EXCLUDED.meeting_link,
         synced_at = NOW()`,
      [
        iv.id,
        applicationId,
        candidateId,
        iv.candidate_name,
        iv.job_title,
        iv.scheduled_start,
        scheduledEnd,
        iv.mode,
        iv.result,
        iv.round_no,
        iv.round,
        interviewerNames,
        iv.meeting_link,
      ]
    );
    stats.interviews += 1;
  }

  return { mode: 'database', ...stats };
}
