-- Add the TASK_MONITOR system work-item type.
-- Append-only delta: prior work_item_type migrations are already committed.

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
  'c1a70000-0000-0000-0000-000000000007',
  'TASK_MONITOR',
  true,
  NULL,
  'active',
  'Task Monitor',
  'A reusable work item that stores selected-work execution intent, dependency/order shape, policies, cursor, linked session references, checkpoint summaries, and halt state while leaving task, session, message, and report evidence on their owning records.',
  $wit$
[
  {
    "key": "summary",
    "label": "Summary",
    "kind": "markdown",
    "writingStandard": "Short human orientation for the selected execution run."
  },
  {
    "key": "executionDefinition",
    "label": "Execution Definition",
    "kind": "json",
    "schemaRef": "#/components/schemas/TaskMonitorExecutionDefinition",
    "writingStandard": "Schema-backed selected-run state. Store IDs, policies, cursor, checkpoint summaries, and halt state; do not copy task/session/message/report bodies or status mirrors."
  }
]
$wit$::jsonb,
  '["FEATURE","STANDARD"]'::jsonb,
  '[]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DEPENDS_ON","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":[]},{"edgeType":"SUPERSEDES","targetTypeKeys":[]},{"edgeType":"CONTRADICTS","targetTypeKeys":[]},{"edgeType":"EVOLVES","targetTypeKeys":[]}]'::jsonb,
  '["BACKLOG","READY","ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '[]'::jsonb,
  '["dueDate","tag"]'::jsonb,
  '{"allowedParentEntityTypes":["ARTIFACT","INITIATIVE","PROJECT","TASK","MESSAGE","CONVERSATION","DESIGN_DOC","AGENT_SESSION","CODING_PROMPT","VALIDATION_SESSION","SERVICE","PLAN","REPORT","PROPOSAL","PLAN_STAGE","PLAN_STEP","IMPLEMENTATION_HINT","USER"]}'::jsonb,
  '{"isTrackingSource":false,"allowedTargetEntityTypes":[],"allowedTargetTaskTypes":[]}'::jsonb,
  '["BACKLOG","READY","ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED","SUPERSEDED"]'::jsonb,
  '["CODING_RESEARCH","EVIDENCE_PIPELINE","SNAPSHOT","ROLLUP_PROPOSAL","DAILY_SESSION","GOAL_PROGRESS","RISK_ALERT","SESSION_SUMMARY","COMMIT","PLAN","IMPLEMENT","FEATURE_SYNC","FEATURE_SYNC_HANDOFF","FEATURE_SYNC_DECISION","DECISION_NEEDED","PHASE_GROUNDING","VALIDATION_WALKTHROUGH","FEATURE_TREE_ANALYSIS","COMPETITIVE_ANALYSIS"]'::jsonb,
  jsonb_build_object(
    'create',
    $ws$## What a task monitor is

A task monitor records selected-work execution state. It coordinates a
bounded run while tasks, agent sessions, messages, and reports remain the
owners of their own live evidence.

## Section shape

`summary` is short markdown for human orientation. `executionDefinition`
is JSON backed by TaskMonitorExecutionDefinition and must hold references
to evidence records rather than copied task, session, message, or report
bodies.

## Discipline

Keep order and cursor state local to the monitor. Do not turn selected-run
ordering into durable project topology, and do not mirror task, session,
message, or report status fields in monitor JSON.$ws$,
    'edit',
    $ws$## Editing task monitors

Edit when selected execution intent, policies, cursor state, linked
session references, checkpoint summaries, or halt state changes.

## Common edit failure modes

- **Copied evidence.** Store IDs and summaries only; leave full task,
  session, message, and report bodies on their owning records.
- **Status mirrors.** Do not duplicate task, session, message, or report
  statuses inside the monitor definition.
- **Topology leakage.** Selected-run dependency/order state belongs in the
  monitor definition, not in project graph edges.$ws$
  ),
  '{"canHaveParent":true,"requiresParent":true,"canHaveChildren":false,"isHierarchyNode":false,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false,"participatesInFeatureHierarchy":false,"canBeTrackedByGoals":false,"supportsJsonSections":true,"canOwnReports":false,"canOwnAgentSessions":false}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
) ON CONFLICT ("id") DO NOTHING;
