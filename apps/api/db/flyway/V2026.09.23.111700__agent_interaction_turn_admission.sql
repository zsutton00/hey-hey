CREATE TABLE agent_interactions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  target_session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  destination_session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  source_run_id text,
  source_turn_id text,
  kind text NOT NULL CHECK (kind IN ('SUBAGENT', 'SESSION_MESSAGE', 'SUPERVISION')),
  mode text NOT NULL CHECK (mode IN ('FOREGROUND', 'BACKGROUND')),
  state text NOT NULL DEFAULT 'ADMITTING' CHECK (state IN ('ADMITTING', 'DISPATCHING', 'WAITING', 'RESULT_READY', 'DELIVERING', 'DELIVERED', 'REJECTED', 'CANCELLED', 'FAILED', 'EXPIRED')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  idempotency_key text NOT NULL,
  request_fingerprint char(64) NOT NULL,
  admitting_machine_id text NOT NULL REFERENCES machines(id) ON DELETE RESTRICT,
  projection_id text NOT NULL UNIQUE,
  expires_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_session_id, idempotency_key)
);
CREATE INDEX agent_interactions_project_created_idx ON agent_interactions(project_id, created_at);

CREATE TABLE agent_interaction_attempts (
  id text PRIMARY KEY,
  interaction_id text NOT NULL REFERENCES agent_interactions(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  target_session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE RESTRICT,
  target_turn_id text UNIQUE,
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'DISPATCHING', 'ACCEPTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED')),
  authority jsonb NOT NULL,
  objective text,
  answer_reference text,
  CHECK ((objective IS NOT NULL) <> (answer_reference IS NOT NULL)),
  result jsonb,
  settled_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interaction_id, ordinal)
);
CREATE INDEX agent_interaction_attempts_target_state_idx ON agent_interaction_attempts(target_session_id, state);

CREATE TABLE agent_interaction_effects (
  id text PRIMARY KEY,
  interaction_id text NOT NULL REFERENCES agent_interactions(id) ON DELETE CASCADE,
  attempt_id text NOT NULL REFERENCES agent_interaction_attempts(id) ON DELETE CASCADE,
  generation integer NOT NULL CHECK (generation >= 1),
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'BLOCKED' CHECK (state IN ('BLOCKED', 'PENDING', 'CLAIMED', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  claim_owner text,
  claim_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, generation, kind)
);
CREATE INDEX agent_interaction_effects_claim_idx ON agent_interaction_effects(state, claim_expires_at, created_at);

CREATE TABLE agent_session_turn_slots (
  agent_session_id text PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  next_ordinal integer NOT NULL DEFAULT 1 CHECK (next_ordinal >= 1),
  occupied_admission_id text UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_session_turn_admissions (
  id text PRIMARY KEY,
  agent_session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('USER', 'WORKFLOW', 'SUBAGENT', 'AGENT_INTERACTION')),
  state text NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED', 'OCCUPIED', 'SETTLED', 'CANCELLED')),
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  idempotency_key text NOT NULL,
  author_kind text NOT NULL CHECK (author_kind IN ('HUMAN', 'SYSTEM', 'AGENT')),
  author_user_id text,
  input_message_id text REFERENCES messages(id) ON DELETE RESTRICT,
  interaction_attempt_id text REFERENCES agent_interaction_attempts(id) ON DELETE RESTRICT,
  session_message_input jsonb,
  turn_id text UNIQUE,
  settled_evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_session_id, ordinal),
  UNIQUE (agent_session_id, idempotency_key),
  CHECK ((source IN ('SUBAGENT', 'AGENT_INTERACTION')) = (interaction_attempt_id IS NOT NULL)),
  CHECK ((source IN ('USER', 'WORKFLOW')) = (input_message_id IS NOT NULL)),
  CHECK ((author_kind = 'AGENT') = (interaction_attempt_id IS NOT NULL))
);
CREATE INDEX agent_session_turn_admissions_head_idx ON agent_session_turn_admissions(agent_session_id, state, ordinal);
ALTER TABLE agent_session_turn_slots ADD CONSTRAINT agent_session_turn_slots_occupied_fk
  FOREIGN KEY (occupied_admission_id) REFERENCES agent_session_turn_admissions(id) ON DELETE RESTRICT;
