-- Demo availability is decided by the deployment environment alone.
ALTER TABLE demo_sandbox_program_state DROP COLUMN enabled;
