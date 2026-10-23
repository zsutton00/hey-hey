-- Deterministic open-trigger projection.
--
-- One row per OPEN SYSTEM trigger (a trigger message awaiting completion),
-- keyed by the human user who owns the conversation. SYSTEM trigger messages
-- carry user_id = 'system', so the owning user can only be resolved through
-- the AgentSession bound to the conversation — which is why the prior
-- per-user resolver had to walk AgentSession rows. This store stamps the
-- resolved user_id at write time, turning that scan into a point lookup
-- bounded by the count of open triggers rather than recent sessions.
--
-- Invariant: a row exists here iff the conversation holds a SYSTEM message
-- with data.triggersAgent (an object) that has NOT been completed by a later
-- data.completesExternalAgentNode.completesTriggerMessageId referencing it —
-- i.e. the materialized form of the triggers-minus-completions set the CLI
-- derives. The write path (MessageService.addMessage) inserts on trigger and
-- deletes on completion to keep this true.

CREATE TABLE "pending_open_trigger" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id"         TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id"      TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id"      TEXT NOT NULL,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "pending_open_trigger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pending_open_trigger_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_open_trigger_conversation_id_fkey"
        FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_open_trigger_message_id_fkey"
        FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_open_trigger_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pending_open_trigger_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- One row per trigger message; the write-path delete and the resolver both
    -- key on message_id, and the backfill ON CONFLICT relies on this.
    CONSTRAINT "pending_open_trigger_message_id_key" UNIQUE ("message_id")
);

-- The resolver filters exclusively by user_id; this is the lookup index.
CREATE INDEX "pending_open_trigger_user_id_idx" ON "pending_open_trigger"("user_id");

-- Backfill from existing data so pre-existing and >7-day-old pending triggers
-- recover on the next authenticate. A trigger is an open SYSTEM message whose
-- data.triggersAgent is an object and which no completion message in the same
-- conversation references via completesExternalAgentNode.completesTriggerMessageId.
-- user_id / organization_id / project_id are resolved through the AgentSession
-- bound to the conversation. DISTINCT ON (m.id) guarantees one row per trigger
-- message even when a conversation has multiple AgentSessions; the earliest
-- session (by created_at) wins, matching the write-path resolution order.
INSERT INTO "pending_open_trigger" (
    "user_id", "conversation_id", "message_id", "organization_id", "project_id", "created_at"
)
SELECT DISTINCT ON (m."id")
    a."user_id",
    m."conversation_id",
    m."id",
    a."organization_id",
    a."project_id",
    m."created_at"
FROM "messages" m
JOIN "agent_sessions" a ON a."conversation_id" = m."conversation_id"
WHERE m."type" = 'SYSTEM'
  AND jsonb_typeof(m."data" -> 'triggersAgent') = 'object'
  AND NOT EXISTS (
      SELECT 1
      FROM "messages" c
      WHERE c."conversation_id" = m."conversation_id"
        AND c."data" -> 'completesExternalAgentNode' ->> 'completesTriggerMessageId' = m."id"
  )
ORDER BY m."id", a."created_at" ASC
ON CONFLICT ("message_id") DO NOTHING;
