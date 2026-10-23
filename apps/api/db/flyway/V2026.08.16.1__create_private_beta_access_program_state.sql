CREATE TABLE "private_beta_access_program_state" (
  "id" VARCHAR(32) PRIMARY KEY,
  "closed_at" TIMESTAMPTZ,
  "closed_by_user_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "private_beta_access_program_state_singleton"
    CHECK ("id" = 'private-beta')
);

INSERT INTO "private_beta_access_program_state" ("id")
VALUES ('private-beta');
