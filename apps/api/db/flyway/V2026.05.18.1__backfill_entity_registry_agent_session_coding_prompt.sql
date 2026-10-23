-- Re-type entity_registry rows that were incorrectly labeled AGENT_SESSION
-- but whose id actually references a coding_prompts row. Caused by a stale
-- enum cast in EntityLifecycleProcessor.handleCodingPromptCreated. Live
-- agent-session registrations were being shadowed by these mis-typed rows.
UPDATE entity_registry
   SET entity_type = 'CODING_PROMPT'
 WHERE entity_type = 'AGENT_SESSION'
   AND entity_id IN (SELECT id FROM coding_prompts);
