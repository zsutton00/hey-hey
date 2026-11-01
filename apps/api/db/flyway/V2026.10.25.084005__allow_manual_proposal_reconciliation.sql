ALTER TABLE proposal_reconciliation_revisions
    DROP CONSTRAINT proposal_reconciliation_revisions_source_check;
ALTER TABLE proposal_reconciliation_revisions
    ADD CONSTRAINT proposal_reconciliation_revisions_source_check
    CHECK (source IN ('AUTHORING', 'MERGE', 'AGENT_FIX', 'MANUAL'));
