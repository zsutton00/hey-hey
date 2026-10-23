-- Durable delivery/idempotency receipts for explicit Task Monitor commands.
-- Flyway is the sole migration system; keep this table in sync with
-- prisma/schema.prisma MonitorCommand.
CREATE TABLE "monitor_commands" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid(),
    "request_id"      TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id"      TEXT NOT NULL,
    "monitor_id"      TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "machine_id"      TEXT NOT NULL,
    "body"            JSONB NOT NULL,
    "expires_at"      TIMESTAMPTZ NOT NULL,
    "delivery_state"  TEXT NOT NULL DEFAULT 'QUEUED',
    "outcome"         JSONB,
    "attempt_count"   INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "acknowledged_at" TIMESTAMPTZ,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "monitor_commands_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "monitor_commands_user_request_key" UNIQUE ("user_id", "request_id"),
    CONSTRAINT "monitor_commands_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "monitor_commands_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "monitor_commands_monitor_id_fkey"
        FOREIGN KEY ("monitor_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "monitor_commands_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "monitor_commands_machine_id_fkey"
        FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "monitor_commands_delivery_state_check"
        CHECK ("delivery_state" IN ('QUEUED', 'SENT', 'RECEIVED'))
);

CREATE INDEX "monitor_commands_machine_delivery_expiry_idx"
    ON "monitor_commands"("machine_id", "delivery_state", "expires_at");
CREATE INDEX "monitor_commands_monitor_created_idx"
    ON "monitor_commands"("monitor_id", "created_at");
