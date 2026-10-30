import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ALL_DECLARED_SECTIONS, TaskService } from '../task.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../../core/events/tokens';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import { CreateTaskDto, UpdateTaskDto } from '../../../generated';
import {
  TaskDependencyRelationType,
  TaskDependencySourceType,
  WorkStatus,
} from '@prisma/client';
import * as TestUtils from '../../../utils/testUtils';
import { materializedSectionsToContentMap } from '../../../utils/work-item-section.util';
import { TaskArtifactService } from '../task-artifact.service';
import { ProjectId, TaskId, UserId } from 'src/types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { TaskDraft } from '../types';
import { RedisService } from '../../../core/redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';
import { AgentEdgeClientService } from '../../agent-edge-client.service';
import { GraphsClientService } from '../../graphs-client.service';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { WorkItemParentageValidator } from '../work-item-parentage-validator.service';
import {
  createWarmWorkItemTypeRegistryWithCustomTypes,
  type CustomTypeRowSpec,
} from '../../../../test/setup/work-item-type-registry.fixture';
import { TaskSectionKey } from '../../../generated/model/taskSectionKey';
import type { TaskMonitorExecutionDefinition } from '../../../generated/model/taskMonitorExecutionDefinition';
import { TaskMonitorReviewMode } from '../../../generated/model/taskMonitorReviewMode';
import { AgentEdgeCategory } from '../../../generated/graphs/model/agentEdgeCategory';
import { AgentEdgeDirection } from '../../../generated/graphs/model/agentEdgeDirection';
import { AgentEdgeEndpointEntityType } from '../../../generated/graphs/model/agentEdgeEndpointEntityType';
import { RelationshipType } from '../../../generated/graphs/model/relationshipType';
import { SearchResponse } from '../../../generated/graphs/model/searchResponse';
import { TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF } from '../task-monitor-execution-definition.validator';
import { WORK_ITEM_GRAPH_LAYOUT_SCHEMA_REF } from '../work-item-graph-layout.validator';
import { IMAGE_SECTION_CONTENT_SCHEMA_REF } from '../image-section-content.validator';
import { PlanHierarchyRollupService } from '../plan-hierarchy-rollup.service';
import { createPlanHierarchyFakeTx } from './plan-hierarchy-fake-tx';
import { WorkItemGraphParticipationComposer } from '../work-item-graph-participation';

const { testIds } = TestUtils;
const TASK_MONITOR_TASK_ID = '33333333-3333-4333-8333-333333333333';
const NEXT_TASK_MONITOR_TASK_ID = '44444444-4444-4444-8444-444444444444';
const TASK_MONITOR_LAUNCH_CONFIGURATION = {
  method: 'quick' as const,
  provider: 'codex' as const,
  model: 'gpt-5.5',
  reasoningEffort: 'high' as const,
};

/**
 * A registry-active, project-scoped custom type used to prove that an accepted
 * custom key flows through create with rules DERIVED from its own stored
 * definition — sections (description + requirements, distinct from STANDARD's
 * description + acceptanceCriteria), initial status, and FEATURE-only
 * parentage — rather than being collapsed to STANDARD.
 */
const CUSTOM_TYPE_SPEC: CustomTypeRowSpec = {
  typeKey: 'MARKETING',
  projectId: testIds.project,
  name: 'Marketing',
  sectionKeys: [TaskSectionKey.Description, TaskSectionKey.Requirements],
  allowedParentTypes: ['FEATURE'],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

/**
 * A custom type whose declared sections include `audience`, a key OUTSIDE the
 * built-in {@link TaskSectionKey} enum. Proves section order is derived from the
 * declared sequence — not a hardcoded per-key table — so a non-built-in key
 * still persists with a defined, gap-free order (description=0, audience=1).
 */
const CUSTOM_TYPE_WITH_NONBUILTIN_SECTION: CustomTypeRowSpec = {
  typeKey: 'CAMPAIGN',
  projectId: testIds.project,
  name: 'Campaign',
  sectionKeys: [TaskSectionKey.Description, 'audience'],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const CUSTOM_TYPE_WITH_SCHEMA_BACKED_SECTION: CustomTypeRowSpec = {
  typeKey: 'CUSTOM_JSON',
  projectId: testIds.project,
  name: 'Custom JSON',
  sectionDefinitions: [
    {
      key: 'payload',
      label: 'Payload',
      kind: 'json',
      schemaRef: TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF,
    },
  ],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const CUSTOM_TYPE_WITH_IMAGE_SECTION: CustomTypeRowSpec = {
  typeKey: 'CUSTOM_IMAGE',
  projectId: testIds.project,
  name: 'Custom Image',
  sectionDefinitions: [
    {
      key: 'image',
      label: 'Image',
      kind: 'json',
      schemaRef: IMAGE_SECTION_CONTENT_SCHEMA_REF,
    },
  ],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const VALID_IMAGE_SECTION_CONTENT = {
  mimeType: 'image/png',
  data: Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
  ]).toString('base64'),
};

const CUSTOM_TYPE_WITH_UNSUPPORTED_SCHEMA_BACKED_SECTION: CustomTypeRowSpec = {
  typeKey: 'UNSUPPORTED_JSON',
  projectId: testIds.project,
  name: 'Unsupported JSON',
  sectionDefinitions: [
    {
      key: 'payload',
      label: 'Payload',
      kind: 'json',
      schemaRef: '#/components/schemas/UnsupportedSection',
    },
  ],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const CUSTOM_TYPE_WITH_HTML_CSS_SECTION: CustomTypeRowSpec = {
  typeKey: 'CUSTOM_HTML_CSS',
  projectId: testIds.project,
  name: 'Custom HTML/CSS',
  sectionDefinitions: [
    {
      key: 'preview',
      label: 'Preview',
      kind: 'html/css',
      defaultSizeKey: 'panel',
      sizeProfiles: [
        {
          key: 'panel',
          label: 'Panel',
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 320, height: 200 },
              page: { width: 800, height: 600 },
            },
          ],
        },
      ],
    },
  ],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const CUSTOM_TYPE_WITH_STRUCTURED_MOCKUP_SECTION: CustomTypeRowSpec = {
  typeKey: 'CUSTOM_STRUCTURED_MOCKUP',
  projectId: testIds.project,
  name: 'Custom Structured Mockup',
  sectionDefinitions: [
    {
      key: 'mockup',
      label: 'Mockup',
      kind: 'structured-mockup',
      defaultSizeKey: 'panel',
      sizeProfiles: [
        {
          key: 'panel',
          label: 'Panel',
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 320, height: 200 },
              page: { width: 800, height: 600 },
            },
          ],
        },
      ],
    },
  ],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const ARCHIVED_CUSTOM_TYPE_SPEC: CustomTypeRowSpec = {
  typeKey: 'RETIRED_CAMPAIGN',
  projectId: testIds.project,
  name: 'Retired Campaign',
  lifecycleStatus: 'archived',
  sectionKeys: [TaskSectionKey.Description, TaskSectionKey.Requirements],
  allowedParentTypes: ['FEATURE'],
  capabilities: {
    requiresParent: false,
    planEligible: true,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const GRAPH_ROOT_TYPE_SPEC: CustomTypeRowSpec = {
  typeKey: 'GRAPH_ROOT',
  projectId: testIds.project,
  name: 'Graph Root',
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
      schemaRef: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_REF,
    },
  ],
  allowedParentTypes: [],
  capabilities: {
    requiresParent: false,
    planEligible: false,
    hasSetInitialStatus: false,
    rendersInline: false,
    graph: {
      nodeChildType: 'GRAPH_NODE',
      layout: {
        sectionKey: 'graphLayout',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
      },
      readableRelationships: [
        {
          edgeType: RelationshipType.Standard,
          category: 'flow',
          sourceEndpoint: {
            role: 'graphNode',
            entityTypes: ['TASK'],
            workItemTypeKeys: ['GRAPH_NODE'],
          },
          targetEndpoint: {
            role: 'graphNode',
            entityTypes: ['TASK'],
            workItemTypeKeys: ['GRAPH_NODE'],
          },
          direction: { required: true, allowedDirections: ['forward'] },
        },
      ],
      editableRelationships: [],
      searchableMetaLinkTargets: [],
      rendererKey: 'work-item-graph',
      editorKey: 'work-item-graph-editor',
      supportedActions: ['viewGraph', 'replaceLayout'],
    },
  },
};

const GRAPH_NODE_TYPE_SPEC: CustomTypeRowSpec = {
  typeKey: 'GRAPH_NODE',
  projectId: testIds.project,
  name: 'Graph Node',
  sectionKeys: [TaskSectionKey.Description],
  allowedParentTypes: ['GRAPH_ROOT'],
  capabilities: {
    requiresParent: true,
    planEligible: false,
    hasSetInitialStatus: false,
    rendersInline: false,
  },
};

const VALID_SCHEMA_BACKED_SECTION_CONTENT = {
  executionPlan: [
    {
      taskId: TASK_MONITOR_TASK_ID,
      dependsOnTaskIds: [],
      launchConfiguration: TASK_MONITOR_LAUNCH_CONFIGURATION,
    },
    {
      taskId: NEXT_TASK_MONITOR_TASK_ID,
      dependsOnTaskIds: [TASK_MONITOR_TASK_ID],
      launchConfiguration: {
        ...TASK_MONITOR_LAUNCH_CONFIGURATION,
        method: 'plan',
      },
    },
  ],
  launchPolicy: {
    terminalSupervision: { mode: TaskMonitorReviewMode.AgentDecides },
  },
  cursor: 0,
} satisfies TaskMonitorExecutionDefinition;

const VALID_GRAPH_LAYOUT_CONTENT = {
  schemaVersion: 'work-item-graph-layout.v1' as const,
  nodes: [
    {
      node: {
        kind: 'persistedWorkItem' as const,
        workItemId: '66666666-6666-4666-8666-666666666666',
      },
      position: { x: 120.5, y: -42 },
    },
  ],
};

const SESSION_LINKED_TASK_MONITOR: TaskMonitorExecutionDefinition = {
  ...VALID_SCHEMA_BACKED_SECTION_CONTENT,
  executionPlan: VALID_SCHEMA_BACKED_SECTION_CONTENT.executionPlan.map(
    (node, index) =>
      index === 0
        ? {
            ...node,
            agentSessionId: '55555555-5555-4555-8555-555555555555',
          }
        : node,
  ),
};

const ADVANCED_TASK_MONITOR: TaskMonitorExecutionDefinition = {
  ...VALID_SCHEMA_BACKED_SECTION_CONTENT,
  cursor: 1,
};

describe('TaskService', () => {
  let service: TaskService;
  let mockPrismaService: jest.Mocked<PrismaService>;
  let mockEventPublisher: jest.Mocked<DomainEventPublisher>;
  let mockTaskArtifactService: jest.Mocked<
    Pick<
      TaskArtifactService,
      'storeOriginalGeneration' | 'updateOriginalArtifactFields'
    >
  >;
  let mockGraphsClient: {
    readStructuredGraph: jest.Mock;
    readIncidentEdges: jest.Mock;
    searchGraph: jest.Mock;
    searchGraphAllPages: jest.Mock;
  };
  let mockAgentEdgeClient: { findIncident: jest.Mock };
  let mockParticipationComposer: { compose: jest.Mock };
  let mockTransaction: jest.Mock;
  let workItemTypeRegistry: WorkItemTypeRegistryService;

  const mockTaskData = {
    id: testIds.task,
    name: 'Test Task',
    type: 'STANDARD' as const,
    description: 'Test description',
    acceptanceCriteria: 'Success criteria',
    organizationId: testIds.organization,
    projectId: testIds.project,
    initiativeId: testIds.initiative,
    status: 'BACKLOG' as const,
    source: 'system' as const,
    tag: undefined,
    priority: 'MEDIUM' as const,
    assigneeId: undefined,
    parentTaskId: null,
    dueDate: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    archivedAt: undefined,
  };
  const defaultSectionContent = {
    description: mockTaskData.description,
    acceptanceCriteria: mockTaskData.acceptanceCriteria,
  };
  const createTaskSectionRecords = (
    taskId: string,
    contentOverrides: Partial<
      Record<'description' | 'acceptanceCriteria', string>
    > = {},
  ) => {
    const materialized = TestUtils.createMockMaterializedTaskSections({
      ...defaultSectionContent,
      ...contentOverrides,
    });

    return materialized.map((section) => ({
      id: `${taskId}-${section.key}`,
      taskId,
      key: section.key,
      order: section.order,
      materializedMarkdown: section.materializedMarkdown,
    }));
  };
  const createTaskMaterializedSections = (
    taskId: string,
    contentOverrides: Partial<
      Record<'description' | 'acceptanceCriteria', string>
    > = {},
  ) =>
    createTaskSectionRecords(taskId, contentOverrides).map((section) => ({
      id: section.id,
      key: section.key,
      order: section.order,
      materializedMarkdown: section.materializedMarkdown,
      materializedProposalId: '',
    }));
  const createUpdateSectionRows = (
    taskId: string,
    updates: Array<{ key: string; content?: unknown }>,
  ) =>
    updates.map((update, index) => ({
      id: `${taskId}-${update.key}-${index}`,
      key: update.key,
      order: index,
      materializedMarkdown: update.content ?? null,
    }));

  beforeEach(async () => {
    mockTransaction = jest.fn();
    mockPrismaService =
      TestUtils.createMockPrismaService() as unknown as jest.Mocked<PrismaService>;
    mockPrismaService.$transaction = mockTransaction;
    // Default tx behavior: proxy reads/writes through mockPrismaService.db so
    // tests that mock prisma.db.* directly still work after methods like
    // updateInTransaction lifted those reads inside the tx. Tests that need
    // tx-specific behavior can still call mockTransaction.mockImplementation.
    mockTransaction.mockImplementation(async (cb: any) =>
      cb(mockPrismaService.db),
    );

    mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    mockTaskArtifactService = {
      storeOriginalGeneration: jest.fn().mockResolvedValue([]),
      updateOriginalArtifactFields: jest.fn().mockResolvedValue(undefined),
    };
    mockGraphsClient = {
      readStructuredGraph: jest
        .fn()
        .mockResolvedValue({ directEdges: [], expansions: [] }),
      readIncidentEdges: jest.fn().mockResolvedValue({ groups: [] }),
      searchGraph: jest.fn().mockResolvedValue({
        identitiesBySeed: [],
        seedResults: [],
        totalElements: 0,
      }),
      searchGraphAllPages: jest
        .fn()
        .mockResolvedValue({ results: [], relationships: [] }),
    };
    mockAgentEdgeClient = {
      findIncident: jest.fn().mockResolvedValue([]),
    };
    mockParticipationComposer = {
      compose: jest.fn(),
    };
    const redisProvider = createRedisServiceMock();

    workItemTypeRegistry = await createWarmWorkItemTypeRegistryWithCustomTypes([
      {
        typeKey: 'DIAGRAM',
        projectId: testIds.project,
        name: 'Diagram',
        allowedParentTypes: [],
        sectionKeys: ['diagramMetadata'],
        sectionDefinitions: [
          {
            key: 'diagramMetadata',
            label: 'Diagram metadata',
            kind: 'json',
            schemaRef: '#/components/schemas/DiagramMetadata',
          },
        ],
      },
      CUSTOM_TYPE_SPEC,
      {
        typeKey: 'mockup',
        projectId: testIds.project,
        initialStatus: 'ACTIVE',
        allowedStatuses: ['ACTIVE', 'BACKLOG', 'READY', 'ARCHIVED'],
        capabilities: { hasSetInitialStatus: true },
      },
      CUSTOM_TYPE_WITH_NONBUILTIN_SECTION,
      CUSTOM_TYPE_WITH_SCHEMA_BACKED_SECTION,
      CUSTOM_TYPE_WITH_IMAGE_SECTION,
      CUSTOM_TYPE_WITH_UNSUPPORTED_SCHEMA_BACKED_SECTION,
      CUSTOM_TYPE_WITH_HTML_CSS_SECTION,
      CUSTOM_TYPE_WITH_STRUCTURED_MOCKUP_SECTION,
      ARCHIVED_CUSTOM_TYPE_SPEC,
      GRAPH_ROOT_TYPE_SPEC,
      GRAPH_NODE_TYPE_SPEC,
    ]);
    const isParentRequired =
      workItemTypeRegistry.isParentRequired.bind(workItemTypeRegistry);
    jest
      .spyOn(workItemTypeRegistry, 'isParentRequired')
      .mockImplementation((type, projectId) =>
        type === 'STANDARD' || type === 'BUG'
          ? false
          : isParentRequired(type, projectId),
      );

    const setup = await createServiceTestingModule({
      providers: [
        TaskService,
        PrismaService,
        TaskArtifactService,
        RedisService,
        GraphsClientService,
      ],
      overrides: [
        [PrismaService, mockPrismaService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
        [TaskArtifactService, mockTaskArtifactService],
        [RedisService, redisProvider.useValue],
        [GraphsClientService, mockGraphsClient],
        [AgentEdgeClientService, mockAgentEdgeClient],
        [WorkItemGraphParticipationComposer, mockParticipationComposer],
        [
          PlanHierarchyRollupService,
          {
            rollUp: jest.fn().mockResolvedValue([]),
          },
        ],
        [WorkItemTypeRegistryService, workItemTypeRegistry],
        [
          WorkItemParentageValidator,
          new WorkItemParentageValidator(workItemTypeRegistry),
        ],
      ],
    });

    mockPrismaService.db.task = {
      ...mockPrismaService.db.task,
      findUniqueOrThrow: jest.fn().mockResolvedValue(mockTaskData),
    };
    mockPrismaService.db.workItemTypeCascadeExecution = {
      findFirst: jest.fn().mockResolvedValue(null),
    } as any;
    (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
    mockPrismaService.db.taskSection = {
      ...mockPrismaService.db.taskSection,
      createMany: jest.fn(),
      findMany: jest.fn().mockImplementation(({ where } = {}) => {
        const taskIdFilter = (where as { taskId?: unknown } | undefined)
          ?.taskId;
        const taskIds = Array.isArray(
          (taskIdFilter as { in?: string[] } | undefined)?.in,
        )
          ? ((taskIdFilter as { in?: string[] }).in ?? [])
          : typeof taskIdFilter === 'string'
            ? [taskIdFilter]
            : [];
        const keys = (where as { key?: { in?: string[] } } | undefined)?.key
          ?.in as string[] | undefined;
        const records = taskIds.flatMap((id: string) =>
          createTaskSectionRecords(id),
        );
        if (keys && keys.length > 0) {
          return Promise.resolve(
            records.filter((record: { key: string }) =>
              keys.includes(record.key),
            ),
          );
        }
        return Promise.resolve(records);
      }),
      update: jest.fn(),
    };
    mockPrismaService.db.taskSectionUpdate = {
      ...mockPrismaService.db.taskSectionUpdate,
      findMany: jest.fn().mockResolvedValue([]),
    };
    const taskWithInitiative = { ...mockTaskData };
    Object.defineProperty(taskWithInitiative, 'initiative', {
      value: { originatingProjectId: testIds.project },
      enumerable: false,
    });
    (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
      taskWithInitiative,
    );
    (mockPrismaService.db.initiative.findFirst as jest.Mock).mockResolvedValue({
      id: testIds.initiative,
      organizationId: testIds.organization,
      originatingProjectId: testIds.project,
    });

    service = setup.module.get<TaskService>(TaskService);
    jest
      .spyOn(service as any, 'assertWorkItemWriteAllowed')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('findReferences', () => {
    const secondReferenceId = '11111111-1111-4111-8111-111111111111';

    it('scopes before counting, excludes archived items, and selects only stable reference fields', async () => {
      const count = mockPrismaService.db.task.count as jest.Mock;
      const findMany = mockPrismaService.db.task.findMany as jest.Mock;
      count.mockResolvedValue(2);
      findMany.mockResolvedValue([
        {
          id: secondReferenceId,
          name: 'Feature A',
          type: 'FEATURE',
          parentTaskId: testIds.task,
          sections: [{ key: TaskSectionKey.Description }],
          description: 'aggregate data must not escape',
        },
      ]);

      const result = await service.findReferences(
        testIds.organization,
        testIds.project,
        'FEATURE',
        2,
        1,
        ' roadmap ',
        [WorkStatus.ACTIVE, WorkStatus.COMPLETED],
        'createdAt',
        'desc',
      );

      const where = {
        organizationId: testIds.organization,
        projectId: testIds.project,
        type: 'FEATURE',
        archivedAt: null,
        status: {
          in: [WorkStatus.ACTIVE, WorkStatus.COMPLETED],
          not: WorkStatus.ARCHIVED,
        },
        name: { contains: 'roadmap', mode: 'insensitive' },
      };
      expect(count).toHaveBeenCalledWith({ where });
      expect(findMany).toHaveBeenCalledWith({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          parentTaskId: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: 1,
        take: 1,
      });
      expect(result).toEqual({
        items: [
          {
            id: secondReferenceId,
            name: 'Feature A',
            type: 'FEATURE',
            parentTaskId: testIds.task,
          },
        ],
        pagination: {
          page: 2,
          limit: 1,
          total: 2,
          totalPages: 2,
          hasNext: false,
          hasPrevious: true,
        },
      });
      expect(Object.keys(result.items[0] ?? {}).sort()).toEqual([
        'id',
        'name',
        'parentTaskId',
        'type',
      ]);
    });
  });

  describe('getGraphAggregate', () => {
    const childId = '11111111-1111-4111-8111-111111111111';
    const contractId = '22222222-2222-4222-8222-222222222222';
    const enforcingStepId = '33333333-3333-4333-8333-333333333333';
    const externalWorkflowId = '44444444-4444-4444-8444-444444444444';

    it('composes committed fields, children, sections and Graph edges during unfinished materialization', async () => {
      const root = {
        ...mockTaskData,
        type: 'GRAPH_ROOT',
        status: WorkStatus.ACTIVE,
        updatedAt: new Date('2026-09-11T05:35:12.404Z'),
      };
      const child = {
        ...root,
        id: childId,
        type: 'GRAPH_NODE',
        parentTaskId: root.id,
      };
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        root,
      );
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        child,
      ]);
      const edge = {
        id: 'committed-edge',
        sourceNodeId: childId,
        targetNodeId: childId,
        sourceEntityType: AgentEdgeEndpointEntityType.Task,
        targetEntityType: AgentEdgeEndpointEntityType.Task,
        type: RelationshipType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        createdAt: root.updatedAt.toISOString(),
        updatedAt: root.updatedAt.toISOString(),
      };
      mockGraphsClient.readStructuredGraph.mockResolvedValue({
        directEdges: [edge],
        expansions: [],
      });
      const participation = {
        entries: [],
        summary: {
          completeness: 'COMPLETE' as const,
          uniqueContractCount: 0,
          participantCount: 0,
          responsibilityCount: 0,
          limits: {
            referenceDepth: 4,
            candidateCount: 500,
            diagramCount: 100,
            graphRequestCount: 10,
            evidenceCount: 500,
          },
          truncationReasons: [],
          errors: [],
        },
      };
      mockParticipationComposer.compose.mockResolvedValue(participation);
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          status: 'APPLYING',
          affectedWorkItemIds: [root.id, child.id],
          workItemIdMappings: { 'temporary:child': child.id },
          relationshipIdMappings: { 'temporary:edge': edge.id },
          priorProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            workItems: {
              [root.id]: {
                ...root,
                status: WorkStatus.BACKLOG,
                updatedAt: '2026-09-09T21:07:24.037Z',
                edges: [],
              },
            },
          },
        },
        { status: 'PUBLISHED', affectedWorkItemIds: [root.id] },
      ]);
      const result = await service.getGraphAggregate(
        testIds.organization,
        testIds.project,
        testIds.task,
        'token',
        ['GUARANTEES'],
      );
      expect(result.root).toMatchObject({
        status: WorkStatus.ACTIVE,
        updatedAt: root.updatedAt.toISOString(),
      });
      expect(result.children).toEqual([
        expect.objectContaining({ id: childId, status: WorkStatus.ACTIVE }),
      ]);
      expect(result.root.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            materializedMarkdown: mockTaskData.description,
          }),
        ]),
      );
      expect(result.relationships).toEqual([
        expect.objectContaining({ id: edge.id }),
      ]);
      expect(result.participation).toBe(participation);
      expect(mockParticipationComposer.compose).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        root.id,
        ['GUARANTEES'],
        'token',
      );
      expect(
        mockPrismaService.db.workItemChangeSetMaterialization.findMany,
      ).not.toHaveBeenCalled();
    });

    it('uses one generic capability path and keeps derived references separate', async () => {
      const root = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        type: 'GRAPH_ROOT',
        projectId: testIds.project,
        sections: [
          {
            id: 'layout-section',
            key: TaskSectionKey.Description,
            order: 0,
            materializedMarkdown: JSON.stringify(VALID_GRAPH_LAYOUT_CONTENT),
            materializedProposalId: '10000000-0000-4000-8000-000000000001',
          },
        ],
      });
      const child = TestUtils.createMockTaskResponseDto({
        id: childId,
        type: 'GRAPH_NODE',
        projectId: testIds.project,
        parentTaskId: root.id,
      });
      jest.spyOn(service, 'findOneByOrganization').mockResolvedValue(root);
      jest
        .spyOn(service as any, 'mapMixedInitiativeTasksWithChildCounts')
        .mockResolvedValue([child]);
      const buildEdgesSpy = jest
        .spyOn(service as any, 'buildTaskEdgesMap')
        .mockResolvedValue(new Map());
      const baseCapability = workItemTypeRegistry.getGraphCapability(
        'GRAPH_ROOT',
        testIds.project,
      )!;
      jest.spyOn(workItemTypeRegistry, 'getGraphCapability').mockReturnValue({
        ...baseCapability,
        layout: {
          ...baseCapability.layout,
          sectionKey: TaskSectionKey.Description,
        },
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
                  workItemTypeKeys: ['CONTRACT'],
                },
              },
              {
                relationshipType: 'DEPENDS_ON',
                direction: 'INCOMING',
                target: {
                  entityTypes: ['TASK'],
                  workItemTypeKeys: ['GRAPH_NODE'],
                },
              },
              {
                relationshipType: 'HAS_TASK',
                direction: 'INCOMING',
                target: {
                  entityTypes: ['TASK'],
                  workItemTypeKeys: ['GRAPH_ROOT'],
                },
              },
            ],
            projectionKind: 'workItemReference',
            deduplicateBy: 'entityId',
            excludeRoot: true,
            limit: 10,
          },
        ],
      });
      const secondContractId = '55555555-5555-4555-8555-555555555555';
      mockGraphsClient.readStructuredGraph.mockResolvedValue({
        directEdges: [],
        expansions: [
          {
            key: 'linkedGraphs',
            targets: [
              {
                identity: { entityId: externalWorkflowId, entityType: 'TASK' },
                paths: [contractId, secondContractId].map((via) => ({
                  identities: [
                    childId,
                    via,
                    enforcingStepId,
                    externalWorkflowId,
                  ].map((entityId) => ({ entityId, entityType: 'TASK' })),
                })),
              },
            ],
          },
        ],
      } satisfies import('src/generated/graphs').StructuredGraphReadResponse);
      (
        mockPrismaService.db.entityRegistry.findMany as jest.Mock
      ).mockResolvedValue([
        { entityId: contractId, entityType: 'TASK', entityName: 'Contract' },
        {
          entityId: enforcingStepId,
          entityType: 'TASK',
          entityName: 'Enforcing step',
        },
        {
          entityId: externalWorkflowId,
          entityType: 'TASK',
          entityName: 'External graph',
        },
      ]);
      (mockPrismaService.db.task.findMany as jest.Mock).mockImplementation(
        ({ where }: any) =>
          where.id?.in
            ? Promise.resolve([
                { id: contractId, type: 'CONTRACT', name: 'Contract' },
                {
                  id: enforcingStepId,
                  type: 'GRAPH_NODE',
                  name: 'Enforcing step',
                },
                {
                  id: externalWorkflowId,
                  type: 'GRAPH_ROOT',
                  name: 'External graph',
                },
              ])
            : Promise.resolve([]),
      );

      const result = await service.getGraphAggregate(
        testIds.organization,
        testIds.project,
        testIds.task as TaskId,
        'token',
      );

      expect(result.relationships).toEqual([]);
      expect(buildEdgesSpy).not.toHaveBeenCalled();
      expect(result.layout).toEqual(VALID_GRAPH_LAYOUT_CONTENT);
      expect(result.derivedReferences).toEqual([
        {
          expansionKey: 'linkedGraphs',
          projectionKind: 'workItemReference',
          entityId: externalWorkflowId,
          entityType: 'TASK',
          workItemTypeKey: 'GRAPH_ROOT',
          displayName: 'External graph',
          viaEntityIds: [contractId, secondContractId],
        },
      ]);
      expect(mockGraphsClient.readStructuredGraph).toHaveBeenCalledTimes(1);
      expect(mockGraphsClient.readStructuredGraph).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          root: { entityId: root.id, entityType: 'TASK' },
          seeds: [root.id, childId].map((entityId) => ({
            entityId,
            entityType: 'TASK',
          })),
          directEdgeTypes: ['STANDARD'],
          expansions: [
            expect.objectContaining({
              key: 'linkedGraphs',
              excludeRoot: true,
              limit: 10,
              seeds: [{ entityId: childId, entityType: 'TASK' }],
              path: expect.arrayContaining([
                expect.objectContaining({
                  direction: 'INCOMING',
                  workItemTypeKeys: ['GRAPH_ROOT'],
                }),
              ]),
            }),
          ],
        }),
        'token',
      );
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      expect(
        mockPrismaService.db.entityRegistry.findMany,
      ).toHaveBeenCalledTimes(1);
      expect(mockGraphsClient.searchGraphAllPages).not.toHaveBeenCalled();
    });

    it('combines the sixteen transition declarations and preserves canonical-reference metadata', async () => {
      const root = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        type: 'GRAPH_ROOT',
        projectId: testIds.project,
      });
      const metadata = {
        role: 'DIAGRAM_REFERENCE',
        canonicalReference: {
          entityType: 'TASK',
          entityId: '2fd9690d-b093-4ab5-8c93-595dff273c7a',
        },
      } satisfies import('src/generated').DiagramElementMetadata;
      const child = TestUtils.createMockTaskResponseDto({
        id: 'b72eed85-afa6-434c-83a8-a0ce252dbfad',
        type: 'GRAPH_NODE',
        projectId: testIds.project,
        parentTaskId: root.id,
        sections: [
          {
            id: '93d85109-a448-4a71-8c72-1e74a3c9e1be',
            key: 'diagramElementMetadata',
            order: 0,
            materializedMarkdown: JSON.stringify(metadata),
            materializedProposalId: 'a1f0fd1d-c5c6-4df7-89e5-21773af4c741',
          },
        ],
      });
      jest.spyOn(service, 'findOneByOrganization').mockResolvedValue(root);
      jest
        .spyOn(workItemTypeRegistry, 'getSections')
        .mockReturnValue(['diagramElementMetadata']);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        {
          ...mockTaskData,
          id: child.id,
          type: child.type,
          parentTaskId: root.id,
        },
      ]);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(
        child.sections!.map((section) => ({ ...section, taskId: child.id })),
      );
      const capability = workItemTypeRegistry.getGraphCapability(
        'GRAPH_ROOT',
        testIds.project,
      )!;
      // Same cross-product and hop constraints as V2026.09.13.1 transition declarations.
      const expansions: import('src/generated').WorkItemTypeGraphReadExpansion[] =
        [];
      for (const first of ['DEPENDS_ON', 'GUARANTEES'] as const) {
        for (const second of ['DEPENDS_ON', 'GUARANTEES'] as const) {
          for (const firstDirection of ['OUTGOING', 'INCOMING'] as const) {
            for (const secondDirection of ['OUTGOING', 'INCOMING'] as const) {
              expansions.push({
                key: `contractLinkedDiagrams_${first}_${firstDirection}_${second}_${secondDirection}`,
                seed: 'graphNodes',
                projectionKind: 'workItemReference',
                deduplicateBy: 'entityId',
                excludeRoot: true,
                limit: 100,
                path: [
                  {
                    relationshipType: first,
                    direction: firstDirection,
                    target: {
                      entityTypes: ['TASK'],
                      workItemTypeKeys: ['CONTRACT'],
                    },
                  },
                  {
                    relationshipType: second,
                    direction: secondDirection,
                    target: {
                      entityTypes: ['TASK'],
                      workItemTypeKeys: ['workflow_step', 'DIAGRAM_ELEMENT'],
                    },
                  },
                  {
                    relationshipType: 'HAS_TASK',
                    direction: 'INCOMING',
                    target: {
                      entityTypes: ['TASK'],
                      workItemTypeKeys: ['workflow', 'DIAGRAM'],
                    },
                  },
                ],
              });
            }
          }
        }
      }
      jest
        .spyOn(workItemTypeRegistry, 'getGraphCapability')
        .mockReturnValue({ ...capability, readExpansions: expansions });
      mockGraphsClient.readStructuredGraph.mockResolvedValue({
        directEdges: [],
        expansions: expansions.map(({ key }) => ({ key, targets: [] })),
      } satisfies import('src/generated/graphs').StructuredGraphReadResponse);
      const result = await service.getGraphAggregate(
        testIds.organization,
        testIds.project,
        testIds.task,
        'token',
      );
      expect(result.derivedReferences).toEqual([]);
      expect(result.children[0]?.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'diagramElementMetadata',
            materializedMarkdown: JSON.stringify(metadata),
          }),
        ]),
      );
      expect(mockGraphsClient.readStructuredGraph).toHaveBeenCalledTimes(1);
      const sent: import('src/generated/graphs').StructuredGraphReadRequest =
        mockGraphsClient.readStructuredGraph.mock.calls[0][2];
      expect(sent.expansions).toHaveLength(16);
      expect(sent.expansions.map(({ key }) => key)).toEqual(
        expansions.map(({ key }) => key),
      );
      for (const [index, expansion] of expansions.entries()) {
        expect(sent.expansions[index]?.path).toEqual(
          expansion.path.map((hop) => ({
            relationshipType: hop.relationshipType,
            direction: hop.direction,
            ...hop.target,
          })),
        );
      }
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(
        mockPrismaService.db.entityRegistry.findMany,
      ).not.toHaveBeenCalled();
    });

    it('rejects missing authentication and non-graph-capable types', async () => {
      await expect(
        service.getGraphAggregate(
          testIds.organization,
          testIds.project,
          testIds.task as TaskId,
          null,
        ),
      ).rejects.toThrow('authenticated user token');

      const root = TestUtils.createMockTaskResponseDto({
        projectId: testIds.project,
        type: 'STANDARD',
      });
      jest.spyOn(service, 'findOneByOrganization').mockResolvedValue(root);
      jest
        .spyOn(workItemTypeRegistry, 'getGraphCapability')
        .mockReturnValue(null);
      await expect(
        service.getGraphAggregate(
          testIds.organization,
          testIds.project,
          testIds.task as TaskId,
          'token',
        ),
      ).rejects.toThrow('does not declare a graph capability');
    });

    it('fails on invalid authored layout and enforces requested project scope', async () => {
      const root = TestUtils.createMockTaskResponseDto({
        projectId: testIds.project,
        type: 'GRAPH_ROOT',
        sections: [
          {
            id: 'layout-section',
            key: TaskSectionKey.Description,
            order: 0,
            materializedMarkdown: '{invalid',
            materializedProposalId: '10000000-0000-4000-8000-000000000001',
          },
        ],
      });
      jest.spyOn(service, 'findOneByOrganization').mockResolvedValue(root);

      await expect(
        service.getGraphAggregate(
          testIds.organization,
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId,
          testIds.task as TaskId,
          'token',
        ),
      ).rejects.toThrow('Work item not found');

      const capability = workItemTypeRegistry.getGraphCapability(
        'GRAPH_ROOT',
        testIds.project,
      )!;
      jest.spyOn(workItemTypeRegistry, 'getGraphCapability').mockReturnValue({
        ...capability,
        layout: {
          ...capability.layout,
          sectionKey: TaskSectionKey.Description,
        },
      });
      jest
        .spyOn(service as any, 'mapMixedInitiativeTasksWithChildCounts')
        .mockResolvedValue([]);
      jest
        .spyOn(service as any, 'buildTaskEdgesMap')
        .mockResolvedValue(new Map());
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

      await expect(
        service.getGraphAggregate(
          testIds.organization,
          testIds.project,
          testIds.task as TaskId,
          'token',
        ),
      ).rejects.toThrow('Invalid work item graph layout');
    });
  });

  describe('replaceServiceAssignmentsInTransaction', () => {
    it('atomically removes stale rows and inserts missing rows for complete-set replacement', async () => {
      const tx = mockPrismaService.db as any;
      tx.serviceTask.deleteMany = jest.fn().mockResolvedValue({ count: 1 });
      tx.serviceTask.createMany = jest.fn().mockResolvedValue({ count: 2 });
      const serviceIds = ['service-1', 'service-2'];

      await service.replaceServiceAssignmentsInTransaction(
        tx,
        testIds.task,
        serviceIds,
      );

      expect(tx.serviceTask.deleteMany).toHaveBeenCalledWith({
        where: { taskId: testIds.task, serviceId: { notIn: serviceIds } },
      });
      expect(tx.serviceTask.createMany).toHaveBeenCalledWith({
        data: serviceIds.map((serviceId) => ({
          taskId: testIds.task,
          serviceId,
        })),
        skipDuplicates: true,
      });
    });

    it('clears all rows without inserting when the asserted set is empty', async () => {
      const tx = mockPrismaService.db as any;
      tx.serviceTask.deleteMany = jest.fn().mockResolvedValue({ count: 2 });
      tx.serviceTask.createMany = jest.fn();

      await service.replaceServiceAssignmentsInTransaction(
        tx,
        testIds.task,
        [],
      );

      expect(tx.serviceTask.deleteMany).toHaveBeenCalledWith({
        where: { taskId: testIds.task, serviceId: { notIn: [] } },
      });
      expect(tx.serviceTask.createMany).not.toHaveBeenCalled();
    });
  });

  describe('hardDeleteByTypeInTransaction', () => {
    it('hard-deletes active and archived work items scoped to the project and type', async () => {
      const tx = mockPrismaService.db as any;
      tx.task.deleteMany = jest.fn().mockResolvedValue({ count: 3 });

      await expect(
        service.hardDeleteByTypeInTransaction(
          tx,
          testIds.organization,
          testIds.project,
          'MARKETING',
        ),
      ).resolves.toBe(3);

      expect(tx.task.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          type: 'MARKETING',
        },
      });
    });
  });

  it('rejects creation writes for a type with a pending cascade execution', async () => {
    const tx = mockPrismaService.db as any;
    tx.workItemTypeCascadeExecution.findFirst.mockResolvedValue({
      id: 'cascade-execution-id',
    });

    const gate = Object.getPrototypeOf(service).assertWorkItemWriteAllowed;
    await expect(
      gate.call(
        service,
        tx,
        testIds.organization,
        testIds.project,
        [],
        undefined,
        'MARKETING',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  describe('deleted type-owned item reads', () => {
    const deletedType = 'DELETED_CUSTOM_TYPE';
    const deletedSnapshot = {
      id: testIds.task,
      name: 'Deleted custom item',
      type: deletedType,
      organizationId: testIds.organization,
      projectId: testIds.project,
      initiativeId: testIds.initiative,
      status: WorkStatus.BACKLOG,
      source: 'user',
      parentTaskId: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      edges: [
        {
          id: 'deleted-snapshot-edge',
          sourceNodeId: testIds.task,
          targetNodeId: '22222222-2222-4222-8222-222222222222',
          type: RelationshipType.RelatedTo,
        },
      ],
    };

    beforeEach(() => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        null,
      );
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          affectedWorkItemIds: [testIds.task],
          workItemIdMappings: {},
          priorProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            workItems: { [testIds.task]: deletedSnapshot },
          },
        },
      ]);
    });

    it('does not restore a deleted type-owned item into list reads', async () => {
      await expect(
        service.findAll(testIds.organization, undefined, {
          projectId: testIds.project,
        }),
      ).resolves.toEqual([]);
    });

    it('does not return a deleted type-owned item from single reads', async () => {
      await expect(
        service.findOne(testIds.organization, testIds.task),
      ).resolves.toBeNull();
      expect(mockPrismaService.db.task.findFirst).toHaveBeenCalled();
    });

    it('does not restore snapshot edges for a deleted type-owned item', async () => {
      await expect(
        service.findOne(
          testIds.organization,
          testIds.task,
          false,
          false,
          false,
          false,
          true,
          'token-xyz',
        ),
      ).resolves.toBeNull();

      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });

    it('does not restore a deleted type-owned item into hierarchy reads', async () => {
      await expect(
        service.findHierarchy(testIds.organization, testIds.task),
      ).rejects.toThrow(NotFoundException);
    });

    it('does not restore a deleted type-owned item into adapter reads', async () => {
      await expect(
        service.findOneForAdapter(testIds.task, testIds.organization),
      ).resolves.toBeNull();
      await expect(
        service.findAllByOrganizationForAdapter(testIds.organization, {
          projectId: testIds.project,
          includeEdges: true,
          userToken: 'token-xyz',
        }),
      ).resolves.toEqual([]);

      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('should create a STANDARD task with acceptanceCriteria', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'New Task',
        sections: TestUtils.createMockTaskSectionInputs({
          description: 'Task description',
          acceptanceCriteria: 'Completion criteria',
        }),
        initiativeId: testIds.initiative,
        status: 'BACKLOG',
        priority: 'HIGH',
      };

      // Mock initiative exists
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        originatingProjectId: testIds.project,
      });

      // Mock transaction
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: jest.fn().mockResolvedValue({
              ...mockTaskData,
              ...createTaskDto,
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      mockEventPublisher.publishInTransaction.mockResolvedValue(null);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(
        createTaskSectionRecords(mockTaskData.id, {
          description: 'Task description',
          acceptanceCriteria: 'Completion criteria',
        }),
      );

      const result = await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(mockTransaction).toHaveBeenCalledWith(expect.any(Function));

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.CREATED,
          aggregateId: mockTaskData.id,
          payload: expect.objectContaining({
            task: expect.objectContaining({
              name: 'New Task',
              type: 'STANDARD',
              description: 'Task description',
              acceptanceCriteria: 'Completion criteria',
            }),
          }),
        }),
      );

      const content = materializedSectionsToContentMap(result.sections);
      expect(content.acceptanceCriteria).toBe('Completion criteria');
      expect(result.source).toBe('system');
      expect(result.childCounts).toEqual({
        total: 0,
        done: 0,
        inProgress: 0,
        backlog: 0,
      });
    });

    it('persists an accepted launch default without materializing a checkout', async () => {
      const config = {
        kind: 'INITIAL_WORKTREE' as const,
        version: 'v1' as const,
        initialWorktreeBranch: 'feature/launch-default',
      };
      const createTaskDto: CreateTaskDto = {
        name: 'Configured task',
        type: 'STANDARD',
        initiativeId: testIds.initiative,
        config,
      };
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        name: createTaskDto.name,
        config,
        projectId: testIds.project,
      });

      mockTransaction.mockImplementation(async (callback) =>
        callback({
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: { create: createSpy },
        }),
      );

      const result = await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ config }),
        }),
      );
      expect(result.config).toEqual(config);
      expect(mockPrismaService.db.task.create).not.toHaveBeenCalled();
    });

    it('rejects a launch default when the effective type policy is empty', async () => {
      const createSpy = jest.fn();
      mockTransaction.mockImplementation(async (callback) =>
        callback({
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: { create: createSpy },
        }),
      );

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Ineligible config',
            type: 'CAMPAIGN',
            initiativeId: testIds.initiative,
            config: {
              kind: 'INITIAL_WORKTREE',
              version: 'v1',
              initialWorktreeBranch: 'feature/not-accepted',
            },
          },
          testIds.project,
        ),
      ).rejects.toThrow("does not accept config kind 'INITIAL_WORKTREE'");
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('should persist explicit task source when provided', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'User Task',
        initiativeId: testIds.initiative,
        source: 'user',
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        source: 'user',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      const result = await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            source: 'user',
          }),
        }),
      );
      expect(result.source).toBe('user');
    });

    it('persists custom-type sections with gap-free declared order including a non-built-in key', async () => {
      // The wire DTO closed-enums section keys, so a custom key like `audience`
      // never arrives through the DTO; it is materialized from the type's
      // DECLARED section list. We pass only the built-in `description` content
      // and assert the declared `audience` section still persists at order 1.
      const createTaskDto: CreateTaskDto = {
        name: 'Campaign Task',
        type: 'CAMPAIGN',
        initiativeId: testIds.initiative,
        sections: [
          { key: TaskSectionKey.Description, content: 'Campaign description' },
        ],
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CAMPAIGN',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      const createdSections = (
        createSpy.mock.calls[0][0] as {
          data: { sections: { create: Array<{ key: string; order: number }> } };
        }
      ).data.sections.create;

      // Declared order is the source of truth: the non-built-in `audience` key
      // gets order 1 from its position, with no gaps.
      expect(createdSections).toEqual([
        expect.objectContaining({ key: 'description', order: 0 }),
        expect.objectContaining({ key: 'audience', order: 1 }),
      ]);
      const orders = createdSections.map((section) => section.order);
      expect(orders).toEqual(orders.map((_, index) => index));
      const emitted = mockEventPublisher.publishInTransaction.mock.calls.find(
        (call) => call[1].type === EVENT_TYPES.TASK.CREATED,
      );
      expect(emitted?.[1].payload).toEqual(
        expect.objectContaining({
          task: expect.objectContaining({ sections: createdSections }),
        }),
      );
    });

    it('should throw NotFoundException when initiative does not exist', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'New Task',
        initiativeId: testIds.initiative,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate parent task belongs to the initiative', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Child Task',
        initiativeId: testIds.initiative,
        parentTaskId: 'parent-1',
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('honors explicit status on CreateTaskDto', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Active Feature',
        initiativeId: testIds.initiative,
        type: 'FEATURE',
        tag: 'product',
        status: 'ACTIVE',
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'FEATURE',
        status: 'ACTIVE',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      const result = await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACTIVE',
          }),
        }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('persists tag on FEATURE creates and emits it on the TaskCreated event', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Tagged Feature',
        initiativeId: testIds.initiative,
        type: 'FEATURE',
        tag: 'backend',
        status: 'ACTIVE',
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'FEATURE',
        tag: 'backend',
        status: 'ACTIVE',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: { create: createSpy },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ tag: 'backend' }),
        }),
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.CREATED,
          payload: expect.objectContaining({
            task: expect.objectContaining({ tag: 'backend' }),
          }),
        }),
      );
    });

    it('rejects FEATURE creates that omit tag with HTTP 400', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Untagged Feature',
        initiativeId: testIds.initiative,
        type: 'FEATURE',
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: { create: jest.fn() },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/FEATURE tasks require a tag/),
      });
    });

    it('rejects non-FEATURE creates that carry tag with HTTP 400', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Standard with tag',
        initiativeId: testIds.initiative,
        type: 'STANDARD',
        tag: 'backend',
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: { create: jest.fn() },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        message: expect.stringMatching(/tag is only valid on FEATURE tasks/),
      });
    });

    it('defaults a new FEATURE to ACTIVE when no status is provided', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Default Feature',
        initiativeId: testIds.initiative,
        type: 'FEATURE',
        tag: 'product',
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'FEATURE',
        status: 'ACTIVE',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkStatus.ACTIVE,
          }),
        }),
      );
    });

    it('defaults a new STANDARD task to BACKLOG when no status is provided', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Default Standard',
        initiativeId: testIds.initiative,
        type: 'STANDARD',
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'STANDARD',
        status: 'BACKLOG',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkStatus.BACKLOG,
          }),
        }),
      );
    });

    it('defaults a new BUG task to BACKLOG when no status is provided', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Default Bug',
        initiativeId: testIds.initiative,
        type: 'BUG',
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'BUG',
        status: 'BACKLOG',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkStatus.BACKLOG,
          }),
        }),
      );
    });

    it('honors an explicit refinement-stage status, overriding the per-type default', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'AI-generated Standard',
        initiativeId: testIds.initiative,
        type: 'STANDARD',
        status: WorkStatus.REFINING_ACCEPTANCE_CRITERIA,
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'STANDARD',
        status: 'REFINING_ACCEPTANCE_CRITERIA',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkStatus.REFINING_ACCEPTANCE_CRITERIA,
          }),
        }),
      );
    });

    it('creates canonical Goals without a date or structural parent', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'GOAL',
        status: 'ACTIVE',
        dueDate: null,
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) =>
        callback({
          initiative: { findFirst: jest.fn() },
          task: { create: createSpy, findFirst: jest.fn() },
        }),
      );
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));
      const result = await service.create(
        testIds.organization,
        undefined,
        { name: 'Goal A', type: 'GOAL' },
        testIds.project,
      );
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dueDate: undefined,
            parentTaskId: null,
          }),
        }),
      );
      expect(result.dueDate).toBeNull();
    });

    it('retains project-effective required-date rejection at creation', async () => {
      const required = jest
        .spyOn(workItemTypeRegistry, 'isScalarRequired')
        .mockReturnValue(true);
      await expect(
        service.create(
          testIds.organization,
          undefined,
          { name: 'Required-date Goal', type: 'GOAL' },
          testIds.project,
        ),
      ).rejects.toThrow('GOAL tasks require a dueDate.');
      required.mockRestore();
    });

    it('rejects GOAL tasks created with a non-null parentTaskId', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Goal A',
        type: 'GOAL',
        dueDate: '2026-12-31T00:00:00.000Z',
        parentTaskId: 'some-parent-id',
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: { findFirst: jest.fn() },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'some-parent-id',
              type: 'FEATURE',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          undefined,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unrecognized work-item type with a message naming the valid types', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Mystery item',
        // A type the project's registry does not have. resolveTaskType now
        // preserves a provided key verbatim, so the assertion must reject an
        // unknown key before it is persisted (or trips a registry snapshot miss).
        type: 'NONSENSE' as CreateTaskDto['type'],
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: { findFirst: jest.fn() },
          task: { create: jest.fn(), findFirst: jest.fn() },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          undefined,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toThrow(
        // The four built-in system types are always active, so the message
        // enumerates them for the caller.
        /'NONSENSE' is not a usable type for this project\. Valid types: .*STANDARD/,
      );
    });

    // Step-1 parity guard: now that resolveTaskType returns a provided key
    // verbatim instead of mapping anything outside BUG/FEATURE/GOAL to STANDARD,
    // each built-in must still persist under its own key (never collapsed).
    it.each([
      { type: 'STANDARD' as const, extra: {} },
      { type: 'BUG' as const, extra: {} },
      { type: 'FEATURE' as const, extra: { tag: 'product' as const } },
      {
        type: 'GOAL' as const,
        extra: { dueDate: '2026-12-31T00:00:00.000Z' },
      },
    ])(
      'persists a built-in $type with its own key rather than collapsing it',
      async ({ type, extra }) => {
        const createTaskDto: CreateTaskDto = {
          name: `A ${type} item`,
          type,
          ...extra,
        };

        const createSpy = jest.fn().mockResolvedValue({
          ...mockTaskData,
          type,
          projectId: testIds.project,
        });
        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            initiative: { findFirst: jest.fn() },
            task: { create: createSpy, findFirst: jest.fn() },
          };
          return callback(mockTx);
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

        await service.create(
          testIds.organization,
          undefined,
          createTaskDto,
          testIds.project,
        );

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type }),
          }),
        );
      },
    );

    it('forces new GOAL tasks to start at ACTIVE, ignoring any caller-supplied status', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Goal A',
        type: 'GOAL',
        dueDate: '2026-12-31T00:00:00.000Z',
        // Caller tries to start the goal in BACKLOG; the service must override
        // this and pin the goal to ACTIVE.
        status: WorkStatus.BACKLOG,
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'GOAL',
        status: 'ACTIVE',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: { findFirst: jest.fn() },
          task: {
            create: createSpy,
            findFirst: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        undefined,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: WorkStatus.ACTIVE,
          }),
        }),
      );
    });

    it('rejects creating a task whose parent resolves to a GOAL', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Child of goal',
        parentTaskId: 'goal-parent',
        initiativeId: testIds.initiative,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'goal-parent',
              type: 'GOAL',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message:
          'A GOAL item cannot parent a STANDARD item under the configured work-item type definitions.',
      });
    });

    it('accepts a non-GOAL parent when creating a task', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Child of feature',
        parentTaskId: 'feature-parent',
        initiativeId: testIds.initiative,
      };

      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        parentTaskId: 'feature-parent',
        projectId: testIds.project,
      });

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
            findFirst: jest.fn().mockResolvedValue({
              id: 'feature-parent',
              type: 'FEATURE',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            parentTaskId: 'feature-parent',
          }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('rejects a rich response to the required identity projection', async () => {
      mockGraphsClient.searchGraph.mockResolvedValueOnce({
        results: [],
      } satisfies SearchResponse);
      await expect(
        service['loadTrackedTaskRowsByGoal'](
          testIds.organization,
          testIds.project,
          [testIds.task],
          'token',
        ),
      ).rejects.toThrow(
        'Graph identity projection response is missing identitiesBySeed',
      );
      expect(mockPrismaService.db.task.findMany).not.toHaveBeenCalled();
    });

    it('batches shared tracked identities and excludes non-task and unresolved targets', async () => {
      const seeds = [testIds.task, '11111111-1111-4111-8111-111111111111'];
      const shared = '22222222-2222-4222-8222-222222222222';
      const missing = '33333333-3333-4333-8333-333333333333';
      const nonTask = '44444444-4444-4444-8444-444444444444';
      mockGraphsClient.searchGraph.mockResolvedValueOnce({
        identitiesBySeed: seeds.map((seedNodeId) => ({
          seedNodeId,
          targets: [
            { entityId: shared, entityType: 'TASK' },
            { entityId: missing, entityType: 'TASK' },
            { entityId: nonTask, entityType: 'PROJECT' },
          ],
        })),
      } satisfies SearchResponse);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValueOnce([
        { id: shared, name: 'Shared work', status: 'ACTIVE', dueDate: null },
      ]);
      const result = await service['loadTrackedTaskRowsByGoal'](
        testIds.organization,
        testIds.project,
        seeds,
        'token',
      );
      expect(mockGraphsClient.searchGraph).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: [shared, missing] },
          organizationId: testIds.organization,
          archivedAt: null,
        },
        select: { id: true, name: true, status: true, dueDate: true },
      });
      expect(result.get(testIds.task)).toEqual(
        result.get('11111111-1111-4111-8111-111111111111'),
      );
      expect(result.get(testIds.task)).toEqual([
        { id: shared, name: 'Shared work', status: 'ACTIVE', dueDate: null },
      ]);
      expect(
        service['toTrackedSnapshots'](result.get(testIds.task) ?? []),
      ).toEqual([
        {
          targetEntityId: shared,
          targetEntityType: 'TASK',
          title: 'Shared work',
          status: 'ACTIVE',
          dueDate: null,
        },
      ]);
    });

    describe('toTrackedWorkSummary', () => {
      const now = new Date('2026-10-08T12:00:00.000Z');
      const past = new Date('2026-10-01T00:00:00.000Z');
      const future = new Date('2026-11-01T00:00:00.000Z');
      const row = (
        id: string,
        status: WorkStatus,
        dueDate: Date | null = null,
      ) => ({ id, name: id, status, dueDate });

      it('returns zero counts for a goal without tracked work', () => {
        expect(service['toTrackedWorkSummary']([], now)).toEqual({
          totalCount: 0,
          completedCount: 0,
          cancelledCount: 0,
          pastDueCount: 0,
          openUndatedCount: 0,
        });
      });

      it('counts completed targets without treating past due dates as overdue', () => {
        expect(
          service['toTrackedWorkSummary'](
            [
              row('a', WorkStatus.COMPLETED, past),
              row('b', WorkStatus.COMPLETED),
            ],
            now,
          ),
        ).toEqual({
          totalCount: 2,
          completedCount: 2,
          cancelledCount: 0,
          pastDueCount: 0,
          openUndatedCount: 0,
        });
      });

      it('separates cancelled, past-due, future and undated open targets', () => {
        expect(
          service['toTrackedWorkSummary'](
            [
              row('cancelled', WorkStatus.CANCELLED, past),
              row('overdue', WorkStatus.ACTIVE, past),
              row('upcoming', WorkStatus.BACKLOG, future),
              row('undated', WorkStatus.ACTIVE),
            ],
            now,
          ),
        ).toEqual({
          totalCount: 4,
          completedCount: 0,
          cancelledCount: 1,
          pastDueCount: 1,
          openUndatedCount: 1,
        });
      });
    });

    it('excludes unresolved and archived targets from the summary', async () => {
      const resolved = '22222222-2222-4222-8222-222222222222';
      const archived = '33333333-3333-4333-8333-333333333333';
      mockGraphsClient.searchGraph.mockResolvedValueOnce({
        identitiesBySeed: [
          {
            seedNodeId: testIds.task,
            targets: [
              { entityId: resolved, entityType: 'TASK' },
              { entityId: archived, entityType: 'TASK' },
            ],
          },
        ],
      } satisfies SearchResponse);
      // The batched read filters archivedAt: null, so archived rows never return.
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValueOnce([
        { id: resolved, name: 'Resolved', status: 'COMPLETED', dueDate: null },
      ]);
      const rows = await service['loadTrackedTaskRowsByGoal'](
        testIds.organization,
        testIds.project,
        [testIds.task],
        'token',
      );
      expect(
        service['toTrackedWorkSummary'](rows.get(testIds.task) ?? []),
      ).toEqual({
        totalCount: 1,
        completedCount: 1,
        cancelledCount: 0,
        pastDueCount: 0,
        openUndatedCount: 0,
      });
    });

    it('preserves empty identity groups and skips graph reads without seeds or a token', async () => {
      mockGraphsClient.searchGraph.mockResolvedValueOnce({
        identitiesBySeed: [{ seedNodeId: testIds.task, targets: [] }],
      } satisfies SearchResponse);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValueOnce(
        [],
      );
      const result = await service['loadTrackedTaskRowsByGoal'](
        testIds.organization,
        testIds.project,
        [testIds.task],
        'token',
      );
      expect(result.get(testIds.task)).toEqual([]);
      await service['loadTrackedTaskRowsByGoal'](
        testIds.organization,
        testIds.project,
        [],
        'token',
      );
      await service['loadTrackedTaskRowsByGoal'](
        testIds.organization,
        testIds.project,
        [testIds.task],
        null,
      );
      expect(mockGraphsClient.searchGraph).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['omitted', {}],
      ['explicit true', { includeTrackedEntities: true }],
    ])(
      'includes GOAL tracked snapshots when includeTrackedEntities is %s',
      async (_label, projectionFilter) => {
        const goalTask = {
          ...mockTaskData,
          type: 'GOAL' as const,
          parentTaskId: null,
        };
        const trackedRow = {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Tracked work item',
          status: 'ACTIVE',
          dueDate: null,
        };
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          goalTask,
        ]);
        (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
        const hydrateSpy = jest
          .spyOn(service as any, 'loadTrackedTaskRowsByGoal')
          .mockResolvedValue(new Map([[goalTask.id, [trackedRow]]]));

        const [result] = await service.findAll(
          testIds.organization,
          testIds.initiative,
          {
            projectId: testIds.project,
            userToken: 'token-xyz',
            ...projectionFilter,
          },
        );

        expect(hydrateSpy).toHaveBeenCalledWith(
          testIds.organization,
          testIds.project,
          [goalTask.id],
          'token-xyz',
          { includeTrackedEntities: true, includeTrackedWorkSummary: false },
        );
        expect(result?.trackedEntities).toEqual([
          {
            targetEntityId: trackedRow.id,
            targetEntityType: 'TASK',
            title: 'Tracked work item',
            status: 'ACTIVE',
            dueDate: null,
          },
        ]);
        expect(result?.trackedWorkSummary).toBeUndefined();
      },
    );

    it('omits only trackedEntities and skips hydration when includeTrackedEntities=false', async () => {
      const goalTask = {
        ...mockTaskData,
        type: 'GOAL' as const,
        parentTaskId: null,
      };
      const trackedRow = {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Tracked work item',
        status: 'ACTIVE',
        dueDate: null,
      };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        goalTask,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      const hydrateSpy = jest
        .spyOn(service as any, 'loadTrackedTaskRowsByGoal')
        .mockResolvedValue(new Map([[goalTask.id, [trackedRow]]]));

      const [defaultResult] = await service.findAll(
        testIds.organization,
        testIds.initiative,
        { projectId: testIds.project, userToken: 'token-xyz' },
      );
      hydrateSpy.mockClear();
      mockGraphsClient.searchGraph.mockClear();

      const [optOutResult] = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          projectId: testIds.project,
          userToken: 'token-xyz',
          includeTrackedEntities: false,
        },
      );

      const { trackedEntities: _trackedEntities, ...ordinaryDefaultFields } =
        defaultResult!;
      expect(optOutResult).toEqual(ordinaryDefaultFields);
      expect(optOutResult?.trackedEntities).toBeUndefined();
      expect(hydrateSpy).not.toHaveBeenCalled();
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });

    describe('tracked projection independence', () => {
      const trackedId = '11111111-1111-4111-8111-111111111111';
      const goalTask = {
        ...mockTaskData,
        type: 'GOAL' as const,
        parentTaskId: null,
      };
      const arrange = () => {
        (mockPrismaService.db.task.findMany as jest.Mock)
          .mockResolvedValueOnce([goalTask])
          .mockResolvedValueOnce([
            {
              id: trackedId,
              name: 'Tracked work item',
              status: 'COMPLETED',
              dueDate: null,
            },
          ]);
        (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
        mockGraphsClient.searchGraph.mockResolvedValueOnce({
          identitiesBySeed: [
            {
              seedNodeId: goalTask.id,
              targets: [{ entityId: trackedId, entityType: 'TASK' }],
            },
          ],
        } satisfies SearchResponse);
      };
      const expectedSummary = {
        totalCount: 1,
        completedCount: 1,
        cancelledCount: 0,
        pastDueCount: 0,
        openUndatedCount: 0,
      };

      it('returns only the summary when snapshots are opted out', async () => {
        arrange();
        const [result] = await service.findAll(
          testIds.organization,
          testIds.initiative,
          {
            projectId: testIds.project,
            userToken: 'token-xyz',
            includeTrackedEntities: false,
            includeTrackedWorkSummary: true,
          },
        );
        expect(result?.trackedEntities).toBeUndefined();
        expect(result?.trackedWorkSummary).toEqual(expectedSummary);
        expect(mockGraphsClient.searchGraph).toHaveBeenCalledTimes(1);
      });

      it('returns snapshots and summary from a single graph read', async () => {
        arrange();
        const [result] = await service.findAll(
          testIds.organization,
          testIds.initiative,
          {
            projectId: testIds.project,
            userToken: 'token-xyz',
            includeTrackedWorkSummary: true,
          },
        );
        expect(result?.trackedEntities).toHaveLength(1);
        expect(result?.trackedWorkSummary).toEqual(expectedSummary);
        expect(mockGraphsClient.searchGraph).toHaveBeenCalledTimes(1);
      });

      it('skips the graph read when neither projection is requested', async () => {
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          goalTask,
        ]);
        (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
        const [result] = await service.findAll(
          testIds.organization,
          testIds.initiative,
          {
            projectId: testIds.project,
            userToken: 'token-xyz',
            includeTrackedEntities: false,
            includeTrackedWorkSummary: false,
          },
        );
        expect(result?.trackedEntities).toBeUndefined();
        expect(result?.trackedWorkSummary).toBeUndefined();
        expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      });

      it('omits the summary rather than fabricating zeros without a token', async () => {
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          goalTask,
        ]);
        (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
        const [result] = await service.findAll(
          testIds.organization,
          testIds.initiative,
          {
            projectId: testIds.project,
            includeTrackedEntities: false,
            includeTrackedWorkSummary: true,
          },
        );
        expect(result?.trackedWorkSummary).toBeUndefined();
        expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      });
    });

    it('uses database sorting and pagination despite unfinished materializations', async () => {
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        mockTaskData,
      ]);
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          status: 'APPLYING',
          workItemIdMappings: { 'temporary:root': testIds.task },
          priorProjection: { workItems: {} },
        },
      ]);
      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          projectId: testIds.project,
          sortBy: 'createdAt',
          sortDir: 'asc',
          page: 2,
          limit: 1,
        },
      );
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 1,
          take: 1,
          orderBy: { createdAt: 'asc' },
          where: expect.objectContaining({
            organizationId: testIds.organization,
            projectId: testIds.project,
            archivedAt: null,
          }),
        }),
      );
      expect(result.map((item) => item.id)).toEqual([testIds.task]);
      expect(
        mockPrismaService.db.workItemChangeSetMaterialization.findMany,
      ).not.toHaveBeenCalled();
    });

    it('maps the public title sort field to the persisted name field', async () => {
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, testIds.initiative, {
        projectId: testIds.project,
        sortBy: 'title',
        sortDir: 'asc',
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } }),
      );
    });

    it('should return all tasks with acceptanceCriteria content', async () => {
      const mockTasks = [
        { ...mockTaskData, name: 'Task 1' },
        { ...mockTaskData, id: testIds.task + '2', name: 'Task 2' },
      ];
      const [firstTask] = mockTasks;
      if (!firstTask) {
        throw new Error('Expected mock task');
      }

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        mockTasks,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([
        {
          parentTaskId: firstTask.id,
          status: 'BACKLOG',
          _count: { _all: 2 },
        },
      ]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
      );

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: testIds.organization,
          initiativeId: testIds.initiative,
          archivedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 0,
        take: 50,
      });

      expect(mockPrismaService.db.task.groupBy).toHaveBeenCalledWith({
        by: ['parentTaskId', 'status'],
        where: {
          organizationId: testIds.organization,
          initiativeId: testIds.initiative,
          archivedAt: null,
          parentTaskId: {
            in: mockTasks.map((task) => task.id),
          },
        },
        _count: { _all: true },
      });

      expect(result).toHaveLength(2);
      const first = result[0];
      if (!first) {
        throw new Error('Expected first task');
      }
      expect(first.sections).toBeUndefined();
      expect(first.childCounts).toEqual({
        total: 2,
        done: 0,
        inProgress: 0,
        backlog: 2,
      });
      expect(result[1]?.childCounts).toEqual({
        total: 0,
        done: 0,
        inProgress: 0,
        backlog: 0,
      });
    });

    it('should include service relations when requested', async () => {
      const relationCreatedAt = new Date('2024-01-02T00:00:00.000Z');
      const mockTasks = [
        {
          ...mockTaskData,
          serviceRelations: [
            {
              id: 'service-task-1',
              serviceId: 'service-1',
              taskId: mockTaskData.id,
              relationType: 'implements',
              createdAt: relationCreatedAt,
            },
          ],
        },
      ];

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        mockTasks,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeServiceRelations: true,
        },
      );

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: testIds.organization,
          initiativeId: testIds.initiative,
          archivedAt: null,
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: 0,
        take: 50,
        include: {
          serviceRelations: {
            select: {
              id: true,
              serviceId: true,
              taskId: true,
              relationType: true,
              createdAt: true,
            },
          },
        },
      });

      expect(result[0]?.serviceRelations).toEqual([
        {
          id: 'service-task-1',
          serviceId: 'service-1',
          taskId: mockTaskData.id,
          relationType: 'implements',
          createdAt: relationCreatedAt.toISOString(),
        },
      ]);
    });

    it('filters requested taskIds within organization and project and excludes archived records', async () => {
      const selectedTaskId = '11111111-1111-4111-8111-111111111111' as TaskId;
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        mockTaskData,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        taskIds: [testIds.task, selectedTaskId],
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: testIds.organization,
            projectId: testIds.project,
            archivedAt: null,
            id: { in: [testIds.task, selectedTaskId] },
          }),
        }),
      );
    });

    it('rejects duplicate taskIds to match the OpenAPI uniqueItems contract', async () => {
      await expect(
        service.findAll(testIds.organization, undefined, {
          projectId: testIds.project,
          taskIds: [testIds.task, testIds.task],
        }),
      ).rejects.toThrow('taskIds must contain unique UUIDs');

      expect(mockPrismaService.db.task.findMany).not.toHaveBeenCalled();
    });

    it('filters direct children for a bounded set of parentTaskIds', async () => {
      const parentTaskIds = [
        testIds.task,
        '11111111-1111-4111-8111-111111111111' as TaskId,
      ];
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        mockTaskData,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        parentTaskIds,
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentTaskId: { in: parentTaskIds },
          }),
        }),
      );
    });

    it('sizes the default page to include every bounded requested taskId', async () => {
      const requestedTaskIds = Array.from(
        { length: 60 },
        (_, index) =>
          `11111111-1111-4111-8111-${String(index).padStart(12, '0')}` as TaskId,
      );
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        mockTaskData,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        taskIds: requestedTaskIds,
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: requestedTaskIds.length,
        }),
      );
    });

    it('rejects invalid selected taskIds before querying', async () => {
      await expect(
        service.findAll(testIds.organization, undefined, {
          projectId: testIds.project,
          taskIds: ['not-a-uuid' as TaskId],
        }),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('taskIds contains invalid UUID'),
      });

      expect(mockPrismaService.db.task.findMany).not.toHaveBeenCalled();
    });

    it('resolves related task candidates before applying ordinary filters and pagination', async () => {
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          status: 'APPLYING',
          workItemIdMappings: { 'temporary:root': testIds.task },
          relationshipIdMappings: { 'temporary:edge': 'edge-related-1' },
          priorProjection: { workItems: {} },
        },
      ]);

      const relatedPlanId = '22222222-2222-4222-8222-222222222222';
      const secondCandidateId =
        '11111111-1111-4111-8111-111111111111' as TaskId;
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        {
          id: 'edge-related-1',
          sourceNodeId: relatedPlanId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: testIds.task,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: RelationshipType.RelatedTo,
          reasoning: 'plan discovers monitor one',
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
        {
          id: 'edge-related-2',
          sourceNodeId: secondCandidateId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: relatedPlanId,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: RelationshipType.RelatedTo,
          reasoning: 'plan discovers monitor two',
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
      ]);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        { ...mockTaskData, type: 'TASK_MONITOR' },
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        relatedEntityId: relatedPlanId,
        relatedEntityType: AgentEdgeEndpointEntityType.Task,
        edgeTypes: [RelationshipType.RelatedTo],
        taskType: 'TASK_MONITOR',
        statuses: [WorkStatus.BACKLOG],
        page: 2,
        limit: 1,
        userToken: 'token-xyz',
      });

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledTimes(1);
      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([relatedPlanId]),
          types: new Set([RelationshipType.RelatedTo]),
        },
        'token-xyz',
      );
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: testIds.organization,
            projectId: testIds.project,
            archivedAt: null,
            id: { in: [testIds.task, secondCandidateId] },
            type: 'TASK_MONITOR',
            status: { in: [WorkStatus.BACKLOG] },
          },
          orderBy: { createdAt: 'desc' },
          skip: 1,
          take: 1,
        }),
      );
    });

    it('intersects related candidates with an explicit taskIds filter', async () => {
      const relatedPlanId = '22222222-2222-4222-8222-222222222222';
      const graphOnlyCandidateId =
        '11111111-1111-4111-8111-111111111111' as TaskId;
      const taskIdsOnlyCandidateId =
        '44444444-4444-4444-8444-444444444444' as TaskId;
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        {
          id: 'edge-related-1',
          sourceNodeId: relatedPlanId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: testIds.task,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: RelationshipType.RelatedTo,
          reasoning: 'shared candidate',
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
        {
          id: 'edge-related-2',
          sourceNodeId: relatedPlanId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: graphOnlyCandidateId,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: RelationshipType.RelatedTo,
          reasoning: 'graph-only candidate',
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
      ]);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        relatedEntityId: relatedPlanId,
        relatedEntityType: AgentEdgeEndpointEntityType.Task,
        edgeTypes: [RelationshipType.RelatedTo],
        taskIds: [testIds.task, taskIdsOnlyCandidateId],
        userToken: 'token-xyz',
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: [testIds.task] } }),
        }),
      );
    });

    it('resolves related candidates for derived edge types through graph traversal', async () => {
      const relatedTaskId = '22222222-2222-4222-8222-222222222222';
      const coProposedTaskId = '11111111-1111-4111-8111-111111111111' as TaskId;
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        {
          id: 'edge-related-1',
          sourceNodeId: relatedTaskId,
          sourceEntityType: AgentEdgeEndpointEntityType.Task,
          targetNodeId: testIds.task,
          targetEntityType: AgentEdgeEndpointEntityType.Task,
          type: RelationshipType.RelatedTo,
          reasoning: 'stored candidate',
          createdAt: '2026-07-18T00:00:00.000Z',
          updatedAt: '2026-07-18T00:00:00.000Z',
        },
      ]);
      mockGraphsClient.readIncidentEdges.mockResolvedValue({
        groups: [
          {
            seedEntityId: relatedTaskId,
            endpoints: [],
            neighborTotal: 1,
            relationships: [
              {
                id: `derived:PROPOSED_TOGETHER:${relatedTaskId}:${coProposedTaskId}`,
                type: RelationshipType.ProposedTogether,
                sourceNodeId: relatedTaskId,
                targetNodeId: coProposedTaskId,
                properties: { source: 'system' },
                createdAt: '2026-07-18T00:00:00.000Z',
                updatedAt: '2026-07-18T00:00:00.000Z',
              },
            ],
          },
        ],
      } satisfies import('src/generated/graphs').IncidentEdgesResponse);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        relatedEntityId: relatedTaskId,
        relatedEntityType: AgentEdgeEndpointEntityType.Task,
        edgeTypes: [
          RelationshipType.RelatedTo,
          RelationshipType.ProposedTogether,
        ],
        userToken: 'token-xyz',
      });

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([relatedTaskId]),
          types: new Set([RelationshipType.RelatedTo]),
        },
        'token-xyz',
      );
      expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          seedEntityIds: [relatedTaskId],
          relationshipTypes: [RelationshipType.ProposedTogether],
        }),
        'token-xyz',
      );
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: [testIds.task, coProposedTaskId] },
          }),
        }),
      );
    });

    it('rejects related candidate selection without an authenticated token', async () => {
      await expect(
        service.findAll(testIds.organization, undefined, {
          projectId: testIds.project,
          relatedEntityId: '22222222-2222-4222-8222-222222222222',
          relatedEntityType: AgentEdgeEndpointEntityType.Task,
          edgeTypes: [RelationshipType.RelatedTo],
          userToken: null,
        }),
      ).rejects.toThrow('An authenticated user token is required');

      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(mockPrismaService.db.task.findMany).not.toHaveBeenCalled();
    });

    it('omits edges when includeEdges is false', async () => {
      const mockTasks = [
        { ...mockTaskData, name: 'Task 1' },
        { ...mockTaskData, id: testIds.task + '2', name: 'Task 2' },
      ];

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        mockTasks,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: false,
          projectId: testIds.project,
          userToken: 'token-abc',
        },
      );

      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      for (const task of result) {
        expect('edges' in task).toBe(false);
      }
    });

    it('omits edges when includeEdges is true but userToken is missing', async () => {
      const mockTasks = [{ ...mockTaskData, name: 'Task 1' }];
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        mockTasks,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: null,
        },
      );

      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(result[0]?.edges).toEqual([]);
    });

    it('issues one incident edge query for selected taskIds and does not materialize monitor order as graph edges', async () => {
      const selectedTaskId = '11111111-1111-4111-8111-111111111111' as TaskId;
      const selectedTasks = [
        { ...mockTaskData, id: testIds.task },
        { ...mockTaskData, id: selectedTaskId, name: 'Selected task' },
      ];
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        selectedTasks,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([]);

      await service.findAll(testIds.organization, undefined, {
        projectId: testIds.project,
        taskIds: [testIds.task, selectedTaskId],
        includeEdges: true,
        userToken: 'token-xyz',
      });

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledTimes(1);
      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        expect.objectContaining({
          nodeIds: new Set([testIds.task, selectedTaskId]),
        }),
        'token-xyz',
      );
    });

    it('issues a single batched incident edge query and groups edges per requested endpoint when includeEdges is true', async () => {
      const taskWithEdges = { ...mockTaskData, name: 'Task 1' };
      const taskWithoutEdges = {
        ...mockTaskData,
        id: testIds.task + '2',
        name: 'Task 2',
      };
      const mockTasks = [taskWithEdges, taskWithoutEdges];

      const outboundEdge = {
        id: 'edge-out',
        sourceNodeId: taskWithEdges.id,
        targetNodeId: 'task-other-1',
        type: 'DEPENDS_ON',
        reasoning: 'depends on other task',
        createdBySessionId: 'session-1',
        lastModifiedBySessionId: null,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      };
      const inboundEdge = {
        id: 'edge-in',
        sourceNodeId: 'task-other-2',
        targetNodeId: taskWithEdges.id,
        type: 'RELATED_TO',
        reasoning: 'other task relates to this',
        createdBySessionId: 'session-2',
        lastModifiedBySessionId: null,
        createdAt: '2024-02-02T00:00:00Z',
        updatedAt: '2024-02-02T00:00:00Z',
      };

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        mockTasks,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        outboundEdge,
        inboundEdge,
      ]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
        },
      );

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledTimes(1);
      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([taskWithEdges.id, taskWithoutEdges.id]),
          types: new Set([
            'DEPENDS_ON',
            'DERIVES_FROM',
            'SUPERSEDES',
            'CONTRADICTS',
            'RELATED_TO',
            'EVOLVES',
          ]),
        },
        'token-xyz',
      );

      const [first, second] = result;
      expect(first?.edges).toEqual([outboundEdge, inboundEdge]);
      expect(second?.edges).toEqual([]);
    });

    it('returns canonical task prerequisites when DEPENDS_ON is selected', async () => {
      const dependent = { ...mockTaskData, type: 'STANDARD' };
      const prerequisite = {
        id: 'plan-prerequisite-edge',
        sourceNodeId: dependent.id,
        targetNodeId: 'prerequisite-task',
        sourceNodeType: 'STANDARD',
        targetNodeType: 'STANDARD',
        type: 'DEPENDS_ON',
      };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        dependent,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([prerequisite]);
      const [result] = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token',
          edgeTypes: [RelationshipType.DependsOn],
        },
      );
      expect(result?.edges).toEqual([prerequisite]);
      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        { nodeIds: new Set([dependent.id]), types: new Set(['DEPENDS_ON']) },
        'token',
      );
    });

    it('preserves target work-item subtype from generic incident-edge reads', async () => {
      const workflowStep = {
        ...mockTaskData,
        id: 'workflow-step-with-contract',
        type: 'workflow_step',
      };
      const contractDependency = {
        id: 'contract-dependency-edge',
        sourceNodeId: workflowStep.id,
        targetNodeId: 'shared-runtime-handoff',
        targetNodeName: 'Shared runtime start handoff',
        targetNodeType: 'CONTRACT',
        type: 'DEPENDS_ON',
        reasoning: 'The monitor runtime start requires the admitted handoff',
        createdAt: '2026-07-24T00:00:00Z',
        updatedAt: '2026-07-24T00:00:00Z',
      };

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        workflowStep,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([contractDependency]);

      const [result] = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          edgeTypes: [RelationshipType.DependsOn],
        },
      );

      expect(result?.edges).toEqual([contractDependency]);
      expect(
        (result?.edges?.[0] as Record<string, unknown> | undefined)
          ?.targetNodeType,
      ).toBe('CONTRACT');
    });

    it('reads system-emitted PROPOSED_TOGETHER edges through exact incident projection', async () => {
      const taskWithEdges = { ...mockTaskData, name: 'Task 1' };
      const relatedTaskId = '11111111-1111-4111-8111-111111111111';
      const proposedTogetherEdge = {
        id: `derived:PROPOSED_TOGETHER:${taskWithEdges.id}:${relatedTaskId}`,
        sourceNodeId: taskWithEdges.id,
        targetNodeId: relatedTaskId,
        type: RelationshipType.ProposedTogether,
        reasoning: 'Entities were co-authored by the same approved proposal',
        createdBySessionId: null,
        lastModifiedBySessionId: null,
        createdAt: '2026-07-24T00:00:00Z',
        updatedAt: '2026-07-24T00:00:00Z',
      };

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        taskWithEdges,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockGraphsClient.readIncidentEdges.mockResolvedValue({
        groups: [
          {
            seedEntityId: taskWithEdges.id,
            endpoints: [],
            neighborTotal: 1,
            relationships: [
              {
                id: proposedTogetherEdge.id,
                type: RelationshipType.ProposedTogether,
                sourceNodeId: taskWithEdges.id,
                targetNodeId: relatedTaskId,
                properties: {
                  source: 'system',
                },
                createdAt: proposedTogetherEdge.createdAt,
                updatedAt: proposedTogetherEdge.updatedAt,
              },
            ],
          },
        ],
      } satisfies import('src/generated/graphs').IncidentEdgesResponse);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          edgeTypes: [RelationshipType.ProposedTogether],
        },
      );

      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(mockGraphsClient.readIncidentEdges).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          seedEntityIds: [taskWithEdges.id],
          relationshipTypes: [RelationshipType.ProposedTogether],
        },
        'token-xyz',
      );
      expect(result[0]?.edges).toEqual([proposedTogetherEdge]);
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });

    it('warns only for each overflowing incident seed', async () => {
      const first = '123e4567-e89b-42d3-a456-426614174001';
      const second = '123e4567-e89b-42d3-a456-426614174002';
      const response: import('src/generated/graphs').IncidentEdgesResponse = {
        groups: [first, second].map((seedEntityId) => ({
          seedEntityId,
          neighborTotal: 60,
          relationships: [],
          endpoints: [],
        })),
      };
      mockGraphsClient.readIncidentEdges.mockResolvedValue(response);
      const warn = jest.spyOn((service as any).logger, 'warn');
      await (service as any).findTraversalOnlyIncidentEdges(
        testIds.organization,
        testIds.project,
        [first, second],
        [RelationshipType.ProposedTogether],
        'token',
      );
      expect(warn).not.toHaveBeenCalled();
      response.groups[1]!.neighborTotal = 101;
      await (service as any).findTraversalOnlyIncidentEdges(
        testIds.organization,
        testIds.project,
        [first, second],
        [RelationshipType.ProposedTogether],
        'token',
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[findTraversalOnlyIncidentEdges] edges may be truncated',
        {
          seedEntityId: second,
          neighborTotal: 101,
          pageSize: 100,
        },
      );
      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
    });

    it('deduplicates reciprocal virtual PROPOSED_TOGETHER edges for multi-task reads', async () => {
      const firstTask = {
        ...mockTaskData,
        id: '123e4567-e89b-42d3-a456-426614174021',
        name: 'Task 1',
      };
      const secondTask = {
        ...mockTaskData,
        id: '123e4567-e89b-42d3-a456-426614174022',
        name: 'Task 2',
      };
      const relationship = (sourceNodeId: string, targetNodeId: string) => ({
        id: `derived:PROPOSED_TOGETHER:${sourceNodeId}:${targetNodeId}`,
        type: RelationshipType.ProposedTogether,
        sourceNodeId,
        targetNodeId,
        properties: { source: 'system' },
        createdAt: '2026-07-24T00:00:00Z',
        updatedAt: '2026-07-24T00:00:00Z',
      });

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        firstTask,
        secondTask,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockGraphsClient.readIncidentEdges.mockResolvedValue({
        groups: [
          {
            seedEntityId: firstTask.id,
            endpoints: [],
            neighborTotal: 1,
            relationships: [relationship(firstTask.id, secondTask.id)],
          },
          {
            seedEntityId: secondTask.id,
            endpoints: [],
            neighborTotal: 1,
            relationships: [relationship(secondTask.id, firstTask.id)],
          },
        ],
      } satisfies import('src/generated/graphs').IncidentEdgesResponse);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          edgeTypes: [RelationshipType.ProposedTogether],
        },
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.edges).toHaveLength(1);
      expect(result[1]?.edges).toEqual(result[0]?.edges);
    });

    it('attaches seed-to-seed incident edges to both requested tasks', async () => {
      const sourceStep = {
        ...mockTaskData,
        id: 'step-source',
        type: 'workflow_step',
      };
      const targetStep = {
        ...mockTaskData,
        id: 'step-target',
        type: 'workflow_step',
      };
      const flowEdge = {
        id: 'edge-flow',
        sourceNodeId: sourceStep.id,
        targetNodeId: targetStep.id,
        type: RelationshipType.Standard,
        category: AgentEdgeCategory.Flow,
        direction: AgentEdgeDirection.Forward,
        reasoning: 'continue to next step',
        createdBySessionId: 'session-1',
        lastModifiedBySessionId: null,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      };

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        sourceStep,
        targetStep,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([flowEdge]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          taskType: 'workflow_step',
          edgeTypes: [RelationshipType.Standard],
        },
      );

      expect(result[0]?.edges).toEqual([flowEdge]);
      expect(result[1]?.edges).toEqual([flowEdge]);
    });

    it('attaches seed-to-non-seed fulfillment edges to the requested task', async () => {
      const workflowStep = {
        ...mockTaskData,
        id: 'step-with-fulfillment',
        type: 'workflow_step',
      };
      const fulfillmentEdge = {
        id: 'edge-fulfilled-by',
        sourceNodeId: workflowStep.id,
        targetNodeId: 'implementation-task',
        type: RelationshipType.FulfilledBy,
        category: AgentEdgeCategory.Meta,
        reasoning: 'implemented by this task',
        createdBySessionId: 'session-1',
        lastModifiedBySessionId: null,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      };

      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        workflowStep,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([fulfillmentEdge]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          taskType: 'workflow_step',
          edgeTypes: [RelationshipType.FulfilledBy],
        },
      );

      expect(result[0]?.edges).toEqual([fulfillmentEdge]);
    });

    it('uses requested edgeTypes exactly and preserves workflow edge metadata', async () => {
      const workflowStep = {
        ...mockTaskData,
        id: 'step-1',
        type: 'workflow_step',
        parentTaskId: 'workflow-1',
      };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        workflowStep,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const edgeTypes = [
        RelationshipType.Standard,
        RelationshipType.Conditional,
        RelationshipType.Loop,
        RelationshipType.FulfilledBy,
      ];
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        {
          id: 'edge-conditional',
          sourceNodeId: workflowStep.id,
          targetNodeId: 'step-2',
          type: RelationshipType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: 'approved',
          reasoning: 'branch when approved',
          createdBySessionId: 'session-1',
          lastModifiedBySessionId: null,
          createdAt: '2024-02-01T00:00:00Z',
          updatedAt: '2024-02-01T00:00:00Z',
        },
      ]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          parentTaskId: 'workflow-1' as TaskId,
          taskType: 'workflow_step',
          edgeTypes,
        },
      );

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([workflowStep.id]),
          types: new Set(edgeTypes),
        },
        'token-xyz',
      );
      expect(result[0]?.edges).toEqual([
        {
          id: 'edge-conditional',
          sourceNodeId: workflowStep.id,
          targetNodeId: 'step-2',
          type: RelationshipType.Conditional,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          predicate: 'approved',
          reasoning: 'branch when approved',
          createdBySessionId: 'session-1',
          lastModifiedBySessionId: null,
          createdAt: '2024-02-01T00:00:00Z',
          updatedAt: '2024-02-01T00:00:00Z',
        },
      ]);
    });

    it('allows graph-capable reads to request declared labels and rejects undeclared labels', async () => {
      const graphRoot = {
        ...mockTaskData,
        id: 'graph-root-task',
        type: 'GRAPH_ROOT',
      };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        graphRoot,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([]);

      await expect(
        service.findAll(testIds.organization, testIds.initiative, {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          taskType: 'GRAPH_ROOT',
          edgeTypes: [RelationshipType.Standard],
        }),
      ).resolves.toHaveLength(1);

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([graphRoot.id]),
          types: new Set([RelationshipType.Standard]),
        },
        'token-xyz',
      );

      mockAgentEdgeClient.findIncident.mockClear();
      await expect(
        service.findAll(testIds.organization, testIds.initiative, {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          taskType: 'GRAPH_ROOT',
          edgeTypes: [RelationshipType.FulfilledBy],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
    });

    it('uses declared readable labels as the default edge set for graph-capable reads', async () => {
      const graphRoot = {
        ...mockTaskData,
        id: 'graph-root-task',
        type: 'GRAPH_ROOT',
      };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        graphRoot,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([
        {
          id: 'standard-edge',
          sourceNodeId: graphRoot.id,
          targetNodeId: 'graph-node-task',
          type: RelationshipType.Standard,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
          reasoning: 'next graph node',
          createdBySessionId: 'session-1',
          lastModifiedBySessionId: null,
          createdAt: '2024-02-01T00:00:00Z',
          updatedAt: '2024-02-01T00:00:00Z',
        },
      ]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
          taskType: 'GRAPH_ROOT',
        },
      );

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([graphRoot.id]),
          types: new Set([RelationshipType.Standard]),
        },
        'token-xyz',
      );
      expect(result[0]?.edges?.map((edge) => edge.type)).toEqual([
        RelationshipType.Standard,
      ]);
    });

    it('loads graph node children through the existing parent and type filters', async () => {
      const graphNode = {
        ...mockTaskData,
        id: 'graph-node-task',
        type: 'GRAPH_NODE',
        parentTaskId: 'graph-root-task',
      };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        graphNode,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          projectId: testIds.project,
          parentTaskId: 'graph-root-task' as TaskId,
          taskType: 'GRAPH_NODE',
          includeSectionKeys: ALL_DECLARED_SECTIONS,
        },
      );

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            parentTaskId: 'graph-root-task',
            type: 'GRAPH_NODE',
          }),
        }),
      );
      expect(result[0]?.id).toBe(graphNode.id);
      expect(result[0]?.sections?.map((section) => section.key)).toEqual([
        TaskSectionKey.Description,
      ]);
    });

    it('deduplicates edges that appear in the seed result more than once', async () => {
      const taskA = { ...mockTaskData, name: 'Task A' };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        taskA,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const selfEdge = {
        id: 'edge-self',
        sourceNodeId: taskA.id,
        targetNodeId: taskA.id,
        type: 'RELATED_TO',
        reasoning: 'self-edge',
        createdBySessionId: 'session-1',
        lastModifiedBySessionId: null,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-02-01T00:00:00Z',
      };

      mockAgentEdgeClient.findIncident.mockResolvedValue([selfEdge]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          includeEdges: true,
          projectId: testIds.project,
          userToken: 'token-xyz',
        },
      );

      expect(result[0]?.edges).toEqual([selfEdge]);
    });

    it('includeDescendants=false issues a single parentTaskId filter with no feature-tree fetch', async () => {
      const task = { ...mockTaskData, parentTaskId: 'feature-root' };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        task,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, testIds.initiative, {
        parentTaskId: 'feature-root' as TaskId,
        includeDescendants: false,
        projectId: testIds.project,
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ parentTaskId: 'feature-root' }),
        }),
      );
    });

    it('includeDescendants=true fetches the feature tree via CTE and filters by subtree', async () => {
      const featureRoot = 'feature-root';
      const featureChild = 'feature-child';
      const taskOnRoot = {
        ...mockTaskData,
        id: 'task-1',
        parentTaskId: featureRoot,
      };
      const taskOnChild = {
        ...mockTaskData,
        id: 'task-2',
        parentTaskId: featureChild,
      };

      (mockPrismaService.db.$queryRaw as jest.Mock).mockResolvedValueOnce([
        { id: featureRoot },
        { id: featureChild },
      ]);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        taskOnRoot,
        taskOnChild,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          parentTaskId: featureRoot as TaskId,
          includeDescendants: true,
          projectId: testIds.project,
        },
      );

      expect(mockPrismaService.db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledTimes(1);
      const taskFetchCall = (mockPrismaService.db.task.findMany as jest.Mock)
        .mock.calls[0];
      expect(taskFetchCall?.[0]?.where?.parentTaskId).toEqual({
        in: expect.arrayContaining([featureRoot, featureChild]),
      });
      expect(result).toHaveLength(2);
    });

    it('includeDescendants=true with no descendants includes only the root feature', async () => {
      const featureRoot = 'feature-leaf';
      const taskOnRoot = {
        ...mockTaskData,
        id: 'task-only',
        parentTaskId: featureRoot,
      };

      (mockPrismaService.db.$queryRaw as jest.Mock).mockResolvedValueOnce([
        { id: featureRoot },
      ]);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        taskOnRoot,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          parentTaskId: featureRoot as TaskId,
          includeDescendants: true,
          projectId: testIds.project,
        },
      );

      const taskFetchCall = (mockPrismaService.db.task.findMany as jest.Mock)
        .mock.calls[0];
      expect(taskFetchCall?.[0]?.where?.parentTaskId).toEqual({
        in: [featureRoot],
      });
      expect(result).toHaveLength(1);
    });

    it('includeDescendants=true returns tasks at all depth levels of a multi-depth subtree', async () => {
      const root = 'root';
      const child = 'child';
      const grandchild = 'grandchild';
      const taskAtRoot = { ...mockTaskData, id: 'tr', parentTaskId: root };
      const taskAtChild = { ...mockTaskData, id: 'tc', parentTaskId: child };
      const taskAtGrandchild = {
        ...mockTaskData,
        id: 'tg',
        parentTaskId: grandchild,
      };

      (mockPrismaService.db.$queryRaw as jest.Mock).mockResolvedValueOnce([
        { id: root },
        { id: child },
        { id: grandchild },
      ]);
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        taskAtRoot,
        taskAtChild,
        taskAtGrandchild,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findAll(
        testIds.organization,
        testIds.initiative,
        {
          parentTaskId: root as TaskId,
          includeDescendants: true,
          projectId: testIds.project,
        },
      );

      const taskFetchCall = (mockPrismaService.db.task.findMany as jest.Mock)
        .mock.calls[0];
      expect(taskFetchCall?.[0]?.where?.parentTaskId).toEqual({
        in: expect.arrayContaining([root, child, grandchild]),
      });
      expect(result).toHaveLength(3);
    });

    it('filters by an open custom type key string (not the closed enum)', async () => {
      const marketingTask = { ...mockTaskData, id: 'mkt-1', type: 'MARKETING' };
      const standardTask = { ...mockTaskData, id: 'std-1', type: 'STANDARD' };
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        marketingTask,
      ]);
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      await service.findAll(testIds.organization, null, {
        projectId: testIds.project,
        taskType: 'MARKETING',
      });

      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: 'MARKETING' }),
        }),
      );
      // Confirm the standard task was NOT passed — the DB mock already
      // filtered, but assert the where clause doesn't also include
      // standardTask's type.
      const callArgs = (mockPrismaService.db.task.findMany as jest.Mock).mock
        .calls[0];
      expect(callArgs?.[0]?.where?.type).toBe('MARKETING');
      void standardTask; // excluded by where filter, not returned
    });
  });

  describe('task dependencies', () => {
    const projectId = 'project-123';

    const buildTaskContext = (taskId: TaskId) => ({
      id: taskId,
      initiativeId: testIds.initiative,
      initiative: {
        originatingProjectId: projectId,
      },
    });

    it('lists dependencies for a task', async () => {
      const dependencyRecord = {
        id: 'dep-1',
        dependentTaskId: testIds.task,
        dependencyTaskId: 'task-2',
        relationType: TaskDependencyRelationType.DEPENDS_ON,
        sourceType: TaskDependencySourceType.USER,
        createdById: testIds.user,
        reason: 'Needs groundwork',
        createdAt: new Date('2024-02-01T00:00:00Z'),
        updatedAt: new Date('2024-02-02T00:00:00Z'),
      };

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        buildTaskContext(testIds.task),
      );
      (
        mockPrismaService.db.taskDependency.findMany as jest.Mock
      ).mockResolvedValue([dependencyRecord]);

      const result = await service.listDependenciesByOrganization(
        testIds.organization,
        testIds.task,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: dependencyRecord.id,
        dependentTaskId: dependencyRecord.dependentTaskId,
        dependencyTaskId: dependencyRecord.dependencyTaskId,
        relationType: dependencyRecord.relationType,
        sourceType: dependencyRecord.sourceType,
        createdById: dependencyRecord.createdById,
        reason: dependencyRecord.reason,
      });
    });

    it('rejects circular dependencies on create', async () => {
      const dependencyTaskId = 'task-2' as TaskId;

      (mockPrismaService.db.task.findFirst as jest.Mock).mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === testIds.task) {
            return buildTaskContext(testIds.task);
          }
          if (where.id === dependencyTaskId) {
            return buildTaskContext(dependencyTaskId);
          }
          return null;
        },
      );

      (
        mockPrismaService.db.taskDependency.findFirst as jest.Mock
      ).mockResolvedValue(null);
      (
        mockPrismaService.db.taskDependency.findMany as jest.Mock
      ).mockResolvedValue([
        {
          dependentTaskId: dependencyTaskId,
          dependencyTaskId: testIds.task,
        },
      ]);

      await expect(
        service.createDependencyByOrganization(
          testIds.organization,
          testIds.task,
          {
            dependencyTaskId,
            relationType: TaskDependencyRelationType.DEPENDS_ON,
          },
          testIds.user,
        ),
      ).rejects.toThrow('Circular dependency detected');
    });

    it('updates dependency relation type', async () => {
      const dependencyId = 'dep-2';
      const dependencyTaskId = 'task-3' as TaskId;
      const existingDependency = {
        id: dependencyId,
        dependentTaskId: testIds.task,
        dependencyTaskId,
        relationType: TaskDependencyRelationType.DEPENDS_ON,
        sourceType: TaskDependencySourceType.SYSTEM,
        createdById: null,
        reason: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-02T00:00:00Z'),
      };

      (mockPrismaService.db.task.findFirst as jest.Mock).mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === testIds.task) {
            return buildTaskContext(testIds.task);
          }
          if (where.id === dependencyTaskId) {
            return buildTaskContext(dependencyTaskId);
          }
          return null;
        },
      );

      (mockPrismaService.db.taskDependency.findFirst as jest.Mock)
        .mockResolvedValueOnce(existingDependency)
        .mockResolvedValueOnce(null);
      (
        mockPrismaService.db.taskDependency.findMany as jest.Mock
      ).mockResolvedValue([]);
      (
        mockPrismaService.db.taskDependency.update as jest.Mock
      ).mockResolvedValue({
        ...existingDependency,
        relationType: TaskDependencyRelationType.BLOCKS,
        sourceType: TaskDependencySourceType.USER,
        createdById: testIds.user,
        updatedAt: new Date('2024-02-03T00:00:00Z'),
      });

      const result = await service.updateDependencyByOrganization(
        testIds.organization,
        testIds.task,
        dependencyId,
        {
          relationType: TaskDependencyRelationType.BLOCKS,
        },
        testIds.user,
      );

      expect(result.relationType).toBe(TaskDependencyRelationType.BLOCKS);
      expect(result.sourceType).toBe(TaskDependencySourceType.USER);
      expect(result.createdById).toBe(testIds.user);
    });

    it('adds only missing inferred dependencies for target tasks', async () => {
      const taskIds = [testIds.task, 'task-2', 'task-3'] as TaskId[];
      const dependencies = [
        {
          dependentTaskId: testIds.task,
          dependencyTaskId: 'task-2' as TaskId,
          relationType: TaskDependencyRelationType.DEPENDS_ON,
          reason: 'Needs setup',
        },
        {
          dependentTaskId: testIds.task,
          dependencyTaskId: 'task-3' as TaskId,
          relationType: TaskDependencyRelationType.BLOCKS,
        },
        {
          dependentTaskId: 'task-2' as TaskId,
          dependencyTaskId: 'task-3' as TaskId,
          relationType: TaskDependencyRelationType.DEPENDS_ON,
        },
      ];

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        originatingProjectId: projectId,
      });
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
        taskIds.map((id) => ({ id })),
      );
      (mockPrismaService.db.taskDependency.findMany as jest.Mock)
        .mockResolvedValueOnce([
          {
            dependentTaskId: testIds.task,
            dependencyTaskId: 'task-2',
          },
        ])
        .mockResolvedValue([]);
      (
        mockPrismaService.db.taskDependency.create as jest.Mock
      ).mockResolvedValue({
        id: 'dep-99',
        dependentTaskId: testIds.task,
        dependencyTaskId: 'task-3',
        relationType: TaskDependencyRelationType.BLOCKS,
        sourceType: TaskDependencySourceType.SYSTEM,
        createdById: null,
        reason: null,
        createdAt: new Date('2024-03-01T00:00:00Z'),
        updatedAt: new Date('2024-03-01T00:00:00Z'),
      });

      const result = await service.applyInferredDependenciesByInitiative(
        testIds.organization,
        testIds.initiative,
        {
          targetTaskIds: [testIds.task],
          dependencies,
        },
      );

      expect(mockPrismaService.db.taskDependency.create).toHaveBeenCalledWith({
        data: {
          dependentTaskId: testIds.task,
          dependencyTaskId: 'task-3',
          relationType: TaskDependencyRelationType.BLOCKS,
          sourceType: TaskDependencySourceType.SYSTEM,
          reason: null,
        },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.dependentTaskId).toBe(testIds.task);
      expect(result[0]?.dependencyTaskId).toBe('task-3');
    });

    it('rejects inferred dependencies with unknown tasks', async () => {
      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        originatingProjectId: projectId,
      });
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
        { id: testIds.task },
      ]);

      await expect(
        service.applyInferredDependenciesByInitiative(
          testIds.organization,
          testIds.initiative,
          {
            targetTaskIds: [testIds.task],
            dependencies: [
              {
                dependentTaskId: testIds.task,
                dependencyTaskId: 'unknown-task' as TaskId,
                relationType: TaskDependencyRelationType.DEPENDS_ON,
              },
            ],
          },
        ),
      ).rejects.toThrow(
        'Inferred dependencies include invalid task references',
      );
    });
  });

  describe('archived custom type lifecycle', () => {
    const archivedType = ARCHIVED_CUSTOM_TYPE_SPEC.typeKey;

    const archivedTypeError = () =>
      `'${archivedType}' is not a usable type for this project. Valid types: ${workItemTypeRegistry
        .getActiveTypeKeys(testIds.project)
        .join(', ')}`;

    const spyOnPlacementRules = () => ({
      canParentChildType: jest.spyOn(
        workItemTypeRegistry,
        'canParentChildType',
      ),
    });

    const expectNoPlacementRules = (
      spies: ReturnType<typeof spyOnPlacementRules>,
    ) => {
      expect(spies.canParentChildType).not.toHaveBeenCalled();
    };

    it('keeps archived definitions readable while excluding them from active types', () => {
      expect(
        workItemTypeRegistry.getDefinition(testIds.project, archivedType),
      ).toMatchObject({
        status: 'ARCHIVED',
        definition: {
          key: archivedType,
          name: ARCHIVED_CUSTOM_TYPE_SPEC.name,
        },
      });
      expect(workItemTypeRegistry.getDefinitions(testIds.project)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'ARCHIVED',
            definition: expect.objectContaining({ key: archivedType }),
          }),
        ]),
      );
      expect(
        workItemTypeRegistry.getActiveTypeKeys(testIds.project),
      ).not.toContain(archivedType);
    });

    it('keeps existing archived-type items readable through the normal task path', async () => {
      const archivedTask = {
        ...mockTaskData,
        type: archivedType,
      };
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        archivedTask,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue([
        {
          id: `${testIds.task}-description`,
          taskId: testIds.task,
          key: TaskSectionKey.Description,
          order: 0,
          materializedMarkdown: 'Existing archived work remains readable',
        },
        {
          id: `${testIds.task}-requirements`,
          taskId: testIds.task,
          key: TaskSectionKey.Requirements,
          order: 1,
          materializedMarkdown: 'Preserve the historical definition',
        },
      ]);

      const result = await service.findOne(testIds.organization, testIds.task);

      expect(result?.type).toBe(archivedType);
      expect(result?.sections?.map((section) => section.key)).toEqual([
        TaskSectionKey.Description,
        TaskSectionKey.Requirements,
      ]);
    });

    it('reads the committed archived-type item despite a nonterminal prior projection', async () => {
      const archivedSnapshot = {
        id: testIds.task,
        name: 'Archived projected item',
        type: archivedType,
        organizationId: testIds.organization,
        projectId: testIds.project,
        initiativeId: testIds.initiative,
        status: WorkStatus.BACKLOG,
        source: 'user',
      };
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          affectedWorkItemIds: [testIds.task],
          priorProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            workItems: { [testIds.task]: archivedSnapshot },
          },
        },
      ]);

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
        ...mockTaskData,
        type: archivedType,
      });
      const result = await service.findOne(testIds.organization, testIds.task);
      expect(result?.name).toBe(mockTaskData.name);
      expect(result?.type).toBe(archivedType);
      expect(mockPrismaService.db.task.findFirst).toHaveBeenCalled();
    });

    it('rejects creating an archived type before placement rules run', async () => {
      const placementSpies = spyOnPlacementRules();
      mockTransaction.mockImplementation(async (callback) =>
        callback({
          initiative: { findFirst: jest.fn() },
          task: { create: jest.fn(), findFirst: jest.fn() },
        }),
      );

      await expect(
        service.create(
          testIds.organization,
          undefined,
          {
            name: 'New retired campaign',
            type: archivedType as CreateTaskDto['type'],
          },
          testIds.project,
        ),
      ).rejects.toThrow(archivedTypeError());
      expectNoPlacementRules(placementSpies);
    });

    it('rejects creating under an archived-type parent before placement rules run', async () => {
      const placementSpies = spyOnPlacementRules();
      mockTransaction.mockImplementation(async (callback) =>
        callback({
          initiative: { findFirst: jest.fn() },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'archived-parent',
              type: archivedType,
              projectId: testIds.project,
            }),
          },
        }),
      );

      await expect(
        service.create(
          testIds.organization,
          undefined,
          {
            name: 'Child task',
            type: 'STANDARD',
            parentTaskId: 'archived-parent',
          },
          testIds.project,
        ),
      ).rejects.toThrow(archivedTypeError());
      expectNoPlacementRules(placementSpies);
    });

    it('rejects moving an archived-type item before placement rules run', async () => {
      const placementSpies = spyOnPlacementRules();
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        type: archivedType,
      });

      await expect(
        service.update(testIds.organization, testIds.initiative, testIds.task, {
          parentTaskId: 'active-parent',
        }),
      ).rejects.toThrow(archivedTypeError());
      expectNoPlacementRules(placementSpies);
    });

    it('rejects re-parenting under an archived-type parent before placement rules run', async () => {
      const placementSpies = spyOnPlacementRules();
      (mockPrismaService.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockTaskData)
        .mockResolvedValueOnce({ id: 'archived-parent', type: archivedType });

      await expect(
        service.update(testIds.organization, testIds.initiative, testIds.task, {
          parentTaskId: 'archived-parent',
        }),
      ).rejects.toThrow(archivedTypeError());
      expectNoPlacementRules(placementSpies);
    });
  });

  describe('findMutationResultByOrganization', () => {
    it('hydrates archived mutation results within the organization', async () => {
      const archivedTask = {
        ...mockTaskData,
        status: WorkStatus.ARCHIVED,
        archivedAt: new Date(),
      };
      (mockPrismaService.db.task.findFirst as jest.Mock).mockImplementation(
        async ({ where }) =>
          where.organizationId === archivedTask.organizationId &&
          where.id === archivedTask.id &&
          where.archivedAt === undefined &&
          where.status === undefined
            ? archivedTask
            : null,
      );

      const result = await service.findMutationResultByOrganization(
        testIds.organization,
        testIds.task,
      );
      expect(result?.status).toBe('ARCHIVED');
      expect(
        materializedSectionsToContentMap(result?.sections).acceptanceCriteria,
      ).toBe('Success criteria');
      await expect(
        service.findOneByOrganization(testIds.organization, testIds.task),
      ).resolves.toBeNull();
    });
  });

  describe('findPersistedByOrganization', () => {
    it('returns the visible persisted row without hydrating sections or child counts', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        mockTaskData,
      );

      const result = await service.findPersistedByOrganization(
        testIds.organization,
        testIds.task,
      );

      expect(result).toBe(mockTaskData);
      expect(mockPrismaService.db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: testIds.task,
          organizationId: testIds.organization,
          archivedAt: null,
          status: { not: WorkStatus.ARCHIVED },
        },
      });
      expect(mockPrismaService.db.taskSection.findMany).not.toHaveBeenCalled();
      expect(mockPrismaService.db.task.groupBy).not.toHaveBeenCalled();
    });

    it('returns null when no visible persisted row exists', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.findPersistedByOrganization(testIds.organization, testIds.task),
      ).resolves.toBeNull();
    });
  });

  describe('findOne', () => {
    it('should return a task with acceptanceCriteria content', async () => {
      const persistedLookup = jest.spyOn(
        service,
        'findPersistedByOrganization',
      );
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        mockTaskData,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([
        {
          parentTaskId: mockTaskData.id,
          status: 'COMPLETED',
          _count: { _all: 1 },
        },
      ]);

      const result = await service.findOne(testIds.organization, testIds.task);

      expect(persistedLookup).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
      );
      expect(mockPrismaService.db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: testIds.task,
          organizationId: testIds.organization,
          archivedAt: null,
          status: { not: WorkStatus.ARCHIVED },
        },
      });

      const content = materializedSectionsToContentMap(result?.sections);
      expect(content.acceptanceCriteria).toBe('Success criteria');
      expect(result?.childCounts).toEqual({
        total: 1,
        done: 1,
        inProgress: 0,
        backlog: 0,
      });
    });

    it('should return null when task not found', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.findOne(testIds.organization, testIds.task);

      expect(result).toBeNull();
    });

    it('round-trips a custom type’s non-built-in section on read', async () => {
      // Regression: a custom type (CAMPAIGN) declares `audience`, a key outside
      // the built-in TaskSectionKey enum. The read path must resolve the task's
      // sections from its OWN declared set, not a hardcoded built-in key list —
      // otherwise `audience` is silently dropped on GET.
      const campaignTask = {
        ...mockTaskData,
        type: 'CAMPAIGN' as const,
        projectId: testIds.project,
        parentTaskId: null,
      };
      const campaignSectionRows = [
        {
          id: `${testIds.task}-description`,
          taskId: testIds.task,
          key: 'description',
          order: 0,
          materializedMarkdown: 'Launch the spring campaign',
        },
        {
          id: `${testIds.task}-audience`,
          taskId: testIds.task,
          key: 'audience',
          order: 1,
          materializedMarkdown: 'Enterprise buyers',
        },
      ];
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        campaignTask,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(campaignSectionRows);

      const result = await service.findOne(testIds.organization, testIds.task);

      // The declared `audience` section survives the read instead of being
      // filtered out, and declared order is preserved.
      expect(result?.sections?.map((section) => section.key)).toEqual([
        'description',
        'audience',
      ]);
      expect(
        result?.sections?.find(
          (section) => (section.key as string) === 'audience',
        )?.materializedMarkdown,
      ).toBe('Enterprise buyers');

      // The section query is scoped to the type's DECLARED keys (including the
      // custom `audience`), not the built-in enum that previously dropped it.
      const sectionQuery = (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mock.calls.at(-1)?.[0];
      expect(sectionQuery.where.key.in).toEqual(
        expect.arrayContaining(['description', 'audience']),
      );
    });

    it('reads back both HTML/CSS source fields without loss', async () => {
      const stored = '{"html":"<main>Preview</main>","css":""}';
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_HTML_CSS',
        projectId: testIds.project,
      });
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue([
        {
          id: `${testIds.task}-preview`,
          taskId: testIds.task,
          key: 'preview',
          order: 0,
          materializedMarkdown: stored,
        },
      ]);

      const result = await service.findOne(testIds.organization, testIds.task);
      const content = result?.sections?.[0]?.materializedMarkdown;

      expect(content).toBe(stored);
      expect(JSON.parse(content ?? '{}')).toEqual({
        html: '<main>Preview</main>',
        css: '',
      });
    });

    it('populates trackedEntities for GOAL-typed task with userToken', async () => {
      const goalRow = {
        ...mockTaskData,
        type: 'GOAL' as const,
        parentTaskId: null,
      };
      const targetTaskId = '00000000-0000-4000-8000-000000000022';
      const targetPlanId = '00000000-0000-4000-8000-000000000033';
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
        goalRow,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockGraphsClient.searchGraph.mockResolvedValueOnce({
        identitiesBySeed: [
          {
            seedNodeId: goalRow.id,
            targets: [
              { entityId: targetTaskId, entityType: 'TASK' },
              { entityId: targetPlanId, entityType: 'TASK' },
            ],
          },
        ],
      });
      (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValueOnce([
        {
          id: targetTaskId,
          name: 'Tracked feature',
          status: 'ACTIVE',
          dueDate: null,
        },
        {
          id: targetPlanId,
          name: 'Tracked plan',
          status: 'ACTIVE',
          dueDate: null,
        },
      ]);

      const result = await service.findOne(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        false,
        'tok',
      );

      expect(mockGraphsClient.searchGraph).toHaveBeenCalled();
      expect(result?.trackedEntities).toHaveLength(2);
      expect(result?.trackedEntities).toContainEqual(
        expect.objectContaining({
          targetEntityId: targetTaskId,
          targetEntityType: 'TASK',
          title: 'Tracked feature',
        }),
      );
      expect(result?.trackedEntities).toContainEqual(
        expect.objectContaining({
          targetEntityId: targetPlanId,
          targetEntityType: 'TASK',
          title: 'Tracked plan',
        }),
      );
    });

    it('does not load trackedEntities for non-GOAL tasks', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
        mockTaskData,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findOne(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        false,
        'tok',
      );

      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      expect(result?.trackedEntities).toBeUndefined();
    });

    it('should include service relations when requested', async () => {
      const relationCreatedAt = new Date('2024-01-03T00:00:00.000Z');
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
        ...mockTaskData,
        serviceRelations: [
          {
            id: 'service-task-2',
            serviceId: 'service-2',
            taskId: mockTaskData.id,
            relationType: 'supports',
            createdAt: relationCreatedAt,
          },
        ],
      });
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findOne(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        true,
        false,
      );

      expect(mockPrismaService.db.task.findFirst).toHaveBeenCalledWith({
        where: {
          id: testIds.task,
          organizationId: testIds.organization,
          archivedAt: null,
          status: { not: WorkStatus.ARCHIVED },
        },
        include: {
          serviceRelations: {
            select: {
              id: true,
              serviceId: true,
              taskId: true,
              relationType: true,
              createdAt: true,
            },
          },
        },
      });

      expect(result?.serviceRelations).toEqual([
        {
          id: 'service-task-2',
          serviceId: 'service-2',
          taskId: mockTaskData.id,
          relationType: 'supports',
          createdAt: relationCreatedAt.toISOString(),
        },
      ]);
    });

    it('omits edges when includeEdges is false', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        mockTaskData,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);

      const result = await service.findOne(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        false,
        'tok',
      );

      expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      expect(mockAgentEdgeClient.findIncident).not.toHaveBeenCalled();
      expect(result?.edges).toBeUndefined();
    });

    it('includes edges when requested with an authenticated user token', async () => {
      const taskWithEdges = {
        ...mockTaskData,
        projectId: testIds.project,
      };
      const edge = {
        id: 'edge-1',
        sourceNodeId: taskWithEdges.id,
        targetNodeId: 'task-target',
        type: 'DEPENDS_ON',
        reasoning: 'dependent work',
        createdBySessionId: 'session-1',
        lastModifiedBySessionId: null,
        createdAt: '2024-02-01T00:00:00.000Z',
        updatedAt: '2024-02-01T00:00:00.000Z',
      };

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        taskWithEdges,
      );
      (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
      mockAgentEdgeClient.findIncident.mockResolvedValue([edge]);

      const result = await service.findOne(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        true,
        'tok',
      );

      expect(mockAgentEdgeClient.findIncident).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        {
          nodeIds: new Set([taskWithEdges.id]),
          types: new Set([
            'DEPENDS_ON',
            'DERIVES_FROM',
            'SUPERSEDES',
            'CONTRADICTS',
            'RELATED_TO',
            'EVOLVES',
          ]),
        },
        'tok',
      );
      expect(result?.edges).toEqual([edge]);
    });
  });

  describe('findHierarchy', () => {
    it('should return task with parent and children', async () => {
      const parentTask = TestUtils.createMockTaskResponseDto({
        id: 'parent-1',
      });
      const task = TestUtils.createMockTaskResponseDto({
        id: 'child-0',
        parentTaskId: parentTask.id as TaskId,
      });
      const children = [
        TestUtils.createMockTaskResponseDto({
          id: 'child-1',
          parentTaskId: task.id as TaskId,
        }),
      ];

      const findOneSpy = jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(parentTask);
      const findAllSpy = jest
        .spyOn(service, 'findAll')
        .mockResolvedValue(children);

      const result = await service.findHierarchy(
        testIds.organization,
        task.id as TaskId,
      );

      expect(findOneSpy).toHaveBeenNthCalledWith(
        1,
        testIds.organization,
        task.id,
        false,
        false,
        false,
        false,
        false,
      );
      expect(findOneSpy).toHaveBeenNthCalledWith(
        2,
        testIds.organization,
        parentTask.id as TaskId,
        false,
        false,
        false,
        false,
        false,
      );
      expect(findAllSpy).toHaveBeenCalledWith(testIds.organization, undefined, {
        parentTaskId: task.id as TaskId,
        includeDesignDocCounts: false,
        includeAgentSessionCounts: false,
        includeServiceRelations: false,
        // Children are requested with their full declared section set (resolved
        // per each child's own type), so custom sections round-trip in the tree.
        includeSectionKeys: ALL_DECLARED_SECTIONS,
      });
      expect(result).toEqual({
        parent: parentTask,
        task,
        children,
      });
    });

    it('should throw NotFoundException when task is missing', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(null);

      await expect(
        service.findHierarchy(testIds.organization, 'missing-task' as TaskId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update task with new acceptanceCriteria', async () => {
      const updateTaskDto: UpdateTaskDto = {
        sections: TestUtils.createMockTaskSectionInputs({
          description: 'Updated description',
          acceptanceCriteria: 'Updated criteria',
        }),
        status: 'REFINING_DETAILS',
      };

      const existingTask = TestUtils.createMockTaskResponseDto({
        status: 'BACKLOG',
        assigneeId: undefined,
      });

      const updatedTaskData = {
        ...mockTaskData,
        sections: TestUtils.createMockMaterializedTaskSections({
          description: 'Updated description',
          acceptanceCriteria: 'Updated criteria',
        }),
      };

      // Mock findOne for existing task check
      jest.spyOn(service, 'findOne').mockResolvedValue(existingTask);

      // Mock transaction
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: mockPrismaService.db.task.findFirst,
            findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
            update: jest.fn().mockResolvedValue(updatedTaskData),
          },
          initiative: {
            findFirst: mockPrismaService.db.initiative.findFirst,
            findUnique: jest
              .fn()
              .mockResolvedValue({ originatingProjectId: 'proj-123' }),
          },
          taskSection: {
            findMany: jest
              .fn()
              .mockResolvedValue(
                createUpdateSectionRows(
                  testIds.task,
                  updateTaskDto.sections ?? [],
                ),
              ),
            update: jest.fn(),
          },
          taskSectionHistory: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      mockEventPublisher.publishInTransaction.mockResolvedValue(null);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(
        createTaskSectionRecords(testIds.task, {
          description: 'Updated description',
          acceptanceCriteria: 'Updated criteria',
        }),
      );
      (
        mockPrismaService.db.task.findUniqueOrThrow as jest.Mock
      ).mockResolvedValue(updatedTaskData);

      const result = await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        updateTaskDto,
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.UPDATED,
          payload: expect.objectContaining({
            update: {
              status: 'REFINING_DETAILS',
            },
          }),
        }),
      );

      // Should also publish status change event
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.STATUS_CHANGED,
          payload: expect.objectContaining({
            previousStatus: 'BACKLOG',
            newStatus: 'REFINING_DETAILS',
            originatingProjectId: testIds.project,
          }),
        }),
      );

      const content = materializedSectionsToContentMap(result.sections);
      expect(content.acceptanceCriteria).toBe('Updated criteria');
    });

    it('should not update TASK_ORIGINAL on generic task PATCH section updates', async () => {
      const updateTaskDto: UpdateTaskDto = {
        sections: TestUtils.createMockTaskSectionInputs({
          description: 'Updated description',
          acceptanceCriteria: 'Updated criteria',
        }),
      };

      const existingTask = TestUtils.createMockTaskResponseDto({
        status: 'BACKLOG',
        assigneeId: undefined,
      });
      (existingTask as any).initiative = {
        originatingProjectId: testIds.project,
      };

      const updatedTaskData = {
        ...mockTaskData,
        ...updateTaskDto,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: mockPrismaService.db.task.findFirst,
            findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
            update: jest.fn().mockResolvedValue(updatedTaskData),
          },
          initiative: {
            findFirst: mockPrismaService.db.initiative.findFirst,
          },
          taskSection: {
            findMany: jest
              .fn()
              .mockResolvedValue(
                createUpdateSectionRows(
                  testIds.task,
                  updateTaskDto.sections ?? [],
                ),
              ),
            update: jest.fn(),
          },
          taskSectionHistory: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'history-id' }),
          },
        };
        return callback(mockTx);
      });

      mockEventPublisher.publishInTransaction.mockResolvedValue(null);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(
        createTaskSectionRecords(testIds.task, {
          description: 'Updated description',
          acceptanceCriteria: 'Updated criteria',
        }),
      );
      (
        mockPrismaService.db.task.findUniqueOrThrow as jest.Mock
      ).mockResolvedValue(updatedTaskData);

      await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        updateTaskDto,
      );

      expect(
        mockTaskArtifactService.updateOriginalArtifactFields,
      ).not.toHaveBeenCalled();
    });

    it('validates schema-backed JSON sections on update before writing section rows', async () => {
      const sectionUpdate = {
        key: 'payload',
        content: { executionPlan: [] },
      };
      const taskSectionUpdate = jest.fn();
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'CUSTOM_JSON',
            projectId: testIds.project,
          }),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        taskSection: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              createUpdateSectionRows(testIds.task, [sectionUpdate]),
            ),
          update: taskSectionUpdate,
        },
        taskSectionHistory: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };

      await expect(
        service.updateInTransaction(
          tx as any,
          testIds.organization,
          testIds.initiative,
          testIds.task,
          { sections: [sectionUpdate] } as UpdateTaskDto,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining(
          `Invalid JSON section 'payload' (${TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF})`,
        ),
      });
      expect(taskSectionUpdate).not.toHaveBeenCalled();
    });

    it('leaves existing image content unchanged when an update carries malformed base64', async () => {
      const sectionUpdate = {
        key: 'image',
        content: { mimeType: 'image/png', data: 'not base64!' },
      };
      const taskSectionUpdate = jest.fn();
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'CUSTOM_IMAGE',
            projectId: testIds.project,
          }),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        taskSection: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              createUpdateSectionRows(testIds.task, [sectionUpdate]),
            ),
          update: taskSectionUpdate,
        },
        taskSectionHistory: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };

      await expect(
        service.updateInTransaction(
          tx as any,
          testIds.organization,
          testIds.initiative,
          testIds.task,
          { sections: [sectionUpdate] } as UpdateTaskDto,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('valid padded base64'),
      });
      expect(taskSectionUpdate).not.toHaveBeenCalled();
    });

    it('canonicalizes an HTML/CSS section on update with empty CSS', async () => {
      const sectionUpdate = {
        key: 'preview',
        content: { css: '', html: '<main>Hello</main>' },
      };
      const taskSectionUpdate = jest.fn();
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'CUSTOM_HTML_CSS',
            projectId: testIds.project,
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'CUSTOM_HTML_CSS',
          }),
          update: jest.fn(),
        },
        taskSection: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: `${testIds.task}-preview`,
                key: 'preview',
                materializedMarkdown: null,
              },
            ])
            .mockResolvedValueOnce([]),
          update: taskSectionUpdate,
        },
        taskSectionHistory: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
        },
      };

      await service.updateInTransaction(
        tx as any,
        testIds.organization,
        testIds.initiative,
        testIds.task,
        { sections: [sectionUpdate] } as UpdateTaskDto,
      );

      expect(taskSectionUpdate).toHaveBeenCalledWith({
        where: { id: `${testIds.task}-preview` },
        data: {
          materializedMarkdown: '{"html":"<main>Hello</main>","css":""}',
        },
      });
    });

    it('rejects removing a required CONTRACT parent in the transactional application path', async () => {
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'CONTRACT',
            parentTaskId: 'feature-parent-id',
          }),
          update: jest.fn(),
        },
      };

      await expect(
        service.updateInTransaction(
          tx as any,
          testIds.organization,
          testIds.initiative,
          testIds.task,
          { parentTaskId: null } as UpdateTaskDto,
        ),
      ).rejects.toThrow(
        'CONTRACT items require a structural parent under the configured work-item type definition.',
      );
      expect(tx.task.update).not.toHaveBeenCalled();
    });

    it('persists cursor and accepted-session mutations through generic section updates', async () => {
      const sessionLinkedExecutionDefinition = structuredClone(
        SESSION_LINKED_TASK_MONITOR,
      );
      const advancedExecutionDefinition = structuredClone(
        ADVANCED_TASK_MONITOR,
      );
      const taskSectionUpdate = jest.fn();
      const buildTx = (
        executionDefinition: TaskMonitorExecutionDefinition,
      ) => ({
        task: {
          findFirst: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'TASK_MONITOR',
            projectId: testIds.project,
          }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            ...mockTaskData,
            type: 'TASK_MONITOR',
          }),
          update: jest.fn(),
        },
        taskSection: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([
              {
                id: `${testIds.task}-executionDefinition`,
                key: 'executionDefinition',
                materializedMarkdown: JSON.stringify(
                  VALID_SCHEMA_BACKED_SECTION_CONTENT,
                ),
              },
            ])
            .mockResolvedValueOnce([
              {
                id: `${testIds.task}-summary`,
                taskId: testIds.task,
                key: 'summary',
                order: 0,
                materializedMarkdown: 'Monitor summary',
              },
              {
                id: `${testIds.task}-executionDefinition`,
                taskId: testIds.task,
                key: 'executionDefinition',
                order: 1,
                materializedMarkdown: JSON.stringify(executionDefinition),
              },
            ]),
          update: taskSectionUpdate,
        },
        taskSectionHistory: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'history-id' }),
        },
      });

      await service.updateInTransaction(
        buildTx(sessionLinkedExecutionDefinition) as any,
        testIds.organization,
        testIds.initiative,
        testIds.task,
        {
          sections: [
            {
              key: 'executionDefinition',
              content: sessionLinkedExecutionDefinition,
            },
          ],
        } as UpdateTaskDto,
      );
      await service.updateInTransaction(
        buildTx(advancedExecutionDefinition) as any,
        testIds.organization,
        testIds.initiative,
        testIds.task,
        {
          sections: [
            {
              key: 'executionDefinition',
              content: advancedExecutionDefinition,
            },
          ],
        } as UpdateTaskDto,
      );

      expect(taskSectionUpdate).toHaveBeenCalledTimes(2);
      const persistedDefinitions = taskSectionUpdate.mock.calls.map((call) =>
        JSON.parse(call[0].data.materializedMarkdown),
      );
      expect(persistedDefinitions[0].cursor).toBe(0);
      expect(persistedDefinitions[0].executionPlan[0]).toMatchObject({
        taskId: TASK_MONITOR_TASK_ID,
        agentSessionId: '55555555-5555-4555-8555-555555555555',
      });
      expect(persistedDefinitions[1]).toMatchObject({
        cursor: 1,
      });
      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);
      for (const call of mockEventPublisher.publishInTransaction.mock.calls) {
        expect(call[1]).toEqual(
          expect.objectContaining({
            type: EVENT_TYPES.TASK.CONTENT_CHANGED,
            payload: expect.objectContaining({
              content: expect.objectContaining({
                type: 'TASK_MONITOR',
                description: '',
              }),
            }),
          }),
        );
      }
    });

    it('should update TASK_ORIGINAL only when explicitly enabled for agent-generated content', async () => {
      const sectionUpdates = TestUtils.createMockTaskSectionInputs({
        description: 'Updated description',
        acceptanceCriteria: 'Updated criteria',
      })

        .map((section) => ({
          key: section.key as 'description' | 'acceptanceCriteria',
          content: section.content,
        }));

      const existingTask = TestUtils.createMockTaskResponseDto({
        status: 'BACKLOG',
        assigneeId: undefined,
      });
      (existingTask as any).initiative = {
        originatingProjectId: testIds.project,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: mockPrismaService.db.task.findFirst,
            findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
          },
          taskSection: {
            findMany: jest
              .fn()
              .mockResolvedValue(
                createUpdateSectionRows(testIds.task, sectionUpdates),
              ),
            update: jest.fn(),
          },
          taskSectionHistory: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'history-id' }),
          },
        };
        return callback(mockTx);
      });

      mockEventPublisher.publishInTransaction.mockResolvedValue(null);
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(
        createTaskSectionRecords(testIds.task, {
          description: 'Updated description',
          acceptanceCriteria: 'Updated criteria',
        }),
      );

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        sectionUpdates,
        { updateOriginalArtifact: true },
      );

      expect(
        mockTaskArtifactService.updateOriginalArtifactFields,
      ).toHaveBeenCalledWith(testIds.task, testIds.organization, {
        description: 'Updated description',
        acceptanceCriteria: 'Updated criteria',
      });
    });

    it('should allow updating initiativeId to move the task', async () => {
      const nextInitiativeId = `${testIds.initiative}-next`;
      const updateTaskDto: UpdateTaskDto = {
        initiativeId: nextInitiativeId,
      };

      const existingTask = TestUtils.createMockTaskResponseDto({
        status: 'BACKLOG',
      });
      (existingTask as any).initiative = {
        originatingProjectId: testIds.project,
      };

      const updatedTaskData = {
        ...mockTaskData,
        initiativeId: nextInitiativeId,
      };

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValueOnce({
        id: nextInitiativeId,
        originatingProjectId: 'proj-456',
      });

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: mockPrismaService.db.task.findFirst,
            findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
            update: jest.fn().mockResolvedValue(updatedTaskData),
          },
          initiative: {
            findFirst: mockPrismaService.db.initiative.findFirst,
          },
          taskSection: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      mockEventPublisher.publishInTransaction.mockResolvedValue(null);

      const result = await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        updateTaskDto,
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.UPDATED,
          payload: expect.objectContaining({
            initiativeId: nextInitiativeId,
          }),
        }),
      );
      expect(result.initiativeId).toBe(nextInitiativeId);
    });

    it('should throw NotFoundException when task does not exist', async () => {
      const updateTaskDto: UpdateTaskDto = {
        sections: TestUtils.createMockTaskSectionInputs({
          description: 'Updated description',
        }),
      };

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
        null,
      );

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should publish assignment event when assigneeId changes', async () => {
      const updateTaskDto: UpdateTaskDto = {
        assigneeId: testIds.user + '2',
      };

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        assigneeId: testIds.user,
      });

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: mockPrismaService.db.task.findFirst,
            findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
            update: jest.fn().mockResolvedValue({
              ...mockTaskData,
              assigneeId: testIds.user + '2',
            }),
          },
          initiative: {
            findFirst: mockPrismaService.db.initiative.findFirst,
          },
          taskSection: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        updateTaskDto,
      );

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.ASSIGNED,
          payload: expect.objectContaining({
            assigneeId: testIds.user + '2',
            previousAssigneeId: testIds.user,
          }),
        }),
      );
    });

    it('should prevent setting parentTaskId equal to taskId', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: testIds.task,
      };

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce(
        mockTaskData,
      );

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should validate parentTaskId on update', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'new-parent',
      };

      // First findFirst: existing-task lookup. Second findFirst: parent-task
      // ownership check returns null, triggering NotFoundException.
      (mockPrismaService.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockTaskData)
        .mockResolvedValueOnce(null);

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects updating a task to point at a GOAL parent', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'goal-parent',
      };

      // First findFirst: existing task lookup. Second findFirst: parent task
      // ownership check (now also tx-aware via passthrough).
      (mockPrismaService.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockTaskData)
        .mockResolvedValueOnce({ id: 'goal-parent', type: 'GOAL' });

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message:
          'A GOAL item cannot parent a STANDARD item under the configured work-item type definitions.',
      });
    });

    it('accepts a non-GOAL parent on update', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'feature-parent',
      };

      (mockPrismaService.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockTaskData)
        .mockResolvedValueOnce({ id: 'feature-parent', type: 'FEATURE' });

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: mockPrismaService.db.task.findFirst,
            findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
            update: jest.fn().mockResolvedValue({
              ...mockTaskData,
              parentTaskId: 'feature-parent',
            }),
          },
          initiative: {
            findFirst: mockPrismaService.db.initiative.findFirst,
          },
          taskSection: {
            findMany: jest.fn().mockResolvedValue([]),
            update: jest.fn(),
          },
        };
        return callback(mockTx);
      });

      const result = await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        updateTaskDto,
      );

      expect(result.parentTaskId).toBe('feature-parent');
    });

    it('rejects re-parenting a FEATURE under a STANDARD parent', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'standard-parent',
      };

      // First findFirst: existing task lookup — the FEATURE being moved.
      // Second findFirst: parent ownership check resolves a STANDARD parent,
      // which may hold STANDARD/BUG children but not a FEATURE.
      (mockPrismaService.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce({ ...mockTaskData, type: 'FEATURE' })
        .mockResolvedValueOnce({ id: 'standard-parent', type: 'STANDARD' });

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message:
          'A STANDARD item cannot parent a FEATURE item under the configured work-item type definitions.',
      });
    });

    it('rejects re-parenting under a parent whose type is unrecognized, naming the valid types', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'mystery-parent',
      };

      // First findFirst: existing-task lookup. Second findFirst: parent
      // ownership check resolves a parent carrying a type the project's
      // registry does not know. The type-recognition gate must reject it with
      // the same valid-types message creation produces, rather than letting
      // the pair decision trip requireEntry's generic registry-snapshot Error.
      (mockPrismaService.db.task.findFirst as jest.Mock)
        .mockResolvedValueOnce(mockTaskData)
        .mockResolvedValueOnce({ id: 'mystery-parent', type: 'NONSENSE' });

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        // The four built-in system types are always active, so the message
        // enumerates them for the caller.
        message: expect.stringMatching(
          /'NONSENSE' is not a usable type for this project\. Valid types: .*STANDARD/,
        ),
      });
    });

    it('clears a canonical Goal date with explicit null', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        type: 'GOAL',
      });
      (mockPrismaService.db.task.update as jest.Mock).mockResolvedValue({
        ...mockTaskData,
        type: 'GOAL',
        dueDate: null,
      });
      await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        { dueDate: null },
      );
      expect(mockPrismaService.db.task.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ dueDate: null }),
        }),
      );
    });

    it.each([
      undefined,
      '2026-12-01T00:00:00.000Z',
      '2026-12-15T00:00:00.000Z',
    ])('preserves or replaces a Goal date on edit: %s', async (dueDate) => {
      const existingDate = new Date('2026-11-01T00:00:00.000Z');
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        type: 'GOAL',
        dueDate: existingDate,
      });
      (mockPrismaService.db.task.update as jest.Mock).mockResolvedValue({
        ...mockTaskData,
        type: 'GOAL',
        dueDate: dueDate ? new Date(dueDate) : existingDate,
      });
      await service.update(
        testIds.organization,
        testIds.initiative,
        testIds.task,
        { name: 'Updated Goal', ...(dueDate === undefined ? {} : { dueDate }) },
      );
      const data = (mockPrismaService.db.task.update as jest.Mock).mock
        .calls[0][0].data;
      if (dueDate === undefined) expect(data).not.toHaveProperty('dueDate');
      else expect(data.dueDate).toEqual(new Date(dueDate));
    });

    it('retains project-effective required-date rejection when clearing', async () => {
      const required = jest
        .spyOn(workItemTypeRegistry, 'isScalarRequired')
        .mockReturnValue(true);
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        type: 'GOAL',
      });
      await expect(
        service.update(testIds.organization, testIds.initiative, testIds.task, {
          dueDate: null,
        }),
      ).rejects.toThrow('GOAL tasks require a dueDate.');
      required.mockRestore();
    });

    it('rejects setting parentTaskId on a GOAL task', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        type: 'GOAL',
      });

      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'some-parent-id',
      };

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects changing the task type after creation', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValueOnce({
        ...mockTaskData,
        type: 'STANDARD',
      });

      const updateTaskDto = {
        type: 'GOAL',
      } as unknown as UpdateTaskDto;

      await expect(
        service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          updateTaskDto,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('per-type section and placement parity (config-driven)', () => {
    // Regression net: every type opens with exactly the sections the registry
    // declares, rejects keys outside them on both create and section-update,
    // and enforces the placement rules from the registry.
    const SECTION_SEED_MATRIX: Array<
      [string, Partial<CreateTaskDto>, string[]]
    > = [
      ['STANDARD', {}, ['description', 'acceptanceCriteria']],
      [
        'FEATURE',
        { type: 'FEATURE', tag: 'product' },
        ['description', 'requirements'],
      ],
      ['BUG', { type: 'BUG' }, ['description']],
      [
        'GOAL',
        { type: 'GOAL', dueDate: '2026-12-31T00:00:00Z' },
        ['description'],
      ],
    ];

    it.each(SECTION_SEED_MATRIX)(
      'creates a %s task with exactly its configured sections',
      async (label, dtoOverrides, expectedKeys) => {
        const createTaskDto: CreateTaskDto = {
          name: `${label} task`,
          initiativeId: testIds.initiative,
          ...dtoOverrides,
        };

        const createSpy = jest.fn().mockResolvedValue({
          ...mockTaskData,
          ...dtoOverrides,
          dueDate: dtoOverrides.dueDate
            ? new Date(dtoOverrides.dueDate)
            : undefined,
          projectId: testIds.project,
        });
        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            initiative: {
              findFirst: jest.fn().mockResolvedValue({
                id: testIds.initiative,
                originatingProjectId: testIds.project,
              }),
            },
            task: { create: createSpy },
          };
          return callback(mockTx);
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

        await service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        );

        const payload = createSpy.mock.calls[0]![0];
        expect(
          payload.data.sections.create.map((s: { key: string }) => s.key),
        ).toEqual(expectedKeys);
      },
    );

    const UNSUPPORTED_KEY_MATRIX: Array<
      [string, Partial<CreateTaskDto>, string]
    > = [
      ['STANDARD', {}, 'requirements'],
      ['FEATURE', { type: 'FEATURE', tag: 'product' }, 'acceptanceCriteria'],
      ['BUG', { type: 'BUG' }, 'acceptanceCriteria'],
      [
        'GOAL',
        { type: 'GOAL', dueDate: '2026-12-31T00:00:00Z' },
        'requirements',
      ],
    ];

    it.each(UNSUPPORTED_KEY_MATRIX)(
      'rejects creating a %s task with an unsupported section key',
      async (label, dtoOverrides, badKey) => {
        const createTaskDto: CreateTaskDto = {
          name: `${label} task`,
          initiativeId: testIds.initiative,
          sections: [{ key: badKey, content: 'content' }],
          ...dtoOverrides,
        } as CreateTaskDto;

        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            initiative: {
              findFirst: jest.fn().mockResolvedValue({
                id: testIds.initiative,
                originatingProjectId: testIds.project,
              }),
            },
            task: { create: jest.fn() },
          };
          return callback(mockTx);
        });

        await expect(
          service.create(
            testIds.organization,
            testIds.initiative,
            createTaskDto,
            testIds.project,
          ),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: expect.stringMatching(/Unsupported task section key/),
        });
      },
    );

    it.each(UNSUPPORTED_KEY_MATRIX)(
      'rejects a section update on a %s task with an unsupported section key',
      async (label, dtoOverrides, badKey) => {
        (
          mockPrismaService.db.task.findFirst as jest.Mock
        ).mockResolvedValueOnce({
          ...mockTaskData,
          type: dtoOverrides.type ?? 'STANDARD',
        });

        const updateTaskDto = {
          sections: [{ key: badKey, content: 'content' }],
        } as UpdateTaskDto;

        await expect(
          service.update(
            testIds.organization,
            testIds.initiative,
            testIds.task,
            updateTaskDto,
          ),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: expect.stringMatching(/Unsupported task section key/),
        });
      },
    );

    const PLACEMENT_MATRIX: Array<[string, Partial<CreateTaskDto>]> = [
      ['STANDARD', {}],
      ['FEATURE', { type: 'FEATURE', tag: 'product' }],
      ['BUG', { type: 'BUG' }],
    ];

    it.each(PLACEMENT_MATRIX)(
      'accepts creating a %s task under a FEATURE parent',
      async (label, dtoOverrides) => {
        const createTaskDto: CreateTaskDto = {
          name: `${label} child`,
          parentTaskId: 'feature-parent',
          initiativeId: testIds.initiative,
          ...dtoOverrides,
        };

        const createSpy = jest.fn().mockResolvedValue({
          ...mockTaskData,
          ...dtoOverrides,
          parentTaskId: 'feature-parent',
          projectId: testIds.project,
        });
        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            initiative: {
              findFirst: jest.fn().mockResolvedValue({
                id: testIds.initiative,
                originatingProjectId: testIds.project,
              }),
            },
            task: {
              create: createSpy,
              findFirst: jest.fn().mockResolvedValue({
                id: 'feature-parent',
                type: 'FEATURE',
                projectId: testIds.project,
              }),
            },
          };
          return callback(mockTx);
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

        await service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        );

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              parentTaskId: 'feature-parent',
            }),
          }),
        );
      },
    );

    it('rejects creating a FEATURE under a STANDARD parent', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'feature under standard',
        type: 'FEATURE',
        tag: 'product',
        parentTaskId: 'standard-parent',
        initiativeId: testIds.initiative,
      };

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'standard-parent',
              type: 'STANDARD',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/cannot parent/),
      });
    });

    const STANDARD_CHILD_MATRIX: Array<[string, Partial<CreateTaskDto>]> = [
      ['STANDARD', {}],
    ];

    it.each(STANDARD_CHILD_MATRIX)(
      'accepts creating a %s task under a STANDARD parent',
      async (label, dtoOverrides) => {
        const createTaskDto: CreateTaskDto = {
          name: `${label} under standard`,
          parentTaskId: 'standard-parent',
          initiativeId: testIds.initiative,
          ...dtoOverrides,
        };

        const createSpy = jest.fn().mockResolvedValue({
          ...mockTaskData,
          ...dtoOverrides,
          parentTaskId: 'standard-parent',
          projectId: testIds.project,
        });
        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            initiative: {
              findFirst: jest.fn().mockResolvedValue({
                id: testIds.initiative,
                originatingProjectId: testIds.project,
              }),
            },
            task: {
              create: createSpy,
              findFirst: jest.fn().mockResolvedValue({
                id: 'standard-parent',
                type: 'STANDARD',
                projectId: testIds.project,
              }),
            },
          };
          return callback(mockTx);
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

        await service.create(
          testIds.organization,
          testIds.initiative,
          createTaskDto,
          testIds.project,
        );

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              parentTaskId: 'standard-parent',
            }),
          }),
        );
      },
    );

    it.each(['FEATURE', 'STANDARD'] as const)(
      'accepts creating a TASK_MONITOR under a canonical %s parent',
      async (parentType) => {
        const createSpy = jest.fn().mockResolvedValue({
          ...mockTaskData,
          type: 'TASK_MONITOR',
          parentTaskId: 'monitor-parent',
          projectId: testIds.project,
        });
        mockTransaction.mockImplementation(async (callback) =>
          callback({
            initiative: {
              findFirst: jest.fn().mockResolvedValue({
                id: testIds.initiative,
                originatingProjectId: testIds.project,
              }),
            },
            task: {
              create: createSpy,
              findFirst: jest.fn().mockResolvedValue({
                id: 'monitor-parent',
                type: parentType,
                projectId: testIds.project,
              }),
            },
          }),
        );
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

        await service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: `${parentType} monitor`,
            type: 'TASK_MONITOR',
            parentTaskId: 'monitor-parent',
            initiativeId: testIds.initiative,
          },
          testIds.project,
        );

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: 'TASK_MONITOR',
              parentTaskId: 'monitor-parent',
            }),
          }),
        );
      },
    );

    // Inline placement matrix for create + re-parent enforcement tests.
    // Mirrors the registry's built-in type rules. Parent/child compatibility
    // is owned by each child's allowedParentTypes declaration.
    type ConfigTaskType =
      | 'STANDARD'
      | 'FEATURE'
      | 'BUG'
      | 'GOAL'
      | 'workflow'
      | 'workflow_step';
    const PLACEMENT_RULES: Record<
      ConfigTaskType,
      {
        allowedParentTypes: ConfigTaskType[];
      }
    > = {
      STANDARD: {
        allowedParentTypes: ['FEATURE', 'STANDARD'],
      },
      FEATURE: {
        allowedParentTypes: ['FEATURE'],
      },
      BUG: {
        allowedParentTypes: ['FEATURE'],
      },
      GOAL: {
        allowedParentTypes: [],
      },
      workflow: {
        allowedParentTypes: ['FEATURE', 'STANDARD'],
      },
      workflow_step: {
        allowedParentTypes: ['workflow'],
      },
    };
    const ALL_TASK_TYPES = Object.keys(PLACEMENT_RULES) as ConfigTaskType[];

    const dtoOverridesForChildType = (
      childType: ConfigTaskType,
    ): Partial<CreateTaskDto> => {
      if (childType === 'FEATURE') return { type: 'FEATURE', tag: 'product' };
      if (childType === 'BUG') return { type: 'BUG' };
      if (childType === 'GOAL')
        return { type: 'GOAL', dueDate: '2026-12-31T00:00:00Z' };
      if (childType === 'workflow' || childType === 'workflow_step') {
        return { type: childType };
      }
      return {};
    };

    // Child candidates are types whose child-owned declaration names at least
    // one allowed parent type.
    const CHILD_CANDIDATES = ALL_TASK_TYPES.filter(
      (t) => PLACEMENT_RULES[t].allowedParentTypes.length > 0,
    );

    const INVALID_PAIR_CASES = ALL_TASK_TYPES.flatMap((parent) =>
      CHILD_CANDIDATES.filter(
        (child) => !PLACEMENT_RULES[child].allowedParentTypes.includes(parent),
      ).map((child) => ({ parent, child })),
    );

    const VALID_PAIR_CASES = ALL_TASK_TYPES.flatMap((parent) =>
      CHILD_CANDIDATES.filter((child) =>
        PLACEMENT_RULES[child].allowedParentTypes.includes(parent),
      ).map((child) => ({ parent, child })),
    );

    const setupCreateForParent = (parentType: ConfigTaskType) => {
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'parent-id',
              type: parentType,
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });
    };

    const buildCreateDto = (childType: ConfigTaskType): CreateTaskDto => ({
      name: `${childType} child`,
      parentTaskId: 'parent-id',
      initiativeId: testIds.initiative,
      ...dtoOverridesForChildType(childType),
    });

    // ── Child-owned per-pair allow-list ──

    it.each(INVALID_PAIR_CASES)(
      'create: rejects a $child child under a $parent parent (allow-list rule)',
      async ({ parent, child }) => {
        setupCreateForParent(parent);
        await expect(
          service.create(
            testIds.organization,
            testIds.initiative,
            buildCreateDto(child),
            testIds.project,
          ),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: `A ${parent} item cannot parent a ${child} item under the configured work-item type definitions.`,
        });
      },
    );

    it.each(INVALID_PAIR_CASES)(
      're-parent: rejects moving a $child task under a $parent parent (allow-list rule)',
      async ({ parent, child }) => {
        (mockPrismaService.db.task.findFirst as jest.Mock)
          .mockResolvedValueOnce({ ...mockTaskData, type: child })
          .mockResolvedValueOnce({ id: 'parent-id', type: parent });

        await expect(
          service.update(
            testIds.organization,
            testIds.initiative,
            testIds.task,
            { parentTaskId: 'parent-id' } as UpdateTaskDto,
          ),
        ).rejects.toMatchObject({
          constructor: BadRequestException,
          message: `A ${parent} item cannot parent a ${child} item under the configured work-item type definitions.`,
        });
      },
    );

    // ── Valid pairs (config-driven happy path) ──

    it.each(VALID_PAIR_CASES)(
      'create: accepts a $child child under a $parent parent',
      async ({ parent, child }) => {
        const createSpy = jest.fn().mockResolvedValue({
          ...mockTaskData,
          ...dtoOverridesForChildType(child),
          parentTaskId: 'parent-id',
          projectId: testIds.project,
        });
        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            initiative: {
              findFirst: jest.fn().mockResolvedValue({
                id: testIds.initiative,
                originatingProjectId: testIds.project,
              }),
            },
            task: {
              create: createSpy,
              findFirst: jest.fn().mockResolvedValue({
                id: 'parent-id',
                type: parent,
                projectId: testIds.project,
              }),
            },
          };
          return callback(mockTx);
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

        await service.create(
          testIds.organization,
          testIds.initiative,
          buildCreateDto(child),
          testIds.project,
        );

        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ parentTaskId: 'parent-id' }),
          }),
        );
      },
    );

    it.each(VALID_PAIR_CASES)(
      're-parent: accepts moving a $child task under a $parent parent',
      async ({ parent, child }) => {
        (mockPrismaService.db.task.findFirst as jest.Mock)
          .mockResolvedValueOnce({ ...mockTaskData, type: child })
          .mockResolvedValueOnce({ id: 'parent-id', type: parent });

        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            task: {
              findFirst: mockPrismaService.db.task.findFirst,
              findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
              update: jest.fn().mockResolvedValue({
                ...mockTaskData,
                type: child,
                parentTaskId: 'parent-id',
              }),
            },
            initiative: {
              findFirst: mockPrismaService.db.initiative.findFirst,
            },
            taskSection: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn(),
            },
          };
          return callback(mockTx);
        });

        const result = await service.update(
          testIds.organization,
          testIds.initiative,
          testIds.task,
          { parentTaskId: 'parent-id' } as UpdateTaskDto,
        );

        expect(result.parentTaskId).toBe('parent-id');
      },
    );
  });

  describe('custom-typed creation (registry-derived rules)', () => {
    it.each([
      {
        forced: true,
        initial: WorkStatus.ACTIVE,
        requested: undefined,
        expected: WorkStatus.ACTIVE,
      },
      {
        forced: true,
        initial: WorkStatus.ACTIVE,
        requested: WorkStatus.BACKLOG,
        expected: WorkStatus.ACTIVE,
      },
      {
        forced: true,
        initial: WorkStatus.ACTIVE,
        requested: WorkStatus.READY,
        expected: WorkStatus.ACTIVE,
      },
      {
        forced: true,
        initial: WorkStatus.BACKLOG,
        requested: WorkStatus.ACTIVE,
        expected: WorkStatus.BACKLOG,
      },
      {
        forced: false,
        initial: WorkStatus.BACKLOG,
        requested: WorkStatus.READY,
        expected: WorkStatus.READY,
      },
      {
        forced: false,
        initial: WorkStatus.BACKLOG,
        requested: undefined,
        expected: WorkStatus.BACKLOG,
      },
    ])(
      'persists Mockup policy $initial (forced=$forced, requested=$requested)',
      async ({ forced, initial, requested, expected }) => {
        // Registry tests prove canonical/override source selection; exercise the
        // same creation path with each resulting effective policy here.
        if (initial !== WorkStatus.ACTIVE || !forced) {
          jest
            .spyOn(workItemTypeRegistry, 'getInitialStatusPolicy')
            .mockReturnValue({
              initialStatus: initial,
              hasSetInitialStatus: forced,
            });
        }
        const createSpy = jest.fn().mockImplementation(async ({ data }) => ({
          ...mockTaskData,
          type: data.type,
          status: data.status,
        }));
        buildTx(createSpy);
        const result = await service.create(
          testIds.organization,
          testIds.initiative,
          { name: 'Interface preview', type: 'mockup', status: requested },
          testIds.project,
        );
        expect(createSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type: 'mockup', status: expected }),
          }),
        );
        expect(result.status).toBe(expected);
      },
    );

    // End-to-end proof of step 3: an accepted, project-scoped custom type
    // (MARKETING) flows through create with its key preserved and every
    // per-type rule resolved from its OWN stored definition via the
    // projectId-threaded registry accessors — not collapsed to STANDARD and
    // not read off the system-only snapshot.
    const buildTx = (createSpy: jest.Mock, parentFind = jest.fn()) => {
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: { create: createSpy, findFirst: parentFind },
        };
        return callback(mockTx);
      });
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));
    };

    it('persists the custom type key and derives its sections from the custom definition', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'MARKETING',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        { name: 'Launch campaign', type: 'MARKETING' as CreateTaskDto['type'] },
        testIds.project,
      );

      const payload = createSpy.mock.calls[0]![0];
      // Key preserved verbatim, not coerced to STANDARD.
      expect(payload.data.type).toBe('MARKETING');
      // Sections derive from MARKETING's definition (description + requirements),
      // distinct from STANDARD's description + acceptanceCriteria.
      expect(
        payload.data.sections.create.map((s: { key: string }) => s.key),
      ).toEqual(['description', 'requirements']);
    });

    it('persists explicit Diagram defaults through ordinary creation', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'DIAGRAM',
        projectId: testIds.project,
      });
      buildTx(createSpy);
      await service.create(
        testIds.organization,
        testIds.initiative,
        { name: 'System overview', type: 'DIAGRAM' },
        testIds.project,
      );
      expect(createSpy.mock.calls[0][0].data.sections.create).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'diagramMetadata',
            materializedMarkdown: JSON.stringify({
              kind: 'GENERAL',
              level: 'OVERVIEW',
            }),
          }),
        ]),
      );
    });

    it('rejects a cross-project Diagram parent and excludes archived parent candidates', async () => {
      const createSpy = jest.fn();
      const parentFind = jest.fn().mockResolvedValue({
        id: testIds.task,
        type: 'FEATURE',
        projectId: 'another-project',
      });
      buildTx(createSpy, parentFind);
      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          { name: 'Wrong parent', type: 'DIAGRAM', parentTaskId: testIds.task },
          testIds.project,
        ),
      ).rejects.toThrow('Diagram parent must belong to the same project');
      expect(parentFind).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: testIds.task,
            organizationId: testIds.organization,
            archivedAt: null,
            status: { not: WorkStatus.ARCHIVED },
          },
        }),
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects an invalid Diagram kind/level before persistence', async () => {
      const createSpy = jest.fn();
      buildTx(createSpy);
      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Invalid view',
            type: 'DIAGRAM',
            sections: [
              {
                key: 'diagramMetadata',
                content: { kind: 'PROCESS', level: 'CODE' },
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toThrow('Diagram kind and level combination is not allowed');
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects a section key outside the custom type definition', async () => {
      buildTx(jest.fn());

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Launch campaign',
            type: 'MARKETING' as CreateTaskDto['type'],
            // acceptanceCriteria is not a MARKETING section.
            sections: [{ key: 'acceptanceCriteria', content: 'x' }],
          } as CreateTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/Unsupported task section key/),
      });
    });

    it('canonicalizes a custom schema-backed JSON section on create', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_JSON',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Schema-backed section',
          type: 'CUSTOM_JSON' as CreateTaskDto['type'],
          sections: [
            {
              key: 'payload',
              content: VALID_SCHEMA_BACKED_SECTION_CONTENT,
            },
          ],
        },
        testIds.project,
      );

      const createdSections = createSpy.mock.calls[0]![0].data.sections.create;
      expect(createdSections).toEqual([
        expect.objectContaining({
          key: 'payload',
          materializedMarkdown: JSON.stringify(
            VALID_SCHEMA_BACKED_SECTION_CONTENT,
          ),
        }),
      ]);
    });

    it('round-trips an HTML/CSS section on create and accepts empty CSS', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_HTML_CSS',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'HTML/CSS section',
          type: 'CUSTOM_HTML_CSS' as CreateTaskDto['type'],
          sections: [
            {
              key: 'preview',
              content: { css: '', html: '<section>Preview</section>' },
            },
          ],
        },
        testIds.project,
      );

      expect(createSpy.mock.calls[0]![0].data.sections.create).toEqual([
        expect.objectContaining({
          key: 'preview',
          materializedMarkdown:
            '{"html":"<section>Preview</section>","css":""}',
        }),
      ]);
    });

    it('preserves a configured HTML/CSS sizeKey and rejects unknown selections', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_HTML_CSS',
        projectId: testIds.project,
      });
      buildTx(createSpy);
      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Sized preview',
          type: 'CUSTOM_HTML_CSS' as CreateTaskDto['type'],
          sections: [
            {
              key: 'preview',
              content: { html: '<main />', css: '', sizeKey: 'panel' },
            },
          ],
        },
        testIds.project,
      );
      expect(
        createSpy.mock.calls[0]![0].data.sections.create[0]
          .materializedMarkdown,
      ).toBe('{"html":"<main />","css":"","sizeKey":"panel"}');
      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Bad size',
            type: 'CUSTOM_HTML_CSS' as CreateTaskDto['type'],
            sections: [
              {
                key: 'preview',
                content: { html: '', css: '', sizeKey: 'missing' },
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toThrow("unknown sizeKey 'missing'");
    });

    it('round-trips a structured mockup document with identities, order, nesting, and presentation', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_STRUCTURED_MOCKUP',
        projectId: testIds.project,
      });
      buildTx(createSpy);
      const document = {
        schemaVersion: 'work-item-structured-mockup.v3',
        revision: 1,
        sizeKey: 'panel',
        annotations: [],
        content: [
          {
            type: 'row',
            props: {
              id: 'actions',
              width: { mode: 'fill' },
              height: { mode: 'content' },
              gap: 8,
              padding: 0,
              justify: 'spread',
              align: 'stretch',
            },
            children: [
              {
                type: 'button',
                props: {
                  id: 'cancel',
                  width: { mode: 'fit' },
                  height: { mode: 'content' },
                  label: 'Cancel',
                },
              },
              {
                type: 'button',
                props: {
                  id: 'save',
                  width: { mode: 'fit' },
                  height: { mode: 'content' },
                  label: 'Save',
                },
              },
            ],
          },
        ],
      };

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Structured mockup',
          type: 'CUSTOM_STRUCTURED_MOCKUP' as CreateTaskDto['type'],
          sections: [{ key: 'mockup', content: document }],
        },
        testIds.project,
      );

      const persisted = createSpy.mock.calls[0]![0].data.sections.create[0]
        .materializedMarkdown as string;
      expect(JSON.parse(persisted)).toEqual(document);
    });

    it.each([
      null,
      '<section>Preview</section>',
      { html: '<section>Preview</section>' },
      { html: '<section>Preview</section>', css: '', extra: true },
      { html: 42, css: '' },
      { html: '<section>Preview</section>', css: 42 },
    ])('rejects malformed HTML/CSS section content %#', async (content) => {
      buildTx(jest.fn());

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Broken HTML/CSS section',
            type: 'CUSTOM_HTML_CSS' as CreateTaskDto['type'],
            sections: [{ key: 'preview', content }],
          } as CreateTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining("Invalid HTML/CSS section 'preview'"),
      });
    });

    it('leaves an omitted HTML/CSS section empty instead of inventing source', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_HTML_CSS',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'HTML/CSS section shell',
          type: 'CUSTOM_HTML_CSS' as CreateTaskDto['type'],
        },
        testIds.project,
      );

      expect(createSpy.mock.calls[0]![0].data.sections.create).toEqual([
        expect.objectContaining({ key: 'preview', materializedMarkdown: null }),
      ]);
    });

    it('validates graph layout through the same schema-backed section boundary for a differently named graph type', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'GRAPH_ROOT',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Generic graph root',
          type: 'GRAPH_ROOT' as CreateTaskDto['type'],
          sections: [
            { key: 'graphLayout', content: VALID_GRAPH_LAYOUT_CONTENT },
          ],
        },
        testIds.project,
      );

      expect(createSpy.mock.calls[0]![0].data.sections.create).toContainEqual(
        expect.objectContaining({
          key: 'graphLayout',
          materializedMarkdown: JSON.stringify(VALID_GRAPH_LAYOUT_CONTENT),
        }),
      );
    });

    it('rejects invalid graph layout without a graph-type-specific validator path', async () => {
      buildTx(jest.fn());

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Broken generic graph root',
            type: 'GRAPH_ROOT' as CreateTaskDto['type'],
            sections: [
              {
                key: 'graphLayout',
                content: {
                  schemaVersion: 'work-item-graph-layout.v1',
                  nodes: [
                    {
                      node: {
                        kind: 'persistedWorkItem',
                        workItemId: 'not-a-uuid',
                      },
                      position: { x: 0, y: 0 },
                    },
                  ],
                },
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining(
          `Invalid JSON section 'graphLayout' (${WORK_ITEM_GRAPH_LAYOUT_SCHEMA_REF})`,
        ),
      });
    });

    it('does not invent invalid JSON content when an optional schema-backed section is omitted on create', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_JSON',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Schema-backed section shell',
          type: 'CUSTOM_JSON' as CreateTaskDto['type'],
        },
        testIds.project,
      );

      const createdSections = createSpy.mock.calls[0]![0].data.sections.create;
      expect(createdSections).toEqual([
        expect.objectContaining({
          key: 'payload',
          materializedMarkdown: null,
        }),
      ]);
    });

    it('rejects invalid content for a custom schema-backed JSON section on create', async () => {
      buildTx(jest.fn());

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Broken schema-backed section',
            type: 'CUSTOM_JSON' as CreateTaskDto['type'],
            sections: [{ key: 'payload', content: { executionPlan: [] } }],
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining(
          `Invalid JSON section 'payload' (${TASK_MONITOR_EXECUTION_DEFINITION_SCHEMA_REF})`,
        ),
      });
    });

    it('rejects a schema-backed execution definition without an execution plan on create', async () => {
      buildTx(jest.fn());
      const { executionPlan: _executionPlan, ...definitionWithoutPlan } =
        VALID_SCHEMA_BACKED_SECTION_CONTENT;

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Missing execution plan',
            type: 'CUSTOM_JSON' as CreateTaskDto['type'],
            sections: [
              {
                key: 'payload',
                content: definitionWithoutPlan,
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('executionPlan'),
      });
    });

    it('rejects task status mirrors in a schema-backed section on create', async () => {
      buildTx(jest.fn());
      const copiedStatusDefinition = structuredClone(
        VALID_SCHEMA_BACKED_SECTION_CONTENT,
      ) as Record<string, unknown>;
      copiedStatusDefinition.executionPlan = [
        {
          ...VALID_SCHEMA_BACKED_SECTION_CONTENT.executionPlan[0],
          taskStatus: 'COMPLETED',
        },
      ];

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Copied status',
            type: 'CUSTOM_JSON' as CreateTaskDto['type'],
            sections: [
              {
                key: 'payload',
                content: copiedStatusDefinition,
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining('must NOT have additional properties'),
      });
    });

    it('preserves a valid image section on create', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_IMAGE',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Image item',
          type: 'CUSTOM_IMAGE' as CreateTaskDto['type'],
          sections: [{ key: 'image', content: VALID_IMAGE_SECTION_CONTENT }],
        },
        testIds.project,
      );

      expect(createSpy.mock.calls[0]![0].data.sections.create).toEqual([
        expect.objectContaining({
          key: 'image',
          materializedMarkdown: JSON.stringify(VALID_IMAGE_SECTION_CONTENT),
        }),
      ]);
    });

    it('creates an image-typed item with an absent image and no placeholder', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'CUSTOM_IMAGE',
        projectId: testIds.project,
      });
      buildTx(createSpy);

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Imageless item',
          type: 'CUSTOM_IMAGE' as CreateTaskDto['type'],
        },
        testIds.project,
      );

      expect(createSpy.mock.calls[0]![0].data.sections.create).toEqual([
        expect.objectContaining({ key: 'image', materializedMarkdown: null }),
      ]);
    });

    it('rejects an image whose bytes do not match its MIME type on create', async () => {
      const createSpy = jest.fn();
      buildTx(createSpy);

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Mislabelled image',
            type: 'CUSTOM_IMAGE' as CreateTaskDto['type'],
            sections: [
              {
                key: 'image',
                content: {
                  ...VALID_IMAGE_SECTION_CONTENT,
                  mimeType: 'image/webp',
                },
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining(
          `Invalid JSON section 'image' (${IMAGE_SECTION_CONTENT_SCHEMA_REF})`,
        ),
      });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('rejects unsupported schemaRefs before persisting a JSON section', async () => {
      buildTx(jest.fn());

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Unsupported schema section',
            type: 'UNSUPPORTED_JSON' as CreateTaskDto['type'],
            sections: [
              {
                key: 'payload',
                content: VALID_SCHEMA_BACKED_SECTION_CONTENT,
              },
            ],
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringContaining(
          '#/components/schemas/UnsupportedSection',
        ),
      });
    });

    it('enforces the custom type forbidden-scalar rule (tag is forbidden)', async () => {
      buildTx(jest.fn());

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Launch campaign',
            type: 'MARKETING' as CreateTaskDto['type'],
            tag: 'product',
          } as CreateTaskDto,
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(/tag is only valid on FEATURE/),
      });
    });

    it('accepts a custom-typed child when the child declares the parent', async () => {
      const createSpy = jest.fn().mockResolvedValue({
        ...mockTaskData,
        type: 'MARKETING',
        parentTaskId: 'feature-parent',
        projectId: testIds.project,
      });
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: createSpy,
            findFirst: jest.fn().mockResolvedValue({
              id: 'feature-parent',
              type: 'FEATURE',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });
      (
        mockPrismaService.db.taskSection.findMany as jest.Mock
      ).mockResolvedValue(createTaskSectionRecords(mockTaskData.id));

      await service.create(
        testIds.organization,
        testIds.initiative,
        {
          name: 'Launch campaign',
          type: 'MARKETING' as CreateTaskDto['type'],
          parentTaskId: 'feature-parent',
        },
        testIds.project,
      );
      expect(createSpy).toHaveBeenCalled();
    });

    it('rejects a custom-typed child under a parent type it does not declare', async () => {
      // MARKETING declares only FEATURE as an allowed parent. A STANDARD parent
      // does not appear in MARKETING's allowedParentTypes, so the placement gate rejects it by name
      // — the child-side axis is a real constraint, not just a permit.
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.initiative,
              originatingProjectId: testIds.project,
            }),
          },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'standard-parent',
              type: 'STANDARD',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          testIds.initiative,
          {
            name: 'Launch campaign',
            type: 'MARKETING' as CreateTaskDto['type'],
            parentTaskId: 'standard-parent',
          },
          testIds.project,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message:
          'A STANDARD item cannot parent a MARKETING item under the configured work-item type definitions.',
      });
    });

    it('gates an unrecognized type even when the project is derived from the parent', async () => {
      // No explicit/initiative project: projectId is settled from the parent.
      // The type-active gate must still fire (after projectId resolves), so an
      // unknown key yields the named-types BadRequest rather than a downstream
      // registry snapshot-miss Error.
      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          initiative: { findFirst: jest.fn() },
          task: {
            create: jest.fn(),
            findFirst: jest.fn().mockResolvedValue({
              id: 'parent-id',
              type: 'STANDARD',
              projectId: testIds.project,
            }),
          },
        };
        return callback(mockTx);
      });

      await expect(
        service.create(
          testIds.organization,
          undefined,
          {
            name: 'Mystery child',
            type: 'NONSENSE' as CreateTaskDto['type'],
            parentTaskId: 'parent-id',
          },
          undefined as unknown as ProjectId,
        ),
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        message: expect.stringMatching(
          /'NONSENSE' is not a usable type for this project/,
        ),
      });
    });
  });

  describe('remove', () => {
    it('should archive task and publish archived event', async () => {
      const existingTask = TestUtils.createMockTaskResponseDto();
      const archivedDate = new Date();
      const archivedTaskData = {
        ...mockTaskData,
        archivedAt: archivedDate,
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(existingTask);

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            update: jest.fn().mockResolvedValue(archivedTaskData),
          },
        };
        return callback(mockTx);
      });

      const result = await service.remove(testIds.organization, testIds.task);

      expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: EVENT_TYPES.TASK.ARCHIVED,
          payload: expect.objectContaining({
            archivedAt: archivedDate.toISOString(),
          }),
        }),
      );

      expect(result.archivedAt).toBeDefined();
    });

    it('should throw NotFoundException when task does not exist', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.remove(testIds.organization, testIds.task),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createFromDrafts', () => {
    const createMockDraft = (
      overrides: Partial<TaskDraft> = {},
    ): TaskDraft => ({
      id: testIds.task,
      title: 'Test Task',
      description: 'Task description',
      acceptanceCriteria: 'Success criteria',
      priority: 'medium' as const,
      estimatedEffort: 'medium' as const,
      category: 'development',
      reasoning: 'Task reasoning',
      influences: [],
      ...overrides,
    });

    it('should throw BadRequestException when drafts array is empty', async () => {
      await expect(
        service.createFromDrafts(
          [],
          testIds.organization,
          testIds.initiative,
          testIds.conversation,
        ),
      ).rejects.toThrow('Task drafts array cannot be empty');
    });

    it('should throw NotFoundException when initiative does not exist', async () => {
      const drafts = [createMockDraft()];

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.createFromDrafts(
          drafts,
          testIds.organization,
          testIds.initiative,
        ),
      ).rejects.toThrow(
        `Initiative ${testIds.initiative} not found in organization ${testIds.organization}`,
      );
    });

    it('should map priority enums correctly', async () => {
      const drafts = [
        createMockDraft({ priority: 'low' }),
        createMockDraft({ id: testIds.task + '2', priority: 'medium' }),
        createMockDraft({ id: testIds.task + '3', priority: 'high' }),
      ];

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        originatingProjectId: testIds.project,
      });

      (mockPrismaService.db.task.create as jest.Mock)
        .mockResolvedValueOnce({ ...mockTaskData, priority: 'LOW' })
        .mockResolvedValueOnce({
          ...mockTaskData,
          id: testIds.task + '2',
          priority: 'MEDIUM',
        })
        .mockResolvedValueOnce({
          ...mockTaskData,
          id: testIds.task + '3',
          priority: 'HIGH',
        });

      await service.createFromDrafts(
        drafts,
        testIds.organization,
        testIds.initiative,
      );

      expect(mockPrismaService.db.task.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'LOW' }),
        }),
      );
      expect(mockPrismaService.db.task.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'MEDIUM' }),
        }),
      );
      expect(mockPrismaService.db.task.create).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          data: expect.objectContaining({ priority: 'HIGH' }),
        }),
      );
    });

    it('should continue even if artifact storage fails', async () => {
      const drafts = [createMockDraft()];

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        originatingProjectId: testIds.project,
      });

      (mockPrismaService.db.task.create as jest.Mock).mockResolvedValue({
        ...mockTaskData,
      });

      mockTaskArtifactService.storeOriginalGeneration.mockRejectedValue(
        new Error('Artifact storage failed'),
      );

      // Should not throw - artifact failure is non-fatal
      const result = await service.createFromDrafts(
        drafts,
        testIds.organization,
        testIds.initiative,
      );

      expect(result).toHaveLength(1);
      const [task] = result;
      if (!task) {
        throw new Error('Expected task result');
      }
      expect(task.id).toBe(mockTaskData.id);
    });

    it('should handle optional estimatedEffort field', async () => {
      const drafts = [
        createMockDraft({ estimatedEffort: undefined }),
        createMockDraft({
          id: testIds.task + '2',
          estimatedEffort: 'large',
        }),
      ];

      (
        mockPrismaService.db.initiative.findFirst as jest.Mock
      ).mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        originatingProjectId: testIds.project,
      });

      (mockPrismaService.db.task.create as jest.Mock)
        .mockResolvedValueOnce(mockTaskData)
        .mockResolvedValueOnce({ ...mockTaskData, id: testIds.task + '2' });

      const result = await service.createFromDrafts(
        drafts,
        testIds.organization,
        testIds.initiative,
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('Adapter Methods for Unified Refinement System', () => {
    beforeEach(() => {
      mockPrismaService.db.task = {
        ...mockPrismaService.db.task,
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      };
    });

    describe('findOneForAdapter', () => {
      it('should find task by ID for unified work item interface', async () => {
        const mockDbTask = {
          ...mockTaskData,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        };

        const expectedResult = {
          ...mockTaskData,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
          designDocCount: null as number | null,
          codingSessionCount: null as number | null,
          agentSessionCount: null as number | null,
          hasProposalSupport: true,
          sections: createTaskMaterializedSections(
            testIds.task,
            defaultSectionContent,
          ),
        };

        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
          mockDbTask,
        );

        const result = await service.findOneForAdapter(
          testIds.task,
          testIds.organization,
        );

        expect(result).toEqual(expectedResult);
        expect(mockPrismaService.db.task.findFirst).toHaveBeenCalledWith({
          where: {
            id: testIds.task,
            organizationId: testIds.organization,
            archivedAt: null,
          },
        });
      });

      it('should return null when task not found', async () => {
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
          null,
        );

        const result = await service.findOneForAdapter(
          testIds.task,
          testIds.organization,
        );

        expect(result).toBeNull();
      });

      it('should handle database errors gracefully', async () => {
        const dbError = new Error('Database connection failed');
        (mockPrismaService.db.task.findFirst as jest.Mock).mockRejectedValue(
          dbError,
        );

        await expect(
          service.findOneForAdapter(testIds.task, testIds.organization),
        ).rejects.toThrow(dbError);
      });
    });

    describe('updateForAdapter', () => {
      const updateData = {
        name: 'Updated Task Name',
        sections: TestUtils.createMockTaskSectionInputs({
          description: 'Updated description',
        }).filter((section) => section.key === 'description'),
        priority: 'HIGH' as const,
      };

      it('should update task with event publishing and filter undefined values', async () => {
        const existingTask = { ...mockTaskData };
        const updatedDbTask = {
          ...mockTaskData,
          ...updateData,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        };

        const expectedResult = {
          ...mockTaskData,
          ...updateData,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
          designDocCount: null as number | null,
          codingSessionCount: null as number | null,
          agentSessionCount: null as number | null,
          hasProposalSupport: true,
          sections: createTaskMaterializedSections(testIds.task, {
            ...defaultSectionContent,
            description: 'Updated description',
          }),
        };

        // Mock findOneForAdapter to return existing task
        const existingTaskWithInitiative = {
          ...existingTask,
          initiative: { originatingProjectId: testIds.project },
        };
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...existingTaskWithInitiative,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(
          createTaskSectionRecords(testIds.task, {
            description: 'Updated description',
          }),
        );

        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            task: {
              findFirst: mockPrismaService.db.task.findFirst,
              findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
              update: jest.fn().mockResolvedValue(updatedDbTask),
            },
            taskSection: {
              findMany: jest
                .fn()
                .mockImplementation(
                  (args?: { where?: { key?: { in?: string[] } } }) => {
                    const keys = args?.where?.key?.in ?? [];
                    if (keys.length === updateData.sections.length) {
                      return createUpdateSectionRows(
                        testIds.task,
                        updateData.sections,
                      );
                    }
                    return createTaskSectionRecords(testIds.task, {
                      description: 'Updated description',
                    });
                  },
                ),
              update: jest.fn(),
            },
            taskSectionHistory: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
            },
          };
          return callback(mockTx);
        });

        mockEventPublisher.publishInTransaction.mockResolvedValue(null);

        const result = await service.updateForAdapter(
          testIds.task,
          updateData,
          testIds.organization,
        );

        expect(result).toEqual(expectedResult);
        expect(mockPrismaService.$transaction).toHaveBeenCalled();
        expect(mockEventPublisher.publishInTransaction).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            type: EVENT_TYPES.TASK.UPDATED,
            aggregateId: testIds.task,
            payload: expect.objectContaining({
              update: expect.objectContaining({
                name: 'Updated Task Name',
                priority: 'HIGH',
              }),
            }),
          }),
        );
      });

      // Step-2 gate: this path permits a genuine type change, so a provided
      // type is asserted active for the project before resolveTaskType (which
      // now preserves it verbatim) lets it reach the section/parentage
      // accessors. An unknown key throws the named-types error up front.
      it('rejects an unrecognized type with a message naming the valid types', async () => {
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(testIds.task));

        await expect(
          service.updateForAdapter(
            testIds.task,
            { type: 'NONSENSE' as UpdateTaskDto['type'] },
            testIds.organization,
          ),
        ).rejects.toThrow(
          /'NONSENSE' is not a usable type for this project\. Valid types: .*STANDARD/,
        );
        // The gate fires before the update transaction is opened.
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      it('rejects changing a parentless task to a type that requires a parent', async () => {
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(testIds.task));

        await expect(
          service.updateForAdapter(
            testIds.task,
            { type: 'workflow_step' },
            testIds.organization,
          ),
        ).rejects.toThrow(
          'workflow_step items require a structural parent under the configured work-item type definition.',
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      });

      // Parity: a built-in type passes the gate and persists verbatim — step-1
      // no longer collapses it, and the gate accepts the always-active built-in.
      it('preserves a built-in type through the active-type gate', async () => {
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(testIds.task));

        const updateSpy = jest
          .fn()
          .mockResolvedValue({ ...mockTaskData, type: 'STANDARD' });
        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            task: {
              findFirst: mockPrismaService.db.task.findFirst,
              findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
              update: updateSpy,
            },
            taskSection: {
              findMany: jest
                .fn()
                .mockResolvedValue(createTaskSectionRecords(testIds.task)),
              update: jest.fn(),
            },
          };
          return callback(mockTx);
        });
        mockEventPublisher.publishInTransaction.mockResolvedValue(null);

        await service.updateForAdapter(
          testIds.task,
          { type: 'STANDARD' },
          testIds.organization,
        );

        expect(updateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ type: 'STANDARD' }),
          }),
        );
      });

      it('triggers plan lifecycle when updateForAdapter changes status', async () => {
        const updateStatusData = {
          status: 'ACTIVE' as const,
        };
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(testIds.task));

        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            task: {
              update: jest.fn().mockResolvedValue({
                ...mockTaskData,
                ...updateStatusData,
                createdAt: new Date('2024-01-01T00:00:00.000Z'),
                updatedAt: new Date('2024-01-01T00:00:00.000Z'),
                archivedAt: null as Date | null,
                dueDate: null as Date | null,
              }),
            },
            initiative: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ originatingProjectId: testIds.project }),
            },
            taskSection: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn(),
            },
          };
          return callback(mockTx);
        });

        await service.updateForAdapter(
          testIds.task,
          updateStatusData,
          testIds.organization,
        );
      });

      it('should filter out undefined values from update data', async () => {
        const updateDataWithUndefined = {
          name: 'Updated Name',
          sections: TestUtils.createMockTaskSectionInputs({
            description: 'Updated description',
          }).filter((section) => section.key === 'description'),
          priority: 'HIGH' as const,
          assigneeId: undefined as string | undefined,
        };
        const expectedFilteredData = {
          name: 'Updated Name',
          priority: 'HIGH' as const,
        };
        const updatedDbTask = {
          ...mockTaskData,
          ...expectedFilteredData,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        };

        // Mock findOneForAdapter to return existing task
        const existingTaskWithInitiative = {
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
        };
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...existingTaskWithInitiative,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(
          createTaskSectionRecords(testIds.task, {
            description: 'Updated description',
          }),
        );

        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            task: {
              findFirst: mockPrismaService.db.task.findFirst,
              findUniqueOrThrow: mockPrismaService.db.task.findUniqueOrThrow,
              update: jest.fn().mockResolvedValue(updatedDbTask),
            },
            taskSection: {
              findMany: jest
                .fn()
                .mockImplementation(
                  (args?: { where?: { key?: { in?: string[] } } }) => {
                    const keys = args?.where?.key?.in ?? [];
                    if (
                      keys.length === updateDataWithUndefined.sections.length
                    ) {
                      return createUpdateSectionRows(
                        testIds.task,
                        updateDataWithUndefined.sections,
                      );
                    }
                    return createTaskSectionRecords(testIds.task, {
                      description: 'Updated description',
                    });
                  },
                ),
              update: jest.fn(),
            },
            taskSectionHistory: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn(),
            },
          };
          return callback(mockTx);
        });

        await service.updateForAdapter(
          testIds.task,
          updateDataWithUndefined,
          testIds.organization,
        );

        expect(mockTransaction).toHaveBeenCalled();
        const callback = mockTransaction.mock.calls.at(-1)?.[0];
        const mockTx = {
          task: {
            update: jest.fn().mockResolvedValue(updatedDbTask),
          },
        };
        if (!callback) {
          throw new Error('Expected transaction callback');
        }
        await callback(mockTx);

        expect(mockTx.task.update).toHaveBeenCalledWith({
          where: {
            id: testIds.task,
          },
          data: expectedFilteredData,
        });
      });

      it('should handle update failures and rollback transaction', async () => {
        const updateError = new Error('Update failed');

        // Mock findOneForAdapter to return existing task
        const existingTaskWithInitiative = {
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
        };
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...existingTaskWithInitiative,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(testIds.task));

        mockTransaction.mockRejectedValue(updateError);

        await expect(
          service.updateForAdapter(
            testIds.task,
            updateData,
            testIds.organization,
          ),
        ).rejects.toThrow(updateError);

        expect(mockEventPublisher.publishInTransaction).not.toHaveBeenCalled();
      });

      it('should handle empty update data', async () => {
        const updatedDbTask = {
          ...mockTaskData,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        };

        const expectedResult = {
          ...mockTaskData,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
          designDocCount: null as number | null,
          codingSessionCount: null as number | null,
          agentSessionCount: null as number | null,
          hasProposalSupport: true,
          sections: createTaskMaterializedSections(
            testIds.task,
            defaultSectionContent,
          ),
        };

        // Mock findOneForAdapter to return existing task
        const existingTaskWithInitiative = {
          ...mockTaskData,
          initiative: { originatingProjectId: testIds.project },
        };
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
          ...existingTaskWithInitiative,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        });
        (
          mockPrismaService.db.taskSection.findMany as jest.Mock
        ).mockResolvedValue(createTaskSectionRecords(testIds.task));

        mockTransaction.mockImplementation(async (callback) => {
          const mockTx = {
            task: {
              update: jest.fn().mockResolvedValue(updatedDbTask),
            },
            taskSection: {
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn(),
            },
          };
          return callback(mockTx);
        });

        const result = await service.updateForAdapter(
          testIds.task,
          {},
          testIds.organization,
        );

        expect(result).toEqual(expectedResult);
      });
    });

    describe('findAllByOrganizationForAdapter', () => {
      const mockTasks = [
        mockTaskData,
        {
          ...mockTaskData,
          id: `${testIds.task}-2`,
          name: 'Second Task',
        },
      ];

      it('should find all tasks by organization with default pagination', async () => {
        const mockDbTasks = mockTasks.map((task) => ({
          ...task,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        }));

        const expectedResults = mockTasks.map((task) => ({
          ...task,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
          designDocCount: null as number | null,
          codingSessionCount: null as number | null,
          agentSessionCount: null as number | null,
          hasProposalSupport: true,
          sections: undefined,
        }));

        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
          mockDbTasks,
        );

        const result = await service.findAllByOrganizationForAdapter(
          testIds.organization,
        );

        expect(result).toEqual(expectedResults);
        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith({
          where: {
            organizationId: testIds.organization,
            archivedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          skip: 0,
        });
      });

      it('omits GOAL tracked snapshots and skips hydration when the adapter opts out', async () => {
        const goalTask = {
          ...mockTaskData,
          type: 'GOAL' as const,
          parentTaskId: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        };
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          goalTask,
        ]);
        (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
        const hydrateSpy = jest.spyOn(
          service as any,
          'loadTrackedTaskRowsByGoal',
        );

        const [result] = await service.findAllByOrganizationForAdapter(
          testIds.organization,
          {
            projectId: testIds.project,
            userToken: 'token-xyz',
            includeTrackedEntities: false,
          },
        );

        expect(result?.trackedEntities).toBeUndefined();
        expect(hydrateSpy).not.toHaveBeenCalled();
        expect(mockGraphsClient.searchGraph).not.toHaveBeenCalled();
      });

      it('hydrates Goal snapshots only from TRACKS relationships', async () => {
        const goalTask = {
          ...mockTaskData,
          type: 'GOAL' as const,
          parentTaskId: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
        };
        const trackedTaskId = '11111111-1111-4111-8111-111111111111';
        const unrelatedTargetId = '22222222-2222-4222-8222-222222222222';
        const trackedTask = {
          id: trackedTaskId,
          name: 'Tracked work item',
          status: 'ACTIVE',
          dueDate: null,
        };

        (mockPrismaService.db.task.findMany as jest.Mock)
          .mockResolvedValueOnce([goalTask])
          .mockResolvedValueOnce([trackedTask]);
        (mockPrismaService.db.task.groupBy as jest.Mock).mockResolvedValue([]);
        mockGraphsClient.searchGraph.mockResolvedValueOnce({
          identitiesBySeed: [
            {
              seedNodeId: goalTask.id,
              targets: [{ entityId: trackedTaskId, entityType: 'TASK' }],
            },
          ],
        });

        const [result] = await service.findAllByOrganizationForAdapter(
          testIds.organization,
          {
            projectId: testIds.project,
            parentTaskId: null,
            taskType: 'GOAL',
            userToken: 'token-xyz',
          },
        );

        expect(mockGraphsClient.searchGraph).toHaveBeenCalledWith(
          testIds.organization,
          testIds.project,
          {
            seedEntityIds: [goalTask.id],
            traversal: {
              direction: 'OUTGOING',
              depth: 1,
              relationshipTypes: ['TRACKS'],
            },
            projection: 'IDENTITIES_BY_SEED',
            includeSeedEntities: false,
          },
          'token-xyz',
        );
        expect(mockPrismaService.db.task.findMany).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({
            where: expect.objectContaining({ id: { in: [trackedTaskId] } }),
          }),
        );
        expect(result?.trackedEntities).toEqual([
          {
            targetEntityId: trackedTaskId,
            targetEntityType: 'TASK',
            title: 'Tracked work item',
            status: 'ACTIVE',
            dueDate: null,
          },
        ]);
        expect(result?.trackedEntities).not.toContainEqual(
          expect.objectContaining({ targetEntityId: unrelatedTargetId }),
        );
      });

      it('filters adapter requests by selected taskIds within the requested project', async () => {
        const selectedTaskId = '11111111-1111-4111-8111-111111111111' as TaskId;
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          {
            ...mockTasks[0],
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
            archivedAt: null as Date | null,
            dueDate: null as Date | null,
          },
        ]);

        await service.findAllByOrganizationForAdapter(testIds.organization, {
          projectId: testIds.project,
          taskIds: [testIds.task, selectedTaskId],
        });

        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: testIds.organization,
              projectId: testIds.project,
              archivedAt: null,
              id: { in: [testIds.task, selectedTaskId] },
            }),
          }),
        );
      });

      it('filters adapter requests by Graph-related candidate IDs', async () => {
        const relatedPlanId = '22222222-2222-4222-8222-222222222222';
        mockAgentEdgeClient.findIncident.mockResolvedValue([
          {
            id: 'edge-related-adapter',
            sourceNodeId: relatedPlanId,
            sourceEntityType: AgentEdgeEndpointEntityType.Task,
            targetNodeId: testIds.task,
            targetEntityType: AgentEdgeEndpointEntityType.Task,
            type: RelationshipType.RelatedTo,
            reasoning: 'plan discovers monitor',
            createdAt: '2026-07-18T00:00:00.000Z',
            updatedAt: '2026-07-18T00:00:00.000Z',
          },
        ]);
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

        await service.findAllByOrganizationForAdapter(testIds.organization, {
          projectId: testIds.project,
          relatedEntityId: relatedPlanId,
          relatedEntityType: AgentEdgeEndpointEntityType.Task,
          edgeTypes: [RelationshipType.RelatedTo],
          userToken: 'token-xyz',
        });

        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ id: { in: [testIds.task] } }),
          }),
        );
      });

      it('sizes adapter default pagination to include every bounded requested taskId', async () => {
        const requestedTaskIds = Array.from(
          { length: 60 },
          (_, index) =>
            `11111111-1111-4111-8111-${String(index).padStart(12, '0')}` as TaskId,
        );
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          {
            ...mockTasks[0],
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
            archivedAt: null as Date | null,
            dueDate: null as Date | null,
          },
        ]);

        await service.findAllByOrganizationForAdapter(testIds.organization, {
          projectId: testIds.project,
          taskIds: requestedTaskIds,
        });

        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            take: requestedTaskIds.length,
          }),
        );
      });

      it('should support custom pagination parameters', async () => {
        const paginationOptions = { page: 2, limit: 10 };
        const mockDbTask = {
          ...mockTasks[0],
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        };

        const expectedResult = {
          ...mockTasks[0],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
          designDocCount: null as number | null,
          codingSessionCount: null as number | null,
          agentSessionCount: null as number | null,
          hasProposalSupport: true,
          sections: undefined,
        };

        const paginatedTasks = [mockDbTask];

        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue(
          paginatedTasks,
        );

        const result = await service.findAllByOrganizationForAdapter(
          testIds.organization,
          paginationOptions,
        );

        expect(result).toEqual([expectedResult]);
        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith({
          where: {
            organizationId: testIds.organization,
            archivedAt: null,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          skip: 10,
        });
      });

      it('maps the public title sort field to the persisted name field', async () => {
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

        await service.findAllByOrganizationForAdapter(testIds.organization, {
          projectId: testIds.project,
          sortBy: 'title',
          sortDir: 'asc',
        });

        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ orderBy: { name: 'asc' } }),
        );
      });

      it('should support additional where conditions', async () => {
        const whereConditions = { statuses: [WorkStatus.ACTIVE] };
        const mockDbTask = {
          ...mockTasks[0],
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:00:00.000Z'),
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
        };

        const expectedResult = {
          ...mockTasks[0],
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          archivedAt: null as Date | null,
          dueDate: null as Date | null,
          childCounts: {
            total: 0,
            done: 0,
            inProgress: 0,
            backlog: 0,
          },
          designDocCount: null as number | null,
          codingSessionCount: null as number | null,
          agentSessionCount: null as number | null,
          hasProposalSupport: true,
          sections: undefined,
        };

        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          mockDbTask,
        ]);

        const result = await service.findAllByOrganizationForAdapter(
          testIds.organization,
          whereConditions,
        );

        expect(result).toEqual([expectedResult]);
        expect(mockPrismaService.db.task.findMany).toHaveBeenCalledWith({
          where: {
            organizationId: testIds.organization,
            archivedAt: null,
            status: { in: whereConditions.statuses },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
          skip: 0,
        });
      });

      it('should return empty array when no tasks found', async () => {
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([]);

        const result = await service.findAllByOrganizationForAdapter(
          testIds.organization,
        );

        expect(result).toEqual([]);
      });
    });

    describe('Refinement Conversation Methods (Placeholder)', () => {
      describe('createRefinementConversation', () => {
        it('should throw not implemented error', async () => {
          await expect(
            service.createRefinementConversation(
              testIds.task,
              testIds.organization,
            ),
          ).rejects.toThrow(
            'Task refinement conversations not yet implemented',
          );
        });
      });

      describe('getActiveRefinementConversation', () => {
        it('should return null when not implemented', async () => {
          const result = await service.getActiveRefinementConversation(
            testIds.task,
            testIds.organization,
          );
          expect(result).toBeNull();
        });
      });

      describe('getActiveRefinementConversation (additional test)', () => {
        it('should return null when no active conversation exists', async () => {
          const result = await service.getActiveRefinementConversation(
            testIds.task,
            testIds.organization,
          );
          expect(result).toBeNull();
        });
      });
    });
  });

  describe('applySectionUpdates version history', () => {
    const sectionUpdates = [
      { key: 'description' as const, content: 'Updated description' },
      {
        key: 'acceptanceCriteria' as const,
        content: 'Updated acceptance criteria',
      },
    ];

    const setupApplySectionMocks = (
      overrides: {
        existingMarkdown?: Record<string, string | null>;
        latestHistoryRow?: { id: string; versionNumber: number } | null;
      } = {},
    ) => {
      const existingMarkdown = overrides.existingMarkdown ?? {
        description: 'Old description',
        acceptanceCriteria: 'Old acceptance criteria',
      };
      const latestHistoryRow = overrides.latestHistoryRow ?? null;

      const txFindManyForSections = jest
        .fn()
        .mockImplementation(({ where }) => {
          const keys: string[] = where?.key?.in ?? [
            'description',
            'acceptanceCriteria',
          ];
          return Promise.resolve(
            keys.map((key) => ({
              id: `${testIds.task}-${key}`,
              key,
              materializedMarkdown:
                existingMarkdown[key] !== undefined
                  ? existingMarkdown[key]
                  : `Old ${key}`,
              order: key === 'description' ? 0 : 1,
            })),
          );
        });
      const txSectionUpdate = jest.fn().mockResolvedValue(undefined);
      const txHistoryFindFirst = jest.fn().mockResolvedValue(latestHistoryRow);
      const txHistoryCreate = jest
        .fn()
        .mockResolvedValue({ id: 'new-history-id' });

      const txTaskFindFirst = jest.fn().mockResolvedValue({
        id: testIds.task,
        type: 'STANDARD',
        status: 'GENERATED',
        projectId: testIds.project,
        initiativeId: testIds.initiative,
      });
      const txTaskFindUniqueOrThrow = jest.fn().mockResolvedValue({
        id: testIds.task,
        type: 'STANDARD',
        status: 'GENERATED',
        projectId: testIds.project,
        initiativeId: testIds.initiative,
      });

      mockTransaction.mockImplementation(async (callback) => {
        const mockTx = {
          task: {
            findFirst: txTaskFindFirst,
            findUniqueOrThrow: txTaskFindUniqueOrThrow,
          },
          taskSection: {
            findMany: txFindManyForSections,
            update: txSectionUpdate,
          },
          taskSectionHistory: {
            findFirst: txHistoryFindFirst,
            create: txHistoryCreate,
          },
        };
        return callback(mockTx);
      });

      mockEventPublisher.publishInTransaction.mockResolvedValue(null);

      return { txHistoryCreate, txHistoryFindFirst, txSectionUpdate };
    };

    it.each([
      ['replacement', JSON.stringify(VALID_GRAPH_LAYOUT_CONTENT)],
      ['clearing', null],
    ] as const)(
      'creates a newly declared optional section before applying a %s',
      async (_scenario, content) => {
        const graphLayoutSection = {
          id: `${testIds.task}-graph-layout`,
          key: 'graphLayout',
          materializedMarkdown: null,
        };
        const findMany = jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: `${testIds.task}-description`,
              key: 'description',
              order: 0,
              materializedMarkdown: 'Existing description',
            },
            {
              ...graphLayoutSection,
              order: 1,
              materializedMarkdown: content,
            },
          ]);
        const upsert = jest.fn().mockResolvedValue(graphLayoutSection);
        const update = jest.fn().mockResolvedValue(undefined);
        const tx = {
          task: {
            findFirst: jest.fn().mockResolvedValue({
              id: testIds.task,
              type: 'GRAPH_ROOT',
              tag: null,
              status: 'ACTIVE',
              projectId: testIds.project,
              initiativeId: testIds.initiative,
            }),
          },
          taskSection: { findMany, upsert, update },
          taskSectionHistory: {
            findFirst: jest.fn(),
            create: jest.fn(),
          },
        };

        await service.applySectionUpdatesInTransaction(
          tx as any,
          testIds.organization,
          testIds.task as TaskId,
          [{ key: 'graphLayout', content }],
        );

        expect(upsert).toHaveBeenCalledWith({
          where: {
            taskId_key: { taskId: testIds.task, key: 'graphLayout' },
          },
          create: {
            taskId: testIds.task,
            key: 'graphLayout',
            order: 1,
            materializedMarkdown: null,
          },
          update: {},
          select: {
            id: true,
            key: true,
            materializedMarkdown: true,
          },
        });
        expect(update).toHaveBeenCalledWith({
          where: { id: graphLayoutSection.id },
          data: { materializedMarkdown: content },
        });
        expect(update).not.toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: `${testIds.task}-description` },
          }),
        );
      },
    );

    it('adds the first Workflow preference row without rewriting existing content or saved positions', async () => {
      const savedLayout = JSON.stringify(VALID_GRAPH_LAYOUT_CONTENT);
      const canonicalPreference =
        '{"schemaVersion":"work-item-graph-layout-preference.v1","rows":2,"columns":3}';
      const preferenceSection = {
        id: `${testIds.task}-graph-layout-preference`,
        key: 'graphLayoutPreference',
        materializedMarkdown: null,
      };
      const findMany = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: `${testIds.task}-description`,
            key: 'description',
            order: 0,
            materializedMarkdown: 'Existing description',
          },
          {
            id: `${testIds.task}-graph-layout`,
            key: 'graphLayout',
            order: 1,
            materializedMarkdown: savedLayout,
          },
          {
            ...preferenceSection,
            order: 2,
            materializedMarkdown: canonicalPreference,
          },
        ]);
      const upsert = jest.fn().mockResolvedValue(preferenceSection);
      const update = jest.fn().mockResolvedValue(undefined);
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue({
            id: testIds.task,
            type: 'workflow',
            tag: null,
            status: 'ACTIVE',
            projectId: testIds.project,
            initiativeId: testIds.initiative,
          }),
        },
        taskSection: { findMany, upsert, update },
        taskSectionHistory: {
          findFirst: jest.fn(),
          create: jest.fn(),
        },
      };

      await service.applySectionUpdatesInTransaction(
        tx as any,
        testIds.organization,
        testIds.task as TaskId,
        [
          {
            key: 'graphLayoutPreference',
            content: canonicalPreference,
          },
        ],
      );

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            key: 'graphLayoutPreference',
            order: 2,
            materializedMarkdown: null,
          }),
        }),
      );
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: preferenceSection.id },
        data: { materializedMarkdown: canonicalPreference },
      });
    });

    it('rejects an undeclared section without creating a persisted row', async () => {
      const upsert = jest.fn();
      const tx = {
        task: {
          findFirst: jest.fn().mockResolvedValue({
            id: testIds.task,
            type: 'GRAPH_ROOT',
            tag: null,
            status: 'ACTIVE',
            projectId: testIds.project,
            initiativeId: testIds.initiative,
          }),
        },
        taskSection: {
          findMany: jest.fn(),
          upsert,
        },
      };

      await expect(
        service.applySectionUpdatesInTransaction(
          tx as any,
          testIds.organization,
          testIds.task as TaskId,
          [{ key: 'unsupportedSection', content: 'nope' }],
        ),
      ).rejects.toThrow('Unsupported task section key');
      expect(upsert).not.toHaveBeenCalled();
    });

    it('should create history rows when updating sections with existing content', async () => {
      const { txHistoryCreate } = setupApplySectionMocks();

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        sectionUpdates,
      );

      expect(txHistoryCreate).toHaveBeenCalledTimes(2);
      expect(txHistoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: testIds.task,
          sectionKey: 'description',
          versionNumber: 1,
          contentSnapshot: 'Old description',
          previousVersionId: null,
        }),
      });
      expect(txHistoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taskId: testIds.task,
          sectionKey: 'acceptanceCriteria',
          versionNumber: 1,
          contentSnapshot: 'Old acceptance criteria',
          previousVersionId: null,
        }),
      });
    });

    it('should not create history rows for initial section creation (null content)', async () => {
      const { txHistoryCreate } = setupApplySectionMocks({
        existingMarkdown: {
          description: null,
          acceptanceCriteria: null,
        },
      });

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        sectionUpdates,
      );

      expect(txHistoryCreate).not.toHaveBeenCalled();
    });

    it('should not create history rows for empty-string section content', async () => {
      const { txHistoryCreate } = setupApplySectionMocks({
        existingMarkdown: {
          description: '',
          acceptanceCriteria: '',
        },
      });

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        sectionUpdates,
      );

      expect(txHistoryCreate).not.toHaveBeenCalled();
    });

    it('should auto-increment version number and link to previous version', async () => {
      const { txHistoryCreate } = setupApplySectionMocks({
        latestHistoryRow: { id: 'prev-history-id', versionNumber: 3 },
      });

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        [{ key: 'description', content: 'New content' }],
      );

      expect(txHistoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          versionNumber: 4,
          previousVersionId: 'prev-history-id',
        }),
      });
    });

    it('should pass changedBy and changeReason from options', async () => {
      const { txHistoryCreate } = setupApplySectionMocks();
      const userId = 'user-123' as UserId;

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        [{ key: 'description', content: 'New content' }],
        { changedBy: userId, changeReason: 'Refining scope' },
      );

      expect(txHistoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changedBy: userId,
          changeReason: 'Refining scope',
        }),
      });
    });

    it('should set changedBy and changeReason to null when not provided', async () => {
      const { txHistoryCreate } = setupApplySectionMocks();

      await service.applySectionUpdates(
        testIds.organization,
        testIds.task as TaskId,
        [{ key: 'description', content: 'New content' }],
      );

      expect(txHistoryCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changedBy: null,
          changeReason: null,
        }),
      });
    });
  });

  describe('getTaskSectionHistory', () => {
    it('should return history ordered by versionNumber descending', async () => {
      const historyRows = [
        {
          id: 'h2',
          sectionKey: 'description',
          versionNumber: 2,
          contentSnapshot: 'v2 content',
          changedBy: 'user-1',
          changedAt: new Date(),
          changeReason: 'Updated scope',
          previousVersionId: 'h1',
        },
        {
          id: 'h1',
          sectionKey: 'description',
          versionNumber: 1,
          contentSnapshot: 'v1 content',
          changedBy: 'user-1',
          changedAt: new Date(),
          changeReason: null,
          previousVersionId: null,
        },
      ];

      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: testIds.task,
      });
      (mockPrismaService.db as any).taskSectionHistory = {
        findMany: jest.fn().mockResolvedValue(historyRows),
      };

      const result = await service.getTaskSectionHistory(
        testIds.organization,
        testIds.task as TaskId,
      );

      expect(result).toEqual(historyRows);
      expect(
        (mockPrismaService.db as any).taskSectionHistory.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: testIds.task },
          orderBy: { versionNumber: 'desc' },
        }),
      );
    });

    it('should filter by sectionKey when provided', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue({
        id: testIds.task,
      });
      (mockPrismaService.db as any).taskSectionHistory = {
        findMany: jest.fn().mockResolvedValue([]),
      };

      await service.getTaskSectionHistory(
        testIds.organization,
        testIds.task as TaskId,
        'description',
      );

      expect(
        (mockPrismaService.db as any).taskSectionHistory.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: testIds.task, sectionKey: 'description' },
        }),
      );
    });

    it('should throw NotFoundException for non-existent task', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.getTaskSectionHistory(
          testIds.organization,
          testIds.task as TaskId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('change-set publication fences', () => {
    it('casts the transaction-scoped advisory lock result for Prisma', async () => {
      (service as any).assertWorkItemWriteAllowed.mockRestore();
      const queryRaw = mockPrismaService.db.$queryRaw as jest.Mock;
      queryRaw.mockClear();
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([]);

      await expect(
        (service as any).assertWorkItemWriteAllowed(
          mockPrismaService.db,
          testIds.organization,
          testIds.project,
          [testIds.task],
        ),
      ).resolves.toBeUndefined();

      const query = queryRaw.mock.calls[0][0];
      expect(query.strings.join('?')).toBe(
        'SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text AS "lockAcquired"',
      );
      expect(query.values).toEqual([
        `${testIds.organization}:${testIds.project}`,
      ]);
    });

    it.each(['APPLYING', 'PREPARED', 'malformed'])(
      'reads committed state across detail, batch, collection and hierarchy with %s history',
      async (state) => {
        const current = {
          ...mockTaskData,
          status: WorkStatus.ACTIVE,
          updatedAt: new Date('2026-09-11T05:35:12.404Z'),
        };
        const prior = {
          ...mockTaskData,
          status: WorkStatus.BACKLOG,
          updatedAt: '2026-09-09T21:07:24.037Z',
        };
        const intents = [
          {
            status: state === 'malformed' ? 'APPLYING' : state,
            affectedWorkItemIds: [testIds.task],
            workItemIdMappings: { 'temporary:root': testIds.task },
            priorProjection:
              state === 'malformed'
                ? null
                : {
                    schemaVersion: 'work-item-change-set-projection.v1',
                    workItems: { [testIds.task]: prior },
                  },
          },
          {
            status: 'PUBLISHED',
            affectedWorkItemIds: [testIds.task],
            priorProjection: {
              schemaVersion: 'work-item-change-set-projection.v1',
              workItems: { [testIds.task]: prior },
            },
          },
        ];
        (
          mockPrismaService.db.workItemChangeSetMaterialization
            .findMany as jest.Mock
        ).mockResolvedValue(intents);
        (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
          current,
        );
        (mockPrismaService.db.task.findMany as jest.Mock).mockResolvedValue([
          current,
        ]);
        const detail = await service.findOne(
          testIds.organization,
          testIds.task,
        );
        const batch = await service.findManyByIds(
          testIds.organization,
          [testIds.task],
          [TaskSectionKey.Description, TaskSectionKey.AcceptanceCriteria],
        );
        const collection = await service.findAll(
          testIds.organization,
          undefined,
          {
            projectId: testIds.project,
            includeSectionKeys: ALL_DECLARED_SECTIONS,
          },
        );
        const hierarchy = await service.findHierarchy(
          testIds.organization,
          testIds.task,
        );
        for (const response of [
          detail,
          batch.get(testIds.task),
          collection[0],
          hierarchy.task,
          hierarchy.children[0],
        ]) {
          expect(response).toMatchObject({
            status: WorkStatus.ACTIVE,
            updatedAt: current.updatedAt.toISOString(),
          });
          expect(response?.sections).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                materializedMarkdown: mockTaskData.description,
              }),
            ]),
          );
        }
        expect(
          mockPrismaService.db.workItemChangeSetMaterialization.findMany,
        ).not.toHaveBeenCalled();
      },
    );

    it('returns committed creates absent from prior snapshots', async () => {
      (mockPrismaService.db.task.findFirst as jest.Mock).mockResolvedValue(
        mockTaskData,
      );
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          status: 'APPLYING',
          affectedWorkItemIds: [testIds.task],
          priorProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            workItems: {},
          },
        },
      ]);
      await expect(
        service.findOne(testIds.organization, testIds.task),
      ).resolves.toMatchObject({ id: testIds.task });
    });

    it('allows the active materialization owner to write through later queued fences', async () => {
      (service as any).assertWorkItemWriteAllowed.mockRestore();
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          id: 'materialization-1',
          status: 'APPLYING',
          affectedWorkItemIds: [testIds.task],
        },
        {
          id: 'materialization-2',
          status: 'PREPARED',
          affectedWorkItemIds: [testIds.task],
        },
      ]);

      await expect(
        (service as any).assertWorkItemWriteAllowed(
          mockPrismaService.db,
          testIds.organization,
          testIds.project,
          [testIds.task],
          'materialization-1',
        ),
      ).resolves.toBeUndefined();
    });

    it('does not reject a direct write that touches a non-published materialization', async () => {
      (service as any).assertWorkItemWriteAllowed.mockRestore();
      const projectedParentId = '123e4567-e89b-42d3-a456-426614174099';
      (
        mockPrismaService.db.workItemChangeSetMaterialization
          .findMany as jest.Mock
      ).mockResolvedValue([
        {
          id: 'materialization-1',
          status: 'PREPARED',
          affectedWorkItemIds: [testIds.task, projectedParentId],
          workItemIdMappings: {
            'temporary:root': testIds.task,
            [`existing:${projectedParentId}`]: projectedParentId,
          },
          priorProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            projection: {
              projectedRoot: {
                identity: { refType: 'temporary', tempId: 'root' },
              },
              children: [],
            },
          },
          targetProjection: {
            schemaVersion: 'work-item-change-set-projection.v1',
            projection: {
              projectedRoot: {
                identity: { refType: 'temporary', tempId: 'root' },
              },
              children: [],
            },
          },
        },
      ]);

      await expect(
        (service as any).assertWorkItemWriteAllowed(
          mockPrismaService.db,
          testIds.organization,
          testIds.project,
          [projectedParentId],
        ),
      ).resolves.toBeUndefined();
      expect(
        mockPrismaService.db.workItemChangeSetMaterialization.findMany,
      ).not.toHaveBeenCalled();
    });
  });

  describe('materialized section provenance', () => {
    const structuredMockup = (
      text: string,
      schemaVersion = 'work-item-structured-mockup.v4',
    ) => ({
      schemaVersion,
      revision: 1,
      content: [
        {
          type: 'text',
          props: {
            id: 'copy',
            width: { mode: 'fit' },
            height: { mode: 'content' },
            text,
          },
        },
      ],
      sizeKey: 'desktop',
      annotations: [],
    });

    it.each(['v3', 'v4', 'v5'])(
      'retains %s structured mockup documents for reopening context',
      (version) => {
        expect(
          (service as any).structuredMockupContext(
            'mockup',
            structuredMockup(
              `copy-${version}`,
              `work-item-structured-mockup.${version}`,
            ),
          ),
        ).toEqual([
          {
            key: 'mockup',
            context: expect.stringContaining(`copy-${version}`),
          },
        ]);
      },
    );

    it('selects provenance by materialization time rather than proposal update time', async () => {
      const olderProposalId = '10000000-0000-4000-8000-000000000001';
      const newerProposalId = '20000000-0000-4000-8000-000000000002';
      (mockPrismaService.db.proposal.findMany as jest.Mock).mockResolvedValue([
        {
          id: newerProposalId,
          targetEntityId: testIds.task,
          updatedAt: new Date('2026-09-11T01:00:00.000Z'),
          updates: {},
          groupMembership: null,
          workItemChangeSetMaterialization: {
            status: 'PUBLISHED',
            publishedAt: new Date('2026-09-11T04:00:00.000Z'),
            operationSet: {
              operations: [
                {
                  op: 'section.replace',
                  ref: { refType: 'existing', id: testIds.task },
                  key: 'mockup',
                  content: structuredMockup('newer'),
                },
              ],
            },
          },
        },
        {
          id: olderProposalId,
          targetEntityId: testIds.task,
          updatedAt: new Date('2026-09-11T03:00:00.000Z'),
          updates: {
            sections: [{ key: 'mockup', content: structuredMockup('older') }],
          },
          groupMembership: {
            executionState: 'APPLIED',
            appliedAt: new Date('2026-09-11T02:00:00.000Z'),
          },
          workItemChangeSetMaterialization: null,
        },
      ]);

      const result = await (service as any).loadMaterializedSectionProvenance([
        testIds.task,
      ]);

      expect(result.get(testIds.task)?.get('mockup')).toBe(newerProposalId);
    });

    it('keeps HTML/CSS provenance stable for annotation-only lifecycle changes', async () => {
      const sourceProposalId = '10000000-0000-4000-8000-000000000001';
      const lifecycleProposalId = '20000000-0000-4000-8000-000000000002';
      const base = {
        html: '<main data-hh-id="hero">Preview</main>',
        css: 'main { color: navy; }',
        sizeKey: 'desktop',
      };
      const openAnnotation = {
        id: '30000000-0000-4000-8000-000000000001',
        note: 'Keep this prominent.',
        author: {
          type: 'human',
          userId: '30000000-0000-4000-8000-000000000002',
        },
        category: 'suggestion',
        lifecycle: 'open',
        authoredProposalId: sourceProposalId,
        authoredSizeKey: 'desktop',
        target: { type: 'element', nodeId: 'hero' },
      };
      (mockPrismaService.db.proposal.findMany as jest.Mock).mockResolvedValue([
        {
          id: sourceProposalId,
          targetEntityId: testIds.task,
          updatedAt: new Date('2026-09-11T01:00:00.000Z'),
          updates: {
            sections: [
              {
                key: 'preview',
                content: { ...base, annotations: [openAnnotation] },
              },
            ],
          },
          groupMembership: {
            executionState: 'APPLIED',
            appliedAt: new Date('2026-09-11T01:00:00.000Z'),
          },
          workItemChangeSetMaterialization: null,
        },
        {
          id: lifecycleProposalId,
          targetEntityId: testIds.task,
          updatedAt: new Date('2026-09-11T02:00:00.000Z'),
          updates: {
            sections: [
              {
                key: 'preview',
                content: {
                  ...base,
                  annotations: [{ ...openAnnotation, lifecycle: 'resolved' }],
                },
              },
            ],
          },
          groupMembership: {
            executionState: 'APPLIED',
            appliedAt: new Date('2026-09-11T02:00:00.000Z'),
          },
          workItemChangeSetMaterialization: null,
        },
      ]);

      const result = await (service as any).loadMaterializedSectionProvenance([
        testIds.task,
      ]);

      expect(result.get(testIds.task)?.get('preview')).toBe(sourceProposalId);
    });

    it('uses a materialized CREATE proposal as the HTML/CSS provenance baseline', async () => {
      const createProposalId = '10000000-0000-4000-8000-000000000001';
      const content = {
        html: '<main data-hh-id="hero">Preview</main>',
        css: 'main { color: navy; }',
        sizeKey: 'desktop',
      };
      (mockPrismaService.db.proposal.findMany as jest.Mock).mockResolvedValue([
        {
          id: createProposalId,
          targetEntityId: testIds.task,
          updatedAt: new Date('2026-09-11T01:00:00.000Z'),
          updates: {
            sections: [{ key: 'preview', content }],
          },
          groupMembership: null,
          workItemChangeSetMaterialization: {
            status: 'PUBLISHED',
            publishedAt: new Date('2026-09-11T01:00:00.000Z'),
            operationSet: {
              root: { refType: 'temporary', tempId: 'root' },
              operations: [
                {
                  op: 'workItem.create',
                  ref: { refType: 'temporary', tempId: 'root' },
                  name: 'New mockup',
                },
                {
                  op: 'section.replace',
                  ref: { refType: 'temporary', tempId: 'root' },
                  key: 'preview',
                  content,
                },
              ],
            },
          },
        },
      ]);

      const result = await (service as any).loadMaterializedSectionProvenance([
        testIds.task,
      ]);

      expect(result.get(testIds.task)?.get('preview')).toBe(createProposalId);
    });
  });
  describe('canonical plan rollup', () => {
    const plan = (status: WorkStatus) => ({
      id: 'plan',
      type: 'PLAN',
      status,
      parentTaskId: null,
    });
    const stage = (id: string, status: WorkStatus) => ({
      id,
      type: 'PLAN_STAGE',
      status,
      parentTaskId: 'plan',
    });
    const step = (id: string, status: WorkStatus, parentTaskId: string) => ({
      id,
      type: 'STANDARD',
      status,
      parentTaskId,
    });
    const statusChangedEventsFor = (taskId: string) =>
      (mockEventPublisher.publishInTransaction as jest.Mock).mock.calls
        .map(([, event]) => event)
        .filter(
          (event) =>
            event.type === EVENT_TYPES.TASK.STATUS_CHANGED &&
            event.aggregateId === taskId,
        );

    beforeEach(() => {
      (service as any).planHierarchyRollupService =
        new PlanHierarchyRollupService({
          outgoing: jest.fn().mockResolvedValue([]),
        } as any);
      (mockEventPublisher.publishInTransaction as jest.Mock).mockClear();
    });

    it('moves the plan to VERIFYING when its last stage is completed directly', async () => {
      const { tx, rows } = createPlanHierarchyFakeTx(
        [
          plan(WorkStatus.ACTIVE),
          stage('stage-1', WorkStatus.COMPLETED),
          stage('stage-2', WorkStatus.ACTIVE),
        ],
        { organizationId: testIds.organization, projectId: testIds.project },
      );

      await service.updateInTransaction(
        tx,
        testIds.organization,
        testIds.initiative,
        'stage-2' as TaskId,
        { status: WorkStatus.COMPLETED } as UpdateTaskDto,
      );

      expect(rows.get('stage-2')?.status).toBe(WorkStatus.COMPLETED);
      expect(rows.get('plan')?.status).toBe(WorkStatus.VERIFYING);
      expect(statusChangedEventsFor('stage-2')).toHaveLength(1);
      expect(statusChangedEventsFor('plan')).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            previousStatus: WorkStatus.ACTIVE,
            newStatus: WorkStatus.VERIFYING,
          }),
        }),
      ]);
    });

    it('recalculates the former stage and plan when the last open step is re-parented out', async () => {
      const { tx, rows } = createPlanHierarchyFakeTx(
        [
          plan(WorkStatus.ACTIVE),
          stage('stage-1', WorkStatus.ACTIVE),
          stage('stage-2', WorkStatus.COMPLETED),
          step('done', WorkStatus.COMPLETED, 'stage-1'),
          step('open', WorkStatus.ACTIVE, 'stage-1'),
          {
            id: 'feature',
            type: 'FEATURE',
            status: WorkStatus.ACTIVE,
            parentTaskId: null,
          },
        ],
        { organizationId: testIds.organization, projectId: testIds.project },
      );
      jest
        .spyOn(service as any, 'loadActiveParentTask')
        .mockResolvedValue({ id: 'feature', type: 'FEATURE' });

      await service.updateInTransaction(
        tx,
        testIds.organization,
        testIds.initiative,
        'open' as TaskId,
        { parentTaskId: 'feature' } as UpdateTaskDto,
      );

      expect(rows.get('stage-1')?.status).toBe(WorkStatus.COMPLETED);
      expect(rows.get('plan')?.status).toBe(WorkStatus.VERIFYING);
      expect(statusChangedEventsFor('stage-1')).toHaveLength(1);
      expect(statusChangedEventsFor('plan')).toHaveLength(1);
    });

    it('recalculates the former stage and plan when the last open step is archived', async () => {
      const { tx, rows } = createPlanHierarchyFakeTx(
        [
          plan(WorkStatus.ACTIVE),
          stage('stage-1', WorkStatus.ACTIVE),
          step('done', WorkStatus.COMPLETED, 'stage-1'),
          step('open', WorkStatus.ACTIVE, 'stage-1'),
        ],
        { organizationId: testIds.organization, projectId: testIds.project },
      );

      await service.removeInTransaction(
        tx,
        testIds.organization,
        'open' as TaskId,
      );

      expect(rows.get('open')?.archivedAt).toBeInstanceOf(Date);
      expect(rows.get('stage-1')?.status).toBe(WorkStatus.COMPLETED);
      expect(rows.get('plan')?.status).toBe(WorkStatus.VERIFYING);
      expect(statusChangedEventsFor('plan')).toHaveLength(1);
    });

    it('moves a VERIFYING plan back to ACTIVE when a stage is reopened directly', async () => {
      const { tx, rows } = createPlanHierarchyFakeTx(
        [
          plan(WorkStatus.VERIFYING),
          stage('stage-1', WorkStatus.COMPLETED),
          stage('stage-2', WorkStatus.COMPLETED),
        ],
        { organizationId: testIds.organization, projectId: testIds.project },
      );

      await service.updateInTransaction(
        tx,
        testIds.organization,
        testIds.initiative,
        'stage-2' as TaskId,
        { status: WorkStatus.ACTIVE } as UpdateTaskDto,
      );

      expect(rows.get('plan')?.status).toBe(WorkStatus.ACTIVE);
    });
  });
});
