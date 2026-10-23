-- Configure the canonical workflow type as the first consumer of generic,
-- bounded graph aggregate read expansions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'workflow'
      AND "graph_configuration" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot configure workflow graph read expansion; canonical workflow template is missing its graph capability';
  END IF;
END
$$;

UPDATE "work_item_type_template"
SET
  "graph_configuration" = jsonb_set(
    "graph_configuration",
    '{readExpansions}',
    $expansions$
[
  {
    "key": "contractLinkedWorkflows",
    "seed": "graphNodes",
    "path": [
      {
        "relationshipType": "DEPENDS_ON",
        "direction": "OUTGOING",
        "target": {"entityTypes":["TASK"],"workItemTypeKeys":["CONTRACT"]}
      },
      {
        "relationshipType": "DEPENDS_ON",
        "direction": "INCOMING",
        "target": {"entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]}
      },
      {
        "relationshipType": "HAS_TASK",
        "direction": "INCOMING",
        "target": {"entityTypes":["TASK"],"workItemTypeKeys":["workflow"]}
      }
    ],
    "projectionKind": "workItemReference",
    "deduplicateBy": "entityId",
    "excludeRoot": true,
    "limit": 100
  }
]
$expansions$::jsonb,
    true
  ),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'workflow';
