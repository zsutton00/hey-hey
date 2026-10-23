-- Make tasks.initiative_id nullable to support FEATURE tasks converted from initiatives.
-- FEATURE tasks have no parent initiative to reference, so the NOT NULL constraint
-- must be lifted before the initiative-to-feature data migration can run.
ALTER TABLE tasks ALTER COLUMN initiative_id DROP NOT NULL;
