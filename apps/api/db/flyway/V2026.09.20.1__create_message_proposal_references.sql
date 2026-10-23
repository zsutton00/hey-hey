CREATE TABLE message_proposal_references (
  message_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT message_proposal_references_pkey PRIMARY KEY (message_id, proposal_id),
  CONSTRAINT message_proposal_references_message_position_key UNIQUE (message_id, position),
  CONSTRAINT message_proposal_references_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT message_proposal_references_proposal_id_fkey
    FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE
);

CREATE INDEX message_proposal_references_proposal_id_idx
  ON message_proposal_references(proposal_id);

INSERT INTO message_proposal_references (message_id, proposal_id, position, created_at)
SELECT
  p.message_id,
  p.id,
  ROW_NUMBER() OVER (PARTITION BY p.message_id ORDER BY p.created_at, p.id) - 1,
  p.created_at
FROM proposals p
WHERE p.message_id IS NOT NULL;
