import { SessionRole } from '../../../generated/model/sessionRole';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  Prisma,
  type WorkItemType,
  type WorkItemTypeTemplate,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { InMemoryMessageBus } from '../../../core/events/in-memory-message-bus.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import { EntityType } from '../../../generated/model/entityType';
import { ReportType } from '../../../generated/model/reportType';
import { TaskSectionKey } from '../../../generated/model/taskSectionKey';
import { WorkItemTypeLifecycleStatus } from '../../../generated/model/workItemTypeLifecycleStatus';
import { WorkItemTypeGuidancePurpose } from '../../../generated/model/workItemTypeGuidancePurpose';
import { WorkItemTypeEffectiveSource } from '../../../generated/model/workItemTypeEffectiveSource';

import { WorkStatus } from '../../../generated/model/workStatus';
import type { WorkItemConfigKind } from '../../../generated/model/workItemConfigKind';
import { AgentEdgeType } from '../../../generated/model/agentEdgeType';
import { WorkItemIconKey } from '../../../generated/model/workItemIconKey';
import type { WorkItemTypeDefinitionDto } from '../../../generated/model/workItemTypeDefinitionDto';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import type { OrganizationId, ProjectId } from '../../../types';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';

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
  summary: 'Summary',
  executionDefinition: 'Execution Definition',
};

/** allowed_statuses with the intended initial status first (deriveRules reads [0]). */
function ordered(statuses: WorkStatus[], initial: WorkStatus): WorkStatus[] {
  return [initial, ...statuses.filter((status) => status !== initial)];
}

interface TypeFixture {
  name: string;
  initialStatus: WorkStatus;
  baseStatuses: WorkStatus[];
  sectionKeys: string[];
  sectionDefinitions?: Array<{
    key: string;
    label: string;
    kind: 'markdown' | 'json';
    schemaRef?: string;
  }>;
  requiredScalars: string[];
  forbiddenScalars: string[];
  allowedParentTypes: string[];
  tracking: {
    allowedSourceEntityTypes: EntityType[];
    allowedSourceTaskTypes: string[];
  };
  edgeTargets?: { edgeType: string; targetTypeKeys: string[] }[];
  parentageAllowedEntityTypes?: EntityType[];
  agentSettableStatuses?: WorkStatus[];
  anchorableReportTypes?: ReportType[];
  capabilities: Record<string, boolean>;
  graphConfiguration?: ReturnType<typeof workflowGraphCapability>;
}

type BuiltInTypeKey =
  | 'STANDARD'
  | 'FEATURE'
  | 'GOAL'
  | 'BUG'
  | 'CONTRACT'
  | 'workflow'
  | 'workflow_step'
  | 'TASK_MONITOR';

const BUILT_IN_TYPE_KEYS: BuiltInTypeKey[] = [
  WORK_ITEM_TYPE_KEYS.Standard,
  WORK_ITEM_TYPE_KEYS.Feature,
  WORK_ITEM_TYPE_KEYS.Goal,
  WORK_ITEM_TYPE_KEYS.Bug,
  WORK_ITEM_TYPE_KEYS.Contract,
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
  workflow: 'c1a70000-0000-0000-0000-000000000005',
  workflow_step: 'c1a70000-0000-0000-0000-000000000006',
  TASK_MONITOR: 'c1a70000-0000-0000-0000-000000000007',
};

function graphCapability(nodeChildType = 'workflow_step') {
  return {
    nodeChildType,
    layout: {
      sectionKey: 'graphLayout',
      schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
    },
    layoutPreference: {
      sectionKey: 'graphLayoutPreference',
      schemaRef: '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
    },
    readableRelationships: [
      {
        edgeType: AgentEdgeType.Standard,
        category: 'flow',
        sourceEndpoint: {
          role: 'graphNode',
          entityTypes: ['TASK'],
          workItemTypeKeys: [nodeChildType],
        },
        targetEndpoint: {
          role: 'graphNode',
          entityTypes: ['TASK'],
          workItemTypeKeys: [nodeChildType],
        },
        direction: {
          required: true,
          allowedDirections: ['forward'],
        },
      },
    ],
    editableRelationships: [
      {
        edgeType: AgentEdgeType.Standard,
        category: 'flow',
        sourceEndpoint: {
          role: 'graphNode',
          entityTypes: ['TASK'],
          workItemTypeKeys: [nodeChildType],
        },
        targetEndpoint: {
          role: 'graphNode',
          entityTypes: ['TASK'],
          workItemTypeKeys: [nodeChildType],
        },
        direction: {
          required: true,
          allowedDirections: ['forward'],
        },
      },
    ],
    searchableMetaLinkTargets: [],
    rendererKey: 'work-item-graph',
    editorKey: 'work-item-graph-editor',
    supportedActions: ['viewGraph', 'replaceLayout'],
  };
}

function workflowGraphCapability() {
  const nodeEndpoint = {
    role: 'graphNode' as const,
    entityTypes: ['TASK'] as const,
    workItemTypeKeys: ['workflow_step'],
  };
  const metadataSchemaRef = '#/components/schemas/RelationshipMetadata';
  const relationships = [
    {
      edgeType: AgentEdgeType.Standard,
      category: 'flow' as const,
      sourceEndpoint: nodeEndpoint,
      targetEndpoint: nodeEndpoint,
      direction: {
        required: true,
        allowedDirections: ['forward'] as const,
        predicateRequired: false,
      },
      metadataSchemaRef,
    },
    {
      edgeType: AgentEdgeType.Conditional,
      category: 'flow' as const,
      sourceEndpoint: nodeEndpoint,
      targetEndpoint: nodeEndpoint,
      direction: {
        required: true,
        allowedDirections: ['forward'] as const,
        predicateRequired: true,
      },
      metadataSchemaRef,
    },
    {
      edgeType: AgentEdgeType.Loop,
      category: 'flow' as const,
      sourceEndpoint: nodeEndpoint,
      targetEndpoint: nodeEndpoint,
      direction: {
        required: false,
        allowedDirections: [] as const,
        predicateRequired: false,
      },
      metadataSchemaRef,
    },
    {
      edgeType: AgentEdgeType.FulfilledBy,
      category: 'meta' as const,
      sourceEndpoint: nodeEndpoint,
      targetEndpoint: {
        role: 'externalEntity' as const,
        entityTypes: ['TASK'] as const,
      },
      direction: {
        required: false,
        allowedDirections: [] as const,
        predicateRequired: false,
      },
      metadataSchemaRef,
    },
    {
      edgeType: AgentEdgeType.DependsOn,
      category: 'meta' as const,
      sourceEndpoint: nodeEndpoint,
      targetEndpoint: {
        role: 'externalEntity' as const,
        entityTypes: ['TASK'] as const,
        workItemTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
      },
      direction: {
        required: false,
        allowedDirections: [] as const,
        predicateRequired: false,
      },
      metadataSchemaRef,
    },
  ];

  return {
    nodeChildType: 'workflow_step',
    layout: {
      sectionKey: 'graphLayout',
      schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
    },
    layoutPreference: {
      sectionKey: 'graphLayoutPreference',
      schemaRef: '#/components/schemas/WorkItemGraphLayoutPreferenceValue',
    },
    readableRelationships: relationships,
    editableRelationships: relationships,
    searchableMetaLinkTargets: [
      {
        edgeType: AgentEdgeType.FulfilledBy,
        targetEntityTypes: ['TASK'] as const,
      },
      {
        edgeType: AgentEdgeType.DependsOn,
        targetEntityTypes: ['TASK'] as const,
        targetWorkItemTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
      },
    ],
    rendererKey: 'work-item-graph',
    editorKey: 'work-item-graph-editor',
    supportedActions: [
      'viewGraph',
      'createNode',
      'updateNode',
      'deleteNode',
      'createRelationship',
      'updateRelationship',
      'reconnectRelationship',
      'deleteRelationship',
      'replaceLayout',
      'clearLayout',
    ] as const,
  };
}

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
    allowedParentTypes: ['FEATURE', 'STANDARD'],
    parentageAllowedEntityTypes: [EntityType.Task],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
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
    parentageAllowedEntityTypes: [EntityType.Task],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
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
    requiredScalars: ['dueDate'],
    forbiddenScalars: ['tag'],
    allowedParentTypes: [],
    parentageAllowedEntityTypes: [],
    tracking: NOT_A_TRACKING_SOURCE,
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
    parentageAllowedEntityTypes: [EntityType.Task],
    tracking: {
      allowedSourceEntityTypes: [EntityType.Task],
      allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
    },
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
    tracking: NOT_A_TRACKING_SOURCE,
    edgeTargets: [
      {
        edgeType: AgentEdgeType.DependsOn,
        targetTypeKeys: [WORK_ITEM_TYPE_KEYS.Feature],
      },
      { edgeType: AgentEdgeType.RelatedTo, targetTypeKeys: [] },
      {
        edgeType: AgentEdgeType.Supersedes,
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
  workflow: {
    name: 'Workflow',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [TaskSectionKey.Description, 'graphLayout'],
    sectionDefinitions: [
      {
        key: TaskSectionKey.Description,
        label: 'Description',
        kind: 'markdown',
      },
      {
        key: 'graphLayout',
        label: 'Graph Layout',
        kind: 'json',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
      },
    ],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: ['FEATURE', 'STANDARD'],
    parentageAllowedEntityTypes: [EntityType.Task],
    tracking: NOT_A_TRACKING_SOURCE,
    capabilities: {
      requiresParent: false,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: true,
      showsInExplorerSidebar: false,
    },
    graphConfiguration: workflowGraphCapability(),
  },
  workflow_step: {
    name: 'Workflow Step',
    initialStatus: WorkStatus.Backlog,
    baseStatuses: SUPERSEDABLE_STATUSES,
    sectionKeys: [TaskSectionKey.Description],
    requiredScalars: [],
    forbiddenScalars: ['tag', 'dueDate'],
    allowedParentTypes: ['workflow'],
    parentageAllowedEntityTypes: [EntityType.Task],
    tracking: NOT_A_TRACKING_SOURCE,
    edgeTargets: [
      {
        edgeType: AgentEdgeType.DependsOn,
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
    parentageAllowedEntityTypes: [EntityType.Task],
    tracking: NOT_A_TRACKING_SOURCE,
    capabilities: {
      requiresParent: true,
      planEligible: false,
      hasSetInitialStatus: false,
      rendersInline: false,
      showsInExplorerSidebar: false,
    },
  },
};

/**
 * Builds the Postgres row exactly as Prisma would return it for a system
 * work_item_type after the collapse — the stored WorkItemTypeDefinitionDto
 * columns plus the capabilities map, JSONB columns as already-parsed plain JSON.
 * The registry derives every rule from this shape via deriveRules, so the
 * accessor assertions exercise the same derivation production runs.
 */
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
      taskType === WORK_ITEM_TYPE_KEYS.Standard ||
      taskType === WORK_ITEM_TYPE_KEYS.Bug
        ? 'work-item'
        : 'project-info',
    description: `${fx.name} work item`,
    sectionDefinitions:
      fx.sectionDefinitions ??
      fx.sectionKeys.map((key) =>
        key === 'executionDefinition'
          ? {
              key,
              label: SECTION_LABELS[key],
              kind: 'json',
              schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
            }
          : taskType === WORK_ITEM_TYPE_KEYS.Feature &&
              key === TaskSectionKey.Requirements
            ? {
                key,
                label: SECTION_LABELS[key],
                kind: 'json',
                schemaRef: '#/components/schemas/FeatureRequirementsSection',
              }
            : {
                key,
                label: SECTION_LABELS[key],
                kind: 'markdown',
              },
      ),
    allowedParentTypes: fx.allowedParentTypes,
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
    writingStandards: {
      create: `${taskType} create guidance`,
      edit: `${taskType} edit guidance`,
    },
    acceptedConfigKinds:
      taskType === WORK_ITEM_TYPE_KEYS.Standard
        ? (['INITIAL_WORKTREE'] as WorkItemConfigKind[])
        : [],
    capabilities: fx.capabilities,
    graphConfiguration: fx.graphConfiguration ?? null,
    createdAt: new Date('2026-06-12T00:00:00.000Z'),
    updatedAt: new Date('2026-06-12T00:00:00.000Z'),
  } as unknown as WorkItemType;
}

function buildProjectOwnedRow(
  taskType: BuiltInTypeKey,
  projectId: string,
  overrides: Partial<WorkItemType> = {},
): WorkItemType {
  return {
    ...buildRow(taskType),
    id: `project-${projectId}-${taskType}`,
    isSystem: false,
    projectId,
    ...overrides,
  } as unknown as WorkItemType;
}

function buildProjectOwnedRows(projectId: string): WorkItemType[] {
  return ALL_TYPES.map((taskType) => buildProjectOwnedRow(taskType, projectId));
}

function buildTemplate(taskType: BuiltInTypeKey, revision: number) {
  return {
    ...buildRow(taskType),
    id: `template-${taskType}-${revision}`,
  } as unknown as WorkItemTypeTemplate;
}

const ALL_TYPES = BUILT_IN_TYPE_KEYS;

/** Let the fire-and-forget refresh in the bus handler settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));
const registries: WorkItemTypeRegistryService[] = [];
afterEach(async () => {
  await Promise.all(
    registries.splice(0).map((registry) => registry.onModuleDestroy()),
  );
  jest.useRealTimers();
});

function buildRegistry(
  rows: WorkItemType[],
  templates: WorkItemTypeTemplate[] = [],
  projectIds: string[] = [
    ...new Set(
      rows
        .map((row) => row.projectId)
        .filter((id): id is string => id !== null),
    ),
  ],
) {
  const findMany = jest
    .fn()
    .mockImplementation(
      async (args?: { where: { projectId: { in: string[] } } }) =>
        args
          ? rows.filter((row) =>
              args.where.projectId.in.includes(row.projectId),
            )
          : rows,
    );
  const templateFindMany = jest.fn().mockResolvedValue(templates);
  const fingerprintRead = jest.fn(async () => [
    { projectId: null, fingerprint: JSON.stringify(templates) },
    ...projectIds.map((id) => ({
      projectId: id,
      fingerprint: JSON.stringify(rows.filter((row) => row.projectId === id)),
    })),
  ]);
  const prisma = {
    $queryRaw: fingerprintRead,
    project: {
      findMany: jest.fn(async (args?: { where?: { id: { in: string[] } } }) =>
        projectIds
          .filter((id) => !args?.where || args.where.id.in.includes(id))
          .map((id) => ({ id })),
      ),
    },
    workItemType: { findMany },
    workItemTypeTemplate: { findMany: templateFindMany },
  } as unknown as PrismaService;
  const bus = new InMemoryMessageBus();
  const registry = new WorkItemTypeRegistryService(prisma, bus);
  registries.push(registry);
  return { registry, bus, findMany, fingerprintRead };
}

function buildRefreshRegistry(
  row: WorkItemType | null,
  templates: WorkItemType[],
) {
  const templateFindFirst = jest.fn();
  const prisma = {
    project: {
      findMany: jest.fn().mockResolvedValue(row ? [{ id: row.projectId }] : []),
    },
    workItemType: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(row),
    },
    workItemTypeTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: templateFindFirst,
    },
  } as unknown as PrismaService;
  const bus = new InMemoryMessageBus();
  const registry = new WorkItemTypeRegistryService(prisma, bus);
  return { registry, templateFindFirst };
}

describe('WorkItemTypeRegistryService', () => {
  it('allows undated canonical Goals while retaining a complete required-date override', async () => {
    const canonical = { ...buildTemplate('GOAL', 1), requiredScalars: [] };
    const override = buildProjectOwnedRow('GOAL', 'override-project', {
      requiredScalars: ['dueDate'],
    });
    const { registry } = buildRegistry(
      [override],
      [canonical],
      ['canonical-project', 'override-project'],
    );
    await registry.onModuleInit();
    expect(
      registry.isScalarRequired('GOAL', 'dueDate', 'canonical-project'),
    ).toBe(false);
    expect(
      registry.isScalarRequired('GOAL', 'dueDate', 'override-project'),
    ).toBe(true);
    expect(registry.getAllowedParentTypes('GOAL', 'canonical-project')).toEqual(
      [],
    );
  });

  it.each([true, false])(
    'derives forced canonical Mockup Active while preserving a complete override (forced=%s)',
    async (hasSetInitialStatus) => {
      const canonical = {
        ...buildTemplate('STANDARD', 1),
        typeKey: 'mockup',
        name: 'Mockup',
        allowedStatuses: ['ACTIVE', 'BACKLOG', 'READY', 'ARCHIVED'],
        capabilities: { hasSetInitialStatus: true },
      };
      const override = buildProjectOwnedRow('STANDARD', 'override-project', {
        typeKey: 'mockup',
        allowedStatuses: ['BACKLOG', 'ACTIVE', 'READY', 'ARCHIVED'],
        capabilities: { hasSetInitialStatus },
      });
      const { registry } = buildRegistry(
        [override],
        [canonical],
        ['canonical-project', 'override-project'],
      );
      await registry.onModuleInit();
      expect(
        registry.getInitialStatusPolicy('mockup', 'canonical-project'),
      ).toEqual({
        initialStatus: WorkStatus.Active,
        hasSetInitialStatus: true,
      });
      expect(
        registry.getInitialStatusPolicy('mockup', 'override-project'),
      ).toEqual({ initialStatus: WorkStatus.Backlog, hasSetInitialStatus });
      expect(
        registry.getDefinition('canonical-project', 'mockup')?.definition
          .allowedStatuses,
      ).toEqual(['ACTIVE', 'BACKLOG', 'READY', 'ARCHIVED']);
      expect(
        registry.getDefinition('override-project', 'mockup')?.definition
          .allowedStatuses,
      ).toEqual(['BACKLOG', 'ACTIVE', 'READY', 'ARCHIVED']);
    },
  );

  it('resolves canonical Decision for projects without a row and a complete decision row as that project override', async () => {
    const canonical = {
      ...buildTemplate('STANDARD', 1),
      typeKey: 'decision',
      name: 'Decision',
      role: 'project-info',
      allowedStatuses: ['ACTIVE', 'SUPERSEDED', 'ARCHIVED'],
      capabilities: { requiresParent: true, hasSetInitialStatus: false },
    };
    const override = buildProjectOwnedRow('STANDARD', 'override-project', {
      typeKey: 'decision',
      name: 'Project Decision',
      allowedStatuses: ['ACTIVE', 'ARCHIVED'],
      capabilities: { requiresParent: true, hasSetInitialStatus: false },
    });
    const { registry } = buildRegistry(
      [override],
      [canonical],
      ['canonical-project', 'override-project', 'other-project'],
    );
    await registry.onModuleInit();

    expect(
      registry.getDefinition('canonical-project', 'decision'),
    ).toMatchObject({
      effectiveSource: 'CANONICAL',
      definition: {
        key: 'decision',
        name: 'Decision',
        allowedStatuses: ['ACTIVE', 'SUPERSEDED', 'ARCHIVED'],
      },
    });
    expect(
      registry.getDefinition('override-project', 'decision'),
    ).toMatchObject({
      effectiveSource: 'CANONICAL_OVERRIDE',
      definition: {
        key: 'decision',
        name: 'Project Decision',
        allowedStatuses: ['ACTIVE', 'ARCHIVED'],
      },
    });
    expect(registry.getDefinition('other-project', 'decision')).toMatchObject({
      effectiveSource: 'CANONICAL',
      definition: { name: 'Decision' },
    });
    expect(
      registry.getInitialStatusPolicy('decision', 'canonical-project'),
    ).toEqual({ initialStatus: WorkStatus.Active, hasSetInitialStatus: false });
  });

  describe('five-second independent recovery', () => {
    const projectId = 'recovery-project';

    it('recovers project creation and deletion without replacing unaffected snapshots', async () => {
      jest.useFakeTimers();
      const projectIds = ['a'];
      const { registry, findMany } = buildRegistry(
        [],
        [buildTemplate('STANDARD', 1)],
        projectIds,
      );
      await registry.onModuleInit();
      await jest.advanceTimersByTimeAsync(5000);
      const untouched = registry.getDefinition('a', 'STANDARD');
      projectIds.push('b');
      await jest.advanceTimersByTimeAsync(5000);
      expect(registry.getDefinition('b', 'STANDARD')).toBeDefined();
      expect(registry.getDefinition('a', 'STANDARD')).toBe(untouched);
      projectIds.pop();
      await jest.advanceTimersByTimeAsync(5000);
      expect(findMany).toHaveBeenLastCalledWith({
        where: { projectId: { in: ['b'] } },
      });
      expect(registry.getDefinition('b', 'STANDARD')).toBeUndefined();
      expect(registry.getDefinition('a', 'STANDARD')).toBe(untouched);
    });

    it('does not acknowledge a concurrent commit beyond the pre-load fingerprint', async () => {
      jest.useFakeTimers();
      const rows = [buildProjectOwnedRow('STANDARD', projectId)];
      const { registry, findMany } = buildRegistry(rows);
      await registry.onModuleInit();
      await jest.advanceTimersByTimeAsync(5000);
      rows[0] = { ...rows[0]!, name: 'First commit' };
      findMany.mockImplementationOnce(async () => {
        const captured = [...rows];
        rows[0] = { ...rows[0]!, name: 'Concurrent commit' };
        return captured;
      });
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('First commit');
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('Concurrent commit');
    });

    it('reloads only the notified project and coalesces project IDs during a load', async () => {
      const rows = [
        buildProjectOwnedRow('STANDARD', 'a'),
        buildProjectOwnedRow('STANDARD', 'b'),
      ];
      const { registry, findMany } = buildRegistry(rows);
      await registry.onModuleInit();
      const untouched = registry.getDefinition('b', 'STANDARD');
      rows[0] = { ...rows[0]!, name: 'Changed A' };
      await registry.refresh('a');
      expect(findMany).toHaveBeenLastCalledWith({
        where: { projectId: { in: ['a'] } },
      });
      expect(registry.getDefinition('a', 'STANDARD')?.definition.name).toBe(
        'Changed A',
      );
      expect(registry.getDefinition('b', 'STANDARD')).toBe(untouched);
      let release!: (rows: WorkItemType[]) => void;
      findMany.mockImplementationOnce(
        () =>
          new Promise<WorkItemType[]>((resolve) => {
            release = resolve;
          }),
      );
      const first = registry.refresh('a');
      await Promise.resolve();
      const pending = [
        registry.refresh('a'),
        registry.refresh('b'),
        registry.refresh('b'),
      ];
      release([rows[0]!]);
      await Promise.all([first, ...pending]);
      expect(findMany).toHaveBeenCalledTimes(4);
      expect(findMany).toHaveBeenLastCalledWith({
        where: { projectId: { in: ['a', 'b'] } },
      });
    });

    it('skips unchanged recovery loads and detects SQL edits, deletes, and canonical changes', async () => {
      jest.useFakeTimers();
      const rows = [
        buildProjectOwnedRow('STANDARD', 'a'),
        buildProjectOwnedRow('STANDARD', 'b'),
      ];
      const template = buildTemplate('STANDARD', 1);
      const { registry, findMany, fingerprintRead } = buildRegistry(rows, [
        template,
      ]);
      await registry.onModuleInit();
      await jest.advanceTimersByTimeAsync(5000); // Establish the recovery baseline.
      findMany.mockClear();
      await jest.advanceTimersByTimeAsync(15000);
      expect(findMany).not.toHaveBeenCalled();
      expect(fingerprintRead).toHaveBeenCalledTimes(4);
      const untouched = registry.getDefinition('b', 'STANDARD');
      rows[0] = { ...rows[0]!, name: 'SQL edit with unchanged timestamp' };
      await jest.advanceTimersByTimeAsync(5000);
      expect(findMany).toHaveBeenLastCalledWith({
        where: { projectId: { in: ['a'] } },
      });
      expect(registry.getDefinition('b', 'STANDARD')).toBe(untouched);
      rows.splice(0, 1); // Reset the override without an event.
      await jest.advanceTimersByTimeAsync(5000);
      expect(registry.getDefinition('a', 'STANDARD')?.definition.name).toBe(
        template.name,
      );
      template.name = 'Canonical SQL edit';
      await jest.advanceTimersByTimeAsync(5000);
      expect(findMany).toHaveBeenLastCalledWith(undefined);
      expect(registry.getDefinition('a', 'STANDARD')?.definition.name).toBe(
        'Canonical SQL edit',
      );
      expect(registry.getDefinition('b', 'STANDARD')?.definition.name).toBe(
        untouched?.definition.name,
      );
    });

    it('keeps failed recovery fingerprints pending for the next tick', async () => {
      jest.useFakeTimers();
      const rows = [buildProjectOwnedRow('STANDARD', projectId)];
      const { registry, findMany, fingerprintRead } = buildRegistry(rows);
      await registry.onModuleInit();
      await jest.advanceTimersByTimeAsync(5000);
      rows[0] = { ...rows[0]!, name: 'Recovered scoped edit' };
      findMany.mockRejectedValueOnce(new Error('temporary failure'));
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).not.toBe('Recovered scoped edit');
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('Recovered scoped edit');
      fingerprintRead.mockRejectedValueOnce(new Error('probe unavailable'));
      await jest.advanceTimersByTimeAsync(5000);
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('Recovered scoped edit');
    });

    it('waits for all reads after a failure before running the queued recovery', async () => {
      const rows = [buildProjectOwnedRow('STANDARD', projectId)];
      let release!: (value: WorkItemType[]) => void;
      let reject!: (reason: Error) => void;
      const findMany = jest.fn().mockResolvedValue(rows);
      const projects = jest.fn().mockResolvedValue([{ id: projectId }]);
      const prisma = {
        project: { findMany: projects },
        workItemType: { findMany },
        workItemTypeTemplate: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const registry = new WorkItemTypeRegistryService(
        prisma,
        new InMemoryMessageBus(),
      );
      registries.push(registry);
      await registry.onModuleInit();
      findMany.mockImplementationOnce(
        () =>
          new Promise<WorkItemType[]>((resolve) => {
            release = resolve;
          }),
      );
      projects.mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      const loading = registry.refresh();
      await Promise.resolve();
      const queued = registry.refresh();
      reject(new Error('temporary project read failure'));
      await flush();
      expect(findMany).toHaveBeenCalledTimes(2);
      release(rows);
      await Promise.all([loading, queued]);
      expect(findMany).toHaveBeenCalledTimes(3);
      expect(() =>
        registry.assertTypeActive('STANDARD', projectId),
      ).not.toThrow();
    });

    it('recovers canonical and project database-only changes and missed notifications at 5000ms', async () => {
      jest.useFakeTimers();
      const template = buildTemplate('STANDARD', 1);
      const rows = [buildProjectOwnedRow('BUG', projectId)];
      const { registry, findMany } = buildRegistry(
        rows,
        [template],
        [projectId],
      );
      await registry.onModuleInit();
      template.name = 'Changed canonical';
      rows[0] = {
        ...rows[0]!,
        name: 'Changed project',
        maintenanceGuidance: 'Recovered guidance',
      };
      await jest.advanceTimersByTimeAsync(4999);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).not.toBe(template.name);
      expect(findMany).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe(template.name);
      expect(
        registry.getGuidance(
          projectId,
          'BUG',
          WorkItemTypeGuidancePurpose.Maintenance,
        ).maintenanceGuidance,
      ).toBe('Recovered guidance');
      // A second committed write deliberately has no bus notification either.
      rows[0] = { ...rows[0]!, lifecycleStatus: 'archived' };
      await jest.advanceTimersByTimeAsync(5000);
      expect(() => registry.assertTypeActive('BUG', projectId)).toThrow();
      await registry.onModuleDestroy();
      const reads = findMany.mock.calls.length;
      await jest.advanceTimersByTimeAsync(15000);
      expect(findMany).toHaveBeenCalledTimes(reads);
    });

    it('retries a temporary database failure on the next five-second tick', async () => {
      jest.useFakeTimers();
      const rows = [buildProjectOwnedRow('STANDARD', projectId)];
      const { registry, findMany } = buildRegistry(rows);
      await registry.onModuleInit();
      rows[0] = { ...rows[0]!, name: 'Recovered' };
      findMany.mockRejectedValueOnce(new Error('temporary database outage'));
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).not.toBe('Recovered');
      await jest.advanceTimersByTimeAsync(4999);
      expect(findMany).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('Recovered');
    });

    it('serializes a burst into one trailing load and retains complete override precedence', async () => {
      const rows = [
        buildProjectOwnedRow('STANDARD', projectId, { name: 'Override' }),
      ];
      const template = buildTemplate('STANDARD', 1);
      const { registry, findMany } = buildRegistry(rows, [
        template,
        buildTemplate('FEATURE', 1),
      ]);
      await registry.onModuleInit();
      let release!: (rows: WorkItemType[]) => void;
      findMany.mockImplementationOnce(
        () =>
          new Promise<WorkItemType[]>((resolve) => {
            release = resolve;
          }),
      );
      const loading = registry.refresh();
      await Promise.resolve();
      const pending = [
        registry.refresh(),
        registry.refresh(),
        registry.refresh(),
      ];
      expect(findMany).toHaveBeenCalledTimes(2);
      rows[0] = {
        ...rows[0]!,
        name: 'New override',
        allowedParentTypes: ['FEATURE'],
        maintenanceGuidance: 'New guidance',
      };
      template.name = 'New canonical';
      release([
        buildProjectOwnedRow('STANDARD', projectId, { name: 'Old load' }),
      ]);
      await Promise.all([loading, ...pending]);
      expect(findMany).toHaveBeenCalledTimes(3);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('New override');
      expect(registry.getAllowedParentTypes('STANDARD', projectId)).toEqual([
        'FEATURE',
      ]);
      expect(
        registry.getGuidance(
          projectId,
          'STANDARD',
          WorkItemTypeGuidancePurpose.Maintenance,
        ).maintenanceGuidance,
      ).toBe('New guidance');
    });

    it('rejects an incomplete recovery snapshot without replacing any read model', async () => {
      jest.useFakeTimers();
      const rows = [
        buildProjectOwnedRow('STANDARD', projectId, {
          maintenanceGuidance: 'Original guidance',
        }),
      ];
      const { registry } = buildRegistry(rows);
      await registry.onModuleInit();
      const before = registry.getDefinition(projectId, 'STANDARD');
      const parents = registry.getAllowedParentTypes('STANDARD', projectId);
      rows[0] = { ...rows[0]!, name: null } as unknown as WorkItemType;
      await expect(registry.refresh()).rejects.toThrow(
        'not a complete definition',
      );
      expect(registry.getDefinition(projectId, 'STANDARD')).toBe(before);
      expect(registry.getAllowedParentTypes('STANDARD', projectId)).toEqual(
        parents,
      );
      expect(
        registry.getGuidance(
          projectId,
          'STANDARD',
          WorkItemTypeGuidancePurpose.Maintenance,
        ).maintenanceGuidance,
      ).toBe('Original guidance');
      rows[0] = { ...rows[0]!, name: 'Repaired' };
      await jest.advanceTimersByTimeAsync(5000);
      expect(
        registry.getDefinition(projectId, 'STANDARD')?.definition.name,
      ).toBe('Repaired');
    });

    it('does not retain a recovery timer or react to signals after failed initialization', async () => {
      jest.useFakeTimers();
      const { registry, bus, findMany } = buildRegistry([
        buildProjectOwnedRow('STANDARD', projectId),
      ]);
      jest
        .spyOn(bus, 'subscribe')
        .mockRejectedValueOnce(new Error('subscription unavailable'));
      await expect(registry.onModuleInit()).rejects.toThrow(
        'subscription unavailable',
      );
      await jest.advanceTimersByTimeAsync(10000);
      await registry.refresh();
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('batch project-scoped guidance', () => {
    const PROJECT = 'project-guidance-batch';

    async function createGuidanceRegistry() {
      const standardTemplate = {
        ...buildTemplate('STANDARD', 1),
        maintenanceGuidance: 'Canonical maintenance advice',
        sessionRoleGuidance: { implementation: 'Canonical implementation' },
      } as unknown as WorkItemTypeTemplate;
      const standardOverride = buildProjectOwnedRow('STANDARD', PROJECT, {
        name: 'Project task meaning',
        maintenanceGuidance: null,
      });
      const bugOverride = buildProjectOwnedRow('BUG', PROJECT, {
        name: 'Project bug meaning',
        maintenanceGuidance: 'Project bug maintenance advice',
        sessionRoleGuidance: Object.fromEntries(
          Object.values(SessionRole).map((role) => [
            role,
            `  ${role} advice  `,
          ]),
        ),
      });
      const { registry } = buildRegistry(
        [standardOverride, bugOverride],
        [standardTemplate, buildTemplate('FEATURE', 1)],
        [PROJECT],
      );
      await registry.onModuleInit();
      return registry;
    }

    it.each(Object.values(SessionRole))(
      'returns ordered role projections for %s without inheriting omitted advice',
      async (sessionRole) => {
        const registry = await createGuidanceRegistry();
        const request = {
          typeKeys: ['BUG', 'STANDARD'],
          purpose: WorkItemTypeGuidancePurpose.Role,
          sessionRole,
        };
        expect(registry.getGuidanceBatch(PROJECT, request)).toEqual({
          results: [
            {
              typeKey: 'BUG',
              name: 'Project bug meaning',
              sessionRole,
              guidance: `  ${sessionRole} advice  `,
            },
            { typeKey: 'STANDARD', name: 'Project task meaning', sessionRole },
          ],
        });
        expect(
          registry.getGuidance(
            PROJECT,
            'BUG',
            WorkItemTypeGuidancePurpose.Role,
            sessionRole,
          ),
        ).toEqual(registry.getGuidanceBatch(PROJECT, request).results[0]);
        expect(() =>
          registry.getGuidance(
            PROJECT,
            'BUG',
            WorkItemTypeGuidancePurpose.Role,
          ),
        ).toThrow('sessionRole is required');
        for (const key of ['UNKNOWN']) {
          expect(() =>
            registry.getGuidance(
              PROJECT,
              key,
              WorkItemTypeGuidancePurpose.Role,
              sessionRole,
            ),
          ).toThrow(key);
        }
      },
    );

    it('preserves complete overrides without inheriting canonical maintenance advice', async () => {
      const registry = await createGuidanceRegistry();

      expect(
        registry.getGuidanceBatch(PROJECT, {
          typeKeys: ['STANDARD', 'BUG'],
          purpose: WorkItemTypeGuidancePurpose.Maintenance,
        }),
      ).toEqual({
        results: [
          { typeKey: 'STANDARD', name: 'Project task meaning' },
          {
            typeKey: 'BUG',
            name: 'Project bug meaning',
            maintenanceGuidance: 'Project bug maintenance advice',
          },
        ],
      });
    });

    it('keeps role batches on the captured snapshot when the published snapshot changes', async () => {
      const registry = await createGuidanceRegistry();
      const original = (registry as any).snapshot;
      const definition = registry.getDefinition(PROJECT, 'BUG')!.definition;
      const advice = definition.sessionRoleGuidance;
      Object.defineProperty(definition, 'sessionRoleGuidance', {
        configurable: true,
        get: () => {
          (registry as any).snapshot = {
            ...original,
            projectSummaries: new Map([[PROJECT, []]]),
          };
          return advice;
        },
      });
      expect(
        registry.getGuidanceBatch(PROJECT, {
          typeKeys: ['BUG', 'STANDARD'],
          purpose: WorkItemTypeGuidancePurpose.Role,
          sessionRole: SessionRole.Review,
        }).results,
      ).toEqual([
        {
          typeKey: 'BUG',
          name: 'Project bug meaning',
          sessionRole: SessionRole.Review,
          guidance: '  review advice  ',
        },
        {
          typeKey: 'STANDARD',
          name: 'Project task meaning',
          sessionRole: SessionRole.Review,
        },
      ]);
      expect(() =>
        registry.getGuidanceBatch(PROJECT, {
          typeKeys: ['STANDARD'],
          purpose: WorkItemTypeGuidancePurpose.Role,
          sessionRole: SessionRole.Review,
        }),
      ).toThrow('STANDARD');
      (registry as any).snapshot = original;
    });

    it('names an unavailable requested type in the batch error', async () => {
      const registry = await createGuidanceRegistry();

      expect(() =>
        registry.getGuidanceBatch(PROJECT, {
          typeKeys: ['BUG', 'UNKNOWN'],
          purpose: WorkItemTypeGuidancePurpose.Maintenance,
        }),
      ).toThrow("Work-item type 'UNKNOWN'");
    });
  });

  describe('accessor correctness after warm-up', () => {
    let registry: WorkItemTypeRegistryService;
    // Every effective accessor is backed by one resolved project snapshot.
    const TEST_PROJECT = 'project-warm';

    beforeEach(async () => {
      ({ registry } = buildRegistry(buildProjectOwnedRows(TEST_PROJECT)));
      await registry.onModuleInit();
    });

    it('resolves every canonical lookup through project-scoped fallback', async () => {
      const projectId = 'project-after-canonical-backfill';
      const warmed = buildRegistry(
        [],
        ALL_TYPES.map((typeKey) => buildTemplate(typeKey, 1)),
        [projectId],
      );

      await warmed.registry.refresh();

      expect(warmed.registry.getAllowedStatusEntries(projectId)).toHaveLength(
        ALL_TYPES.length,
      );
      expect(warmed.registry.getHierarchyNodeTypes(projectId)).toContain(
        WORK_ITEM_TYPE_KEYS.Feature,
      );
      expect(warmed.registry.getTrackingSourceTypes(projectId)).toContain(
        WORK_ITEM_TYPE_KEYS.Goal,
      );
      expect(warmed.registry.getActiveTypeKeys(projectId)).toEqual(
        [...ALL_TYPES].sort(),
      );
      expect(warmed.registry.getDefinitions(projectId)).toHaveLength(
        ALL_TYPES.length,
      );

      for (const taskType of ALL_TYPES) {
        expect(
          warmed.registry.getRulesForProject(taskType, projectId),
        ).toBeDefined();
        expect(
          warmed.registry.getDefinition(projectId, taskType),
        ).toMatchObject({
          effectiveSource: WorkItemTypeEffectiveSource.Canonical,
          definition: { key: taskType },
        });
        expect(
          warmed.registry.isTypeActiveForProject(taskType, projectId),
        ).toBe(true);
      }
    });

    it('exposes explicit accepted config policy without inferring from key or role', async () => {
      const projectId = 'project-config-policy';
      const rows = [
        buildProjectOwnedRow(WORK_ITEM_TYPE_KEYS.Standard, projectId, {
          acceptedConfigKinds: [],
        }),
        buildProjectOwnedRow(WORK_ITEM_TYPE_KEYS.Bug, projectId, {
          acceptedConfigKinds: ['INITIAL_WORKTREE'],
        }),
      ];
      const warmed = buildRegistry(rows);

      await warmed.registry.refresh();

      expect(
        warmed.registry.getAcceptedConfigKinds(
          WORK_ITEM_TYPE_KEYS.Standard,
          projectId,
        ),
      ).toEqual([]);
      expect(
        warmed.registry.isConfigKindAccepted(
          WORK_ITEM_TYPE_KEYS.Standard,
          'INITIAL_WORKTREE',
          projectId,
        ),
      ).toBe(false);
      expect(
        warmed.registry.getAcceptedConfigKinds(
          WORK_ITEM_TYPE_KEYS.Bug,
          projectId,
        ),
      ).toEqual(['INITIAL_WORKTREE']);
      expect(
        warmed.registry.isConfigKindAccepted(
          WORK_ITEM_TYPE_KEYS.Bug,
          'INITIAL_WORKTREE',
          projectId,
        ),
      ).toBe(true);
    });

    it('does not expose canonical definitions outside a known project snapshot', async () => {
      const projectId = 'project-without-materialized-definitions';
      const warmed = buildRegistry(
        ALL_TYPES.map(buildRow),
        ALL_TYPES.map((typeKey) => buildTemplate(typeKey, 1)),
      );

      await warmed.registry.refresh();

      expect(
        warmed.registry.getRulesForProject(
          WORK_ITEM_TYPE_KEYS.Standard,
          projectId,
        ),
      ).toBeUndefined();
      expect(warmed.registry.getActiveTypeKeys(projectId)).toEqual([]);
      expect(warmed.registry.getDefinitions(projectId)).toEqual([]);
      expect(warmed.registry.getHierarchyNodeTypes(projectId)).toEqual([]);
      expect(warmed.registry.getTrackingSourceTypes(projectId)).toEqual([]);
      expect(() =>
        warmed.registry.getAllowedStatuses(
          WORK_ITEM_TYPE_KEYS.Standard,
          projectId,
        ),
      ).toThrow("Work-item type 'STANDARD' is not present");
    });

    it('uses project-owned lifecycle state for canonical definitions', async () => {
      const projectId = 'project-with-archived-canonical-type';
      const projectOwnedRows = ALL_TYPES.map((taskType) => ({
        ...buildRow(taskType),
        id: `project-owned-${taskType}`,
        isSystem: false,
        projectId,
        lifecycleStatus:
          taskType === WORK_ITEM_TYPE_KEYS.Bug ? 'archived' : 'active',
      })) as unknown as WorkItemType[];
      const warmed = buildRegistry(projectOwnedRows);

      await warmed.registry.refresh();

      expect(
        warmed.registry.isTypeActiveForProject(
          WORK_ITEM_TYPE_KEYS.Bug,
          projectId,
        ),
      ).toBe(false);
      expect(warmed.registry.getActiveTypeKeys(projectId)).not.toContain(
        WORK_ITEM_TYPE_KEYS.Bug,
      );
      expect(
        warmed.registry.getDefinition(projectId, WORK_ITEM_TYPE_KEYS.Bug),
      ).toMatchObject({
        status: WorkItemTypeLifecycleStatus.Archived,
      });
      expect(
        warmed.registry.getDefinitions(
          projectId,
          WorkItemTypeLifecycleStatus.Active,
        ),
      ).toHaveLength(ALL_TYPES.length - 1);
    });

    it('keeps different project-owned definitions isolated for the same canonical key', async () => {
      const projectA = 'project-canonical-a';
      const projectB = 'project-canonical-b';
      const warmed = buildRegistry([
        buildProjectOwnedRow(WORK_ITEM_TYPE_KEYS.Standard, projectA, {
          requiredScalars: ['tag'],
        }),
        buildProjectOwnedRow(WORK_ITEM_TYPE_KEYS.Standard, projectB, {
          requiredScalars: ['dueDate'],
        }),
      ]);

      await warmed.registry.refresh();

      expect(
        warmed.registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Standard,
          'tag',
          projectA,
        ),
      ).toBe(true);
      expect(
        warmed.registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Standard,
          'tag',
          projectB,
        ),
      ).toBe(false);
      expect(
        warmed.registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Standard,
          'dueDate',
          projectB,
        ),
      ).toBe(true);
    });

    it('rejects a snapshot generation with an incomplete project override', async () => {
      const projectId = 'project-with-incomplete-override';
      const incompleteOverride = buildProjectOwnedRow(
        WORK_ITEM_TYPE_KEYS.Standard,
        projectId,
        { name: '' },
      );
      const warmed = buildRegistry(
        [incompleteOverride],
        [buildTemplate(WORK_ITEM_TYPE_KEYS.Standard, 1)],
        [projectId],
      );

      await expect(warmed.registry.refresh()).rejects.toThrow(
        "Cannot load work-item type 'STANDARD'",
      );
      expect(
        warmed.registry.getDefinition(projectId, WORK_ITEM_TYPE_KEYS.Standard),
      ).toBeUndefined();
    });

    it.each(['GUARANTEES', 'IMPLEMENTS', 'CONSUMES'])(
      'accepts %s traversal declarations',
      async (relationshipType) => {
        const projectId = 'project-with-participation-expansion';
        const templates = ALL_TYPES.map((typeKey) => buildTemplate(typeKey, 1));
        const workflow = templates.find((row) => row.typeKey === 'workflow')!;
        workflow.graphConfiguration = {
          ...(workflow.graphConfiguration as object),
          readExpansions: [
            {
              key: 'participants',
              seed: 'graphNodes',
              path: [
                {
                  relationshipType,
                  direction: 'OUTGOING',
                  target: {
                    entityTypes: ['TASK'],
                    workItemTypeKeys: ['CONTRACT'],
                  },
                },
              ],
              projectionKind: 'workItemReference',
              deduplicateBy: 'entityId',
              limit: 10,
            },
          ],
        } as Prisma.JsonValue;
        const warmed = buildRegistry([], templates, [projectId]);
        await expect(warmed.registry.refresh()).resolves.toBeUndefined();
      },
    );

    it('rejects duplicate effective graph read expansion keys', async () => {
      const projectId = 'project-with-duplicate-expansions';
      const templates = ALL_TYPES.map((typeKey) => buildTemplate(typeKey, 1));
      const workflow = templates.find((row) => row.typeKey === 'workflow')!;
      const expansion = {
        key: 'linkedGraphs',
        seed: 'graphNodes',
        path: [
          {
            relationshipType: 'DEPENDS_ON',
            direction: 'OUTGOING',
            target: {
              entityTypes: ['TASK'],
              workItemTypeKeys: ['CONTRACT'],
            },
          },
        ],
        projectionKind: 'workItemReference',
        deduplicateBy: 'entityId',
        limit: 10,
      };
      workflow.graphConfiguration = {
        ...(workflow.graphConfiguration as object),
        readExpansions: [expansion, expansion],
      } as Prisma.JsonValue;
      const warmed = buildRegistry([], templates, [projectId]);

      await expect(warmed.registry.refresh()).rejects.toThrow(
        "duplicate graph read expansion key 'linkedGraphs'",
      );
    });

    it('rejects inactive endpoint work-item keys before publishing a snapshot', async () => {
      const projectId = 'project-with-inactive-expansion-target';
      const templates = ALL_TYPES.map((typeKey) => buildTemplate(typeKey, 1));
      const workflow = templates.find((row) => row.typeKey === 'workflow')!;
      workflow.graphConfiguration = {
        ...(workflow.graphConfiguration as object),
        readExpansions: [
          {
            key: 'linkedGraphs',
            seed: 'graphNodes',
            path: [
              {
                relationshipType: 'DEPENDS_ON',
                direction: 'OUTGOING',
                target: {
                  entityTypes: ['TASK'],
                  workItemTypeKeys: ['MISSING_TYPE'],
                },
              },
            ],
            projectionKind: 'workItemReference',
            deduplicateBy: 'entityId',
            limit: 10,
          },
        ],
      } as Prisma.JsonValue;
      const warmed = buildRegistry([], templates, [projectId]);

      await expect(warmed.registry.refresh()).rejects.toThrow(
        "references inactive work-item type 'MISSING_TYPE'",
      );
    });

    it('supersedable system types allow SUPERSEDED status', () => {
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Standard,
          WorkStatus.Superseded,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isSupersedable(WORK_ITEM_TYPE_KEYS.Standard, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Feature,
          WorkStatus.Superseded,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isSupersedable(WORK_ITEM_TYPE_KEYS.Feature, TEST_PROJECT),
      ).toBe(true);
      expect(registry.isSupersedable('workflow', TEST_PROJECT)).toBe(true);
      expect(registry.isSupersedable('workflow_step', TEST_PROJECT)).toBe(true);
      expect(
        registry.isSupersedable(WORK_ITEM_TYPE_KEYS.TaskMonitor, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isSupersedable(WORK_ITEM_TYPE_KEYS.Contract, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Bug,
          WorkStatus.Superseded,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isSupersedable(WORK_ITEM_TYPE_KEYS.Bug, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          WorkStatus.Superseded,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isSupersedable(WORK_ITEM_TYPE_KEYS.Goal, TEST_PROJECT),
      ).toBe(false);
    });

    it('all lifecycle-backed types allow the core working statuses', () => {
      const core = [
        WorkStatus.Backlog,
        WorkStatus.Active,
        WorkStatus.OnHold,
        WorkStatus.Verifying,
        WorkStatus.Completed,
        WorkStatus.Cancelled,
        WorkStatus.Archived,
      ];
      for (const t of ALL_TYPES.filter(
        (t) => t !== WORK_ITEM_TYPE_KEYS.Contract,
      )) {
        for (const s of core)
          expect(registry.isStatusAllowed(t, s, TEST_PROJECT)).toBe(true);
      }
    });

    it('CONTRACT only allows ACTIVE, SUPERSEDED, and ARCHIVED', () => {
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          WorkStatus.Active,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          WorkStatus.Superseded,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          WorkStatus.Archived,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          WorkStatus.Backlog,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isStatusAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          WorkStatus.Completed,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('GOAL initial status is ACTIVE with hasSetInitialStatus=true', () => {
      const p = registry.getInitialStatusPolicy(
        WORK_ITEM_TYPE_KEYS.Goal,
        TEST_PROJECT,
      );
      expect(p.initialStatus).toBe(WorkStatus.Active);
      expect(p.hasSetInitialStatus).toBe(true);
    });

    it('STANDARD/BUG/TASK_MONITOR initial status is BACKLOG, FEATURE/CONTRACT is ACTIVE — none forced', () => {
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.Standard,
          TEST_PROJECT,
        ).initialStatus,
      ).toBe(WorkStatus.Backlog);
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.Standard,
          TEST_PROJECT,
        ).hasSetInitialStatus,
      ).toBe(false);
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.Feature,
          TEST_PROJECT,
        ).initialStatus,
      ).toBe(WorkStatus.Active);
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.Feature,
          TEST_PROJECT,
        ).hasSetInitialStatus,
      ).toBe(false);
      expect(
        registry.getInitialStatusPolicy(WORK_ITEM_TYPE_KEYS.Bug, TEST_PROJECT)
          .initialStatus,
      ).toBe(WorkStatus.Backlog);
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          TEST_PROJECT,
        ).initialStatus,
      ).toBe(WorkStatus.Backlog);
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.Contract,
          TEST_PROJECT,
        ).initialStatus,
      ).toBe(WorkStatus.Active);
      expect(
        registry.getInitialStatusPolicy(
          WORK_ITEM_TYPE_KEYS.Contract,
          TEST_PROJECT,
        ).hasSetInitialStatus,
      ).toBe(false);
    });

    it('only STANDARD carries acceptanceCriteria section', () => {
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Standard,
          TaskSectionKey.AcceptanceCriteria,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Feature,
          TaskSectionKey.AcceptanceCriteria,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Bug,
          TaskSectionKey.AcceptanceCriteria,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          TaskSectionKey.AcceptanceCriteria,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          TaskSectionKey.AcceptanceCriteria,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('only FEATURE carries requirements section', () => {
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Feature,
          TaskSectionKey.Requirements,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.getSectionDefinition(
          WORK_ITEM_TYPE_KEYS.Feature,
          TaskSectionKey.Requirements,
          TEST_PROJECT,
        ),
      ).toEqual(
        expect.objectContaining({
          kind: 'json',
          schemaRef: '#/components/schemas/FeatureRequirementsSection',
        }),
      );
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Standard,
          TaskSectionKey.Requirements,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.Contract,
          TaskSectionKey.Requirements,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('TASK_MONITOR carries a schema-backed executionDefinition section', () => {
      expect(
        registry.isSectionAllowed(
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          'executionDefinition',
          TEST_PROJECT,
        ),
      ).toBe(true);

      expect(
        registry.getSectionDefinitions(
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          TEST_PROJECT,
        ),
      ).toEqual([
        { key: 'summary', label: 'Summary', kind: 'markdown' },
        {
          key: 'executionDefinition',
          label: 'Execution Definition',
          kind: 'json',
          schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
        },
      ]);
      expect(
        registry.getSectionDefinition(
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          'executionDefinition',
          TEST_PROJECT,
        ),
      ).toMatchObject({
        kind: 'json',
        schemaRef: '#/components/schemas/TaskMonitorExecutionDefinition',
      });
    });

    it('resolves the complete built-in Workflow graph capability through ordinary accessors', () => {
      expect(registry.getSectionDefinitions('workflow', TEST_PROJECT)).toEqual(
        TYPE_FIXTURES.workflow.sectionDefinitions,
      );
      expect(registry.getGraphCapability('workflow', TEST_PROJECT)).toEqual(
        workflowGraphCapability(),
      );
      expect(
        registry.getGraphReadableRelationshipTypes('workflow', TEST_PROJECT),
      ).toEqual([
        AgentEdgeType.Standard,
        AgentEdgeType.Conditional,
        AgentEdgeType.Loop,
        AgentEdgeType.FulfilledBy,
        AgentEdgeType.DependsOn,
      ]);

      const graph = registry.getGraphCapability('workflow', TEST_PROJECT);
      expect(graph?.rendererKey).toBe('work-item-graph');
      expect(graph?.editorKey).toBe('work-item-graph-editor');
      expect(graph?.searchableMetaLinkTargets).toEqual([
        {
          edgeType: AgentEdgeType.FulfilledBy,
          targetEntityTypes: ['TASK'],
        },
        {
          edgeType: AgentEdgeType.DependsOn,
          targetEntityTypes: ['TASK'],
          targetWorkItemTypeKeys: [WORK_ITEM_TYPE_KEYS.Contract],
        },
      ]);
    });

    it('every prose-authored system type carries description section', () => {
      for (const t of ALL_TYPES.filter(
        (t) => t !== WORK_ITEM_TYPE_KEYS.TaskMonitor,
      )) {
        expect(
          registry.isSectionAllowed(
            t,
            TaskSectionKey.Description,
            TEST_PROJECT,
          ),
        ).toBe(true);
      }
    });

    it('GOAL requires dueDate; FEATURE requires tag; others require neither', () => {
      expect(
        registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Goal,
          'dueDate',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Feature,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Standard,
          'dueDate',
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Standard,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isScalarRequired(WORK_ITEM_TYPE_KEYS.Bug, 'tag', TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Contract,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isScalarRequired(
          WORK_ITEM_TYPE_KEYS.Contract,
          'dueDate',
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('tag is forbidden everywhere except FEATURE', () => {
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Standard,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Bug,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Goal,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Feature,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Contract,
          'tag',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Contract,
          'dueDate',
          TEST_PROJECT,
        ),
      ).toBe(true);
    });

    it('STANDARD, BUG, CONTRACT, workflow_step, and TASK_MONITOR require a parent; FEATURE, GOAL, and workflow do not', () => {
      expect(
        registry.isParentRequired(WORK_ITEM_TYPE_KEYS.Standard, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isParentRequired(WORK_ITEM_TYPE_KEYS.Bug, TEST_PROJECT),
      ).toBe(true);
      expect(registry.isParentRequired('workflow_step', TEST_PROJECT)).toBe(
        true,
      );
      expect(
        registry.isParentRequired(
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isParentRequired(WORK_ITEM_TYPE_KEYS.Contract, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isParentRequired(WORK_ITEM_TYPE_KEYS.Feature, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isParentRequired(WORK_ITEM_TYPE_KEYS.Goal, TEST_PROJECT),
      ).toBe(false);
      expect(registry.isParentRequired('workflow', TEST_PROJECT)).toBe(false);
    });

    it('uses only the child declaration for parent placement', () => {
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Standard,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Bug,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Feature,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Goal,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          'workflow',
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Contract,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('uses the CONTRACT child declaration without a parent-side mirror', () => {
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Feature,
          WORK_ITEM_TYPE_KEYS.Contract,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Bug,
          WORK_ITEM_TYPE_KEYS.Contract,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('treats EntityType parentage as a literal allow-list', () => {
      expect(
        registry.canParentEntityType(
          WORK_ITEM_TYPE_KEYS.Goal,
          EntityType.DesignDoc,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentEntityType(
          WORK_ITEM_TYPE_KEYS.Goal,
          EntityType.Task,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentEntityType(
          WORK_ITEM_TYPE_KEYS.Standard,
          EntityType.Task,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentEntityType(
          WORK_ITEM_TYPE_KEYS.Standard,
          EntityType.User,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentEntityType('MISSING', EntityType.Task, TEST_PROJECT),
      ).toBe(false);
    });

    it('projects child-owned parentage in both directions', () => {
      expect(
        registry.getAllowedParentTypes(
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          TEST_PROJECT,
        ),
      ).toEqual([WORK_ITEM_TYPE_KEYS.Feature, WORK_ITEM_TYPE_KEYS.Standard]);
      expect(
        registry.getAllowedChildTypes(
          WORK_ITEM_TYPE_KEYS.Feature,
          TEST_PROJECT,
        ),
      ).toContain(WORK_ITEM_TYPE_KEYS.TaskMonitor);
      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Feature,
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          TEST_PROJECT,
        ),
      ).toBe(true);
    });

    it('workflow may only parent workflow_step children', () => {
      expect(
        registry.canParentChildType('workflow', 'workflow_step', TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.canParentChildType(
          'workflow',
          WORK_ITEM_TYPE_KEYS.Standard,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('only workflow renders inline', () => {
      expect(registry.rendersInline('workflow', TEST_PROJECT)).toBe(true);
      expect(registry.rendersInline('workflow_step', TEST_PROJECT)).toBe(false);
      expect(
        registry.rendersInline(WORK_ITEM_TYPE_KEYS.Standard, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.rendersInline(WORK_ITEM_TYPE_KEYS.TaskMonitor, TEST_PROJECT),
      ).toBe(false);
    });

    it('resolves Explorer Sidebar visibility from the named capability', () => {
      expect(
        registry.showsInExplorerSidebar(
          WORK_ITEM_TYPE_KEYS.Feature,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.showsInExplorerSidebar(WORK_ITEM_TYPE_KEYS.Goal, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.showsInExplorerSidebar(
          WORK_ITEM_TYPE_KEYS.Standard,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.showsInExplorerSidebar(WORK_ITEM_TYPE_KEYS.Bug, TEST_PROJECT),
      ).toBe(false);
    });

    it('only FEATURE is a hierarchy node', () => {
      expect(
        registry.isHierarchyNode(WORK_ITEM_TYPE_KEYS.Feature, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isHierarchyNode(WORK_ITEM_TYPE_KEYS.Standard, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isHierarchyNode(WORK_ITEM_TYPE_KEYS.Bug, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isHierarchyNode(WORK_ITEM_TYPE_KEYS.Goal, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isHierarchyNode(WORK_ITEM_TYPE_KEYS.Contract, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isHierarchyNode(WORK_ITEM_TYPE_KEYS.TaskMonitor, TEST_PROJECT),
      ).toBe(false);
    });

    it('isHierarchyNode returns false for an unknown type rather than throwing', () => {
      // Project-scoped types may not be in the system hierarchy axis;
      // entity-context walks task rows through this method and must get a
      // clean boolean, not a throw.
      expect(registry.isHierarchyNode('SOME_UNKNOWN_TYPE', TEST_PROJECT)).toBe(
        false,
      );
    });

    it('getHierarchyNodeTypes returns exactly [FEATURE]', () => {
      expect(registry.getHierarchyNodeTypes(TEST_PROJECT).sort()).toEqual([
        WORK_ITEM_TYPE_KEYS.Feature,
      ]);
    });

    it('only GOAL is a tracking source', () => {
      expect(
        registry.isTrackingSource(WORK_ITEM_TYPE_KEYS.Goal, TEST_PROJECT),
      ).toBe(true);
      expect(
        registry.isTrackingSource(WORK_ITEM_TYPE_KEYS.Standard, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isTrackingSource(WORK_ITEM_TYPE_KEYS.Feature, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isTrackingSource(WORK_ITEM_TYPE_KEYS.Bug, TEST_PROJECT),
      ).toBe(false);
      expect(
        registry.isTrackingSource(WORK_ITEM_TYPE_KEYS.Contract, TEST_PROJECT),
      ).toBe(false);
    });

    it('getTrackingSourceTypes returns exactly [GOAL]', () => {
      expect(registry.getTrackingSourceTypes(TEST_PROJECT)).toEqual([
        WORK_ITEM_TYPE_KEYS.Goal,
      ]);
    });

    it('GOAL may track active work-item targets but not PLAN or DESIGN_DOC', () => {
      expect(
        registry.isTrackingTargetEntityTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          EntityType.Task,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isTrackingTargetEntityTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          EntityType.DesignDoc,
          TEST_PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.isTrackingTargetEntityTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          EntityType.DesignDoc,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('GOAL may track FEATURE/STANDARD/BUG task subtypes but not GOAL', () => {
      expect(
        registry.isTrackingTargetTaskTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          WORK_ITEM_TYPE_KEYS.Feature,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isTrackingTargetTaskTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          WORK_ITEM_TYPE_KEYS.Standard,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isTrackingTargetTaskTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          WORK_ITEM_TYPE_KEYS.Bug,
          TEST_PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.isTrackingTargetTaskTypeAllowed(
          WORK_ITEM_TYPE_KEYS.Goal,
          WORK_ITEM_TYPE_KEYS.Goal,
          TEST_PROJECT,
        ),
      ).toBe(false);
    });

    it('projects target-owned tracking declarations back to the source', () => {
      expect(
        registry.getTrackingTargetTaskTypes(
          WORK_ITEM_TYPE_KEYS.Goal,
          TEST_PROJECT,
        ),
      ).toEqual([
        WORK_ITEM_TYPE_KEYS.Bug,
        WORK_ITEM_TYPE_KEYS.Feature,
        WORK_ITEM_TYPE_KEYS.Standard,
      ]);
    });

    it('getAllowedStatusEntries returns one entry per type with consistent statuses', () => {
      const entries = registry.getAllowedStatusEntries(TEST_PROJECT);
      expect(entries.map((e) => e.taskType).sort()).toEqual(
        [...ALL_TYPES].sort(),
      );
      for (const entry of entries) {
        expect(entry.allowedStatuses).toEqual([
          ...registry.getAllowedStatuses(
            entry.taskType as WorkItemTypeKey,
            TEST_PROJECT,
          ),
        ]);
      }
    });
  });

  describe('cross-instance invalidation', () => {
    const PROJECT = 'project-invalidation';

    it('refreshes the snapshot when a config-changed signal is published', async () => {
      const rows = [
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT),
      ];
      const { registry, bus, findMany } = buildRegistry(rows);
      await registry.onModuleInit();

      // Baseline: STANDARD forbids `tag` per the seeded config.
      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Standard,
          'tag',
          PROJECT,
        ),
      ).toBe(true);

      // Simulate a config change landing in Postgres: STANDARD no longer
      // forbids any scalar. The next load returns the mutated row.
      const mutated = rows.map((row) =>
        row.typeKey === WORK_ITEM_TYPE_KEYS.Standard
          ? ({ ...row, forbiddenScalars: [] } as unknown as WorkItemType)
          : row,
      );
      findMany.mockResolvedValue(mutated);

      // Publishing the invalidation must re-warm the snapshot — no restart.
      await registry.publishConfigChanged(
        'org-test' as unknown as OrganizationId,
        WORK_ITEM_TYPE_KEYS.Standard,
      );
      await flush();

      expect(
        registry.isScalarForbidden(
          WORK_ITEM_TYPE_KEYS.Standard,
          'tag',
          PROJECT,
        ),
      ).toBe(false);
      // findMany called twice: once on warm-up, once on invalidation.
      expect(findMany).toHaveBeenCalledTimes(2);

      // The bus is the delivery mechanism — a second instance subscribed to the
      // same channel would observe the same refresh.
      expect(bus).toBeInstanceOf(InMemoryMessageBus);
    });

    it('drops a deleted custom type from definitions and validation after refresh', async () => {
      const deletedTypeKey = 'DELETED_CUSTOM_TYPE';
      const deletedRow = {
        ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
        id: 'deleted-custom-row',
        isSystem: false,
        projectId: PROJECT,
        typeKey: deletedTypeKey,
        lifecycleStatus: 'active',
      } as unknown as WorkItemType;
      const remainingRows = ALL_TYPES.map(buildRow);
      const { registry, bus, findMany } = buildRegistry([
        ...remainingRows,
        deletedRow,
      ]);
      await registry.onModuleInit();

      expect(registry.getDefinition(PROJECT, deletedTypeKey)).toBeDefined();
      expect(registry.getActiveTypeKeys(PROJECT)).toContain(deletedTypeKey);

      findMany.mockResolvedValue(remainingRows);
      await registry.publishConfigChanged(
        'org-test' as unknown as OrganizationId,
        deletedTypeKey,
      );
      await flush();

      expect(registry.getDefinition(PROJECT, deletedTypeKey)).toBeUndefined();
      expect(registry.getDefinitions(PROJECT)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            definition: expect.objectContaining({ key: deletedTypeKey }),
          }),
        ]),
      );
      expect(
        registry.getDefinitions(PROJECT, WorkItemTypeLifecycleStatus.Active),
      ).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            definition: expect.objectContaining({ key: deletedTypeKey }),
          }),
        ]),
      );
      expect(registry.getActiveTypeKeys(PROJECT)).not.toContain(deletedTypeKey);
      expect(registry.isTypeActiveForProject(deletedTypeKey, PROJECT)).toBe(
        false,
      );
      expect(() => registry.assertTypeActive(deletedTypeKey, PROJECT)).toThrow(
        new BadRequestException(
          `'${deletedTypeKey}' is not a usable type for this project. ` +
            `Valid types: ${registry.getActiveTypeKeys(PROJECT).join(', ')}`,
        ),
      );
      expect(bus).toBeInstanceOf(InMemoryMessageBus);
    });

    it('rebuilds relationship answers for custom definition archive, restore, and edits', async () => {
      const customType = 'CUSTOM_REVIEW';
      const customRow = buildProjectOwnedRow(
        WORK_ITEM_TYPE_KEYS.Feature,
        PROJECT,
        {
          id: 'project-invalidation-custom-review',
          typeKey: customType,
          allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Feature],
          parentage: {
            allowedParentEntityTypes: [EntityType.Task],
          },
          tracking: {
            allowedSourceEntityTypes: [EntityType.Task],
            allowedSourceTaskTypes: [WORK_ITEM_TYPE_KEYS.Goal],
          },
        },
      );
      const rows = [...buildProjectOwnedRows(PROJECT), customRow];
      const { registry, findMany } = buildRegistry(rows);
      await registry.refresh();

      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Feature,
          customType,
          PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentEntityType(customType, EntityType.Task, PROJECT),
      ).toBe(true);
      expect(
        registry.canParentEntityType(customType, EntityType.DesignDoc, PROJECT),
      ).toBe(false);
      expect(
        registry.getTrackingTargetTaskTypes(WORK_ITEM_TYPE_KEYS.Goal, PROJECT),
      ).toContain(customType);

      findMany.mockResolvedValueOnce([
        ...buildProjectOwnedRows(PROJECT),
        { ...customRow, lifecycleStatus: 'archived' },
      ]);
      await registry.refresh();

      expect(
        registry.canParentChildType(
          WORK_ITEM_TYPE_KEYS.Feature,
          customType,
          PROJECT,
        ),
      ).toBe(false);
      expect(
        registry.canParentEntityType(customType, EntityType.Task, PROJECT),
      ).toBe(false);
      expect(
        registry.getTrackingTargetTaskTypes(WORK_ITEM_TYPE_KEYS.Goal, PROJECT),
      ).not.toContain(customType);

      findMany.mockResolvedValueOnce([
        ...buildProjectOwnedRows(PROJECT),
        {
          ...customRow,
          lifecycleStatus: 'active',
          allowedParentTypes: [WORK_ITEM_TYPE_KEYS.Standard],
          parentage: {
            allowedParentEntityTypes: [EntityType.DesignDoc],
          },
          tracking: NOT_A_TRACKING_SOURCE,
        },
      ]);
      await registry.refresh();

      expect(registry.getAllowedParentTypes(customType, PROJECT)).toEqual([
        WORK_ITEM_TYPE_KEYS.Standard,
      ]);
      expect(
        registry.canParentEntityType(customType, EntityType.Task, PROJECT),
      ).toBe(false);
      expect(
        registry.canParentEntityType(customType, EntityType.DesignDoc, PROJECT),
      ).toBe(true);
      expect(
        registry.getTrackingTargetTaskTypes(WORK_ITEM_TYPE_KEYS.Goal, PROJECT),
      ).not.toContain(customType);
    });

    it('uses the project override EntityType parentage in the atomic relationship snapshot', async () => {
      const rows = buildProjectOwnedRows(PROJECT).map((row) =>
        row.typeKey === WORK_ITEM_TYPE_KEYS.Standard
          ? {
              ...row,
              parentage: {
                allowedParentEntityTypes: [EntityType.DesignDoc],
              },
            }
          : row,
      );
      const { registry } = buildRegistry(rows);
      await registry.refresh();

      expect(
        registry.canParentEntityType(
          WORK_ITEM_TYPE_KEYS.Standard,
          EntityType.DesignDoc,
          PROJECT,
        ),
      ).toBe(true);
      expect(
        registry.canParentEntityType(
          WORK_ITEM_TYPE_KEYS.Standard,
          EntityType.Task,
          PROJECT,
        ),
      ).toBe(false);
    });
  });

  describe('project-scoped type validation', () => {
    const PROJECT_A = 'project-uuid-a';
    const PROJECT_B = 'project-uuid-b';

    it('materialized canonical types are usable only in projects that own the rows', async () => {
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
        ...buildProjectOwnedRows(PROJECT_B),
      ]);
      await registry.onModuleInit();

      for (const taskType of ALL_TYPES) {
        expect(registry.isTypeActiveForProject(taskType, PROJECT_A)).toBe(true);
        expect(registry.isTypeActiveForProject(taskType, PROJECT_B)).toBe(true);
      }
    });

    it('unknown type key is not usable in any project', async () => {
      const { registry } = buildRegistry(ALL_TYPES.map(buildRow));
      await registry.onModuleInit();

      expect(registry.isTypeActiveForProject('UNKNOWN_TYPE', PROJECT_A)).toBe(
        false,
      );
    });

    it('archived project-owned type is not usable in that project', async () => {
      const rows = [
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A).map((row) =>
          row.typeKey === WORK_ITEM_TYPE_KEYS.Standard
            ? ({ ...row, lifecycleStatus: 'archived' } as WorkItemType)
            : row,
        ),
      ];
      const { registry } = buildRegistry(rows);
      await registry.onModuleInit();

      expect(
        registry.isTypeActiveForProject(
          WORK_ITEM_TYPE_KEYS.Standard,
          PROJECT_A,
        ),
      ).toBe(false);
      for (const t of ALL_TYPES.filter(
        (t) => t !== WORK_ITEM_TYPE_KEYS.Standard,
      )) {
        expect(registry.isTypeActiveForProject(t, PROJECT_A)).toBe(true);
      }
    });

    it('active project-specific type is usable only in that project', async () => {
      const projectRow = {
        ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
        id: 'custom-row-id',
        isSystem: false,
        projectId: PROJECT_A,
        typeKey: 'CUSTOM_TYPE',
        lifecycleStatus: 'active',
      } as unknown as WorkItemType;
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
        ...buildProjectOwnedRows(PROJECT_B),
        projectRow,
      ]);
      await registry.onModuleInit();

      expect(registry.isTypeActiveForProject('CUSTOM_TYPE', PROJECT_A)).toBe(
        true,
      );
      expect(registry.isTypeActiveForProject('CUSTOM_TYPE', PROJECT_B)).toBe(
        false,
      );
    });

    it('archived project-specific type is not usable', async () => {
      const projectRow = {
        ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
        id: 'custom-row-id',
        isSystem: false,
        projectId: PROJECT_A,
        typeKey: 'CUSTOM_TYPE',
        lifecycleStatus: 'archived',
      } as unknown as WorkItemType;
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
        ...buildProjectOwnedRows(PROJECT_B),
        projectRow,
      ]);
      await registry.onModuleInit();

      expect(registry.isTypeActiveForProject('CUSTOM_TYPE', PROJECT_A)).toBe(
        false,
      );
    });

    it('getActiveTypeKeys returns sorted active keys for the project scope', async () => {
      const projectRow = {
        ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
        id: 'custom-row-id',
        isSystem: false,
        projectId: PROJECT_A,
        typeKey: 'CUSTOM_TYPE',
        lifecycleStatus: 'active',
      } as unknown as WorkItemType;
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
        ...buildProjectOwnedRows(PROJECT_B),
        projectRow,
      ]);
      await registry.onModuleInit();

      const keys = registry.getActiveTypeKeys(PROJECT_A);
      expect(keys).toEqual([...new Set([...ALL_TYPES, 'CUSTOM_TYPE'])].sort());
      // PROJECT_B has no custom rows — only its own canonical rows.
      expect(registry.getActiveTypeKeys(PROJECT_B)).toEqual(
        [...ALL_TYPES].sort(),
      );
    });

    it('assertTypeActive does not throw for an active type', async () => {
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
      ]);
      await registry.onModuleInit();

      expect(() =>
        registry.assertTypeActive(WORK_ITEM_TYPE_KEYS.Standard, PROJECT_A),
      ).not.toThrow();
    });

    it('assertTypeActive throws BadRequestException naming valid types when type is absent', async () => {
      const { registry } = buildRegistry(ALL_TYPES.map(buildRow));
      await registry.onModuleInit();

      expect(() =>
        registry.assertTypeActive('INVALID_TYPE', PROJECT_A),
      ).toThrow(BadRequestException);

      let thrown: BadRequestException | undefined;
      try {
        registry.assertTypeActive('INVALID_TYPE', PROJECT_A);
      } catch (e) {
        thrown = e as BadRequestException;
      }
      const validTypes = registry.getActiveTypeKeys(PROJECT_A);
      expect(thrown?.message).toContain('INVALID_TYPE');
      expect(thrown?.message).toContain(validTypes.join(', '));
    });

    it('assertTypeActive throws BadRequestException when type is archived', async () => {
      const rows = [
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A).map((row) =>
          row.typeKey === WORK_ITEM_TYPE_KEYS.Standard
            ? ({ ...row, lifecycleStatus: 'archived' } as WorkItemType)
            : row,
        ),
      ];
      const { registry } = buildRegistry(rows);
      await registry.onModuleInit();

      expect(() =>
        registry.assertTypeActive(WORK_ITEM_TYPE_KEYS.Standard, PROJECT_A),
      ).toThrow(BadRequestException);
    });
  });

  describe('insertAcceptedDefinitionInTransaction', () => {
    const PROJECT = 'project-uuid-write';
    const ORG = 'org-write' as unknown as OrganizationId;

    const definition: WorkItemTypeDefinitionDto = {
      key: 'MARKETING',
      name: 'Marketing',
      role: 'work-item',
      iconKey: WorkItemIconKey.Task,
      description: 'Campaign work',
      sections: [
        { key: 'brief', label: 'Brief', writingStandard: 'Keep it tight' },
        {
          key: 'preview',
          label: 'Preview',
          kind: 'html/css',
        },
      ],
      requiredScalars: ['dueDate'],
      forbiddenScalars: ['tag'],
      allowedStatuses: [WorkStatus.Active, WorkStatus.Completed],
      allowedParentTypes: ['FEATURE'],
      edgeTargets: [
        { edgeType: AgentEdgeType.RelatedTo, targetTypeKeys: ['STANDARD'] },
      ],
    };

    function buildTx() {
      const create = jest.fn().mockResolvedValue(undefined);
      const tx = {
        workItemType: { create },
        workItemTypeTemplate: { findUnique: jest.fn().mockResolvedValue(null) },
      } as unknown as Prisma.TransactionClient;
      return { tx, create };
    }

    it('persists the DTO faithfully into the rich columns as a non-system, project-scoped, active row', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();

      const { id } = await registry.insertAcceptedDefinitionInTransaction(
        tx,
        definition,
        PROJECT,
        ORG,
      );

      const { data } = create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data.id).toBe(id);
      expect(data.typeKey).toBe('MARKETING');
      expect(data.projectId).toBe(PROJECT);
      expect(data.lifecycleStatus).toBe('active');

      // Rich, faithful definition columns.
      expect(data.name).toBe('Marketing');
      expect(data.role).toBe('work-item');
      expect(data.iconKey).toBe(WorkItemIconKey.Task);
      expect(data.description).toBe('Campaign work');
      expect(data.sectionDefinitions).toEqual(definition.sections);
      expect(data.allowedParentTypes).toEqual(['FEATURE']);
      expect(data.edgeTargets).toEqual(definition.edgeTargets);
      // Shared lean columns the summary read-back path uses: statuses plus the
      // closed-enum scalar axes, stored directly as TaskScalarField arrays.
      expect(data.allowedStatuses).toEqual([
        WorkStatus.Active,
        WorkStatus.Completed,
      ]);
      expect(data.requiredScalars).toEqual(definition.requiredScalars);
      expect(data.forbiddenScalars).toEqual(definition.forbiddenScalars);
    });

    it('persists role guidance and materializes the same complete administrative definition', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();
      const accepted = {
        ...definition,
        sessionRoleGuidance: { research: '  Keep evidence verbatim.  ' },
      };

      await registry.insertAcceptedDefinitionInTransaction(
        tx,
        accepted,
        PROJECT,
        ORG,
      );
      const data = create.mock.calls[0]![0].data;
      expect(data.sessionRoleGuidance).toEqual(accepted.sessionRoleGuidance);
      const reloaded = buildRegistry([{ ...data, graphConfiguration: null }]);
      await reloaded.registry.refresh();
      expect(
        reloaded.registry.getDefinition(PROJECT, definition.key)?.definition,
      ).toMatchObject(accepted);
      expect(
        reloaded.registry.getGuidance(
          PROJECT,
          definition.key,
          WorkItemTypeGuidancePurpose.Role,
          SessionRole.Research,
        ).guidance,
      ).toBe(accepted.sessionRoleGuidance.research);
    });

    it('round-trips an independent custom color through effective reads', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();
      const accepted = {
        ...definition,
        iconKey: 'shield' as const,
        colorKey: 'secondary' as const,
      };
      await registry.insertAcceptedDefinitionInTransaction(
        tx,
        accepted,
        PROJECT,
        ORG,
      );
      const data = create.mock.calls[0][0].data;
      expect(data.colorKey).toBe('secondary');
      const reloaded = buildRegistry([{ ...data, graphConfiguration: null }]);
      await reloaded.registry.refresh();
      expect(
        reloaded.registry.getDefinition(PROJECT, definition.key),
      ).toMatchObject({
        effectiveSource: 'PROJECT_CUSTOM',
        definition: { iconKey: 'shield', colorKey: 'secondary' },
      });
    });

    it('stores omitted guidance as database null', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();
      await registry.insertAcceptedDefinitionInTransaction(
        tx,
        definition,
        PROJECT,
        ORG,
      );
      expect(create.mock.calls[0]![0].data.sessionRoleGuidance).toBe(
        Prisma.DbNull,
      );
    });

    it('persists an explicit identity reserved by grouped enactment', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();
      const reservedId = '123e4567-e89b-42d3-a456-426614174360';

      const result = await registry.insertAcceptedDefinitionInTransaction(
        tx,
        definition,
        PROJECT,
        ORG,
        reservedId,
      );

      expect(result.id).toBe(reservedId);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: reservedId }),
      });
    });

    it.each([
      ['an explicit narrower list', [WorkStatus.Active]],
      ['an explicit empty list', []],
    ])(
      'keeps %s of agent-settable statuses as authored',
      async (_label, agentSettableStatuses) => {
        const { registry } = buildRegistry([]);
        const { tx, create } = buildTx();

        await registry.insertAcceptedDefinitionInTransaction(
          tx,
          { ...definition, agentSettableStatuses },
          PROJECT,
          ORG,
        );

        const { data } = create.mock.calls[0]![0] as {
          data: Record<string, unknown>;
        };
        expect(data.agentSettableStatuses).toEqual(agentSettableStatuses);
      },
    );

    it('defaults the optional axes to neutral and writes no dropped columns', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();

      await registry.insertAcceptedDefinitionInTransaction(
        tx,
        definition,
        PROJECT,
        ORG,
      );

      const { data } = create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      // The fixture omits capabilities/parentage/tracking/etc., so they store
      // neutral values deriveRules reads as "no constraint" rather than a guess.
      expect(data.capabilities).toEqual({});
      expect(data.parentage).toEqual({ allowedParentEntityTypes: [] });
      expect(data.tracking).toEqual({
        allowedSourceEntityTypes: [],
        allowedSourceTaskTypes: [],
      });
      // No list means no restriction: agents may set every allowed status.
      expect(data.agentSettableStatuses).toEqual([
        WorkStatus.Active,
        WorkStatus.Completed,
      ]);
      expect(data.anchorableReportTypes).toEqual([]);
      expect(data.writingStandards).toEqual({ create: '', edit: '' });
      expect(data.graphConfiguration).toEqual(Prisma.JsonNull);

      // The collapse dropped these columns; the write must not resurrect them.
      expect(data.sections).toBeUndefined();
      expect(data.scalarDefinitions).toBeUndefined();
      expect(data.allowedChildTypes).toBeUndefined();
      expect(data.initialStatusPolicy).toBeUndefined();
      expect(data.allowedEdgeTargetEntityTypes).toBeUndefined();
      expect(data.requiresParent).toBeUndefined();
      expect(data.planEligible).toBeUndefined();
    });

    it('persists graph configuration separately while keeping capabilities boolean-only', async () => {
      const { registry } = buildRegistry([]);
      const { tx, create } = buildTx();
      const graph = {
        ...graphCapability('GRAPH_NODE'),
        extension: { enabled: true },
        layout: {
          ...graphCapability('GRAPH_NODE').layout,
          extension: 'preserved',
        },
      };

      await registry.insertAcceptedDefinitionInTransaction(
        tx,
        {
          ...definition,
          capabilities: {
            graph,
          } as WorkItemTypeDefinitionDto['capabilities'],
        },
        PROJECT,
        ORG,
      );

      const { data } = create.mock.calls[0]![0] as {
        data: Record<string, unknown>;
      };
      expect(data.capabilities).toEqual({});
      expect(data.graphConfiguration).toEqual(graph);
    });

    it.each([true, false])(
      'persists showsInExplorerSidebar=%s in the existing boolean capability map',
      async (showsInExplorerSidebar) => {
        const { registry } = buildRegistry([]);
        const { tx, create } = buildTx();

        await registry.insertAcceptedDefinitionInTransaction(
          tx,
          {
            ...definition,
            capabilities: { showsInExplorerSidebar },
          },
          PROJECT,
          ORG,
        );

        const { data } = create.mock.calls[0]![0] as {
          data: Record<string, unknown>;
        };
        expect(data.capabilities).toEqual({ showsInExplorerSidebar });
      },
    );

    it('the post-commit runner publishes the config-changed invalidation for the new key', async () => {
      const { registry, bus } = buildRegistry([]);
      const { tx } = buildTx();
      const publishSpy = jest.spyOn(bus, 'publish');

      const { runPostCommit } =
        await registry.insertAcceptedDefinitionInTransaction(
          tx,
          definition,
          PROJECT,
          ORG,
        );

      // The signal must not fire as part of the in-tx insert — only when the
      // caller runs the returned runner after the tx commits.
      expect(publishSpy).not.toHaveBeenCalled();

      await runPostCommit();

      expect(publishSpy).toHaveBeenCalledTimes(1);
      const published = publishSpy.mock.calls[0]![0];
      expect(published.event.type).toBe(
        EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED,
      );
      expect(published.event.aggregateId).toBe('MARKETING');
    });
  });

  describe('accepted custom definition lifecycle writes', () => {
    const PROJECT = 'project-lifecycle-write';
    const ORG = 'org-lifecycle-write' as unknown as OrganizationId;
    const storedRow = {
      ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
      id: 'custom-marketing-row',
      typeKey: 'MARKETING',
      isSystem: false,
      projectId: PROJECT,
      name: 'Marketing',
      sectionDefinitions: [
        { key: 'brief', label: 'Brief' },
        { key: 'audience', label: 'Audience' },
      ],
    } as unknown as WorkItemType;
    const editedDefinition = {
      key: 'MARKETING',
      name: 'Marketing',
      sections: [{ key: 'brief', label: 'Brief' }],
      requiredScalars: storedRow.requiredScalars,
      forbiddenScalars: storedRow.forbiddenScalars,
      allowedStatuses: storedRow.allowedStatuses,
      allowedParentTypes: storedRow.allowedParentTypes,
      edgeTargets: storedRow.edgeTargets,
    } as unknown as WorkItemTypeDefinitionDto;

    function buildLifecycleTx(rows: Array<WorkItemType | null>) {
      const findFirst = jest.fn();
      for (const row of rows) findFirst.mockResolvedValueOnce(row);
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      const tx = {
        workItemType: { findFirst, updateMany, deleteMany },
        workItemTypeTemplate: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as unknown as Prisma.TransactionClient;
      return { tx, findFirst, updateMany, deleteMany };
    }

    it('updates only the registry definition and preserves dropped item section content', async () => {
      const { registry } = buildRegistry([]);
      const { tx, updateMany } = buildLifecycleTx([storedRow]);

      const { runPostCommit } =
        await registry.updateAcceptedDefinitionInTransaction(
          tx,
          'MARKETING',
          editedDefinition,
          PROJECT,
          ORG,
        );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: storedRow.id, lifecycleStatus: 'active' },
        data: expect.objectContaining({
          sectionDefinitions: editedDefinition.sections,
        }),
      });
      expect((tx as any).taskSection).toBeUndefined();
      expect((tx as any).task).toBeUndefined();

      const publishSpy = jest.spyOn(registry, 'publishConfigChanged');
      expect(publishSpy).not.toHaveBeenCalled();
      await runPostCommit();
      expect(publishSpy).toHaveBeenCalledWith(ORG, 'MARKETING', PROJECT);
    });

    it.each([undefined, {}, { implementation: '  New advice  ' }])(
      'preserves or removes role entries through approved edits: %j',
      async (sessionRoleGuidance) => {
        const { registry } = buildRegistry([]);
        const { tx, updateMany } = buildLifecycleTx([
          { ...storedRow, sessionRoleGuidance: { review: 'Old advice' } },
        ]);
        await registry.updateAcceptedDefinitionInTransaction(
          tx,
          'MARKETING',
          { ...editedDefinition, sessionRoleGuidance },
          PROJECT,
          ORG,
        );
        expect(updateMany.mock.calls[0]![0].data.sessionRoleGuidance).toEqual(
          sessionRoleGuidance ?? Prisma.DbNull,
        );
      },
    );

    it('clears a previously persisted icon when the optional iconKey is removed', async () => {
      const { registry } = buildRegistry([]);
      const { tx, updateMany } = buildLifecycleTx([
        { ...storedRow, iconKey: WorkItemIconKey.Task },
      ]);

      await registry.updateAcceptedDefinitionInTransaction(
        tx,
        'MARKETING',
        editedDefinition,
        PROJECT,
        ORG,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: storedRow.id, lifecycleStatus: 'active' },
        data: expect.objectContaining({ iconKey: null }),
      });
    });

    it.each([
      'primary',
      'secondary',
      'success',
      'warning',
      'error',
      'info',
      undefined,
    ] as const)('persists custom color %s or clears it', async (colorKey) => {
      const { registry } = buildRegistry([]);
      const { tx, updateMany } = buildLifecycleTx([
        { ...storedRow, colorKey: 'primary' },
      ]);
      await registry.updateAcceptedDefinitionInTransaction(
        tx,
        'MARKETING',
        { ...editedDefinition, ...(colorKey ? { colorKey } : {}) },
        PROJECT,
        ORG,
      );
      expect(updateMany.mock.calls[0][0].data.colorKey).toBe(colorKey ?? null);
    });

    it('rejects canonical color at application before writing', async () => {
      const { registry } = buildRegistry([]);
      const { tx, updateMany } = buildLifecycleTx([storedRow]);
      (tx.workItemTypeTemplate.findUnique as jest.Mock).mockResolvedValue({
        id: 'canonical',
      });
      await expect(
        registry.updateAcceptedDefinitionInTransaction(
          tx,
          'MARKETING',
          { ...editedDefinition, colorKey: 'primary' },
          PROJECT,
          ORG,
        ),
      ).rejects.toThrow('Only project-custom');
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('archives only the registry row and defers invalidation', async () => {
      const { registry } = buildRegistry([]);
      const { tx, updateMany } = buildLifecycleTx([storedRow]);
      const publishSpy = jest.spyOn(registry, 'publishConfigChanged');

      const { runPostCommit } =
        await registry.archiveAcceptedDefinitionInTransaction(
          tx,
          'MARKETING',
          PROJECT,
          ORG,
        );

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: storedRow.id, lifecycleStatus: 'active' },
        data: { lifecycleStatus: 'archived' },
      });
      expect((tx as any).task).toBeUndefined();
      expect(publishSpy).not.toHaveBeenCalled();
      await runPostCommit();
      expect(publishSpy).toHaveBeenCalledWith(ORG, 'MARKETING', PROJECT);
    });

    it('hard-deletes an accepted archived custom row and defers invalidation', async () => {
      const row = {
        ...storedRow,
        lifecycleStatus: 'archived',
      } as WorkItemType;
      const { registry } = buildRegistry([]);
      const { tx, deleteMany } = buildLifecycleTx([row, row]);
      const publishSpy = jest.spyOn(registry, 'publishConfigChanged');

      await registry.assertCustomDefinitionDeletableInTransaction(
        tx,
        'MARKETING',
        PROJECT,
      );
      const { runPostCommit } =
        await registry.deleteAcceptedCustomDefinitionInTransaction(
          tx,
          'MARKETING',
          PROJECT,
          ORG,
        );

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          id: row.id,
          projectId: PROJECT,
          lifecycleStatus: 'archived',
        },
      });
      expect(publishSpy).not.toHaveBeenCalled();
      await runPostCommit();
      expect(publishSpy).toHaveBeenCalledWith(ORG, 'MARKETING', PROJECT);
    });

    it.each([
      ['missing', null],
      [
        'canonical',
        buildProjectOwnedRow(WORK_ITEM_TYPE_KEYS.Standard, PROJECT),
      ],
      ['active', storedRow],
    ])('rejects a %s row before hard deletion', async (_name, projectRow) => {
      const { registry } = buildRegistry([]);
      const { tx, deleteMany } = buildLifecycleTx([
        projectRow as WorkItemType | null,
      ]);

      await expect(
        registry.assertCustomDefinitionDeletableInTransaction(
          tx,
          _name === 'canonical'
            ? WORK_ITEM_TYPE_KEYS.Standard
            : _name === 'active'
              ? 'MARKETING'
              : 'MISSING',
          PROJECT,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it.each(['update', 'archive'] as const)(
      'rejects a missing custom row before the %s write',
      async (operation) => {
        const { registry } = buildRegistry([]);
        const { tx, updateMany } = buildLifecycleTx([null, null]);

        const result =
          operation === 'update'
            ? registry.updateAcceptedDefinitionInTransaction(
                tx,
                'MISSING',
                editedDefinition,
                PROJECT,
                ORG,
              )
            : registry.archiveAcceptedDefinitionInTransaction(
                tx,
                'MISSING',
                PROJECT,
                ORG,
              );

        await expect(result).rejects.toThrow(
          "Active custom work-item type 'MISSING' is no longer available in this project.",
        );
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it('reconstructs the stored definition for acceptance-time classification', async () => {
      const { registry } = buildRegistry([]);
      const { tx } = buildLifecycleTx([storedRow]);

      await expect(
        registry.getAcceptedCustomDefinitionInTransaction(
          tx,
          'MARKETING',
          PROJECT,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          definition: expect.objectContaining({
            key: 'MARKETING',
            sections: storedRow.sectionDefinitions,
          }),
        }),
      );
    });
  });

  describe('project-scoped custom type resolution', () => {
    const PROJECT_A = 'project-custom-a';
    const PROJECT_B = 'project-custom-b';

    // Two projects each define a 'MARKETING' type with DIFFERENT rules. Before
    // the per-project split these collided in one global map keyed by type;
    // now each resolves to its own rules in its own scope.
    const marketingA = {
      ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
      id: 'marketing-a',
      isSystem: false,
      projectId: PROJECT_A,
      typeKey: 'MARKETING',
      lifecycleStatus: 'active',
      name: 'Marketing (A)',
      sectionDefinitions: [{ key: 'description', label: 'Description' }],
      requiredScalars: ['tag'],
      capabilities: {
        requiresParent: false,
        planEligible: true,
        hasSetInitialStatus: false,
        rendersInline: false,
        showsInExplorerSidebar: true,
      },
    } as unknown as WorkItemType;

    const marketingB = {
      ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
      id: 'marketing-b',
      isSystem: false,
      projectId: PROJECT_B,
      typeKey: 'MARKETING',
      lifecycleStatus: 'active',
      name: 'Marketing (B)',
      sectionDefinitions: [
        { key: 'description', label: 'Description' },
        { key: 'acceptanceCriteria', label: 'Acceptance Criteria' },
      ],
      requiredScalars: [],
      allowedParentTypes: [],
      capabilities: {
        requiresParent: false,
        planEligible: true,
        hasSetInitialStatus: false,
        rendersInline: false,
        showsInExplorerSidebar: false,
      },
    } as unknown as WorkItemType;

    const graphAlpha = {
      ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
      id: 'graph-alpha',
      isSystem: false,
      projectId: PROJECT_A,
      typeKey: 'GRAPH_ALPHA',
      lifecycleStatus: 'active',
      name: 'Graph Alpha',
      allowedParentTypes: [],
      capabilities: {
        requiresParent: false,
        planEligible: false,
        hasSetInitialStatus: false,
        rendersInline: false,
      },
      graphConfiguration: graphCapability('GRAPH_ALPHA_NODE'),
    } as unknown as WorkItemType;

    const graphBeta = {
      ...graphAlpha,
      id: 'graph-beta',
      typeKey: 'GRAPH_BETA',
      name: 'Graph Beta',
      capabilities: {
        requiresParent: false,
        planEligible: false,
        hasSetInitialStatus: false,
        rendersInline: false,
      },
      graphConfiguration: graphCapability('GRAPH_BETA_NODE'),
    } as unknown as WorkItemType;

    const htmlCssType = {
      ...marketingA,
      id: 'html-css-type',
      typeKey: 'HTML_CSS_TYPE',
      name: 'HTML/CSS Type',
      sectionDefinitions: [
        { key: 'preview', label: 'Preview', kind: 'html/css' },
      ],
    } as unknown as WorkItemType;

    async function warm() {
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
        ...buildProjectOwnedRows(PROJECT_B),
        marketingA,
        marketingB,
        graphAlpha,
        graphBeta,
        htmlCssType,
      ]);
      await registry.onModuleInit();
      return registry;
    }

    it('resolves the same custom key to independent rules per project', async () => {
      const registry = await warm();

      expect(
        registry.getSections('MARKETING' as WorkItemTypeKey, PROJECT_A),
      ).toEqual([TaskSectionKey.Description]);
      expect(
        registry.getSections('MARKETING' as WorkItemTypeKey, PROJECT_B),
      ).toEqual([
        TaskSectionKey.Description,
        TaskSectionKey.AcceptanceCriteria,
      ]);
      expect(
        registry.isScalarRequired(
          'MARKETING' as WorkItemTypeKey,
          'tag',
          PROJECT_A,
        ),
      ).toBe(true);
      expect(
        registry.isScalarRequired(
          'MARKETING' as WorkItemTypeKey,
          'tag',
          PROJECT_B,
        ),
      ).toBe(false);
      expect(registry.getAllowedParentTypes('MARKETING', PROJECT_A)).toEqual([
        WORK_ITEM_TYPE_KEYS.Feature,
        WORK_ITEM_TYPE_KEYS.Standard,
      ]);
      expect(registry.getAllowedParentTypes('MARKETING', PROJECT_B)).toEqual(
        [],
      );
    });

    it('resolves a custom type through the per-type accessors in its own project', async () => {
      const registry = await warm();

      expect(registry.getAllowedChildTypes('MARKETING', PROJECT_B)).toEqual([]);
      expect(
        registry.getInitialStatusPolicy(
          'MARKETING' as WorkItemTypeKey,
          PROJECT_A,
        ).initialStatus,
      ).toBe(WorkStatus.Backlog);
      // System types still resolve within a custom type's project scope.
      expect(
        registry.getAllowedParentTypes(WORK_ITEM_TYPE_KEYS.Standard, PROJECT_A),
      ).toContain(WORK_ITEM_TYPE_KEYS.Feature);
      expect(registry.showsInExplorerSidebar('MARKETING', PROJECT_A)).toBe(
        true,
      );
      expect(registry.showsInExplorerSidebar('MARKETING', PROJECT_B)).toBe(
        false,
      );
      // GRAPH_ALPHA omits the optional capability entirely; the accessor is
      // fail-closed rather than deriving visibility from its graph shape.
      expect(registry.showsInExplorerSidebar('GRAPH_ALPHA', PROJECT_A)).toBe(
        false,
      );
    });

    it('derives graph rules for differently named custom graph-shaped types through the same accessors', async () => {
      const registry = await warm();

      expect(
        registry.getGraphReadableRelationshipTypes('GRAPH_ALPHA', PROJECT_A),
      ).toEqual([AgentEdgeType.Standard]);
      expect(
        registry.getGraphReadableRelationshipTypes('GRAPH_BETA', PROJECT_A),
      ).toEqual([AgentEdgeType.Standard]);
      expect(
        registry.getGraphCapability('GRAPH_ALPHA', PROJECT_A)?.layout,
      ).toEqual({
        sectionKey: 'graphLayout',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
      });
      expect(
        registry.getDefinition(PROJECT_A, 'GRAPH_BETA')?.definition.capabilities
          ?.graph,
      ).toEqual(graphCapability('GRAPH_BETA_NODE'));
    });

    it('preserves an HTML/CSS section declaration through project resolution', async () => {
      const registry = await warm();

      expect(
        registry.getSectionDefinition('HTML_CSS_TYPE', 'preview', PROJECT_A),
      ).toEqual({ key: 'preview', label: 'Preview', kind: 'html/css' });
      expect(
        registry.getDefinition(PROJECT_A, 'HTML_CSS_TYPE')?.definition.sections,
      ).toEqual([{ key: 'preview', label: 'Preview', kind: 'html/css' }]);
    });

    it('does not leak a custom type into a project that did not define it', async () => {
      const registry = await warm();

      expect(() =>
        registry.getSections('MARKETING' as WorkItemTypeKey, 'project-other'),
      ).toThrow();
    });

    it('resolves archived custom definitions by project and type key', async () => {
      const archivedMarketing = {
        ...marketingA,
        id: 'marketing-archived',
        typeKey: 'MARKETING_ARCHIVED',
        lifecycleStatus: 'archived',
      } as unknown as WorkItemType;
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        archivedMarketing,
      ]);
      await registry.onModuleInit();

      expect(registry.getDefinition(PROJECT_A, 'MARKETING_ARCHIVED')).toEqual(
        expect.objectContaining({
          effectiveSource: WorkItemTypeEffectiveSource.ProjectCustom,
          status: WorkItemTypeLifecycleStatus.Archived,
          projectId: PROJECT_A,
        }),
      );
      expect(
        registry.getDefinition(PROJECT_B, 'MARKETING_ARCHIVED'),
      ).toBeUndefined();
    });
  });

  describe('getTaskRefinementLevels (section-derived)', () => {
    const PROJECT_A = 'project-uuid-levels-a';
    const PROJECT_B = 'project-uuid-levels-b';

    // Custom, project-scoped rows whose rich definition columns are populated so
    // getDefinition can read their section sets. One carries acceptanceCriteria
    // (two-level), one does not (single-level).
    const customTwoLevel = {
      ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
      id: 'custom-two-level',
      isSystem: false,
      projectId: PROJECT_A,
      typeKey: 'CUSTOM_TWO',
      lifecycleStatus: 'active',
      name: 'Custom Two',
      sectionDefinitions: [
        { key: 'description', label: 'Description' },
        { key: 'acceptanceCriteria', label: 'Acceptance Criteria' },
      ],
    } as unknown as WorkItemType;

    const customSingleLevel = {
      ...buildRow(WORK_ITEM_TYPE_KEYS.Standard),
      id: 'custom-single-level',
      isSystem: false,
      projectId: PROJECT_A,
      typeKey: 'CUSTOM_ONE',
      lifecycleStatus: 'active',
      name: 'Custom One',
      sectionDefinitions: [{ key: 'description', label: 'Description' }],
    } as unknown as WorkItemType;

    async function warmRegistry() {
      const { registry } = buildRegistry([
        ...ALL_TYPES.map(buildRow),
        ...buildProjectOwnedRows(PROJECT_A),
        ...buildProjectOwnedRows(PROJECT_B),
        customTwoLevel,
        customSingleLevel,
      ]);
      await registry.onModuleInit();
      return registry;
    }

    it('leaves the four built-in types unchanged: only STANDARD is two-level', async () => {
      const registry = await warmRegistry();
      expect(
        registry.getTaskRefinementLevels(
          WORK_ITEM_TYPE_KEYS.Standard,
          PROJECT_A,
        ),
      ).toEqual(['description', 'acceptanceCriteria']);
      expect(
        registry.getTaskRefinementLevels(
          WORK_ITEM_TYPE_KEYS.Feature,
          PROJECT_A,
        ),
      ).toEqual(['description']);
      expect(
        registry.getTaskRefinementLevels(WORK_ITEM_TYPE_KEYS.Bug, PROJECT_A),
      ).toEqual(['description']);
      expect(
        registry.getTaskRefinementLevels(WORK_ITEM_TYPE_KEYS.Goal, PROJECT_A),
      ).toEqual(['description']);
    });

    it('derives the two-level flow for a custom type with an acceptanceCriteria section', async () => {
      const registry = await warmRegistry();
      expect(registry.getTaskRefinementLevels('CUSTOM_TWO', PROJECT_A)).toEqual(
        ['description', 'acceptanceCriteria'],
      );
    });

    it('derives the single-level flow for a custom type without an acceptanceCriteria section', async () => {
      const registry = await warmRegistry();
      expect(registry.getTaskRefinementLevels('CUSTOM_ONE', PROJECT_A)).toEqual(
        ['description'],
      );
    });

    it('fails when a typed item has no project-owned definition', async () => {
      const registry = await warmRegistry();
      expect(() =>
        registry.getTaskRefinementLevels('UNKNOWN', PROJECT_A),
      ).toThrow("Work-item type 'UNKNOWN' is not present");
      // CUSTOM_TWO is scoped to PROJECT_A and is not visible to PROJECT_B.
      expect(() =>
        registry.getTaskRefinementLevels('CUSTOM_TWO', PROJECT_B),
      ).toThrow("Work-item type 'CUSTOM_TWO' is not present");
    });
  });
});
