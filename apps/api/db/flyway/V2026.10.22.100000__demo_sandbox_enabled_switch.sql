ALTER TABLE demo_sandbox_program_state ADD COLUMN enabled boolean;
UPDATE demo_sandbox_program_state SET enabled = (creation_mode = 'OPEN');
ALTER TABLE demo_sandbox_program_state ALTER COLUMN enabled SET NOT NULL;
ALTER TABLE demo_sandbox_program_state DROP COLUMN creation_mode;
DROP TYPE demo_sandbox_creation_mode;
