ALTER TABLE users ADD COLUMN is_demo_user BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TYPE demo_sandbox_status AS ENUM (
  'PROVISIONING', 'ACTIVE', 'DISCARDING', 'EXPIRING', 'DELETED'
);
CREATE TYPE demo_sandbox_creation_mode AS ENUM ('OPEN', 'PAUSED');

-- organization_id and project_id intentionally have no foreign keys: the row
-- outlives final deletion of its tenancy until the demo user is removed.
CREATE TABLE demo_sandboxes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  demo_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  browser_binding_hash TEXT NOT NULL UNIQUE,
  creator_ip_hash TEXT NOT NULL,
  readiness_feature_id TEXT NOT NULL,
  provisioning_deadline TIMESTAMP(3) NOT NULL,
  status demo_sandbox_status NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at TIMESTAMP(3),
  expires_at TIMESTAMP(3)
);
CREATE INDEX demo_sandboxes_status_expires_at_idx ON demo_sandboxes(status, expires_at);
CREATE INDEX demo_sandboxes_creator_ip_hash_created_at_idx ON demo_sandboxes(creator_ip_hash, created_at);

CREATE TABLE demo_sandbox_program_state (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  creation_mode demo_sandbox_creation_mode NOT NULL,
  active_cap INTEGER NOT NULL CHECK (active_cap >= 0),
  per_ip_limit INTEGER NOT NULL CHECK (per_ip_limit >= 1),
  per_ip_window_seconds INTEGER NOT NULL CHECK (per_ip_window_seconds >= 1),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Creation stays paused until an operator opens the program; the cap and
-- per-address values are provisional (open items in the Demo Sandbox design).
INSERT INTO demo_sandbox_program_state
  (id, creation_mode, active_cap, per_ip_limit, per_ip_window_seconds)
VALUES ('singleton', 'PAUSED', 50, 3, 86400);

-- Principal that owns every sandbox organization. The hash is not a valid
-- bcrypt value, so no password can ever authenticate as this user.
INSERT INTO users (id, email, name, password_hash, is_active, is_demo_user, updated_at)
VALUES ('demo-system', 'demo-system@internal.local', 'Demo Sandbox System', '!', TRUE, FALSE, CURRENT_TIMESTAMP);
