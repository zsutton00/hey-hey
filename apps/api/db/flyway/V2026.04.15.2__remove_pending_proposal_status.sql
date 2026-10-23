-- Collapse proposal lifecycle: remove PENDING status (DRAFT → APPROVED/REJECTED).
-- Postgres does not support DROP VALUE from enums, so we recreate the type.

UPDATE proposals SET status = 'DRAFT' WHERE status = 'PENDING';

CREATE TYPE proposal_status_new AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

ALTER TABLE proposals ALTER COLUMN status DROP DEFAULT;

ALTER TABLE proposals
  ALTER COLUMN status TYPE proposal_status_new
  USING status::text::proposal_status_new;

DROP TYPE proposal_status;

ALTER TYPE proposal_status_new RENAME TO proposal_status;

ALTER TABLE proposals ALTER COLUMN status SET DEFAULT 'DRAFT'::proposal_status;
