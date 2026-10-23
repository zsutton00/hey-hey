ALTER TABLE "private_beta_access_program_state"
  ADD COLUMN "self_service_admission_mode" "private_beta_self_service_admission_mode" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "self_service_admission_updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "self_service_admission_updated_by_user_id" UUID;
