-- PostgreSQL requires a newly-added enum value to commit before later
-- migrations can safely use it in constraints and data changes.
ALTER TYPE "controller_authorization_cadence"
    ADD VALUE IF NOT EXISTS 'FIVE_MINUTES';
