CREATE TABLE controller_browser_contexts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credential_hash varchar(64) NOT NULL UNIQUE,
 user_id text NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE controller_browser_bindings ADD COLUMN browser_context_id uuid REFERENCES controller_browser_contexts(id);
CREATE INDEX controller_browser_bindings_context_idx ON controller_browser_bindings(browser_context_id);

DROP INDEX IF EXISTS pending_machine_enrollments_browser_binding_hash_key;
