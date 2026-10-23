-- Promote Contract to a built-in work-item type and make workflow_step
-- Contract dependencies visible as metadata, not flow structure.

UPDATE "work_item_type"
SET "lifecycle_status" = 'archived',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT'
  AND "is_system" = false
  AND "lifecycle_status" <> 'archived';

INSERT INTO "work_item_type" (
    "id",
    "type_key",
    "is_system",
    "project_id",
    "lifecycle_status",
    "name",
    "description",
    "section_definitions",
    "allowed_parent_types",
    "allowed_child_types",
    "edge_targets",
    "allowed_statuses",
    "required_scalars",
    "forbidden_scalars",
    "parentage",
    "tracking",
    "agent_settable_statuses",
    "anchorable_report_types",
    "writing_standards",
    "capabilities",
    "created_at",
    "updated_at"
)
SELECT
    'c1a70000-0000-0000-0000-000000000008',
    'CONTRACT',
    true,
    NULL,
    'active',
    'Contract',
    'A user-authored, first-class marker that an agreement exists across a boundary between features. It is a pointer and notice, never the source of truth for code or payload shape.',
    '[{"key":"description","label":"Description","kind":"markdown"}]'::jsonb,
    '["FEATURE"]'::jsonb,
    '[]'::jsonb,
    '[
      {"edgeType":"DEPENDS_ON","targetTypeKeys":["FEATURE"]},
      {"edgeType":"RELATED_TO","targetTypeKeys":[]},
      {"edgeType":"SUPERSEDES","targetTypeKeys":["CONTRACT"]}
    ]'::jsonb,
    '["ACTIVE","SUPERSEDED"]'::jsonb,
    '[]'::jsonb,
    '["tag","dueDate"]'::jsonb,
    '{"allowedParentEntityTypes":[]}'::jsonb,
    '{"isTrackingSource":false,"allowedTargetEntityTypes":[],"allowedTargetTaskTypes":[]}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    jsonb_build_object(
      'create',
      '## What a contract is

A Contract records that a user-authored agreement exists across a feature boundary. It is a pointer and notice, not the source of truth for code, payload shape, or runtime behavior.

## Section shape

Contracts are single-section: `description` states the agreement in the user''s terms and names the boundary it makes visible. Parent the Contract to the feature that owns one side of the agreement; use graph edges to connect the other side.

## Discipline

Do not encode payload schemas, exact API bodies, or implementation truth in the Contract. Keep children, tags, and due dates off the item.',
      'edit',
      '## Editing contracts

Edit when the agreement summary, owning feature side, or visible boundary changes. Preserve the pointer model: the code remains the source of truth, and graph edges carry the relationship to the other side.

## Common edit failure modes

- **Payload source of truth.** Move exact payload shape or code-level rules to the implementation contract that owns them.
- **Loose relationship only.** Use a Contract when the boundary carries a real agreement worth surfacing, not as a substitute for ordinary edges.'
    ),
    '{
      "canHaveParent": true,
      "requiresParent": true,
      "canHaveChildren": false,
      "isHierarchyNode": false,
      "planEligible": false,
      "hasSetInitialStatus": false,
      "rendersInline": false
    }'::jsonb,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1
    FROM "work_item_type"
    WHERE "type_key" = 'CONTRACT'
      AND "is_system" = true
);

UPDATE "work_item_type"
SET "edge_targets" = '[
      {"edgeType":"RELATED_TO","targetTypeKeys":[]},
      {"edgeType":"DEPENDS_ON","targetTypeKeys":["CONTRACT"]},
      {"edgeType":"DERIVES_FROM","targetTypeKeys":[]},
      {"edgeType":"SUPERSEDES","targetTypeKeys":[]},
      {"edgeType":"CONTRADICTS","targetTypeKeys":[]},
      {"edgeType":"EVOLVES","targetTypeKeys":[]}
    ]'::jsonb,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'workflow_step'
  AND "is_system" = true;
