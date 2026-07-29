import { query } from '../config/db.js';
import { apiFetch, loginAts } from './http.js';

async function fetchAllPages(baseUrl, path, token, { limit = 100 } = {}) {
  const items = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await apiFetch(baseUrl, `${path}${sep}page=${page}&limit=${limit}`, { token });
    const batch = data.data || data.items || (Array.isArray(data) ? data : []);
    items.push(...batch);
    totalPages = data.pagination?.totalPages || data.totalPages || 1;
    if (!batch.length) break;
    page += 1;
    if (page > 50) break; // safety
  }

  return items;
}

export async function syncAts() {
  const baseUrl = process.env.ATS_URL;
  const email = process.env.ATS_EMAIL;
  const password = process.env.ATS_PASSWORD;

  if (!baseUrl || !email || !password) {
    throw new Error('ATS_URL / ATS_EMAIL / ATS_PASSWORD required');
  }

  const { token } = await loginAts(baseUrl, email, password);
  const stats = { jobs: 0, candidates: 0, applications: 0, interviews: 0 };

  // Jobs
  const jobs = await fetchAllPages(baseUrl, '/jobs', token);
  const jobIdByExternal = new Map();
  for (const job of jobs) {
    const { rows } = await query(
      `INSERT INTO jobs (external_id, title, department, location, is_active, openings_count, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         title = EXCLUDED.title,
         department = EXCLUDED.department,
         location = EXCLUDED.location,
         is_active = EXCLUDED.is_active,
         openings_count = EXCLUDED.openings_count,
         raw = EXCLUDED.raw,
         synced_at = NOW()
       RETURNING id`,
      [
        String(job.id),
        job.title || 'Untitled',
        job.department || null,
        job.location || null,
        job.isActive !== false && job.is_active !== false,
        job.openingsCount ?? job.openings_count ?? null,
        JSON.stringify(job),
      ]
    );
    jobIdByExternal.set(String(job.id), rows[0].id);
    stats.jobs += 1;
  }

  // Candidates
  const candidates = await fetchAllPages(baseUrl, '/candidates', token);
  const candidateIdByExternal = new Map();
  for (const c of candidates) {
    const { rows } = await query(
      `INSERT INTO candidates (external_id, name, email, phone, status, category, source, current_company, raw, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (external_id) DO UPDATE SET
         name = EXCLUDED.name,
         email = EXCLUDED.email,
         phone = EXCLUDED.phone,
         status = EXCLUDED.status,
         category = EXCLUDED.category,
         source = EXCLUDED.source,
         current_company = EXCLUDED.current_company,
         raw = EXCLUDED.raw,
         synced_at = NOW()
       RETURNING id`,
      [
        String(c.id),
        c.fullName || c.name || 'Unknown',
        c.email || null,
        c.phone || null,
        c.status || null,
        c.category || null,
        c.source || null,
        c.currentCompany || c.current_company || null,
        JSON.stringify(c),
      ]
    );
    candidateIdByExternal.set(String(c.id), rows[0].id);
    stats.candidates += 1;

    // Applications nested on candidate list
    const apps = c.applications || [];
    for (const app of apps) {
      const jobExt = app.jobId || app.job_id || app.job?.id;
      await query(
        `INSERT INTO applications (
           external_id, candidate_id, candidate_external_id, job_id, job_external_id,
           job_title, status, stage_name, shortlisted, raw, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (external_id) DO UPDATE SET
           candidate_id = EXCLUDED.candidate_id,
           job_id = EXCLUDED.job_id,
           job_external_id = EXCLUDED.job_external_id,
           job_title = EXCLUDED.job_title,
           status = EXCLUDED.status,
           stage_name = EXCLUDED.stage_name,
           shortlisted = EXCLUDED.shortlisted,
           raw = EXCLUDED.raw,
           synced_at = NOW()`,
        [
          String(app.id),
          rows[0].id,
          String(c.id),
          jobExt ? jobIdByExternal.get(String(jobExt)) || null : null,
          jobExt ? String(jobExt) : null,
          app.job?.title || app.job_title || null,
          app.status || null,
          app.currentStage?.name || app.current_stage?.name || app.stage_name || null,
          Boolean(app.shortlisted),
          JSON.stringify(app),
        ]
      );
      stats.applications += 1;
    }
  }

  // Full applications list (may have more fields / job titles)
  try {
    const applications = await fetchAllPages(baseUrl, '/applications', token);
    for (const app of applications) {
      const candExt = app.candidateId || app.candidate_id || app.candidate?.id;
      const jobExt = app.jobId || app.job_id || app.job?.id;
      const candId = candExt ? candidateIdByExternal.get(String(candExt)) : null;
      if (!candId) continue;

      await query(
        `INSERT INTO applications (
           external_id, candidate_id, candidate_external_id, job_id, job_external_id,
           job_title, status, stage_name, shortlisted, raw, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (external_id) DO UPDATE SET
           candidate_id = EXCLUDED.candidate_id,
           job_id = EXCLUDED.job_id,
           job_external_id = EXCLUDED.job_external_id,
           job_title = COALESCE(EXCLUDED.job_title, applications.job_title),
           status = EXCLUDED.status,
           stage_name = COALESCE(EXCLUDED.stage_name, applications.stage_name),
           shortlisted = EXCLUDED.shortlisted,
           raw = EXCLUDED.raw,
           synced_at = NOW()`,
        [
          String(app.id),
          candId,
          candExt ? String(candExt) : null,
          jobExt ? jobIdByExternal.get(String(jobExt)) || null : null,
          jobExt ? String(jobExt) : null,
          app.job?.title || app.job_title || null,
          app.status || null,
          app.currentStage?.name || app.current_stage?.name || null,
          Boolean(app.shortlisted),
          JSON.stringify(app),
        ]
      );
      stats.applications += 1;
    }
  } catch (err) {
    console.warn('[sync:ats] applications:', err.message);
  }

  // Interviews
  try {
    const interviews = await fetchAllPages(baseUrl, '/interviews', token, { limit: 100 });
    for (const iv of interviews) {
      const appExt = iv.applicationId || iv.application_id || iv.application?.id;
      let candidateId = null;
      let candidateName = iv.candidate?.fullName || iv.candidateName || iv.candidate_name || null;
      let jobTitle = iv.job?.title || iv.jobTitle || iv.job_title || null;
      let applicationId = null;

      if (appExt) {
        const { rows: appRows } = await query(
          `SELECT id, candidate_id, job_title FROM applications WHERE external_id = $1`,
          [String(appExt)]
        );
        if (appRows[0]) {
          applicationId = appRows[0].id;
          candidateId = appRows[0].candidate_id;
          jobTitle = jobTitle || appRows[0].job_title;
        }
      }

      if (candidateId && !candidateName) {
        const { rows: cRows } = await query(`SELECT name FROM candidates WHERE id = $1`, [candidateId]);
        candidateName = cRows[0]?.name || null;
      }

      const interviewers = iv.interviewers || [];
      const interviewerNames = interviewers.map(
        (u) => u.fullName || u.name || u.email || 'Interviewer'
      );

      await query(
        `INSERT INTO interviews (
           external_id, application_id, candidate_id, candidate_name, job_title,
           scheduled_start, scheduled_end, mode, result, round_no, round_label,
           interviewer_names, meeting_link, raw, synced_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
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
           raw = EXCLUDED.raw,
           synced_at = NOW()`,
        [
          String(iv.id),
          applicationId,
          candidateId,
          candidateName,
          jobTitle,
          iv.scheduledStart || iv.scheduled_start || null,
          iv.scheduledEnd || iv.scheduled_end || null,
          iv.mode || null,
          iv.result || null,
          iv.roundNo ?? iv.round_no ?? null,
          iv.round || iv.round_label || null,
          interviewerNames,
          iv.meetingLink || iv.meeting_link || null,
          JSON.stringify(iv),
        ]
      );
      stats.interviews += 1;
    }
  } catch (err) {
    console.warn('[sync:ats] interviews:', err.message);
  }

  return stats;
}
