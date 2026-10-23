-- Forward-only durable request and execution-attempt storage.
ALTER TYPE "ReportType" ADD VALUE 'PROJECT_REPORT';
ALTER TYPE "AgentSessionType" ADD VALUE 'PROJECT_REPORT';
CREATE TYPE "ProjectReportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE project_report_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  preset JSONB,
  resolved_scope JSONB NOT NULL,
  exclusions JSONB NOT NULL,
  launch_config JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  status "ProjectReportStatus" NOT NULL DEFAULT 'QUEUED',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT project_report_request_idempotency_key UNIQUE (organization_id, project_id, user_id, idempotency_key)
);
CREATE INDEX project_report_request_project_created_idx ON project_report_requests(project_id, created_at);

CREATE TABLE project_report_attempts (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES project_report_requests(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  idempotency_key TEXT NOT NULL,
  status "ProjectReportStatus" NOT NULL DEFAULT 'QUEUED',
  agent_session_id TEXT UNIQUE REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE RESTRICT,
  -- Report expiration/deletion removes its terminal attempt, preserving existing Reports lifecycle.
  report_id TEXT UNIQUE REFERENCES reports(id) ON DELETE CASCADE,
  failure JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP(3),
  completed_at TIMESTAMP(3),
  failed_at TIMESTAMP(3),
  CONSTRAINT project_report_attempt_number_key UNIQUE (request_id, attempt_number),
  CONSTRAINT project_report_attempt_idempotency_key UNIQUE (request_id, idempotency_key),
  CONSTRAINT project_report_attempt_terminal_state CHECK (
    (status = 'COMPLETED' AND report_id IS NOT NULL AND completed_at IS NOT NULL AND failure IS NULL AND failed_at IS NULL)
    OR (status = 'FAILED' AND report_id IS NULL AND completed_at IS NULL AND failure IS NOT NULL AND failed_at IS NOT NULL)
    OR (status IN ('QUEUED', 'RUNNING') AND report_id IS NULL AND completed_at IS NULL AND failure IS NULL AND failed_at IS NULL)
  ),
  CONSTRAINT project_report_attempt_running_identity CHECK (
    status NOT IN ('RUNNING', 'COMPLETED') OR (agent_session_id IS NOT NULL AND conversation_id IS NOT NULL AND started_at IS NOT NULL)
  )
);
-- At most one in-flight attempt per request; retries retain prior terminal evidence.
CREATE UNIQUE INDEX project_report_attempt_active_key ON project_report_attempts(request_id)
WHERE status IN ('QUEUED', 'RUNNING');
