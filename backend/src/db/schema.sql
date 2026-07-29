-- Manager AI Hub schema (create order respects FKs)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS managers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'MANAGER' CHECK (role IN ('MANAGER', 'ADMIN')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manager_team_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  sprintboard_team_id TEXT,
  scope TEXT NOT NULL DEFAULT 'ALL' CHECK (scope IN ('ALL', 'TEAM', 'ATS_ALL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (manager_id, sprintboard_team_id, scope)
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  team_ids TEXT[] NOT NULL DEFAULT '{}',
  department TEXT,
  shift_start TEXT DEFAULT '09:30',
  shift_end TEXT DEFAULT '19:00',
  late_after TEXT DEFAULT '09:30',
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  assignee_external_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT,
  priority TEXT,
  due_date DATE,
  team_id TEXT,
  project_name TEXT,
  updated_at TIMESTAMPTZ,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_employee ON tasks(employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks(team_id);

CREATE TABLE IF NOT EXISTS eod_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  employee_external_id TEXT,
  report_date DATE NOT NULL,
  status TEXT,
  achievements TEXT,
  tasks_data JSONB,
  pending_tasks_data JSONB,
  blockers_data JSONB,
  tomorrow_plan JSONB,
  self_evaluation JSONB,
  working_mode TEXT,
  submitted_at TIMESTAMPTZ,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eod_employee_date ON eod_reports(employee_id, report_date DESC);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  openings_count INT,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT,
  category TEXT,
  source TEXT,
  current_company TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_name ON candidates(LOWER(name));

CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
  candidate_external_id TEXT,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_external_id TEXT,
  job_title TEXT,
  status TEXT,
  stage_name TEXT,
  shortlisted BOOLEAN DEFAULT FALSE,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_applications_candidate ON applications(candidate_id);

CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
  candidate_name TEXT,
  job_title TEXT,
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  mode TEXT,
  result TEXT,
  round_no INT,
  round_label TEXT,
  interviewer_names TEXT[] DEFAULT '{}',
  meeting_link TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interviews_start ON interviews(scheduled_start);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate ON interviews(candidate_id);

-- ACL tables (after employees + candidates exist)
CREATE TABLE IF NOT EXISTS manager_teams (
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_teams_employee ON manager_teams(employee_id);

CREATE TABLE IF NOT EXISTS manager_candidate_access (
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('sprintboard', 'ats', 'attendance', 'all')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'error')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  stats JSONB DEFAULT '{}',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS attendance_punches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT NOT NULL UNIQUE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  employee_external_id TEXT,
  employee_name TEXT,
  punch_time TIMESTAMPTZ NOT NULL,
  punch_type TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK (punch_type IN ('IN', 'OUT', 'UNKNOWN')),
  device_sn TEXT,
  raw JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_punches_employee_time ON attendance_punches(employee_id, punch_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_punches_time ON attendance_punches(punch_time DESC);

CREATE TABLE IF NOT EXISTS attendance_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Absent'
    CHECK (status IN ('Present', 'Absent', 'Late', 'Half Day', 'On Leave', 'Holiday')),
  first_in TIMESTAMPTZ,
  last_out TIMESTAMPTZ,
  hours_worked NUMERIC(5,2) DEFAULT 0,
  late_minutes INT DEFAULT 0,
  punch_count INT DEFAULT 0,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_days_employee_date ON attendance_days(employee_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_days_date_status ON attendance_days(work_date, status);

CREATE TABLE IF NOT EXISTS employee_performance_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  open_tasks INT DEFAULT 0,
  done_tasks INT DEFAULT 0,
  eod_submitted BOOLEAN DEFAULT FALSE,
  attendance_status TEXT,
  blockers_flag BOOLEAN DEFAULT FALSE,
  score INT DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_perf_daily_date ON employee_performance_daily(work_date DESC);
CREATE INDEX IF NOT EXISTS idx_perf_daily_employee ON employee_performance_daily(employee_id, work_date DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_trace JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_manager ON chat_messages(manager_id, created_at DESC);

-- Security (also in migrate_security.sql for existing DBs)
ALTER TABLE managers
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  ip INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_manager ON refresh_tokens(manager_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS backup_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  location TEXT,
  bytes BIGINT,
  retention_kept INT,
  error_message TEXT,
  stats JSONB
);

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID REFERENCES managers(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arg_keys TEXT[] DEFAULT '{}',
  success BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

