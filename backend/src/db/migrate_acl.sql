-- Incremental migration: manager_teams ACL + safe alters
CREATE TABLE IF NOT EXISTS manager_teams (
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_manager_teams_employee ON manager_teams(employee_id);

-- Optional recruiter/candidate scoping (ATS side)
CREATE TABLE IF NOT EXISTS manager_candidate_access (
  manager_id UUID NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (manager_id, candidate_id)
);
