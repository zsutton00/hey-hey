CREATE TABLE proposal_reconciliation_replacements (
 id text PRIMARY KEY,
 proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE RESTRICT,
 replacement_proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE RESTRICT,
 group_id text REFERENCES proposal_groups(id) ON DELETE RESTRICT,
 replacement_group_id text REFERENCES proposal_groups(id) ON DELETE RESTRICT,
 source_state jsonb NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((group_id IS NULL) = (replacement_group_id IS NULL))
);
CREATE INDEX proposal_reconciliation_replacements_proposal_id_created_at_idx
 ON proposal_reconciliation_replacements(proposal_id, created_at);
