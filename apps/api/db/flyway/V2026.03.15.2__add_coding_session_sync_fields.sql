ALTER TABLE "coding_sessions"
  ADD COLUMN "last_synced_at" TIMESTAMPTZ,
  ADD COLUMN "has_unsynced_changes" BOOLEAN NOT NULL DEFAULT false;
