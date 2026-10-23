-- Remove the persisted coding-prompt entity and its entity-scoped projections.
-- The shared PostgreSQL EntityType enum intentionally retains CODING_PROMPT as
-- a legacy database value so this migration does not require rewriting every
-- polymorphic EntityType column in one deployment.

DELETE FROM "message_mentions"
WHERE "entity_type" IN ('CODING_PROMPT', 'coding_prompt', 'coding-prompt');

DELETE FROM "attention_events"
WHERE "entity_type" IN ('CODING_PROMPT', 'coding_prompt', 'coding-prompt');

DELETE FROM "notifications"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "influences"
WHERE "influenced_type" IN ('CODING_PROMPT', 'coding_prompt', 'coding-prompt')
   OR "influencing_type" IN ('CODING_PROMPT', 'coding_prompt', 'coding-prompt');

DELETE FROM "entity_stars"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "tags"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "entity_graph_embedding_mappings"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "entity_registry"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "topology_consolidation_entity_state"
WHERE "entity_type" = 'CODING_PROMPT';

UPDATE "topology_subfacet_candidate"
SET "last_source_entity_type" = NULL,
    "last_source_entity_id" = NULL
WHERE "last_source_entity_type" = 'CODING_PROMPT';

DELETE FROM "entity_subfacets"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "entity_summaries"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "plan_relationships"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "report_entities"
WHERE "entity_type" = 'CODING_PROMPT';

DELETE FROM "file_touch_index"
WHERE "attached_entity_type" = 'CODING_PROMPT';

UPDATE "flow_executions"
SET "entity_type" = NULL,
    "entity_id" = NULL
WHERE "entity_type" IN ('CODING_PROMPT', 'coding_prompt', 'coding-prompt');

UPDATE "agent_sessions"
SET "entity_type" = NULL,
    "entity_id" = NULL
WHERE "entity_type" IN ('CODING_PROMPT', 'coding_prompt', 'coding-prompt');

DROP TABLE IF EXISTS "implementation_hint_coding_prompts";
DROP TABLE IF EXISTS "coding_prompts";
