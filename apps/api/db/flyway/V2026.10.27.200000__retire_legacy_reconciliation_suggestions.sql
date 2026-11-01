-- Suggestions migrated from standalone Agent fix corrections have no agent
-- message to review them in. They are retired: never applied, never offered
-- with Accept or Reject, and kept only in history. The original proposal's
-- updates, revisions and approvals are untouched.
ALTER TABLE proposal_reconciliation_suggestions
 DROP CONSTRAINT proposal_reconciliation_suggestions_status_check,
 ADD CONSTRAINT proposal_reconciliation_suggestions_status_check
  CHECK(status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED','OUT_OF_DATE','RETIRED'));

UPDATE proposals SET application_eligible = false
WHERE id IN (
 SELECT legacy_proposal_id FROM proposal_reconciliation_suggestions
 WHERE status = 'PENDING' AND legacy_proposal_id IS NOT NULL);

UPDATE proposal_reconciliation_suggestions SET status = 'RETIRED'
WHERE status = 'PENDING' AND legacy_proposal_id IS NOT NULL;
