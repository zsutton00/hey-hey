-- Approved proposal cohort lookups are scoped to one project and conversation.
CREATE INDEX graph_proposal_conversation_create
    ON graph.node (organization_id, project_id, (properties->>'conversationId'))
    WHERE entity_type='PROPOSAL'
      AND properties->>'status'='APPROVED'
      AND properties->>'action'='CREATE';
