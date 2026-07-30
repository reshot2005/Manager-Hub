-- Leave management, attrition-risk scores, proactive alerts (idempotent)

CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type TEXT NOT NULL
    CHECK (leave_type IN ('Sick', 'Casual', 'WFH', 'Other')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES managers(id) ON DELETE SET NULL,
  notes TEXT,
  source_leave_id TEXT,
  synced_at TIMESTAMPTZ,
  CONSTRAINT leave_requests_dates_ok CHECK (end_date >= start_date)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_requests_source
  ON leave_requests(source_leave_id) WHERE source_leave_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee_dates
  ON leave_requests(employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status_dates
  ON leave_requests(status, start_date, end_date);

CREATE TABLE IF NOT EXISTS employee_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  computed_date DATE NOT NULL,
  attendance_score INT NOT NULL DEFAULT 0 CHECK (attendance_score >= 0 AND attendance_score <= 100),
  task_completion_score INT NOT NULL DEFAULT 0 CHECK (task_completion_score >= 0 AND task_completion_score <= 100),
  eod_consistency_score INT NOT NULL DEFAULT 0 CHECK (eod_consistency_score >= 0 AND eod_consistency_score <= 100),
  composite_score INT NOT NULL DEFAULT 0 CHECK (composite_score >= 0 AND composite_score <= 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),
  contributing_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
  window_days INT NOT NULL DEFAULT 14,
  synced_days INT NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, computed_date)
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_date_level
  ON employee_risk_scores(computed_date DESC, risk_level);
CREATE INDEX IF NOT EXISTS idx_risk_scores_employee
  ON employee_risk_scores(employee_id, computed_date DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'Warning'
    CHECK (severity IN ('Info', 'Warning', 'Critical')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_alerts_manager_open
  ON alerts(manager_id, acknowledged, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe
  ON alerts(manager_id, alert_type, employee_id, created_at DESC);
