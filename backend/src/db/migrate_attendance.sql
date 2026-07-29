-- Attendance tables + sync_runs source expansion (safe for existing DBs)

ALTER TABLE sync_runs DROP CONSTRAINT IF EXISTS sync_runs_source_check;
ALTER TABLE sync_runs
  ADD CONSTRAINT sync_runs_source_check
  CHECK (source IN ('sprintboard', 'ats', 'attendance', 'all'));

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
