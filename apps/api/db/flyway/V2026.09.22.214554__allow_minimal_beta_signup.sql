-- Unified signup requires name, email, and organization only. Preserve historical review context.
ALTER TABLE private_beta_access_requests
  ALTER COLUMN team_size DROP NOT NULL,
  ALTER COLUMN product_context DROP NOT NULL,
  ALTER COLUMN access_rationale DROP NOT NULL;
