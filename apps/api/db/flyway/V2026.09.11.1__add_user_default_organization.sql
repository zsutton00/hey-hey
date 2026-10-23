-- An explicit account preference, independent of browser session selection.
-- Preserve inaccessible preferences so sign-in denies rather than substitutes.
ALTER TABLE "users" ADD COLUMN "default_organization_id" TEXT;
