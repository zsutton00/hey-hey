import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import type { WorkItemType } from '@prisma/client';
import { InMemoryMessageBus } from '../../src/core/events/in-memory-message-bus.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { EntityType } from '../../src/generated/model/entityType';
import { ReportType } from '../../src/generated/model/reportType';
import { TaskSectionKey } from '../../src/generated/model/taskSectionKey';

import { WorkStatus } from '../../src/generated/model/workStatus';
import type { WorkItemTypeRole } from '../../src/generated/model/workItemTypeRole';
import type { WorkItemConfigKind } from '../../src/generated/model/workItemConfigKind';
import type { WorkItemTypeSectionDefinition } from '../../src/generated/model/workItemTypeSectionDefinition';
import { WorkItemTypeRegistryService } from '../../src/services/tasks/work-item-type-registry.service';

const ALL_ENTITY_TYPES = Object.values(EntityType);
const ALL_REPORT_TYPES = Object.values(ReportType);

const BASE_STATUSES: WorkStatus[] = [
  WorkStatus.Generated,
  WorkStatus.Backlog,
  WorkStatus.RefiningDescription,
  WorkStatus.RefiningDetails,
  WorkStatus.RefiningAcceptanceCriteria,
  WorkStatus.GeneratingDescription,
  WorkStatus.GeneratingDetails,
  WorkStatus.GeneratingDescriptionAndDetails,
  WorkStatus.GeneratingAcceptanceCriteria,
  WorkStatus.GeneratingAll,
  WorkStatus.Active,
  WorkStatus.OnHold,
  WorkStatus.Verifying,
  WorkStatus.Completed,
  WorkStatus.Cancelled,
  WorkStatus.Archived,
];
const SUPERSEDABLE_STATUSES: WorkStatus[] = [
  ...BASE_STATUSES,
  WorkStatus.Superseded,
];

const NOT_A_TRACKING_SOURCE = {
  allowedSourceEntityTypes: [] as EntityType[],
  allowedSourceTaskTypes: [] as string[],
};

const SECTION_LABELS: Record<string, string> = {
  description: 'Description',
  acceptanceCriteria: 'Acceptance Criteria',
  requirements: 'Requirements',
  graphLayout: 'Graph Layout',
  graphLayoutPreference: 'Graph Layout Preference',
  summary: 'Summary',
  executionDefinition: 'Execution Definition',
  outcome: 'Outcome',
  planConfiguration: 'Plan configuration',
};

export const STANDARD_WRITING_GUIDANCE = `**What a task is**

Write a task the user can review and an agent can carry out. A feature describes a capability; a task describes a concrete change that delivers it. Make the outcome, affected parts of the system, and consequential choices clear enough to approve.

**Ground the scope**

Base the task on the user’s request, their decisions and corrections, and applicable reviewed project requirements. Necessary implementation work belongs in scope; additional product behavior requires agreement. Engineering standards constrain implementation without authorizing additional outcomes. Apply this rule throughout the description, implementation, and acceptance criteria.

**Verify where the change belongs**

Establish which part of the system owns the behavior before choosing the parent and Services. When ownership or an implementation point is unclear, search the relevant project context. Do not assign work to the surface displaying a problem merely because that is where it was noticed. Include the complete known Service scope without guessing.

**Description**

Explain what changes and why in plain language. Reference applicable project knowledge rather than restating it. Keep file-level details in the implementation field.

**Implementation**

Identify the relevant Services, components, APIs, or files and explain what changes in each. Include established patterns, constraints, and consequential changes to responsibilities or interactions. Naming files alone is insufficient; an exhaustive symbol inventory is unnecessary.

Describe technical shapes or algorithms only when they are needed to understand a consequential choice or preserve an established decision. Multiple possible implementations do not by themselves require choosing one during task authoring. Leave routine engineering choices to the implementer.

When the change affects a boundary governed by a Contract, cite the applicable agreement and explain how the change honors it. Surface conflicts or missing durable agreements separately; topical overlap alone does not establish a Contract.

Resolve questions that materially change the outcome, scope, or architectural responsibility before submitting. A task need not settle every implementation detail to be ready.

**Acceptance criteria**

List concrete, verifiable results derived from the agreed scope. Include meaningful boundaries where needed. Remove redundant criteria rather than combining distinct results into dense bullets to meet a count.

**Preserve decisions and readability**

Preserve established decisions, constraints, and necessary rationale so another agent can continue without the conversation. Do not reopen settled choices or reconstruct unrelated history. Use direct language and enough detail to make the work reviewable; remove repetition and speculative detail.`;

const COMPLETE_SERVICE_SCOPE_FIXTURE = `## Complete known service scope

For a work-item type whose registry role is \`work-item\`, include \`serviceIds\` whenever implementation scope is known. The supplied IDs are the complete set: include every service explicitly mentioned in the description or implementation detail, without guessing additional services. On create, omit \`serviceIds\` only when scope is genuinely unknown. On edit, omit it to preserve current assignments; supply an empty array only to assert that the complete known set is empty.`;

const STANDARD_RELATIONSHIPS_FIXTURE = `## Structured relationships

Declare typed cross-entity relationships in the proposal's structured \`edges\` parameter. Prose mentions provide navigation but do not materialize graph edges. Declare \`SUPERSEDES\` on the successor proposal, targeting the predecessor; approval performs the atomic transition. Do not create raw \`SUPERSEDES\` edges or directly set \`SUPERSEDED\`.`;

const STANDARD_CREATE_FIELD_FIXTURE = `## The implementation field

\`create_work_item\` accepts a dedicated \`implementation\` parameter separate from the section list. The tool folds it into a trailing \`## Implementation\` block on the description. Do not hand-write that heading or duplicate the detail in the description prose.`;

const STANDARD_EDIT_FIELD_FIXTURE = `## The implementation field

\`edit_work_item\` accepts a dedicated \`implementation\` parameter separate from the section list. The tool folds it into a trailing \`## Implementation\` block on the description and preserves the existing description when no replacement description section is supplied. Do not hand-write that heading or duplicate the detail in the description prose.`;

const BUG_RESOLVED_CONTEXT_FIXTURE = `## Preserve resolved investigation context

Preserve every grounded investigation result required for a future agent to continue without the source conversation. This includes reproduction evidence, observed behavior and conditions, debugging observations, investigation results, an established root cause or narrowed hypotheses, materially useful rejected explanations, affected components and boundaries, and the agreed fix direction. Do not summarize away evidence or erase rejected explanations that materially narrow the remaining work.

Grounded context preservation takes precedence over ordinary concision and paragraph-count guidance when the detail is material. The evidence-backed scope rule still applies: preserve only content established by the user's request or authoritative, non-archived project context, and never invent behavior or detail.`;

const FEATURE_SCOPED_EDIT_FIXTURE = `## Scope to the initiating work

A feature can accumulate design and iteration across a long lifetime.
Scope an edit initiated from a task, plan, design doc, or other bounded
work context to the feature content that work actually affects. Preserve
unrelated feature and design-doc statements—even when they read as
definitive—unless the initiating request establishes that they are
affected.

## Roll-up check

Use topology and roll-up review to surface genuine conflicts introduced
by the scoped edit. A conflict is evidence to flag or clarify; it does
not authorize proposing unrelated feature edits automatically.`;

/** allowed_statuses with the intended initial status first (deriveRules reads [0]). */
function ordered(statuses: WorkStatus[], initial: WorkStatus): WorkStatus[] {
  return [initial, ...statuses.filter((status) => status !== initial)];
}

interface TypeFixture {
  name: string;
  initialStatus: WorkStatus;
  baseStatuses: WorkStatus[];
  sectionKeys: string[];
  requiredScalars: string[];
  forbiddenScalars: string[];
  allowedParentTypes: string[];
  allowedChildTypes: string[];
  tracking: {
    allowedSourceEntityTypes: EntityType[];
    allowedSourceTaskTypes: string[];
  };
  edgeTargets?: { edgeType: string; targetTypeKeys: string[] }[];
  parentageAllowedEntityTypes?: EntityType[];
  agentSettableStatuses?: WorkStatus[];
  anchorableReportTypes?: ReportType[];
  acceptedConfigKinds?: WorkItemConfigKind[];
  capabilities: Record<string, boolean>;
}

export type BuiltInTypeKey =
  | 'STANDARD'
  | 'FEATURE'
  | 'GOAL'
  | 'BUG'
  | 'CONTRACT'
  | 'PLAN'
  | 'PLAN_STAGE'
  | 'DIAGRAM'
  | 'DIAGRAM_ELEMENT'
  | 'workflow'
  | 'workflow_step'
  | 'TASK_MONITOR';

export const BUILT_IN_WORK_ITEM_TYPE_KEYS: BuiltInTypeKey[] = [
  WORK_ITEM_TYPE_KEYS.Standard,
  WORK_ITEM_TYPE_KEYS.Feature,
  WORK_ITEM_TYPE_KEYS.Goal,
  WORK_ITEM_TYPE_KEYS.Bug,
  WORK_ITEM_TYPE_KEYS.Contract,
  WORK_ITEM_TYPE_KEYS.Plan,
  WORK_ITEM_TYPE_KEYS.PlanStage,
  WORK_ITEM_TYPE_KEYS.Diagram,
  WORK_ITEM_TYPE_KEYS.DiagramElement,
  'workflow',
  'workflow_step',
  WORK_ITEM_TYPE_KEYS.TaskMonitor,
];

const SYSTEM_ROW_IDS: Record<BuiltInTypeKey, string> = {
  STANDARD: 'c1a70000-0000-0000-0000-000000000001',
  FEATURE: 'c1a70000-0000-0000-0000-000000000002',
  GOAL: 'c1a70000-0000-0000-0000-000000000003',
  BUG: 'c1a70000-0000-0000-0000-000000000004',
  CONTRACT: 'c1a70000-0000-0000-0000-000000000008',
  PLAN: 'c1a70000-0000-0000-0000-000000000009',
  PLAN_STAGE: 'c1a70000-0000-0000-0000-000000000010',
  DIAGRAM: 'c1a70000-0000-0000-0000-000000000011',
  DIAGRAM_ELEMENT: 'c1a70000-0000-0000-0000-000000000012',
  workflow: 'c1a70000-0000-0000-0000-000000000005',
  workflow_step: 'c1a70000-0000-0000-0000-000000000006',
  TASK_MONITOR: 'c1a70000-0000-0000-0000-000000000007',
};

// Most consumers of this shared fixture use one of these stable project
// scopes. A real project receives these rows from the materializer; keeping
// the same shape here prevents tests from relying on global rows as an
// effective project snapshot.
const DEFAULT_PROJECT_IDS = [
  '123e4567-e89b-42d3-a456-426614174003',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'test-proj-123',
  'test-project-789',
];

const TYPE_FIXTURES: Record<BuiltInTypeKey, TypeFixture> = {
  STANDARD: {
    name: 'Task',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [
      TaskSectionKey.Description,
      TaskSectionKey.AcceptanceCriteria,
    ],
    requiredScalars: [],
    forbiddenScalars: ['tag'],
    allowedParentTypes: ['FEATURE', 'STANDARD', 'PLAN_STAGE'],
    allowedChildTypes: ['STANDARD', 'BUG', 'TASK_MONITOR'],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: true,
      planEligible: true,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
  FEATURE: {
    name: 'Feature',
    initialStatus: WorkStatus.Active,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [TaskSectionKey.Description, TaskSectionKey.Requirements],
    requiredScalars: ['tag'],
    forbiddenScalars: [],
    allowedParentTypes: ['FEATURE'],
    allowedChildTypes: [
      'STANDARD',
      'BUG',
      'FEATURE',
      'workflow',
      'TASK_MONITOR',
    ],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: false,
      planEligible: true,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: true,
    },
  },
  GOAL: {
    name: 'Goal',
    initialStatus: WorkStatus.Active,
    baseStatuses: BASE_STATUSES,
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['tag'],
    allowedParentTypes: [],
    allowedChildTypes: [],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [],
    capabilities: {
      requiresParent: false,
      planEligible: true,
      hasSetInitialStatus: true,
      rendersInline: false,
      showsInExplorerSidebar: true,
    },
  },
  BUG: {
    name: 'Bug',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: BASE_STATUSES,
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['tag'],
    allowedParentTypes: ['FEATURE'],
    allowedChildTypes: ['STANDARD', 'BUG', 'FEATURE', 'workflow'],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: true,
      planEligible: true,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
  CONTRACT: {
    name: 'Contract',
    initialStatus: WorkStatus.Active,
    baseStatuses: [
      WorkStatus.Active,
      WorkStatus.Superseded,
      WorkStatus.Archived,
    ],
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Feature],
    allowedChildTypes: [],
    tracking: NOT_A_TRACKING_SOURCE,
    edgeTargets: [
      { edgeType: 'DEPENDS_ON', targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Feature] },
      { edgeType: 'RELATED_TO', targetTypeKeys: [] },
      {
        edgeType: 'SUPERSEDES',
        targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
      },
    ],
    parentageAllowedEntityTypes: [EntityType.Task],
    anchorableReportTypes: [],
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
  PLAN: {
    name: 'Plan',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: [
      WorkStatus.Backlog,
      WorkStatus.Refining,
      WorkStatus.Ready,
      WorkStatus.Active,
      WorkStatus.OnHold,
      WorkStatus.Blocked,
      WorkStatus.Verifying,
      WorkStatus.Completed,
      WorkStatus.Archived,
    ],
    sectionKeys: ['outcome', TaskSectionKey.Description, 'planConfiguration'],
    requiredScalars: [],
    forbiddenScalars: ['dueDate', 'tag'],
    allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Feature],
    allowedChildTypes: [WORK_ITEM_TYPE_KEYS.PlanStage],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: true,
    },
  },
  PLAN_STAGE: {
    name: 'Plan stage',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: [
      WorkStatus.Backlog,
      WorkStatus.Refining,
      WorkStatus.Active,
      WorkStatus.Blocked,
      WorkStatus.Completed,
      WorkStatus.Archived,
    ],
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['dueDate', 'tag'],
    allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Plan],
    allowedChildTypes: [WORK_ITEM_TYPE_KEYS.Standard],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
  DIAGRAM: {
    name: 'Diagram',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [
      TaskSectionKey.Description,
      'graphLayout',
      'graphLayoutPreference',
    ],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: ['FEATURE', 'STANDARD'],
    allowedChildTypes: [WORK_ITEM_TYPE_KEYS.DiagramElement],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: false,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: true,
      showsInExplorerSidebar: false,
    },
  },
  DIAGRAM_ELEMENT: {
    name: 'Diagram Element',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Diagram],
    allowedChildTypes: [],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [EntityType.Task],
    edgeTargets: [
      {
        edgeType: 'GUARANTEES',
        targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
      },
    ],
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
  workflow: {
    name: 'Workflow',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [
      TaskSectionKey.Description,
      'graphLayout',
      'graphLayoutPreference',
    ],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: ['FEATURE', 'STANDARD'],
    allowedChildTypes: ['workflow_step'],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: false,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: true,
      showsInExplorerSidebar: false,
    },
  },
  workflow_step: {
    name: 'Workflow Step',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: ['workflow'],
    allowedChildTypes: [],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [EntityType.Task],
    edgeTargets: [
      {
        edgeType: 'DEPENDS_ON',
        targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
      },
    ],
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
  TASK_MONITOR: {
    name: 'Task Monitor',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: [
      WorkStatus.Backlog,
      WorkStatus.Ready,
      WorkStatus.Active,
      WorkStatus.OnHold,
      WorkStatus.Verifying,
      WorkStatus.Completed,
      WorkStatus.Cancelled,
      WorkStatus.Archived,
      WorkStatus.Superseded,
    ],
    sectionKeys: ['summary', 'executionDefinition'],
    requiredScalars: [],
    forbiddenScalars: ['dueDate', 'tag'],
    allowedParentTypes: [
      WORK_ITEM_TYPE_KEYS.Feature,
      WORK_ITEM_TYPE_KEYS.Standard,
    ],
    allowedChildTypes: [],
    tracking: NOT_A_TRACKING_SOURCE,
    parentageAllowedEntityTypes: [EntityType.Task],
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
};

function buildRow(taskType: BuiltInTypeKey): WorkItemType {
  const fx = TYPE_FIXTURES[taskType];
  const allowedStatuses = ordered(fx.baseStatuses, fx.initialStatus);
  return {
    id: SYSTEM_ROW_IDS[taskType],
    typeKey: taskType,
    isSystem: true,
    projectId: null,
    lifecycleStatus: 'active',
    name: fx.name,
    role:
      taskType === WORK_ITEM_TYPE_KEYS.TaskMonitor
        ? 'monitor'
        : taskType === WORK_ITEM_TYPE_KEYS.Standard ||
            taskType === WORK_ITEM_TYPE_KEYS.Bug
          ? 'work-item'
          : 'project-info',
    description: `${fx.name} work item`,
    sectionDefinitions: fx.sectionKeys.map((key) =>
      key === 'requirements'
        ? {
            key,
            label: SECTION_LABELS[key],
            kind: 'json',
            schemaRef: '#/components/schemas/FeatureRequirementsSection',
          }
        : key === 'graphLayout'
          ? {
              key,
              label: SECTION_LABELS[key],
              kind: 'json',
              schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
            }
          : key === 'graphLayoutPreference'
            ? {
                key,
                label: SECTION_LABELS[key],
                kind: 'json',
                required: false,
                schemaRef:
                  '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
              }
            : key === 'executionDefinition'
              ? {
                  key,
                  label: SECTION_LABELS[key],
                  kind: 'json',
                  schemaRef:
                    '#/components/schemas/TaskMonitorExecutionDefinition',
                }
              : key === 'planConfiguration'
                ? {
                    key,
                    label: SECTION_LABELS[key],
                    kind: 'json',
                    schemaRef: '#/components/schemas/PlanConfigurationV1',
                  }
                : {
                    key,
                    label: SECTION_LABELS[key],
                    kind: 'markdown',
                  },
    ),
    allowedParentTypes: fx.allowedParentTypes,
    allowedChildTypes: fx.allowedChildTypes,
    edgeTargets: fx.edgeTargets ?? [],
    allowedStatuses,
    requiredScalars: fx.requiredScalars,
    forbiddenScalars: fx.forbiddenScalars,
    parentage: {
      allowedParentEntityTypes:
        fx.parentageAllowedEntityTypes ?? ALL_ENTITY_TYPES,
    },
    tracking: fx.tracking,
    agentSettableStatuses: fx.agentSettableStatuses ?? allowedStatuses,
    anchorableReportTypes: fx.anchorableReportTypes ?? ALL_REPORT_TYPES,
    writingStandards:
      taskType === WORK_ITEM_TYPE_KEYS.Standard
        ? {
            create: `${STANDARD_WRITING_GUIDANCE}\n\n${STANDARD_CREATE_FIELD_FIXTURE}\n\n${STANDARD_RELATIONSHIPS_FIXTURE}\n\n${COMPLETE_SERVICE_SCOPE_FIXTURE}`,
            edit: `${STANDARD_WRITING_GUIDANCE}\n\n${STANDARD_EDIT_FIELD_FIXTURE}\n\n${STANDARD_RELATIONSHIPS_FIXTURE}\n\n${COMPLETE_SERVICE_SCOPE_FIXTURE}`,
          }
        : taskType === WORK_ITEM_TYPE_KEYS.Bug
          ? {
              create: `BUG create guidance\n\n${BUG_RESOLVED_CONTEXT_FIXTURE}`,
              edit: `BUG edit guidance\n\n${BUG_RESOLVED_CONTEXT_FIXTURE}`,
            }
          : taskType === WORK_ITEM_TYPE_KEYS.Feature
            ? {
                create: `${taskType} create guidance`,
                edit: `${taskType} edit guidance\n\n${FEATURE_SCOPED_EDIT_FIXTURE}`,
              }
            : {
                create: `${taskType} create guidance`,
                edit: `${taskType} edit guidance`,
              },
    acceptedConfigKinds:
      fx.acceptedConfigKinds ??
      (taskType === WORK_ITEM_TYPE_KEYS.Standard ? ['INITIAL_WORKTREE'] : []),
    capabilities: fx.capabilities,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  } as unknown as WorkItemType;
}

function buildProjectOwnedRow(
  taskType: BuiltInTypeKey,
  projectId: string,
): WorkItemType {
  return {
    ...buildRow(taskType),
    id: `project-${projectId}-${taskType}`,
    isSystem: false,
    projectId,
  } as unknown as WorkItemType;
}

function buildProjectOwnedBuiltInRows(projectId: string): WorkItemType[] {
  return BUILT_IN_WORK_ITEM_TYPE_KEYS.map((typeKey) =>
    buildProjectOwnedRow(typeKey, projectId),
  );
}

/**
 * The built-in system `work_item_type` rows in the canonical column shape
 * the registry's {@link WorkItemTypeRegistryService.refresh} reads. Exposed so a
 * test can seed a *live* in-memory Prisma double (one whose `create` appends and
 * `findMany` reads back) with the built-ins, then watch a freshly accepted
 * custom type land in the same snapshot — distinct from the warm fixtures below,
 * whose `findMany` returns a frozen array.
 */
export function buildBuiltInWorkItemTypeRows(
  projectId?: string,
): WorkItemType[] {
  const rows = BUILT_IN_WORK_ITEM_TYPE_KEYS.map(buildRow);
  return projectId
    ? [...rows, ...buildProjectOwnedBuiltInRows(projectId)]
    : rows;
}

/**
 * Build a WorkItemTypeRegistryService with its snapshot already warmed from
 * global rows plus project-owned canonical rows for the stable fixture scopes.
 * The snapshot is populated before the service is returned, so callers can use
 * it immediately without awaiting a separate refresh.
 */
export async function createWarmWorkItemTypeRegistry(): Promise<WorkItemTypeRegistryService> {
  return warmRegistry([
    ...buildBuiltInWorkItemTypeRows(),
    ...DEFAULT_PROJECT_IDS.flatMap(buildProjectOwnedBuiltInRows),
  ]);
}

/**
 * Spec for a non-system, project-scoped custom type row — the shape an accepted
 * `create_work_item_type` proposal persists. Defaults mirror a typical custom
 * type: a child-only, non-tracking type with description + requirements
 * sections and `tag` forbidden. Override any axis to exercise a specific rule.
 */
export interface CustomTypeRowSpec {
  typeKey: string;
  projectId: string;
  name?: string;
  role?: WorkItemTypeRole;
  initialStatus?: WorkStatus;
  /**
   * Declared section keys, in order. Typed as a free `string[]` — not
   * `TaskSectionKey[]` — because a custom type may declare section keys outside
   * the built-in enum (e.g. `audience`); the registry treats the key set as open.
   */
  sectionKeys?: string[];
  sectionDefinitions?: WorkItemTypeSectionDefinition[];
  /**
   * Restricted allowed-status set, in any order. Defaults to the full
   * supersedable set. Use a short list (e.g. `[BACKLOG, ACTIVE]`) to exercise
   * the per-type status contract — a status outside this set must be rejected
   * on both create and edit.
   */
  allowedStatuses?: WorkStatus[];
  requiredScalars?: string[];
  forbiddenScalars?: string[];
  allowedParentTypes?: string[];
  allowedParentEntityTypes?: EntityType[];
  allowedChildTypes?: string[];
  tracking?: {
    allowedSourceEntityTypes: EntityType[];
    allowedSourceTaskTypes: string[];
  };
  capabilities?: Record<string, unknown>;
  lifecycleStatus?: 'active' | 'archived';
  writingStandards?: { create: string; edit: string };
  acceptedConfigKinds?: WorkItemConfigKind[];
  edgeTargets?: { edgeType: string; targetTypeKeys: string[] }[];
}

const DEFAULT_CUSTOM_CAPABILITIES: Record<string, boolean> = {
  requiresParent: false,
  planEligible: true,
  hasSetInitialStatus: false,
  rendersInline: false,
  showsInExplorerSidebar: false,
};

function buildCustomRow(spec: CustomTypeRowSpec): WorkItemType {
  const initialStatus = spec.initialStatus ?? WorkStatus.Backlog;
  const sectionKeys = spec.sectionKeys ?? [
    TaskSectionKey.Description,
    TaskSectionKey.Requirements,
  ];
  const allowedStatuses = ordered(
    spec.allowedStatuses ?? SUPERSEDABLE_STATUSES,
    initialStatus,
  );
  const { graph, ...capabilities } =
    spec.capabilities ?? DEFAULT_CUSTOM_CAPABILITIES;
  return {
    id: `custom-${spec.typeKey}-${spec.projectId}`,
    typeKey: spec.typeKey,
    isSystem: false,
    projectId: spec.projectId,
    lifecycleStatus: spec.lifecycleStatus ?? 'active',
    name: spec.name ?? spec.typeKey,
    role: spec.role ?? 'work-item',
    description: `${spec.typeKey} work item`,
    sectionDefinitions:
      spec.sectionDefinitions ??
      sectionKeys.map((key) => ({
        key,
        label: SECTION_LABELS[key] ?? key,
      })),
    allowedParentTypes: spec.allowedParentTypes ?? [],
    allowedChildTypes: spec.allowedChildTypes ?? [],
    edgeTargets: spec.edgeTargets ?? [],
    allowedStatuses,
    requiredScalars: spec.requiredScalars ?? [],
    forbiddenScalars: spec.forbiddenScalars ?? ['tag'],
    parentage: {
      allowedParentEntityTypes:
        spec.allowedParentEntityTypes ?? ALL_ENTITY_TYPES,
    },
    tracking: spec.tracking ?? NOT_A_TRACKING_SOURCE,
    agentSettableStatuses: allowedStatuses,
    anchorableReportTypes: ALL_REPORT_TYPES,
    writingStandards: spec.writingStandards ?? { create: '', edit: '' },
    acceptedConfigKinds: spec.acceptedConfigKinds ?? [],
    capabilities,
    graphConfiguration: graph ?? null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  } as unknown as WorkItemType;
}

/**
 * Warm a registry from the four built-in system types PLUS the supplied
 * project-scoped custom types. The custom rows land in the per-project rules
 * map, so they resolve only for their own `projectId` and key — built-in
 * behaviour for every other type and project is unchanged.
 */
export async function createWarmWorkItemTypeRegistryWithCustomTypes(
  customSpecs: CustomTypeRowSpec[],
): Promise<WorkItemTypeRegistryService> {
  const projectIds = [
    ...new Set([
      ...DEFAULT_PROJECT_IDS,
      ...customSpecs.map((spec) => spec.projectId),
    ]),
  ];
  return warmRegistry([
    ...BUILT_IN_WORK_ITEM_TYPE_KEYS.map(buildRow),
    ...projectIds.flatMap(buildProjectOwnedBuiltInRows),
    ...customSpecs.map(buildCustomRow),
  ]);
}

async function warmRegistry(
  rows: WorkItemType[],
): Promise<WorkItemTypeRegistryService> {
  const projectRows = rows.filter((row) => row.projectId !== null);
  const templates = rows.filter((row) => row.projectId === null);
  const projectIds = [
    ...new Set(projectRows.map((row) => row.projectId as string)),
  ];
  const prisma = {
    project: {
      findMany: jest.fn().mockResolvedValue(projectIds.map((id) => ({ id }))),
    },
    workItemType: { findMany: jest.fn().mockResolvedValue(projectRows) },
    workItemTypeTemplate: {
      findMany: jest.fn().mockResolvedValue(templates),
    },
  } as unknown as PrismaService;
  const registry = new WorkItemTypeRegistryService(
    prisma,
    new InMemoryMessageBus(),
  );
  await registry.refresh();
  return registry;
}

/**
 * Build a WorkItemTypeRegistryService whose project-owned `archivedType` rows
 * are marked as archived and all other project-owned built-ins are active.
 * Global rows remain available only to protected system accessors.
 */
export async function createRegistryWithArchivedSystemType(
  archivedType: BuiltInTypeKey,
): Promise<WorkItemTypeRegistryService> {
  const rows = [
    ...BUILT_IN_WORK_ITEM_TYPE_KEYS.map(buildRow),
    ...DEFAULT_PROJECT_IDS.flatMap((projectId) =>
      BUILT_IN_WORK_ITEM_TYPE_KEYS.map((typeKey) =>
        typeKey === archivedType
          ? ({
              ...buildProjectOwnedRow(typeKey, projectId),
              lifecycleStatus: 'archived',
            } as unknown as WorkItemType)
          : buildProjectOwnedRow(typeKey, projectId),
      ),
    ),
  ];
  return warmRegistry(rows);
}
