-- Per-machine security audit feed. Rows are either reported by the CLI
-- (signature/replay/timestamp/allowlist/rate-limit categories) or recorded
-- server-side on revocation. The primary key is (machine_id, id) — the
-- client-supplied id scoped to its machine — so a CLI retry after the server
-- was unreachable re-reports the same entries idempotently (ON CONFLICT DO
-- NOTHING) rather than duplicating rows, while two different machines reusing
-- the same id never collide. ON DELETE CASCADE: deleting a machine removes its
-- audit rows with it.
CREATE TABLE "machine_security_events" (
    "id"          TEXT        NOT NULL,
    "machine_id"  TEXT        NOT NULL,
    "event_type"  TEXT        NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "detail"      TEXT,
    "metadata"    JSONB,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_security_events_pkey" PRIMARY KEY ("machine_id", "id"),
    CONSTRAINT "machine_security_events_machine_id_fkey"
        FOREIGN KEY ("machine_id") REFERENCES "machines"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Feed reads are per-machine, most-recent-first.
CREATE INDEX "machine_security_events_machine_id_occurred_at_idx"
    ON "machine_security_events"("machine_id", "occurred_at");
