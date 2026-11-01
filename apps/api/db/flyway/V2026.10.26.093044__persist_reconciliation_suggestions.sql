CREATE TABLE proposal_reconciliation_suggestions (
 id UUID PRIMARY KEY,
 proposal_id TEXT NOT NULL REFERENCES proposals(id),
 candidate_revision_id UUID NOT NULL REFERENCES proposal_reconciliation_revisions(id),
 agent_session_id TEXT REFERENCES agent_sessions(id),
 message_id TEXT REFERENCES messages(id),
 legacy_proposal_id TEXT UNIQUE REFERENCES proposals(id),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED','OUT_OF_DATE')),
 request JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ON proposal_reconciliation_suggestions(proposal_id,status);

-- Only persisted standalone reconciliation lineage identifies legacy saved edits.
-- Independent futures and grouped replacements retain their existing lifecycle.
INSERT INTO proposal_reconciliation_suggestions
 (id, proposal_id, candidate_revision_id, legacy_proposal_id, request, created_at)
SELECT gen_random_uuid(), original.id, basis.id, correction.id,
 jsonb_build_object('method','AGENT_FIX',
   'expectedCandidateRevisionId',basis.id,
   'expectedFutureRevision',(correction.updates->>'expectedRevision')::integer,
   'expectedCurrentBases', candidate.bases,
   'proposedResult',correction.updates->'result'), correction.created_at
FROM proposal_reconciliation_replacements lineage
JOIN proposals original ON original.id = lineage.proposal_id
JOIN proposals correction ON correction.id = lineage.replacement_proposal_id
JOIN LATERAL (
 SELECT id FROM proposal_reconciliation_revisions
 WHERE proposal_id = original.id AND created_at <= correction.created_at
 ORDER BY created_at DESC, id DESC LIMIT 1
) basis ON true
JOIN LATERAL (
 SELECT bases FROM proposal_reconciliation_revisions WHERE proposal_id = correction.id
 ORDER BY created_at DESC, id DESC LIMIT 1
) candidate ON true
WHERE original.action = 'VERSIONED_UPDATE' AND correction.action = 'VERSIONED_UPDATE'
 AND correction.status = 'DRAFT' AND lineage.replacement_group_id IS NULL
 AND original.organization_id = correction.organization_id AND original.project_id = correction.project_id
 AND original.updates->>'futureId' = correction.updates->>'futureId'
 AND NOT EXISTS (SELECT 1 FROM proposal_group_members WHERE proposal_id IN (original.id,correction.id));
