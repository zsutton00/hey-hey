ALTER TABLE proposal_future_revisions DROP CONSTRAINT proposal_future_revisions_proposal_id_key;
ALTER TABLE proposal_future_revisions ADD COLUMN candidate_revision_id TEXT;
UPDATE proposal_future_revisions receipt SET candidate_revision_id = (
  SELECT revision.id FROM proposal_reconciliation_revisions revision
  WHERE revision.proposal_id = receipt.proposal_id
  ORDER BY revision.created_at DESC, revision.id DESC LIMIT 1
);
CREATE UNIQUE INDEX proposal_future_revisions_proposal_id_candidate_revision_id_key
  ON proposal_future_revisions(proposal_id, candidate_revision_id);

-- Retired votes retain attribution and the exact content they reviewed.
CREATE TABLE proposal_approval_audit (
  audit_id BIGSERIAL PRIMARY KEY,
  approval_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  candidate_revision_id TEXT,
  approval JSONB NOT NULL,
  retired_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION retain_retired_proposal_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO proposal_approval_audit(approval_id, proposal_id, candidate_revision_id, approval)
  SELECT OLD.id, OLD.proposal_id,
    (SELECT id FROM proposal_reconciliation_revisions WHERE proposal_id = OLD.proposal_id
     ORDER BY created_at DESC, id DESC LIMIT 1), to_jsonb(OLD);
  RETURN OLD;
END;
$$;
CREATE TRIGGER retain_retired_proposal_approval BEFORE DELETE ON proposal_approvals
  FOR EACH ROW EXECUTE FUNCTION retain_retired_proposal_approval();

-- A transaction can start before a competing save, then acquire its row lock
-- afterwards. Transaction-start timestamps must not reorder the content chain.
CREATE FUNCTION order_proposal_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := GREATEST(clock_timestamp(),
    (SELECT created_at + INTERVAL '1 millisecond'
     FROM proposal_reconciliation_revisions WHERE id = NEW.previous_revision_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_proposal_content_revision BEFORE INSERT ON proposal_reconciliation_revisions
  FOR EACH ROW EXECUTE FUNCTION order_proposal_content_revision();
