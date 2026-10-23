CREATE TYPE "proposal_approval_type" AS ENUM ('APPROVAL', 'REJECTION');

CREATE TABLE "proposal_approvals" (
    "id"          TEXT NOT NULL DEFAULT gen_random_uuid(),
    "proposal_id" TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "type"        "proposal_approval_type" NOT NULL,
    "reason"      TEXT,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "proposal_approvals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_approvals_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_approvals_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_approvals_proposal_id_user_id_key"
        UNIQUE ("proposal_id", "user_id")
);

CREATE INDEX "proposal_approvals_proposal_id_idx" ON "proposal_approvals"("proposal_id");
CREATE INDEX "proposal_approvals_user_id_idx" ON "proposal_approvals"("user_id");
