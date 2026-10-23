CREATE TABLE proposal_reconciliation_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    previous_revision_id UUID REFERENCES proposal_reconciliation_revisions(id) ON DELETE RESTRICT,
    source TEXT NOT NULL CHECK (source IN ('AUTHORING', 'MERGE', 'AGENT_FIX')),
    bases JSONB NOT NULL,
    proposed_result JSONB NOT NULL,
    intent TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX proposal_reconciliation_revisions_proposal_id_created_at_idx
    ON proposal_reconciliation_revisions(proposal_id, created_at);

-- Proposal deletion may remove its history; revisions themselves may never be rewritten.
CREATE FUNCTION reject_proposal_reconciliation_revision_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Proposal reconciliation revisions are immutable';
END;
$$;
CREATE TRIGGER proposal_reconciliation_revision_immutable
    BEFORE UPDATE ON proposal_reconciliation_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_proposal_reconciliation_revision_update();
