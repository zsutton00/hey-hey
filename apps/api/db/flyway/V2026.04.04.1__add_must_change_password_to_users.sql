-- Add must_change_password flag for beta onboarding flow
-- Users created via admin onboarding will have this set to true,
-- requiring them to change their password on first login.
ALTER TABLE users
ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
