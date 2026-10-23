ALTER TABLE "proposal_group_members"
  ADD COLUMN IF NOT EXISTS "publication_payload" JSONB,
  ADD COLUMN IF NOT EXISTS "published_edge_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "published_post_commit_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "publication_completed_at" TIMESTAMPTZ;

ALTER TABLE "proposal_group_members"
  ADD CONSTRAINT "proposal_group_members_published_edge_count_check"
  CHECK ("published_edge_count" >= 0),
  ADD CONSTRAINT "proposal_group_members_published_post_commit_count_check"
  CHECK ("published_post_commit_count" >= 0);
