-- One durable attempt to continue an Agent Session on another paired computer
-- after its bound computer was revoked or removed. The same row tracks the
-- attempt through readiness inspection, the binding transition, delivery and
-- provider startup, so every outcome survives reloads and retries reuse it.
--
-- Machine identities are retained without foreign keys so machine records and
-- their audit history are never altered or cascaded. No authority moves with
-- the attempt: each delivery runs under the destination's own authorization.
CREATE TABLE agent_session_continuations (
  id UUID PRIMARY KEY,
  agent_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  previous_machine_id TEXT NOT NULL,
  destination_machine_id TEXT NOT NULL,

  -- INSPECTED: destination readiness is known; nothing has moved.
  -- AWAITING_HISTORY_CONFIRMATION: only a new provider session from saved
  --   history is possible; nothing starts until the person confirms.
  -- PENDING: delivery or provider startup is in progress.
  -- UNCERTAIN: no startup acknowledgement arrived in time; reconcile first.
  -- FAILED: delivery or startup failed with a known cause; retry this attempt.
  -- SUCCEEDED: provider startup confirmed the selected mode.
  -- CANCELLED: the person declined; nothing was started.
  state TEXT NOT NULL CHECK (state IN (
    'INSPECTED',
    'AWAITING_HISTORY_CONFIRMATION',
    'PENDING',
    'UNCERTAIN',
    'FAILED',
    'SUCCEEDED',
    'CANCELLED'
  )),

  -- What the destination's local inspection found, under its own authorization.
  native_state TEXT NOT NULL CHECK (native_state IN ('USABLE', 'ABSENT', 'UNUSABLE')),
  inspection_reason TEXT NOT NULL,

  -- The selected continuation mode. Starts as NATIVE_RESUME when native state
  -- is usable and becomes SAVED_HISTORY only when the provider rejects resume.
  mode TEXT NOT NULL CHECK (mode IN ('NATIVE_RESUME', 'SAVED_HISTORY')),
  native_resume_rejected_at TIMESTAMP(3),
  history_confirmed_at TIMESTAMP(3),

  input_fingerprint CHAR(64) NOT NULL,
  start_run_inputs JSONB NOT NULL,

  -- Pending binding transition: set when the session is rebound to the
  -- destination, and reverted only when evidence shows no execution started
  -- and this attempt still owns the binding.
  binding_moved_at TIMESTAMP(3),
  binding_reverted_at TIMESTAMP(3),

  -- Each delivery try gets a new operation and generation. Acknowledgements
  -- carry the generation, so a delayed answer to an earlier try cannot
  -- overwrite a later one.
  delivery_generation INTEGER NOT NULL DEFAULT 0 CHECK (delivery_generation >= 0),
  delivery_operation_id UUID UNIQUE,
  delivered_at TIMESTAMP(3),
  provider_started_at TIMESTAMP(3),

  -- Safe reason code and diagnostic detail for the latest failed, uncertain or
  -- rejected-resume outcome. Never carries prompts, credentials or payloads.
  outcome_code TEXT,
  outcome_detail TEXT,

  inspected_at TIMESTAMP(3) NOT NULL,
  terminal_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,

  -- A continuation always moves to a different computer. Retrying a failed
  -- delivery reuses this attempt; it is never a new same-machine continuation.
  CHECK (previous_machine_id <> destination_machine_id),
  CHECK (binding_reverted_at IS NULL OR binding_moved_at IS NOT NULL),
  CHECK (state <> 'INSPECTED' OR binding_moved_at IS NULL),
  CHECK (
    state NOT IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')
    OR (binding_moved_at IS NOT NULL AND binding_reverted_at IS NULL
        AND delivery_operation_id IS NOT NULL)
  ),
  CHECK ((delivery_operation_id IS NULL) = (delivery_generation = 0)),
  CHECK (delivered_at IS NULL OR delivery_operation_id IS NOT NULL),
  -- A new provider session from saved history never starts unconfirmed.
  CHECK (
    mode <> 'SAVED_HISTORY'
    OR state NOT IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')
    OR history_confirmed_at IS NOT NULL
  ),
  CHECK (native_resume_rejected_at IS NULL OR mode = 'SAVED_HISTORY'),
  -- Success is provider startup, not delivery receipt.
  CHECK ((state = 'SUCCEEDED') = (provider_started_at IS NOT NULL)),
  CHECK (state NOT IN ('FAILED', 'UNCERTAIN') OR outcome_code IS NOT NULL),
  CHECK ((state IN ('SUCCEEDED', 'CANCELLED')) = (terminal_at IS NOT NULL))
);

CREATE INDEX agent_session_continuations_session_created_idx
  ON agent_session_continuations (agent_session_id, created_at);

-- A session moves off a given binding at most once, unless that move was
-- reverted.
CREATE UNIQUE INDEX agent_session_continuations_one_move_per_source_idx
  ON agent_session_continuations (agent_session_id, previous_machine_id)
  WHERE binding_moved_at IS NOT NULL AND binding_reverted_at IS NULL;

-- At most one committed, unresolved attempt per session, so a new inspection
-- can never hide a failed or uncertain committed attempt.
CREATE UNIQUE INDEX agent_session_continuations_one_unresolved_idx
  ON agent_session_continuations (agent_session_id)
  WHERE binding_moved_at IS NOT NULL
    AND binding_reverted_at IS NULL
    AND state IN ('AWAITING_HISTORY_CONFIRMATION', 'PENDING', 'UNCERTAIN', 'FAILED');
