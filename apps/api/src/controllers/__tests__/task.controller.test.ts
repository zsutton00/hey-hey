import { ProjectAccessService } from '../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../auth/services/project-resource-access.service';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import { TaskController } from '../task.controller';
import { TaskService } from '../../services/tasks/task.service';
import { GoalTracksService } from '../../services/tasks/goal-tracks.service';
import { TaskSupersedeService } from '../../services/tasks/task-supersede.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import {
  BUILT_IN_WORK_ITEM_TYPE_KEYS,
  createWarmWorkItemTypeRegistry,
} from '../../../test/setup/work-item-type-registry.fixture';
import { ProposalService } from '../../services/proposal/proposal.service';
import {
  CreateProposalDto,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  CreateTaskDto,
  ProposalStatus,
  UpdateTaskDto,
  WorkStatus,
} from '../../generated';
import type { TypedProposalResponse } from '../../services/proposal/proposal.types';
import { ProjectId, TaskId } from '../../types';
import * as TestUtils from '../../utils/testUtils';
import { materializedSectionsToContentMap } from '../../utils/work-item-section.util';

const { testIds } = TestUtils;

const buildFakeRequest = (headers: Record<string, string> = {}): Request =>
  ({
    headers,
    ip: '127.0.0.1',
  }) as unknown as Request;

const buildAuthUser = () => TestUtils.createMockAuthenticatedUser();

const buildProposalResponse = (
  overrides: Partial<TypedProposalResponse> = {},
): TypedProposalResponse =>
  ({
    id: 'p-1' as TypedProposalResponse['id'],
    organizationId: testIds.organization,
    projectId: testIds.project,
    type: 'SINGLE',
    action: 'UPDATE',
    status: 'APPROVED' as ProposalStatus,
    targetEntityId: testIds.task,
    targetEntityType: 'TASK',
    updates: { name: 'updated' },
    requestorId: testIds.user,
    requestorContext: { source: 'user' },
    approvals: [],
    createdAt: '2026-04-30T00:00:00.000Z',
    updatedAt: '2026-04-30T00:00:00.000Z',
    ...overrides,
  }) as TypedProposalResponse;

describe('TaskController', () => {
  let controller: TaskController;
  let mockTaskService: jest.Mocked<TaskService>;
  let mockProposalService: { create: jest.Mock };
  let mockGoalTracksService: {
    attachToGoal: jest.Mock;
    detachFromGoal: jest.Mock;
  };
  let mockTaskSupersedeService: { supersedeTask: jest.Mock };

  beforeEach(async () => {
    mockTaskService = TestUtils.createMockTaskService();
    mockTaskService.findMutationResultByOrganization = jest.fn();
    mockProposalService = { create: jest.fn() };
    mockGoalTracksService = {
      attachToGoal: jest.fn(),
      detachFromGoal: jest.fn(),
    };
    mockTaskSupersedeService = { supersedeTask: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TaskController],
      providers: [
        {
          provide: ProjectAccessService,
          useValue: { assertOrganization: jest.fn(), assertProject: jest.fn() },
        },
        {
          provide: ProjectResourceAccessService,
          useValue: { assertResource: jest.fn() },
        },
        {
          provide: TaskService,
          useValue: mockTaskService,
        },
        {
          provide: ProposalService,
          useValue: mockProposalService,
        },
        {
          provide: GoalTracksService,
          useValue: mockGoalTracksService,
        },
        {
          provide: TaskSupersedeService,
          useValue: mockTaskSupersedeService,
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: await createWarmWorkItemTypeRegistry(),
        },
      ],
    }).compile();

    controller = module.get<TaskController>(TaskController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getGraphAggregate', () => {
    it('forwards project scope, work-item identity, and the authenticated token', async () => {
      const aggregate = {
        root: TestUtils.createMockTaskResponseDto(),
        children: [],
        relationships: [],
        layout: null,
        derivedReferences: [],
        participation: {
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
        },
      };
      mockTaskService.getGraphAggregate = jest.fn();
      mockTaskService.getGraphAggregate.mockResolvedValue(aggregate);

      await expect(
        controller.getGraphAggregate(
          testIds.task,
          testIds.project,
          testIds.organization,
          'token',
          'GUARANTEES,CONSUMES',
        ),
      ).resolves.toBe(aggregate);
      expect(mockTaskService.getGraphAggregate).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        testIds.task,
        'token',
        ['GUARANTEES', 'CONSUMES'],
      );
    });
  });

  describe('findReferences', () => {
    it('delegates the authenticated project-scoped reference request', async () => {
      const response = {
        items: [
          {
            id: testIds.task,
            name: 'Feature A',
            type: WORK_ITEM_TYPE_KEYS.Feature,
            parentTaskId: null,
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
      };
      mockTaskService.findReferences.mockResolvedValue(response);

      await expect(
        controller.findReferences(
          testIds.project,
          testIds.organization,
          ` ${WORK_ITEM_TYPE_KEYS.Feature} `,
          '2',
          '1',
          ' roadmap ',
          ['ACTIVE', 'COMPLETED'],
          'createdAt',
          'desc',
        ),
      ).resolves.toBe(response);
      expect(mockTaskService.findReferences).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        WORK_ITEM_TYPE_KEYS.Feature,
        2,
        1,
        'roadmap',
        [WorkStatus.Active, WorkStatus.Completed],
        'createdAt',
        'desc',
      );
    });

    it.each([
      ['missing type', undefined, '1', '50'],
      ['missing page', WORK_ITEM_TYPE_KEYS.Feature, undefined, '50'],
      ['zero page', WORK_ITEM_TYPE_KEYS.Feature, '0', '50'],
      ['fractional page', WORK_ITEM_TYPE_KEYS.Feature, '1.5', '50'],
      ['missing limit', WORK_ITEM_TYPE_KEYS.Feature, '1', undefined],
      ['zero limit', WORK_ITEM_TYPE_KEYS.Feature, '1', '0'],
      ['limit above maximum', WORK_ITEM_TYPE_KEYS.Feature, '1', '501'],
      ['fractional limit', WORK_ITEM_TYPE_KEYS.Feature, '1', '1.5'],
    ])(
      'rejects %s before querying the service',
      async (_caseName, type, page, limit) => {
        await expect(
          controller.findReferences(
            testIds.project,
            testIds.organization,
            type,
            page,
            limit,
            undefined,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(mockTaskService.findReferences).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['invalid status', ['NOT_A_STATUS'], undefined, undefined],
      ['invalid sort field', undefined, 'updatedAt', undefined],
      ['invalid sort order', undefined, undefined, 'sideways'],
    ])(
      'rejects %s before querying the service',
      async (_caseName, statuses, sortBy, sortOrder) => {
        await expect(
          controller.findReferences(
            testIds.project,
            testIds.organization,
            WORK_ITEM_TYPE_KEYS.Feature,
            '1',
            '20',
            undefined,
            statuses,
            sortBy,
            sortOrder,
          ),
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(mockTaskService.findReferences).not.toHaveBeenCalled();
      },
    );
  });

  describe('create', () => {
    it('passes an omitted Goal date through without inventing a deadline', async () => {
      const dto: CreateTaskDto = { name: 'Undated Goal', type: 'GOAL' };
      mockTaskService.create.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ dueDate: null }),
      );
      await controller.create(
        dto,
        testIds.project,
        undefined,
        testIds.organization,
        testIds.user,
      );
      expect(mockTaskService.create).toHaveBeenCalledWith(
        testIds.organization,
        undefined,
        dto,
        testIds.project,
      );
    });

    it('rejects a date-only due date before task creation', async () => {
      await expect(
        controller.create(
          {
            name: 'Date-only task',
            dueDate: '2026-08-20',
          } as CreateTaskDto,
          testIds.project,
          undefined,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toThrow(
        'dueDate must be a full ISO 8601 date-time; date-only values are not accepted.',
      );

      expect(mockTaskService.create).not.toHaveBeenCalled();
    });

    it('should create a task successfully with all fields', async () => {
      const sectionsInput = TestUtils.createMockTaskSectionInputs({
        description: 'Test description',
        acceptanceCriteria: 'Success criteria for completion',
      });
      const createTaskDto: CreateTaskDto = {
        name: 'Test Task',
        sections: sectionsInput,
        initiativeId: testIds.initiative,
        status: 'BACKLOG',
        priority: 'MEDIUM',
      };

      const expectedResponse = TestUtils.createMockTaskResponseDto({
        sections: TestUtils.createMockMaterializedTaskSections({
          description: 'Test description',
          acceptanceCriteria: 'Success criteria for completion',
        }),
        id: testIds.task,
        organizationId: testIds.organization,
      });

      mockTaskService.create.mockResolvedValue(expectedResponse);

      const result = await controller.create(
        createTaskDto,
        testIds.project,
        undefined,
        testIds.organization,
        testIds.user,
      );

      expect(mockTaskService.create).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );
      expect(result).toEqual(expectedResponse);
      const content = materializedSectionsToContentMap(result.sections);
      expect(content.description).toBe('Test description');
      expect(content.acceptanceCriteria).toBe(
        'Success criteria for completion',
      );
    });

    it('forwards the typed launch config unchanged to task creation', async () => {
      const config = {
        kind: 'INITIAL_WORKTREE' as const,
        version: 'v1' as const,
        initialWorktreeBranch: null,
      };
      const createTaskDto: CreateTaskDto = {
        name: 'Configured task',
        type: 'STANDARD',
        parentTaskId: testIds.task,
        config,
      };
      const expectedResponse = TestUtils.createMockTaskResponseDto({
        name: createTaskDto.name,
        config,
      });
      mockTaskService.create.mockResolvedValue(expectedResponse);

      const result = await controller.create(
        createTaskDto,
        testIds.project,
        undefined,
        testIds.organization,
        testIds.user,
      );

      expect(mockTaskService.create).toHaveBeenCalledWith(
        testIds.organization,
        undefined,
        createTaskDto,
        testIds.project,
      );
      expect(result.config).toEqual(config);
    });

    it('should create a task with minimal fields', async () => {
      const createTaskDto: CreateTaskDto = {
        name: 'Minimal Task',
        initiativeId: testIds.initiative,
      };

      const expectedResponse = TestUtils.createMockTaskResponseDto({
        name: createTaskDto.name,
        initiativeId: createTaskDto.initiativeId,
        id: testIds.task,
        organizationId: testIds.organization,
      });

      mockTaskService.create.mockResolvedValue(expectedResponse);

      const result = await controller.create(
        createTaskDto,
        testIds.project,
        undefined,
        testIds.organization,
        testIds.user,
      );

      expect(mockTaskService.create).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        createTaskDto,
        testIds.project,
      );
      expect(result).toEqual(expectedResponse);
    });
  });

  describe('findAll', () => {
    it('should return all tasks for an initiative', async () => {
      const expectedTasks = [
        TestUtils.createMockTaskResponseDto({
          name: 'Task 1',
          sections: TestUtils.createMockMaterializedTaskSections({
            description: 'Description for task 1',
            acceptanceCriteria: 'Criteria for task 1',
          }),
        }),
        TestUtils.createMockTaskResponseDto({
          name: 'Task 2',
          sections: TestUtils.createMockMaterializedTaskSections({
            description: 'Description for task 2',
            acceptanceCriteria: 'Criteria for task 2',
          }),
        }),
      ];

      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      const result = await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        {
          includeDesignDocCounts: false,
          includeAgentSessionCounts: false,
          includeServiceRelations: false,
          includeEdges: false,
          includeTrackedEntities: true,
          includeTrackedWorkSummary: false,
          userToken: null,
          projectId: testIds.project,
          sortBy: 'createdAt',
          sortDir: 'desc',
        },
      );
      const filters = mockTaskService.findAll.mock.calls[0]?.[2] ?? {};
      expect('parentTaskId' in filters).toBe(false);
      expect(result).toEqual(expectedTasks);
      expect(result).toHaveLength(2);
    });

    it('should request child tasks when parentTaskId is provided', async () => {
      const expectedTasks = [
        TestUtils.createMockTaskResponseDto({ name: 'Child task' }),
      ];

      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        'parent-1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        {
          parentTaskId: 'parent-1',
          includeDesignDocCounts: false,
          includeAgentSessionCounts: false,
          includeServiceRelations: false,
          includeEdges: false,
          includeTrackedEntities: true,
          includeTrackedWorkSummary: false,
          userToken: null,
          projectId: testIds.project,
          sortBy: 'createdAt',
          sortDir: 'desc',
        },
      );
    });

    it('should request children for a bounded set of parentTaskIds', async () => {
      const secondParentId = '11111111-1111-4111-8111-111111111111';
      mockTaskService.findAll.mockResolvedValue([]);
      const args: Parameters<TaskController['findAll']> = [
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        `${testIds.task},${secondParentId}`,
      ];

      await controller.findAll(...args);

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        expect.objectContaining({
          parentTaskIds: [testIds.task, secondParentId],
        }),
      );
    });

    it('should reject parentTaskIds combined with parentTaskId', async () => {
      const args: Parameters<TaskController['findAll']> = [
        testIds.project,
        testIds.organization,
        testIds.initiative,
        testIds.task,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [testIds.task],
      ];

      await expect(controller.findAll(...args)).rejects.toThrow(
        'parentTaskId and parentTaskIds are mutually exclusive',
      );
      expect(mockTaskService.findAll).not.toHaveBeenCalled();
    });

    it('should forward includeDesignDocCounts flag', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        'true',
        'true',
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        {
          includeDesignDocCounts: true,
          includeAgentSessionCounts: true,
          includeServiceRelations: false,
          includeEdges: false,
          includeTrackedEntities: true,
          includeTrackedWorkSummary: false,
          userToken: null,
          projectId: testIds.project,
          sortBy: 'createdAt',
          sortDir: 'desc',
        },
      );
      const filters = mockTaskService.findAll.mock.calls[0]?.[2] ?? {};
      expect('parentTaskId' in filters).toBe(false);
    });

    it('should forward includeServiceRelations flag', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        'false',
        'false',
        'true',
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        {
          includeDesignDocCounts: false,
          includeAgentSessionCounts: false,
          includeServiceRelations: true,
          includeEdges: false,
          includeTrackedEntities: true,
          includeTrackedWorkSummary: false,
          userToken: null,
          projectId: testIds.project,
          sortBy: 'createdAt',
          sortDir: 'desc',
        },
      );
    });

    it('should forward includeEdges flag and userToken', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        'false',
        'false',
        'false',
        'true',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined, // includeDescendants
        'token-abc',
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        {
          includeDesignDocCounts: false,
          includeAgentSessionCounts: false,
          includeServiceRelations: false,
          includeEdges: true,
          includeTrackedEntities: true,
          includeTrackedWorkSummary: false,
          userToken: 'token-abc',
          projectId: testIds.project,
          sortBy: 'createdAt',
          sortDir: 'desc',
        },
      );
    });

    it('should forward requested edgeTypes for task list lookup', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        'false',
        'false',
        'false',
        'true',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'token-abc',
        `${AgentEdgeType.Standard},${AgentEdgeType.Conditional}`,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        expect.objectContaining({
          includeEdges: true,
          edgeTypes: [AgentEdgeType.Standard, AgentEdgeType.Conditional],
          userToken: 'token-abc',
        }),
      );
    });

    it('should reject invalid edgeTypes for task list lookup', async () => {
      await expect(
        controller.findAll(
          testIds.project,
          testIds.organization,
          testIds.initiative,
          undefined,
          'false',
          'false',
          'false',
          'true',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'token-abc',
          'NOT_A_LABEL',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTaskService.findAll).not.toHaveBeenCalled();
    });

    it('should forward a complete related-entity filter independently from includeEdges', async () => {
      const relatedEntityId = '019f7698-d354-7ad3-8733-863b9fbbfa55';
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue([]);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'TASK_MONITOR',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'token-abc',
        AgentEdgeType.RelatedTo,
        undefined,
        relatedEntityId,
        AgentEdgeEndpointEntityType.Task,
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        expect.objectContaining({
          projectId: testIds.project,
          taskType: 'TASK_MONITOR',
          includeEdges: false,
          edgeTypes: [AgentEdgeType.RelatedTo],
          relatedEntityId,
          relatedEntityType: AgentEdgeEndpointEntityType.Task,
        }),
      );
    });

    it.each([
      [
        'only relatedEntityId',
        '22222222-2222-4222-8222-222222222222',
        undefined,
      ],
      ['only relatedEntityType', undefined, AgentEdgeEndpointEntityType.Task],
    ])(
      'should reject a partial related-entity identity: %s',
      async (_label, relatedEntityId, relatedEntityType) => {
        await expect(
          controller.findAll(
            testIds.project,
            testIds.organization,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'token-abc',
            AgentEdgeType.RelatedTo,
            undefined,
            relatedEntityId,
            relatedEntityType,
          ),
        ).rejects.toThrow(
          'relatedEntityId and relatedEntityType must be provided together',
        );
      },
    );

    it('should reject a related-entity filter without edgeTypes', async () => {
      await expect(
        controller.findAll(
          testIds.project,
          testIds.organization,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'token-abc',
          undefined,
          undefined,
          '22222222-2222-4222-8222-222222222222',
          AgentEdgeEndpointEntityType.Task,
        ),
      ).rejects.toThrow(
        'edgeTypes is required when filtering by a related entity',
      );
    });

    it('should fall back to organization-wide listing when initiativeId is omitted', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue(
        expectedTasks,
      );

      const result = await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        'true',
        'false',
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(testIds.organization, {
        includeDesignDocCounts: true,
        includeAgentSessionCounts: false,
        includeServiceRelations: false,
        includeEdges: false,
        includeTrackedEntities: true,
        includeTrackedWorkSummary: false,
        userToken: null,
        projectId: testIds.project,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
      const filters =
        mockTaskService.findAllByOrganizationForAdapter.mock.calls[0]?.[1] ??
        {};
      expect('parentTaskId' in filters).toBe(false);
      expect(result).toEqual(expectedTasks);
    });

    it('should normalize comma-separated statuses for filtering', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue(
        expectedTasks,
      );

      await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        `${WorkStatus.Active},${WorkStatus.Completed}`,
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(testIds.organization, {
        includeDesignDocCounts: false,
        includeAgentSessionCounts: false,
        includeServiceRelations: false,
        includeEdges: false,
        includeTrackedEntities: true,
        includeTrackedWorkSummary: false,
        userToken: null,
        projectId: testIds.project,
        statuses: [WorkStatus.Active, WorkStatus.Completed],
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
      const filters =
        mockTaskService.findAllByOrganizationForAdapter.mock.calls[0]?.[1] ??
        {};
      expect('parentTaskId' in filters).toBe(false);
    });

    it('should forward explicit sortBy and sortDir to the service', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue(
        expectedTasks,
      );

      await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'updatedAt',
        'asc',
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        expect.objectContaining({ sortBy: 'updatedAt', sortDir: 'asc' }),
      );
    });

    it('should apply default sortBy=createdAt and sortDir=desc when omitted', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue(
        expectedTasks,
      );

      await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        expect.objectContaining({ sortBy: 'createdAt', sortDir: 'desc' }),
      );
    });

    it('should throw BadRequestException for an invalid sortBy value', async () => {
      await expect(
        controller.findAll(
          testIds.project,
          testIds.organization,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'badField',
          undefined,
        ),
      ).rejects.toThrow('sortBy must be one of');
    });

    it('should throw BadRequestException for an invalid sortDir value', async () => {
      await expect(
        controller.findAll(
          testIds.project,
          testIds.organization,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'sideways',
        ),
      ).rejects.toThrow('sortDir must be one of');
    });

    it('should default includeDescendants to false when omitted', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        'feature-1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      const filters = mockTaskService.findAll.mock.calls[0]?.[2] ?? {};
      expect('includeDescendants' in filters).toBe(false);
    });

    it('should forward includeDescendants=true to the service', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        'feature-1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'true', // includeDescendants
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        expect.objectContaining({
          parentTaskId: 'feature-1',
          includeDescendants: true,
        }),
      );
    });

    it('should not include includeDescendants in filters when parentTaskId is absent', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined, // no parentTaskId
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'true', // includeDescendants=true but parentTaskId absent
      );

      const filters = mockTaskService.findAll.mock.calls[0]?.[2] ?? {};
      // includeDescendants is still forwarded even without parentTaskId; the service ignores it
      expect(filters).toEqual(
        expect.objectContaining({
          includeDescendants: true,
        }),
      );
      expect('parentTaskId' in filters).toBe(false);
    });

    it('should forward includeTrackedEntities=false through the organization-wide list path', async () => {
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue([]);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'false',
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        expect.objectContaining({ includeTrackedEntities: false }),
      );
    });

    it('should forward includeTrackedEntities=true by default through the initiative list path', async () => {
      mockTaskService.findAll.mockResolvedValue([]);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        expect.objectContaining({ includeTrackedEntities: true }),
      );
    });

    it('should forward includeTrackedWorkSummary=true independently of includeTrackedEntities', async () => {
      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue([]);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'false',
        undefined,
        'true',
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(
        testIds.organization,
        expect.objectContaining({
          includeTrackedEntities: false,
          includeTrackedWorkSummary: true,
        }),
      );
    });

    it('should default includeTrackedWorkSummary to false through the initiative list path', async () => {
      mockTaskService.findAll.mockResolvedValue([]);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        expect.objectContaining({ includeTrackedWorkSummary: false }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a specific task with description and acceptance criteria', async () => {
      const expectedTask = TestUtils.createMockTaskResponseDto({
        name: 'Specific Task',
        sections: TestUtils.createMockMaterializedTaskSections({
          description: 'Specific task description',
          acceptanceCriteria: 'Specific acceptance criteria',
        }),
      });

      mockTaskService.findOneByOrganization.mockResolvedValue(expectedTask);

      const result = await controller.findOne(
        testIds.task,
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        null,
      );
      expect(result).toEqual(expectedTask);
      const content = materializedSectionsToContentMap(result.sections);
      expect(content.description).toBe('Specific task description');
      expect(content.acceptanceCriteria).toBe('Specific acceptance criteria');
    });

    it('should throw NotFoundException when task is not found', async () => {
      mockTaskService.findOneByOrganization.mockResolvedValue(null);

      await expect(
        controller.findOne(
          testIds.task,
          testIds.project,
          testIds.organization,
          'false',
          'false',
          undefined,
          undefined,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        null,
      );
    });

    it('should forward includeServiceRelations for task lookup', async () => {
      const expectedTask = TestUtils.createMockTaskResponseDto();
      mockTaskService.findOneByOrganization.mockResolvedValue(expectedTask);

      await controller.findOne(
        testIds.task,
        testIds.project,
        testIds.organization,
        'false',
        'false',
        'true',
        undefined,
      );

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        true,
        false,
        null,
      );
    });

    it('should forward includeEdges for task lookup', async () => {
      const expectedTask = TestUtils.createMockTaskResponseDto();
      mockTaskService.findOneByOrganization.mockResolvedValue(expectedTask);

      await controller.findOne(
        testIds.task,
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        'true',
      );

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        true,
        null,
      );
    });

    it('should forward requested edgeTypes for task lookup', async () => {
      const expectedTask = TestUtils.createMockTaskResponseDto();
      mockTaskService.findOneByOrganization.mockResolvedValue(expectedTask);

      await controller.findOne(
        testIds.task,
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        'true',
        'token-abc',
        [AgentEdgeType.Loop, AgentEdgeType.FulfilledBy],
      );

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        true,
        'token-abc',
        [AgentEdgeType.Loop, AgentEdgeType.FulfilledBy],
      );
    });
  });

  describe('findHierarchy', () => {
    it('should return task with parent and children', async () => {
      const parent = TestUtils.createMockTaskResponseDto({
        id: 'parent-1',
        parentTaskId: undefined,
      });
      const task = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        parentTaskId: parent.id as TaskId,
      });
      const children = [
        TestUtils.createMockTaskResponseDto({ parentTaskId: testIds.task }),
      ];
      const expectedHierarchy = {
        parent,
        task,
        children,
      };

      mockTaskService.findHierarchyByOrganization.mockResolvedValue(
        expectedHierarchy,
      );

      const result = await controller.findHierarchy(
        testIds.task,
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findHierarchyByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
      );
      expect(result).toEqual(expectedHierarchy);
    });

    it('should forward includeServiceRelations for hierarchy lookup', async () => {
      const expectedHierarchy = {
        parent: undefined,
        task: TestUtils.createMockTaskResponseDto(),
        children: [],
      };
      mockTaskService.findHierarchyByOrganization.mockResolvedValue(
        expectedHierarchy,
      );

      await controller.findHierarchy(
        testIds.task,
        testIds.project,
        testIds.organization,
        'false',
        'false',
        'true',
      );

      expect(mockTaskService.findHierarchyByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        true,
      );
    });
  });

  describe('update', () => {
    it.each([undefined, null, '2026-08-20T00:00:00.000Z'])(
      'preserves Goal update date semantics for %s',
      async (dueDate) => {
        const updates: UpdateTaskDto = {
          name: 'Updated Goal',
          ...(dueDate === undefined ? {} : { dueDate }),
        };
        mockProposalService.create.mockResolvedValue(
          buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
        );
        mockTaskService.findMutationResultByOrganization.mockResolvedValue(
          TestUtils.createMockTaskResponseDto({
            type: 'GOAL',
            dueDate: dueDate ?? null,
          }),
        );
        await controller.update(
          testIds.task,
          testIds.project,
          updates,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        );
        const proposal = mockProposalService.create.mock.calls[0][3];
        if (dueDate === undefined)
          expect(proposal.updates).not.toHaveProperty('dueDate');
        else expect(proposal.updates.dueDate).toBe(dueDate);
      },
    );

    it('returns APPLIED with the archived task after an approved archive', async () => {
      const task = TestUtils.createMockTaskResponseDto({ status: 'ARCHIVED' });
      mockProposalService.create.mockResolvedValue(buildProposalResponse());
      mockTaskService.findOneByOrganization.mockResolvedValue(null);
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(task);

      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          { status: 'ARCHIVED' },
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).resolves.toEqual({ status: 'APPLIED', task });
    });

    it('returns APPLIED with updated task when proposal auto-applies (non-top-level task, user source)', async () => {
      const sectionsInput = TestUtils.createMockTaskSectionInputs({
        description: 'Updated task description',
        acceptanceCriteria: 'Updated success criteria',
      });
      const updateTaskDto: UpdateTaskDto = {
        name: 'Updated Task',
        sections: sectionsInput,
        status: 'BACKLOG',
      };

      const updatedTask = TestUtils.createMockTaskResponseDto({
        sections: TestUtils.createMockMaterializedTaskSections({
          description: 'Updated task description',
          acceptanceCriteria: 'Updated success criteria',
        }),
        id: testIds.task,
        organizationId: testIds.organization,
      });

      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        updatedTask,
      );

      const result = await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      expect(result.status).toBe('APPLIED');
      expect(result.proposal).toBeUndefined();
      expect(result.task).toEqual(updatedTask);

      const dto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(dto.action).toBe('UPDATE');
      expect(dto.targetEntityType).toBe('TASK');
      expect(dto.targetEntityId).toBe(testIds.task);
      expect(dto.updates).toEqual(updateTaskDto);
      expect((dto.requestorContext as { source?: string }).source).toBe('user');

      const content = materializedSectionsToContentMap(result.task.sections);
      expect(content.description).toBe('Updated task description');
      expect(content.acceptanceCriteria).toBe('Updated success criteria');
    });

    it('returns APPLIED on top-level FEATURE when only non-content fields change', async () => {
      const updateTaskDto: UpdateTaskDto = {
        status: 'ACTIVE',
        priority: 'HIGH',
      };

      const updatedTask = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        parentTaskId: undefined,
        status: 'ACTIVE' as WorkStatus,
        priority: 'HIGH',
      });

      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        updatedTask,
      );

      const result = await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      expect(result.status).toBe('APPLIED');
      expect(result.task).toEqual(updatedTask);
    });

    it('routes a GOAL PATCH through a user-authored UPDATE proposal and returns APPLIED', async () => {
      const updateTaskDto: UpdateTaskDto = { name: 'Updated goal' };
      const updatedGoal = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        name: 'Updated goal',
        parentTaskId: undefined,
      });
      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        updatedGoal,
      );

      const result = await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      expect(result).toEqual({ status: 'APPLIED', task: updatedGoal });
      expect(mockProposalService.create.mock.calls[0]).toEqual([
        testIds.organization,
        testIds.project,
        testIds.user,
        expect.objectContaining({
          action: 'UPDATE',
          targetEntityId: testIds.task,
          targetEntityType: 'TASK',
          updates: updateTaskDto,
          requestorContext: expect.objectContaining({ source: 'user' }),
        }),
      ]);
    });

    it('rejects a date-only GOAL due date before proposal creation', async () => {
      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          { dueDate: '2026-08-20' },
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(
        'dueDate must be a full ISO 8601 date-time; date-only values are not accepted.',
      );

      expect(mockProposalService.create).not.toHaveBeenCalled();
    });

    it('preserves an already normalized task due date', async () => {
      const dueDate = '2026-08-20T15:30:00.000Z';
      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ id: testIds.task, dueDate }),
      );

      await controller.update(
        testIds.task,
        testIds.project,
        { dueDate },
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      const proposalDto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(proposalDto.updates).toEqual({ dueDate });
      expect(proposalDto.eli5).toBe("Changes this task's due date.");
    });

    it('preserves an OpenAPI date-time with a numeric UTC offset', async () => {
      const dueDate = '2026-08-20T15:30:00+02:00';
      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ id: testIds.task, dueDate }),
      );

      await controller.update(
        testIds.task,
        testIds.project,
        { dueDate },
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      const proposalDto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(proposalDto.updates).toEqual({ dueDate });
    });

    it('returns PENDING with the unchanged task and proposal payload when threshold>0', async () => {
      const updateTaskDto: UpdateTaskDto = {
        name: 'Renamed Feature',
      };

      const unchangedTask = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        type: WORK_ITEM_TYPE_KEYS.Feature,
        name: 'Original Feature',
        parentTaskId: undefined,
      });

      const pendingProposal = buildProposalResponse({
        id: 'p-pending' as TypedProposalResponse['id'],
        status: 'DRAFT' as ProposalStatus,
        updates: updateTaskDto,
      });

      mockProposalService.create.mockResolvedValue(pendingProposal);
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        unchangedTask,
      );

      const result = await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      expect(result.status).toBe('PENDING');
      expect(result.task).toEqual(unchangedTask);
      expect(result.task.name).toBe('Original Feature');
      expect(result.proposal).toEqual(pendingProposal);
    });

    it("server-stamps requestorContext.source='user' regardless of body content", async () => {
      const updateTaskDto = {
        name: 'New Name',
        // Attempt to spoof the source via an extra key — the controller
        // MUST drop this and stamp source='user' itself.
        requestorContext: { source: 'agent' },
      } as unknown as UpdateTaskDto;

      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ id: testIds.task }),
      );

      await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      const dto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect((dto.requestorContext as { source?: string }).source).toBe('user');
    });

    it('rejects an empty PATCH body (no fields to change)', async () => {
      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          {} as UpdateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockProposalService.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the task vanishes between proposal and refetch', async () => {
      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(null);

      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          { name: 'X' } as UpdateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('appends a USER influence with empty reasoning on a status-only PATCH (no reason text)', async () => {
      const updateTaskDto: UpdateTaskDto = { status: 'BACKLOG' as WorkStatus };

      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ id: testIds.task }),
      );

      await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      const dto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(dto.influences).toEqual([
        {
          entityId: testIds.user,
          entityType: 'USER',
          reasonType: 'user_reason',
          reasoning: '',
        },
      ]);
    });

    it('appends a USER influence carrying the trimmed reason on a content PATCH; reason does not leak into updates', async () => {
      const updateTaskDto: UpdateTaskDto = {
        name: 'Renamed task',
        reason: '  changed because the scope shifted  ',
      };

      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ id: testIds.task }),
      );

      await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      const dto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(dto.influences).toEqual([
        {
          entityId: testIds.user,
          entityType: 'USER',
          reasonType: 'user_reason',
          reasoning: 'changed because the scope shifted',
        },
      ]);
      expect(dto.updates).toEqual({ name: 'Renamed task' });
      expect((dto.updates as Record<string, unknown>).reason).toBeUndefined();
    });

    it('drops whitespace-only reason text but still attaches the USER influence with empty reasoning', async () => {
      const updateTaskDto: UpdateTaskDto = {
        name: 'Renamed task',
        reason: '   \t\n  ',
      };

      mockProposalService.create.mockResolvedValue(
        buildProposalResponse({ status: 'APPROVED' as ProposalStatus }),
      );
      mockTaskService.findMutationResultByOrganization.mockResolvedValue(
        TestUtils.createMockTaskResponseDto({ id: testIds.task }),
      );

      await controller.update(
        testIds.task,
        testIds.project,
        updateTaskDto,
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      const dto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(dto.influences).toEqual([
        {
          entityId: testIds.user,
          entityType: 'USER',
          reasonType: 'user_reason',
          reasoning: '',
        },
      ]);
    });

    it('rejects a PATCH body that carries only `reason` and no real fields to change', async () => {
      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          { reason: 'just explaining myself' } as UpdateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockProposalService.create).not.toHaveBeenCalled();
    });
  });

  describe('GOAL task lifecycle', () => {
    const goalDueDate = '2026-12-31T00:00:00.000Z';

    it('should forward a GOAL create payload to taskService.create', async () => {
      const createGoalDto: CreateTaskDto = {
        name: 'Ship public beta',
        type: WORK_ITEM_TYPE_KEYS.Goal,
        dueDate: goalDueDate,
        initiativeId: testIds.initiative,
      };

      const expectedResponse = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        organizationId: testIds.organization,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        dueDate: goalDueDate,
        parentTaskId: undefined,
      });

      mockTaskService.create.mockResolvedValue(expectedResponse);

      const result = await controller.create(
        createGoalDto,
        testIds.project,
        undefined,
        testIds.organization,
        testIds.user,
      );

      expect(mockTaskService.create).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        createGoalDto,
        testIds.project,
      );
      expect(result).toEqual(expectedResponse);
      expect(result.type).toBe(WORK_ITEM_TYPE_KEYS.Goal);
      expect(result.dueDate).toBe(goalDueDate);
    });

    it('should propagate BadRequestException when GOAL is created without dueDate', async () => {
      const createGoalDto: CreateTaskDto = {
        name: 'Goal missing due date',
        type: WORK_ITEM_TYPE_KEYS.Goal,
        initiativeId: testIds.initiative,
      };

      mockTaskService.create.mockRejectedValue(
        new BadRequestException('GOAL tasks require a dueDate.'),
      );

      await expect(
        controller.create(
          createGoalDto,
          testIds.project,
          undefined,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTaskService.create).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        createGoalDto,
        testIds.project,
      );
    });

    it('should propagate BadRequestException when GOAL is created with a parentTaskId', async () => {
      const createGoalDto: CreateTaskDto = {
        name: 'Nested goal',
        type: WORK_ITEM_TYPE_KEYS.Goal,
        dueDate: goalDueDate,
        parentTaskId: 'parent-1' as TaskId,
        initiativeId: testIds.initiative,
      };

      mockTaskService.create.mockRejectedValue(
        new BadRequestException(
          'GOAL tasks must be top-level (parentTaskId must be null).',
        ),
      );

      await expect(
        controller.create(
          createGoalDto,
          testIds.project,
          undefined,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should forward bounded taskIds for selected work hydration', async () => {
      const expectedTasks = [TestUtils.createMockTaskResponseDto()];
      const selectedTaskId = '11111111-1111-4111-8111-111111111111' as TaskId;
      mockTaskService.findAll.mockResolvedValue(expectedTasks);

      await controller.findAll(
        testIds.project,
        testIds.organization,
        testIds.initiative,
        undefined,
        undefined,
        undefined,
        undefined,
        'true',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'token-abc',
        undefined,
        `${testIds.task},${selectedTaskId}`,
      );

      expect(mockTaskService.findAll).toHaveBeenCalledWith(
        testIds.organization,
        testIds.initiative,
        expect.objectContaining({
          includeEdges: true,
          taskIds: [testIds.task, selectedTaskId],
          projectId: testIds.project,
          userToken: 'token-abc',
        }),
      );
    });

    it('should reject invalid taskIds before calling the service', async () => {
      await expect(
        controller.findAll(
          testIds.project,
          testIds.organization,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          'not-a-uuid',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockTaskService.findAll).not.toHaveBeenCalled();
      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).not.toHaveBeenCalled();
    });

    it('should forward type=GOAL and a status filter to the listing service', async () => {
      const expectedTasks = [
        TestUtils.createMockTaskResponseDto({
          name: 'Ship public beta',
          type: WORK_ITEM_TYPE_KEYS.Goal,
          dueDate: goalDueDate,
          parentTaskId: undefined,
        }),
      ];

      mockTaskService.findAllByOrganizationForAdapter.mockResolvedValue(
        expectedTasks,
      );

      const result = await controller.findAll(
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        WorkStatus.Active,
        WORK_ITEM_TYPE_KEYS.Goal,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(
        mockTaskService.findAllByOrganizationForAdapter,
      ).toHaveBeenCalledWith(testIds.organization, {
        includeDesignDocCounts: false,
        includeAgentSessionCounts: false,
        includeServiceRelations: false,
        includeEdges: false,
        includeTrackedEntities: true,
        includeTrackedWorkSummary: false,
        userToken: null,
        statuses: [WorkStatus.Active],
        taskType: WORK_ITEM_TYPE_KEYS.Goal,
        projectId: testIds.project,
        sortBy: 'createdAt',
        sortDir: 'desc',
      });
      expect(result).toEqual(expectedTasks);
      expect(result[0]?.type).toBe(WORK_ITEM_TYPE_KEYS.Goal);
    });

    it('should return a GOAL-typed task from the read endpoint', async () => {
      const expectedTask = TestUtils.createMockTaskResponseDto({
        id: testIds.task,
        type: WORK_ITEM_TYPE_KEYS.Goal,
        dueDate: goalDueDate,
        parentTaskId: undefined,
      });

      mockTaskService.findOneByOrganization.mockResolvedValue(expectedTask);

      const result = await controller.findOne(
        testIds.task,
        testIds.project,
        testIds.organization,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(mockTaskService.findOneByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
        false,
        false,
        false,
        false,
        null,
      );
      expect(result.type).toBe(WORK_ITEM_TYPE_KEYS.Goal);
      expect(result.dueDate).toBe(goalDueDate);
      expect(result.parentTaskId).toBeUndefined();
    });

    it('should propagate BadRequestException when PATCH attempts to change task type', async () => {
      const updateTaskDto: UpdateTaskDto = {
        type: WORK_ITEM_TYPE_KEYS.Standard,
      };

      mockProposalService.create.mockRejectedValue(
        new BadRequestException('Task type cannot be changed after creation.'),
      );

      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          updateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);

      const dto = mockProposalService.create.mock
        .calls[0]?.[3] as CreateProposalDto;
      expect(dto.targetEntityId).toBe(testIds.task);
      expect(dto.updates).toEqual(updateTaskDto);
    });

    it('should propagate BadRequestException when PATCH clears dueDate on a GOAL', async () => {
      const updateTaskDto: UpdateTaskDto = {
        dueDate: '',
      };

      mockProposalService.create.mockRejectedValue(
        new BadRequestException('GOAL tasks require a dueDate.'),
      );

      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          updateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate BadRequestException when PATCH sets parentTaskId on a GOAL', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'parent-1',
      };

      mockProposalService.create.mockRejectedValue(
        new BadRequestException(
          'GOAL tasks must be top-level (parentTaskId must be null).',
        ),
      );

      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          updateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate BadRequestException when POST attaches a non-GOAL task to a GOAL parent', async () => {
      const createDto: CreateTaskDto = {
        name: 'Standard task under a goal',
        type: WORK_ITEM_TYPE_KEYS.Standard,
        parentTaskId: 'goal-parent' as TaskId,
        initiativeId: testIds.initiative,
      };

      mockTaskService.create.mockRejectedValue(
        new BadRequestException(
          'goals cannot have child tasks; use TRACKS edges to associate work.',
        ),
      );

      await expect(
        controller.create(
          createDto,
          testIds.project,
          undefined,
          testIds.organization,
          testIds.user,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should propagate BadRequestException when PATCH reparents a task under a GOAL', async () => {
      const updateTaskDto: UpdateTaskDto = {
        parentTaskId: 'goal-parent',
      };

      mockProposalService.create.mockRejectedValue(
        new BadRequestException(
          'goals cannot have child tasks; use TRACKS edges to associate work.',
        ),
      );

      await expect(
        controller.update(
          testIds.task,
          testIds.project,
          updateTaskDto,
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('attachToGoal', () => {
    const sessionHeader = '00000000-0000-4000-8000-000000000040';
    const goalId = testIds.task;
    const targetId = '00000000-0000-4000-8000-000000000020';

    function makeRes() {
      return { status: jest.fn().mockReturnThis() } as unknown as {
        status: jest.Mock;
      };
    }

    it('returns 201 when a new TRACKS edge is created', async () => {
      mockGoalTracksService.attachToGoal.mockResolvedValue({
        edge: { id: 'e1' },
        target: { targetEntityId: targetId, targetEntityType: 'TASK' },
        created: true,
      });
      const res = makeRes();

      await controller.attachToGoal(
        goalId,
        testIds.project,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        testIds.organization,
        'tok',
        buildFakeRequest({ 'x-agent-session-id': sessionHeader }),
        res as any,
      );

      expect(mockGoalTracksService.attachToGoal).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        goalId,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        sessionHeader,
        'tok',
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 200 on idempotent re-attach', async () => {
      mockGoalTracksService.attachToGoal.mockResolvedValue({
        edge: { id: 'e1' },
        target: { targetEntityId: targetId, targetEntityType: 'TASK' },
        created: false,
      });
      const res = makeRes();

      await controller.attachToGoal(
        goalId,
        testIds.project,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        testIds.organization,
        'tok',
        buildFakeRequest({ 'x-agent-session-id': sessionHeader }),
        res as any,
      );

      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('passes a null session id through when the X-Agent-Session-ID header is missing', async () => {
      mockGoalTracksService.attachToGoal.mockResolvedValue({
        edge: { id: 'e1' },
        target: { targetEntityId: targetId, targetEntityType: 'TASK' },
        created: true,
      });
      const res = makeRes();

      await controller.attachToGoal(
        goalId,
        testIds.project,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        testIds.organization,
        'tok',
        buildFakeRequest(),
        res as any,
      );

      expect(mockGoalTracksService.attachToGoal).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        goalId,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        null,
        'tok',
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('surfaces NotFoundException from the service', async () => {
      mockGoalTracksService.attachToGoal.mockRejectedValue(
        new NotFoundException('Goal not found'),
      );

      await expect(
        controller.attachToGoal(
          goalId,
          testIds.project,
          { targetEntityId: targetId, targetEntityType: 'TASK' },
          testIds.organization,
          'tok',
          buildFakeRequest({ 'x-agent-session-id': sessionHeader }),
          makeRes() as any,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('detachFromGoal', () => {
    const goalId = testIds.task;
    const targetId = '00000000-0000-4000-8000-000000000020';

    it('delegates to GoalTracksService and returns the result', async () => {
      mockGoalTracksService.detachFromGoal.mockResolvedValue({
        deleted: true,
        targetEntityId: targetId,
        targetEntityType: 'TASK',
      });

      const result = await controller.detachFromGoal(
        goalId,
        testIds.project,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        testIds.organization,
        'tok',
      );

      expect(result.deleted).toBe(true);
      expect(mockGoalTracksService.detachFromGoal).toHaveBeenCalledWith(
        testIds.organization,
        testIds.project,
        goalId,
        { targetEntityId: targetId, targetEntityType: 'TASK' },
        'tok',
      );
    });

    it('surfaces BadRequestException from the service', async () => {
      mockGoalTracksService.detachFromGoal.mockRejectedValue(
        new BadRequestException('not a goal'),
      );

      await expect(
        controller.detachFromGoal(
          goalId,
          testIds.project,
          { targetEntityId: targetId, targetEntityType: 'TASK' },
          testIds.organization,
          'tok',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('supersedeTask', () => {
    const taskId = testIds.task;
    const successorId = '00000000-0000-4000-8000-000000000020';

    it('delegates to TaskSupersedeService with the authenticated user and a user-stamped requestor context', async () => {
      const user = buildAuthUser();
      mockTaskSupersedeService.supersedeTask.mockResolvedValue({
        status: 'APPLIED',
        task: { id: taskId, status: WorkStatus.Superseded },
      });

      const result = await controller.supersedeTask(
        taskId,
        testIds.project,
        { successorTaskId: successorId },
        testIds.organization,
        user,
        buildFakeRequest(),
      );

      expect(mockTaskSupersedeService.supersedeTask).toHaveBeenCalledTimes(1);
      const call = mockTaskSupersedeService.supersedeTask.mock.calls[0]!;
      expect(call[0]).toBe(testIds.organization);
      expect(call[1]).toBe(testIds.project);
      expect(call[2]).toBe(taskId);
      expect(call[3]).toEqual({ successorTaskId: successorId });
      expect(call[4]).toBe(user.userId);
      // The transition authors a user-sourced proposal — never an agent one.
      expect((call[5] as { source?: string }).source).toBe('user');
      expect(result.status).toBe('APPLIED');
      expect(result.task.status).toBe(WorkStatus.Superseded);
    });

    it('returns PENDING with the proposal when the supersede awaits review', async () => {
      mockTaskSupersedeService.supersedeTask.mockResolvedValue({
        status: 'PENDING',
        task: { id: taskId, status: WorkStatus.Active },
        proposal: { id: 'p1' },
      });

      const result = await controller.supersedeTask(
        taskId,
        testIds.project,
        { successorTaskId: successorId },
        testIds.organization,
        buildAuthUser(),
        buildFakeRequest(),
      );

      expect(result.status).toBe('PENDING');
      expect(result.proposal?.id).toBe('p1');
    });

    it('surfaces BadRequestException from the service', async () => {
      mockTaskSupersedeService.supersedeTask.mockRejectedValue(
        new BadRequestException('task type cannot be superseded'),
      );

      await expect(
        controller.supersedeTask(
          taskId,
          testIds.project,
          { successorTaskId: successorId },
          testIds.organization,
          buildAuthUser(),
          buildFakeRequest(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAllowedStatuses', () => {
    it('returns one allowed-status entry per task type', () => {
      const result = controller.getAllowedStatuses(testIds.project);
      const types = result.entries.map((e) => e.taskType).sort();
      expect(types).toEqual([...BUILT_IN_WORK_ITEM_TYPE_KEYS].sort());
    });

    it('does not fall back to global rows for a project without definitions', () => {
      const result = controller.getAllowedStatuses(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as ProjectId,
      );

      expect(result.entries).toEqual([]);
    });

    it('exposes SUPERSEDED only for supersedable task types', () => {
      const result = controller.getAllowedStatuses(testIds.project);
      for (const entry of result.entries) {
        const hasSuperseded = entry.allowedStatuses.includes(
          WorkStatus.Superseded,
        );
        const supersedableTypes = new Set<string>([
          WORK_ITEM_TYPE_KEYS.Standard,
          WORK_ITEM_TYPE_KEYS.Feature,
          WORK_ITEM_TYPE_KEYS.Workflow,
          WORK_ITEM_TYPE_KEYS.WorkflowStep,
          WORK_ITEM_TYPE_KEYS.TaskMonitor,
          WORK_ITEM_TYPE_KEYS.Contract,
          WORK_ITEM_TYPE_KEYS.Diagram,
          WORK_ITEM_TYPE_KEYS.DiagramElement,
        ]);
        const expectSuperseded = supersedableTypes.has(entry.taskType);
        expect(hasSuperseded).toBe(expectSuperseded);
      }
    });
  });

  describe('remove', () => {
    it('should archive a task successfully', async () => {
      const expectedResponse = TestUtils.createMockTaskResponseDto({
        archivedAt: '2024-01-01T00:00:00.000Z',
      });

      mockTaskService.removeByOrganization.mockResolvedValue(expectedResponse);

      const result = await controller.remove(
        testIds.task,
        testIds.project,
        testIds.organization,
      );

      expect(mockTaskService.removeByOrganization).toHaveBeenCalledWith(
        testIds.organization,
        testIds.task,
      );
      expect(result).toEqual(expectedResponse);
      expect(result.archivedAt).toBeDefined();
    });
  });
});
