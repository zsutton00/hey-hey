-- Add the workflow work-item family and the rendersInline capability.
-- Append-only delta: prior work_item_type migrations are already committed.

UPDATE "work_item_type"
SET
  "capabilities" = "capabilities" || '{"rendersInline": false}'::jsonb,
  "anchorable_report_types" = '["CODING_RESEARCH","EVIDENCE_PIPELINE","SNAPSHOT","ROLLUP_PROPOSAL","DAILY_SESSION","GOAL_PROGRESS","RISK_ALERT","SESSION_SUMMARY","COMMIT","PLAN","IMPLEMENT","FEATURE_SYNC","FEATURE_SYNC_HANDOFF","FEATURE_SYNC_DECISION","DECISION_NEEDED","PHASE_GROUNDING","VALIDATION_WALKTHROUGH","FEATURE_TREE_ANALYSIS","COMPETITIVE_ANALYSIS"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (
  'c1a70000-0000-0000-0000-000000000001',
  'c1a70000-0000-0000-0000-000000000002',
  'c1a70000-0000-0000-0000-000000000003',
  'c1a70000-0000-0000-0000-000000000004'
);

UPDATE "work_item_type"
SET
  "allowed_child_types" = '["STANDARD","BUG","workflow"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000001';

UPDATE "work_item_type"
SET
  "allowed_child_types" = '["STANDARD","BUG","FEATURE","workflow"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000002';

UPDATE "work_item_type"
SET
  "allowed_child_types" = '["STANDARD","BUG","FEATURE","workflow"]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "id" = 'c1a70000-0000-0000-0000-000000000004';

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
) VALUES (
  'c1a70000-0000-0000-0000-000000000005',
  'workflow',
  true,
  NULL,
  'active',
  'Workflow',
  'A graph-shaped design artifact that owns workflow_step children and renders inline as a flow chart when mentioned.',
  '[{"key":"description","label":"Description"}]'::jsonb,
  '["STANDARD","FEATURE","BUG"]'::jsonb,
  '["workflow_step"]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DEPENDS_ON","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":[]},{"edgeType":"SUPERSEDES","targetTypeKeys":[]},{"edgeType":"CONTRADICTS","targetTypeKeys":[]},{"edgeType":"EVOLVES","targetTypeKeys":[]}]'::jsonb,
  '["BACKLOG","GENERATED","REFINING_DESCRIPTION","REFINING_DETAILS","REFINING_ACCEPTANCE_CRITERIA","GENERATING_DESCRIPTION","GENERATING_DETAILS","GENERATING_DESCRIPTION_AND_DETAILS","GENERATING_ACCEPTANCE_CRITERIA","GENERATING_ALL","ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '[]'::jsonb,
  '["tag","dueDate"]'::jsonb,
  '{"allowedParentEntityTypes":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","CODING_PROMPT","VALIDATION_SESSION","SERVICE","PLAN","REPORT","PROPOSAL","PLAN_STAGE","PLAN_STEP","IMPLEMENTATION_HINT","USER"]}'::jsonb,
  '{"isTrackingSource":false,"allowedTargetEntityTypes":[],"allowedTargetTaskTypes":[]}'::jsonb,
  '["BACKLOG","GENERATED","REFINING_DESCRIPTION","REFINING_DETAILS","REFINING_ACCEPTANCE_CRITERIA","GENERATING_DESCRIPTION","GENERATING_DETAILS","GENERATING_DESCRIPTION_AND_DETAILS","GENERATING_ACCEPTANCE_CRITERIA","GENERATING_ALL","ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '["CODING_RESEARCH","EVIDENCE_PIPELINE","SNAPSHOT","ROLLUP_PROPOSAL","DAILY_SESSION","GOAL_PROGRESS","RISK_ALERT","SESSION_SUMMARY","COMMIT","PLAN","IMPLEMENT","FEATURE_SYNC","FEATURE_SYNC_HANDOFF","FEATURE_SYNC_DECISION","DECISION_NEEDED","PHASE_GROUNDING","VALIDATION_WALKTHROUGH","FEATURE_TREE_ANALYSIS","COMPETITIVE_ANALYSIS"]'::jsonb,
  jsonb_build_object(
    'create',
    $ws$## What a workflow is

A workflow is a graph-shaped design artifact. It owns workflow_step
children and renders inline as a flow chart when mentioned from a design
doc, task, feature, or plan context.

## Section shape

Workflows are single-section: `description` names the process, boundary,
and intended outcome in plain language. Put individual states or actions
on workflow_step children rather than packing them into the workflow body.

## Discipline

Use workflow_step children for the graph nodes and typed flow edges for
sequence, conditions, loops, and fulfillment. A workflow-level handoff
must be reducible to a concrete step; create or target that step instead
of hiding the handoff on the container.$ws$,
    'edit',
    $ws$## Editing workflows

Edit when the workflow boundary, title, or summary changes. Keep the
container description focused on the process as a whole; move step-level
behavior to workflow_step children.

## Common edit failure modes

- **Inline chart detail in prose.** Add or edit workflow_step children and
  flow edges instead of narrating the chart in the description.
- **Container-level handoffs.** Cross-workflow relationships originate at
  workflow_step items so the graph records where the handoff occurs.$ws$
  ),
  '{"canHaveParent":true,"requiresParent":false,"canHaveChildren":true,"isHierarchyNode":false,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":true}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;

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
) VALUES (
  'c1a70000-0000-0000-0000-000000000006',
  'workflow_step',
  true,
  NULL,
  'active',
  'Workflow Step',
  'A leaf node inside a workflow that captures one state, action, decision, or handoff.',
  '[{"key":"description","label":"Description"}]'::jsonb,
  '["workflow"]'::jsonb,
  '[]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DEPENDS_ON","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":[]},{"edgeType":"SUPERSEDES","targetTypeKeys":[]},{"edgeType":"CONTRADICTS","targetTypeKeys":[]},{"edgeType":"EVOLVES","targetTypeKeys":[]}]'::jsonb,
  '["BACKLOG","GENERATED","REFINING_DESCRIPTION","REFINING_DETAILS","REFINING_ACCEPTANCE_CRITERIA","GENERATING_DESCRIPTION","GENERATING_DETAILS","GENERATING_DESCRIPTION_AND_DETAILS","GENERATING_ACCEPTANCE_CRITERIA","GENERATING_ALL","ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '[]'::jsonb,
  '["tag","dueDate"]'::jsonb,
  '{"allowedParentEntityTypes":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","CODING_PROMPT","VALIDATION_SESSION","SERVICE","PLAN","REPORT","PROPOSAL","PLAN_STAGE","PLAN_STEP","IMPLEMENTATION_HINT","USER"]}'::jsonb,
  '{"isTrackingSource":false,"allowedTargetEntityTypes":[],"allowedTargetTaskTypes":[]}'::jsonb,
  '["BACKLOG","GENERATED","REFINING_DESCRIPTION","REFINING_DETAILS","REFINING_ACCEPTANCE_CRITERIA","GENERATING_DESCRIPTION","GENERATING_DETAILS","GENERATING_DESCRIPTION_AND_DETAILS","GENERATING_ACCEPTANCE_CRITERIA","GENERATING_ALL","ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '["CODING_RESEARCH","EVIDENCE_PIPELINE","SNAPSHOT","ROLLUP_PROPOSAL","DAILY_SESSION","GOAL_PROGRESS","RISK_ALERT","SESSION_SUMMARY","COMMIT","PLAN","IMPLEMENT","FEATURE_SYNC","FEATURE_SYNC_HANDOFF","FEATURE_SYNC_DECISION","DECISION_NEEDED","PHASE_GROUNDING","VALIDATION_WALKTHROUGH","FEATURE_TREE_ANALYSIS","COMPETITIVE_ANALYSIS"]'::jsonb,
  jsonb_build_object(
    'create',
    $ws$## What a workflow step is

A workflow_step is one node inside a workflow. It describes a concrete
state, action, decision, or handoff that belongs to its parent workflow.

## Section shape

Workflow steps are single-section: `description` states what happens at
the node and what output or transition it produces. Keep it small enough
to render as a flow-chart node.

## Discipline

A workflow_step must live under a workflow. Use typed flow edges for
ordering and branching. Use fulfillment edges to point from the step to
the task, plan step, feature, or other work item that implements it.$ws$,
    'edit',
    $ws$## Editing workflow steps

Edit when a node label, local behavior, or fulfillment target changes.
Keep each step focused on a single node in the parent workflow.

## Common edit failure modes

- **Multiple nodes in one step.** Split separate actions or decisions into
  separate workflow_step children.
- **Fulfillment hidden in prose.** Record implementation ownership with an
  edge from the workflow_step instead of only describing it in text.$ws$
  ),
  '{"canHaveParent":true,"requiresParent":true,"canHaveChildren":false,"isHierarchyNode":false,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
