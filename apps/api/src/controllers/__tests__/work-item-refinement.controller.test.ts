import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  ConversationResponseDto,
  ConversationStatus,
  InitiationType,
  Priority,
  RefinementLevel,
  WorkStatus,
} from '../../generated';
import { ConversationService } from '../../services/conversation.service';
import { InitiativeRefinementService } from '../../services/initiatives/initiative-refinement.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { TaskRefinementService } from '../../services/tasks/task-refinement.service';
import { TaskService } from '../../services/tasks/task.service';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';
import { WorkflowRouterService } from '../../services/workflows/workflow-router.service';
import { WorkflowTypeRegistryService } from '../../services/workflows/workflow-type-registry.service';
import { OrganizationId } from '../../types';
import { InitiativeRefinableEntity } from '../../types/initiative-refinement-adapter.types';
import {
  TaskRefinableEntity,
  toTaskRefinableEntity,
} from '../../types/task-refinement-adapter.types';
import * as TestUtils from '../../utils/testUtils';
import { WorkItemRefinementController } from '../work-item-refinement.controller';
import { createServiceTestingModule } from '../../../test/setup/testing-module.factory';
import { createWarmWorkItemTypeRegistry } from '../../../test/setup/work-item-type-registry.fixture';

describe('WorkItemRefinementController', () => {
  let controller: WorkItemRefinementController;
  let mockInitiativeRefinementService: jest.Mocked<InitiativeRefinementService>;
  let mockTaskRefinementService: jest.Mocked<TaskRefinementService>;
  let mockConversationService: jest.Mocked<ConversationService>;
  let mockWorkflowRouterService: jest.Mocked<WorkflowRouterService>;
  let mockWorkflowTypeRegistryService: jest.Mocked<WorkflowTypeRegistryService>;
  let mockInitiativeService: jest.Mocked<InitiativeService>;
  let mockTaskService: jest.Mocked<TaskService>;

  const { testIds } = TestUtils;

  const mockInitiativeEntity = TestUtils.createMockInitiativeRefinableEntity({
    id: testIds.initiative,
    name: 'Test Initiative',
    description: 'Test description',
    details: 'Test details',
    acceptanceCriteria: 'Test criteria',
    status: WorkStatus.RefiningDescription,
    priority: Priority.Medium,
    organizationId: testIds.organization,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const mockTaskEntity: TaskRefinableEntity = toTaskRefinableEntity(
    TestUtils.createMockTaskResponseDto({
      id: testIds.task,
      name: 'Test Task',
      sections: TestUtils.createMockMaterializedTaskSections({
        description: 'Test description',
        acceptanceCriteria: 'Test criteria',
      }),
      status: WorkStatus.Backlog,
      priority: 'MEDIUM' as Priority,
      organizationId: testIds.organization,
      initiativeId: testIds.initiative,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );

  const mockConversation: ConversationResponseDto =
    TestUtils.createMockConversation({
      id: testIds.conversation,
      workflowId: testIds.workflow,
      projectId: testIds.project,
      organizationId: testIds.organization,
      status: ConversationStatus.InProgress,
      initiatedBy: InitiationType.User,
      version: 1,
      workflowName: 'initiative-refinement' as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

  const mockRefinementSessionResponse = {
    conversation: mockConversation,
    entities: [mockInitiativeEntity],
  };

  beforeEach(async () => {
    // Create comprehensive mock services using TestUtils
    mockInitiativeRefinementService =
      TestUtils.createMockInitiativeRefinementService();
    mockTaskRefinementService = TestUtils.createMockTaskRefinementService();
    (mockInitiativeRefinementService as any).applySectionUpdates = jest.fn();
    (mockTaskRefinementService as any).applySectionUpdates = jest.fn();
    mockConversationService = TestUtils.createMockConversationService();
    mockWorkflowRouterService =
      TestUtils.createMockWorkflowRouterService() as unknown as jest.Mocked<WorkflowRouterService>;
    mockInitiativeService = {
      updateForAdapter: jest.fn(),
    } as unknown as jest.Mocked<InitiativeService>;
    mockTaskService = {
      updateForAdapter: jest.fn(),
    } as unknown as jest.Mocked<TaskService>;

    // Create mocks for new dependencies
    mockWorkflowTypeRegistryService = {
      startWorkflowByType: jest.fn(),
    } as unknown as jest.Mocked<WorkflowTypeRegistryService>;

    const warmWorkItemTypeRegistry = await createWarmWorkItemTypeRegistry();

    const setup = await createServiceTestingModule({
      controllers: [WorkItemRefinementController],
      providers: [
        InitiativeRefinementService,
        TaskRefinementService,
        InitiativeService,
        TaskService,
        ConversationService,
        WorkflowRouterService,
        WorkflowTypeRegistryService,
        WorkItemTypeRegistryService,
      ],
      overrides: [
        [InitiativeRefinementService, mockInitiativeRefinementService],
        [TaskRefinementService, mockTaskRefinementService],
        [InitiativeService, mockInitiativeService],
        [TaskService, mockTaskService],
        [ConversationService, mockConversationService],
        [WorkflowRouterService, mockWorkflowRouterService],
        [WorkflowTypeRegistryService, mockWorkflowTypeRegistryService],
        [WorkItemTypeRegistryService, warmWorkItemTypeRegistry],
      ],
    });

    controller = setup.module.get<WorkItemRefinementController>(
      WorkItemRefinementController,
    );

    // Setup default mock behavior
    mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(true);
    mockInitiativeService.updateForAdapter.mockResolvedValue(
      mockInitiativeEntity as any,
    );
    mockTaskService.updateForAdapter.mockResolvedValue(mockTaskEntity as any);

    // Suppress logger output in tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Private Helper Methods', () => {
    describe('getRefinementService', () => {
      it('should return InitiativeRefinementService for initiative entity type', () => {
        const service = (
          controller as unknown as {
            getRefinementService: (type: string) => unknown;
          }
        ).getRefinementService('initiative');
        expect(service).toBe(mockInitiativeRefinementService);
      });

      it('should return TaskRefinementService for task entity type', () => {
        const service = (
          controller as unknown as {
            getRefinementService: (type: string) => unknown;
          }
        ).getRefinementService('task');
        expect(service).toBe(mockTaskRefinementService);
      });

      it('should throw error for unsupported entity type', () => {
        expect(() => {
          (
            controller as unknown as {
              getRefinementService: (type: string) => unknown;
            }
          ).getRefinementService('unsupported');
        }).toThrow(BadRequestException);
        expect(() => {
          (
            controller as unknown as {
              getRefinementService: (type: string) => unknown;
            }
          ).getRefinementService('unsupported');
        }).toThrow('Unsupported entity type: unsupported');
      });
    });

    describe('validateEntityType', () => {
      it('should validate correct entity types', () => {
        expect(
          (
            controller as unknown as {
              validateEntityType: (type: string) => string;
            }
          ).validateEntityType('initiative'),
        ).toBe('initiative');
        expect(
          (
            controller as unknown as {
              validateEntityType: (type: string) => string;
            }
          ).validateEntityType('task'),
        ).toBe('task');
      });

      it('should throw BadRequestException for invalid entity types', () => {
        expect(() => {
          (
            controller as unknown as {
              validateEntityType: (type: string) => string;
            }
          ).validateEntityType('invalid');
        }).toThrow(BadRequestException);
        expect(() => {
          (
            controller as unknown as {
              validateEntityType: (type: string) => string;
            }
          ).validateEntityType('invalid');
        }).toThrow(
          "Invalid entity type: invalid. Must be 'initiative' or 'task'",
        );
      });
    });

    describe('validateRefinementLevel', () => {
      it('should validate correct refinement levels', () => {
        expect(
          (
            controller as unknown as {
              validateRefinementLevel: (level: string) => string;
            }
          ).validateRefinementLevel('description'),
        ).toBe('description');
        expect(
          (
            controller as unknown as {
              validateRefinementLevel: (level: string) => string;
            }
          ).validateRefinementLevel('details'),
        ).toBe('details');
        expect(
          (
            controller as unknown as {
              validateRefinementLevel: (level: string) => string;
            }
          ).validateRefinementLevel('acceptanceCriteria'),
        ).toBe('acceptanceCriteria');
      });

      it('should throw BadRequestException for invalid refinement levels', () => {
        expect(() => {
          (
            controller as unknown as {
              validateRefinementLevel: (level: string) => string;
            }
          ).validateRefinementLevel('invalid');
        }).toThrow(BadRequestException);
        expect(() => {
          (
            controller as unknown as {
              validateRefinementLevel: (level: string) => string;
            }
          ).validateRefinementLevel('invalid');
        }).toThrow(
          "Invalid refinement level: invalid. Must be 'description', 'details', or 'acceptanceCriteria'",
        );
      });
    });

    describe('findWorkItem', () => {
      it('should find initiative work item', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );

        const result = await (
          controller as unknown as {
            findWorkItem: (
              type: string,
              id: string,
              orgId: OrganizationId,
            ) => Promise<unknown>;
          }
        ).findWorkItem('initiative', testIds.initiative, testIds.organization);

        expect(result).toBe(mockInitiativeEntity);
        expect(
          mockInitiativeRefinementService.findOneForAdapter,
        ).toHaveBeenCalledWith(testIds.initiative, testIds.organization);
      });

      it('should find task work item', async () => {
        mockTaskRefinementService.findOneForAdapter.mockResolvedValue(
          mockTaskEntity,
        );

        const result = await (
          controller as unknown as {
            findWorkItem: (
              type: string,
              id: string,
              orgId: OrganizationId,
            ) => Promise<unknown>;
          }
        ).findWorkItem('task', testIds.task, testIds.organization);

        expect(result).toBe(mockTaskEntity);
        expect(
          mockTaskRefinementService.findOneForAdapter,
        ).toHaveBeenCalledWith(testIds.task, testIds.organization);
      });
    });

    describe('updateWorkItem', () => {
      it('should update initiative work item', async () => {
        const updates = { priority: Priority.High };
        const updatedInitiative = { ...mockInitiativeEntity, ...updates };
        mockInitiativeService.updateForAdapter.mockResolvedValue(
          updatedInitiative as any,
        );

        const result = await (
          controller as unknown as {
            updateWorkItem: (
              type: string,
              id: string,
              updates: unknown,
              orgId: OrganizationId,
            ) => Promise<unknown>;
          }
        ).updateWorkItem(
          'initiative',
          testIds.initiative,
          updates,
          testIds.organization,
        );

        expect(result).toBe(updatedInitiative);
        expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
          testIds.initiative,
          {
            name: undefined,
            status: undefined,
            priority: Priority.High,
            assigneeId: undefined,
          },
          testIds.organization,
        );
      });

      it('should update task work item', async () => {
        const updates = { priority: Priority.Low };
        const updatedTask = { ...mockTaskEntity, ...updates };
        mockTaskService.updateForAdapter.mockResolvedValue(updatedTask as any);

        const result = await (
          controller as unknown as {
            updateWorkItem: (
              type: string,
              id: string,
              updates: unknown,
              orgId: OrganizationId,
            ) => Promise<unknown>;
          }
        ).updateWorkItem('task', testIds.task, updates, testIds.organization);

        expect(result).toBe(updatedTask);
        expect(mockTaskService.updateForAdapter).toHaveBeenCalledWith(
          testIds.task,
          {
            name: undefined,
            status: undefined,
            priority: Priority.Low,
            assigneeId: undefined,
          },
          testIds.organization,
        );
      });
    });

    describe('calculateProgress', () => {
      it('should calculate correct progress percentages', () => {
        expect((controller as any).calculateProgress('description')).toBe(33);
        expect((controller as any).calculateProgress('details')).toBe(66);
        expect(
          (controller as any).calculateProgress('acceptanceCriteria'),
        ).toBe(100);
      });
    });

    describe('getStatusForLevel', () => {
      it('should return correct status for initiative levels', () => {
        expect(
          (controller as any).getStatusForLevel('initiative', 'description'),
        ).toEqual({
          status: WorkStatus.RefiningDescription,
        });
        expect(
          (controller as any).getStatusForLevel('initiative', 'details'),
        ).toEqual({
          status: WorkStatus.RefiningDetails,
        });
        expect(
          (controller as any).getStatusForLevel(
            'initiative',
            'acceptanceCriteria',
          ),
        ).toEqual({
          status: WorkStatus.RefiningAcceptanceCriteria,
        });
      });

      it('should return correct status for task levels', () => {
        expect(
          (controller as any).getStatusForLevel('task', 'description'),
        ).toEqual({
          status: WorkStatus.RefiningDescription,
        });
        expect(
          (controller as any).getStatusForLevel('task', 'details'),
        ).toEqual({
          status: WorkStatus.RefiningAcceptanceCriteria,
        });
        expect(
          (controller as any).getStatusForLevel('task', 'acceptanceCriteria'),
        ).toEqual({
          status: WorkStatus.RefiningAcceptanceCriteria,
        });
      });
    });

    describe('getFinalizedStatus', () => {
      it('should return correct finalized status for initiatives', () => {
        expect((controller as any).getFinalizedStatus('initiative')).toEqual({
          status: WorkStatus.Active,
        });
      });

      it('should return correct finalized status for tasks', () => {
        expect(
          (
            controller as unknown as {
              getFinalizedStatus: (type: string) => unknown;
            }
          ).getFinalizedStatus('task'),
        ).toEqual({
          status: WorkStatus.Active,
        });
      });

      it('should throw error for unknown entity types', () => {
        expect(() => {
          (
            controller as unknown as {
              getFinalizedStatus: (type: string) => unknown;
            }
          ).getFinalizedStatus('unknown');
        }).toThrow(BadRequestException);
      });
    });
  });

  describe('API Endpoints', () => {
    beforeEach(() => {
      // Setup common mocks
    });

    describe('refineWorkItem', () => {
      it('should check for existing conversation and return status if workflow is running', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        mockInitiativeRefinementService.getActiveRefinementConversation.mockResolvedValue(
          testIds.conversation,
        );
        mockConversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(true);

        const result = await controller.refineWorkItem(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
          testIds.user,
        );

        expect(result).toEqual({
          entityId: testIds.initiative,
          conversationId: testIds.conversation,
          workflowId: testIds.workflow,
          currentLevel: 'description',
        });
      });

      it('should create new conversation when none exists', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        mockInitiativeRefinementService.getActiveRefinementConversation.mockResolvedValue(
          null,
        );
        mockInitiativeRefinementService.createRefinementConversation.mockResolvedValue(
          {
            conversation: mockConversation,
            entities: [mockInitiativeEntity],
          },
        );
        mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(true);

        await controller.refineWorkItem(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
          testIds.user,
        );

        expect(
          mockInitiativeRefinementService.createRefinementConversation,
        ).toHaveBeenCalledWith(
          testIds.initiative,
          'initiative',
          testIds.organization,
          testIds.project,
          undefined,
          testIds.user,
        );
      });

      it('should restart workflow if not running', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        mockInitiativeRefinementService.getActiveRefinementConversation.mockResolvedValue(
          testIds.conversation,
        );
        mockConversationService.findOne.mockResolvedValue(mockConversation);
        mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(false);

        mockWorkflowTypeRegistryService.startWorkflowByType.mockResolvedValue({
          workflowId: 'new-workflow-id',
          conversationId: testIds.conversation,
          success: true,
        });

        const result = await controller.refineWorkItem(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
          testIds.user,
        );

        expect(
          mockWorkflowTypeRegistryService.startWorkflowByType,
        ).toHaveBeenCalled();
        expect(result.workflowId).toBe('new-workflow-id');
      });

      it('should throw NotFoundException when work item not found', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          null,
        );

        await expect(
          controller.refineWorkItem(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            testIds.user,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('updateContent', () => {
      const updateRequest = {
        sections: TestUtils.createMockWorkItemSectionInputs({
          description: 'Updated description',
          details: 'Updated details',
          acceptanceCriteria: 'Updated criteria',
        }),
        priority: Priority.High,
        assigneeId: testIds.user,
        requestFeedback: true,
        feedbackContext: 'Please review',
      };

      it('should update work item content with all fields', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        const updatedEntity = {
          ...mockInitiativeEntity,
          priority: updateRequest.priority,
          assigneeId: updateRequest.assigneeId,
        };
        mockInitiativeRefinementService.applySectionUpdates.mockResolvedValue(
          updatedEntity as any,
        );
        mockInitiativeService.updateForAdapter.mockResolvedValue(
          updatedEntity as any,
        );

        const result = await controller.updateContent(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
          updateRequest,
        );

        expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
          testIds.initiative,
          {
            name: undefined,
            status: undefined,
            priority: updateRequest.priority,
            assigneeId: updateRequest.assigneeId,
          },
          testIds.organization,
        );

        expect(result).toEqual({
          feedbackRequested: true,
          workItem: updatedEntity,
          updatedFields: [
            'priority',
            'assigneeId',
            'description',
            'details',
            'acceptanceCriteria',
          ],
        });
      });

      it('should update work item content with partial fields', async () => {
        const partialUpdate = {
          sections: [
            {
              key: 'description',
              content: 'Updated description only',
            },
          ],
        };
        mockTaskRefinementService.findOneForAdapter.mockResolvedValue(
          mockTaskEntity,
        );
        const updatedEntity = { ...mockTaskEntity, ...partialUpdate };
        mockTaskRefinementService.applySectionUpdates.mockResolvedValue(
          updatedEntity as any,
        );
        mockTaskService.updateForAdapter.mockResolvedValue(
          updatedEntity as any,
        );

        const result = await controller.updateContent(
          testIds.organization,
          testIds.project,
          'task',
          testIds.task,
          partialUpdate,
        );

        expect(result.updatedFields).toEqual(['description']);
        expect(result.feedbackRequested).toBe(false);
      });

      it('should throw BadRequestException when no fields provided', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );

        await expect(
          controller.updateContent(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            {},
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw NotFoundException when work item not found', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          null,
        );

        await expect(
          controller.updateContent(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            updateRequest,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('advanceLevel', () => {
      const advanceRequest = {
        currentLevel: 'description' as RefinementLevel,
        targetLevel: 'details' as RefinementLevel,
      };

      it('should advance work item to next level', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        mockInitiativeRefinementService.canAdvanceToNextLevel.mockReturnValue(
          true,
        );
        const advancedEntity = {
          ...mockInitiativeEntity,
          status: WorkStatus.RefiningDetails,
        };
        mockInitiativeService.updateForAdapter.mockResolvedValue(
          advancedEntity as any,
        );

        const result = await controller.advanceLevel(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
          advanceRequest,
        );

        expect(
          mockInitiativeRefinementService.canAdvanceToNextLevel,
        ).toHaveBeenCalledWith(mockInitiativeEntity, 'description');
        expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
          testIds.initiative,
          {
            name: undefined,
            status: WorkStatus.RefiningDetails,
            priority: undefined,
            assigneeId: undefined,
          },
          testIds.organization,
        );

        expect(result).toEqual({
          entityId: testIds.initiative,
          currentLevel: 'details',
        });
      });

      it('should advance to auto-determined next level when target not specified', async () => {
        const requestWithoutTarget = {
          currentLevel: 'description' as RefinementLevel,
        };
        mockTaskRefinementService.findOneForAdapter.mockResolvedValue(
          mockTaskEntity,
        );
        mockTaskRefinementService.canAdvanceToNextLevel.mockReturnValue(true);
        const advancedTask = {
          ...mockTaskEntity,
          status: WorkStatus.RefiningAcceptanceCriteria,
        };
        mockTaskService.updateForAdapter.mockResolvedValue(advancedTask as any);

        const result = await controller.advanceLevel(
          testIds.organization,
          testIds.project,
          'task',
          testIds.task,
          requestWithoutTarget,
        );

        expect(result.currentLevel).toBe('acceptanceCriteria');
      });

      it('should reject task requests that use legacy details level', async () => {
        await expect(
          controller.advanceLevel(
            testIds.organization,
            testIds.project,
            'task',
            testIds.task,
            {
              currentLevel: 'description' as RefinementLevel,
              targetLevel: 'details' as RefinementLevel,
            },
          ),
        ).rejects.toThrow(
          "Task refinement level 'details' is no longer supported. Use 'description' and 'acceptanceCriteria'.",
        );
      });

      it('should skip validation when skipValidation is true', async () => {
        const mismatchedInitiative = {
          ...mockInitiativeEntity,
          status: WorkStatus.RefiningDetails, // Different from request currentLevel
        };
        const skipValidationRequest = {
          ...advanceRequest,
          skipValidation: true,
        };

        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mismatchedInitiative,
        );
        mockInitiativeRefinementService.canAdvanceToNextLevel.mockReturnValue(
          false,
        );
        mockInitiativeService.updateForAdapter.mockResolvedValue(
          mismatchedInitiative as any,
        );

        const result = await controller.advanceLevel(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
          skipValidationRequest,
        );

        expect(result.currentLevel).toBe('details');
      });

      it('should throw BadRequestException when current level mismatch and validation not skipped', async () => {
        const mismatchedInitiative = {
          ...mockInitiativeEntity,
          status: WorkStatus.RefiningDetails,
        };
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mismatchedInitiative,
        );

        await expect(
          controller.advanceLevel(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            advanceRequest,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when cannot advance further', async () => {
        const finalLevelRequest = {
          currentLevel: 'acceptanceCriteria' as RefinementLevel,
        };

        const finalLevelInitiative = {
          ...mockInitiativeEntity,
          status: WorkStatus.RefiningAcceptanceCriteria,
        };

        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          finalLevelInitiative,
        );

        await expect(
          controller.advanceLevel(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            finalLevelRequest,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw BadRequestException when advancement blocked and validation not skipped', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        mockInitiativeRefinementService.canAdvanceToNextLevel.mockReturnValue(
          false,
        );

        await expect(
          controller.advanceLevel(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            advanceRequest,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw NotFoundException when work item not found', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          null,
        );

        await expect(
          controller.advanceLevel(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            advanceRequest,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('finalizeRefinement', () => {
      it('should finalize work item at acceptance_criteria level', async () => {
        const finalLevelInitiative = {
          ...mockInitiativeEntity,
          status: WorkStatus.RefiningAcceptanceCriteria,
        };
        const finalizedInitiative = {
          ...finalLevelInitiative,
          status: WorkStatus.Active,
        };

        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          finalLevelInitiative,
        );
        mockInitiativeService.updateForAdapter.mockResolvedValue(
          finalizedInitiative as any,
        );

        const result = await controller.finalizeRefinement(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
        );

        expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
          testIds.initiative,
          {
            name: undefined,
            status: WorkStatus.Active,
            priority: undefined,
            assigneeId: undefined,
          },
          testIds.organization,
        );

        expect(result).toEqual({
          success: true,
          message: 'initiative refinement finalized successfully',
          status: 'finalized',
          entityId: testIds.initiative,
          currentLevel: 'acceptanceCriteria',
          metadata: {
            finalizedAt: expect.any(String),
            finalStatus: WorkStatus.Active,
          },
        });
      });

      it('should finalize task work item', async () => {
        const finalLevelTask = {
          ...mockTaskEntity,
          status: WorkStatus.RefiningAcceptanceCriteria,
        };
        const finalizedTask = {
          ...finalLevelTask,
          status: WorkStatus.Completed,
        };

        mockTaskRefinementService.findOneForAdapter.mockResolvedValue(
          finalLevelTask,
        );
        mockTaskService.updateForAdapter.mockResolvedValue(
          finalizedTask as any,
        );

        const result = await controller.finalizeRefinement(
          testIds.organization,
          testIds.project,
          'task',
          testIds.task,
        );

        expect(result.metadata?.finalStatus).toBe(WorkStatus.Completed);
      });

      it('should finalize BUG task at description level', async () => {
        const bugTask = toTaskRefinableEntity(
          TestUtils.createMockTaskResponseDto({
            id: testIds.task,
            type: WORK_ITEM_TYPE_KEYS.Bug,
            status: WorkStatus.RefiningDescription,
          }),
        );
        const finalizedBugTask = {
          ...bugTask,
          status: WorkStatus.Active,
        };

        mockTaskRefinementService.findOneForAdapter.mockResolvedValue(bugTask);
        mockTaskService.updateForAdapter.mockResolvedValue(
          finalizedBugTask as any,
        );

        const result = await controller.finalizeRefinement(
          testIds.organization,
          testIds.project,
          'task',
          testIds.task,
        );

        expect(result.currentLevel).toBe('description');
        expect(result.metadata?.finalStatus).toBe(WorkStatus.Active);
      });

      it('should throw BadRequestException when not at acceptance_criteria level', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );

        await expect(
          controller.finalizeRefinement(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw NotFoundException when work item not found', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          null,
        );

        await expect(
          controller.finalizeRefinement(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('getRefinementStatus', () => {
      it('should return comprehensive refinement status for initiative', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          mockInitiativeEntity,
        );
        mockInitiativeRefinementService.canAdvanceToNextLevel.mockReturnValue(
          true,
        );

        const result = await controller.getRefinementStatus(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
        );

        expect(result).toEqual({
          entityId: testIds.initiative,
          entityType: 'initiative',
          currentLevel: 'description',
          nextLevel: 'details',
          status: WorkStatus.RefiningDescription,
          progress: {
            currentLevel: 'description',
            nextLevel: 'details',
            progressPercentage: 33,
            canAdvance: true,
            canFinalize: false,
          },
          contentState: {
            hasDescription: true,
            hasDetails: true,
            hasAcceptanceCriteria: true,
          },
          availableActions: ['advance', 'update_content', 'refine_message'],
        });
      });

      it('should return status for task with finalize action available', async () => {
        const finalLevelTask = {
          ...mockTaskEntity,
          status: WorkStatus.RefiningAcceptanceCriteria,
        };
        mockTaskRefinementService.findOneForAdapter.mockResolvedValue(
          finalLevelTask,
        );
        mockTaskRefinementService.canAdvanceToNextLevel.mockReturnValue(false);

        const result = await controller.getRefinementStatus(
          testIds.organization,
          testIds.project,
          'task',
          testIds.task,
        );

        expect(result.progress.canFinalize).toBe(true);
        expect(result.availableActions).toContain('finalize');
      });

      it('should handle empty content fields', async () => {
        const emptyContentInitiative: InitiativeRefinableEntity = {
          ...mockInitiativeEntity,
          description: '',
          details: '   ', // Whitespace only
          acceptanceCriteria: '',
        };
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          emptyContentInitiative,
        );
        mockInitiativeRefinementService.canAdvanceToNextLevel.mockReturnValue(
          false,
        );

        const result = await controller.getRefinementStatus(
          testIds.organization,
          testIds.project,
          'initiative',
          testIds.initiative,
        );

        expect(result.contentState).toEqual({
          hasDescription: false,
          hasDetails: false,
          hasAcceptanceCriteria: false,
        });
        expect(result.availableActions).not.toContain('advance');
      });

      it('should throw NotFoundException when work item not found', async () => {
        mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
          null,
        );

        await expect(
          controller.getRefinementStatus(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle end-to-end refinement workflow for initiative', async () => {
      // Setup initial initiative at description level
      const descriptionInitiative = { ...mockInitiativeEntity };
      mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
        descriptionInitiative,
      );
      mockInitiativeRefinementService.canAdvanceToNextLevel.mockReturnValue(
        true,
      );

      // Get status
      const statusResult = await controller.getRefinementStatus(
        testIds.organization,
        testIds.project,
        'initiative',
        testIds.initiative,
      );
      expect(statusResult.currentLevel).toBe('description');

      // Update content
      mockInitiativeService.updateForAdapter.mockResolvedValue({
        ...descriptionInitiative,
        description: 'Updated description',
      } as any);
      mockInitiativeRefinementService.applySectionUpdates.mockResolvedValue(
        descriptionInitiative as any,
      );

      const updateResult = await controller.updateContent(
        testIds.organization,
        testIds.project,
        'initiative',
        testIds.initiative,
        {
          sections: TestUtils.createMockWorkItemSectionInputs({
            description: 'Updated description',
          }),
        },
      );
      expect(updateResult.feedbackRequested).toBe(false);

      // Advance level - reset mock to return description level initiative first
      mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(
        descriptionInitiative,
      );
      const detailsInitiative = {
        ...descriptionInitiative,
        status: WorkStatus.RefiningDetails,
      };
      mockInitiativeService.updateForAdapter.mockResolvedValue(
        detailsInitiative as any,
      );

      const advanceResult = await controller.advanceLevel(
        testIds.organization,
        testIds.project,
        'initiative',
        testIds.initiative,
        { currentLevel: 'description' },
      );
      expect(advanceResult.currentLevel).toBe('details');
    });

    it('should handle task-specific entity type routing', async () => {
      mockTaskRefinementService.findOneForAdapter.mockResolvedValue(
        mockTaskEntity,
      );
      mockTaskRefinementService.canAdvanceToNextLevel.mockReturnValue(true);

      const result = await controller.getRefinementStatus(
        testIds.organization,
        testIds.project,
        'task',
        testIds.task,
      );

      expect(result.entityType).toBe('task');
      expect(mockTaskRefinementService.findOneForAdapter).toHaveBeenCalled();
      expect(
        mockInitiativeRefinementService.findOneForAdapter,
      ).not.toHaveBeenCalled();
    });

    it('should maintain consistent error handling across all endpoints', async () => {
      // Test consistent NotFoundException for missing work items
      mockInitiativeRefinementService.findOneForAdapter.mockResolvedValue(null);

      const endpoints = [
        () =>
          controller.refineWorkItem(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            testIds.user,
          ),
        () =>
          controller.updateContent(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            {
              sections: TestUtils.createMockWorkItemSectionInputs({
                description: 'test',
              }),
            },
          ),
        () =>
          controller.advanceLevel(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
            { currentLevel: 'description' },
          ),
        () =>
          controller.finalizeRefinement(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
          ),
        () =>
          controller.getRefinementStatus(
            testIds.organization,
            testIds.project,
            'initiative',
            testIds.initiative,
          ),
      ];

      for (const endpoint of endpoints) {
        await expect(endpoint()).rejects.toThrow(NotFoundException);
      }
    });
  });
});
