/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Staged Content Service – Design Doc Focused Tests
 *
 * These tests cover the design document flows that were recently implemented,
 * verifying refine/advance behavior and workflow orchestration.
 */

import { BadRequestException } from '@nestjs/common';
import { DesignDocStagedContentAdapter } from '../../../adapters/staged-content/design-doc.adapter';
import { WorkItemStagedContentAdapter } from '../../../adapters/staged-content/work-item.adapter';
import { ADR_DESIGN_DOC_CONTENT_TYPE } from '../../../config/content-types/design-doc.config';
import { INITIATIVE_CONTENT_TYPE } from '../../../config/content-types/initiative.config';
import { WORK_ITEM_CONTENT_TYPE } from '../../../config/content-types/work-item.config';
import { AdrStatus } from '../../../generated';
import { ConversationResponseDto } from '../../../generated/model/conversationResponseDto';
import { ConversationStatus } from '../../../generated/model/conversationStatus';
import { InitiationType } from '../../../generated/model/initiationType';
import { WorkflowName } from '../../../generated/model/workflowName';
import {
  ContentTypeDefinition,
  StageDefinition,
  StageOperation,
  ValidationError,
} from '../../../types/staged-content.types';
import { StagedDesignDoc } from '../../../types/staged-design-doc.types';
import {
  ChangeDetectionResult,
  OptimizationContext as TaskOptimizationContext,
} from '../../../types/refinable-entity.types';
import { toTaskRefinableEntity } from '../../../types/task-refinement-adapter.types';
import { InitiativeRefinableEntity } from '../../../types/initiative-refinement-adapter.types';
import * as TestUtils from '../../../utils/testUtils';
import { ConversationService } from '../../conversation.service';
import {
  InitiativeChangeDetection,
  InitiativeOptimizationService,
  OptimizationContext as InitiativeOptimizationContext,
} from '../../initiatives/initiative-optimization.service';
import { InitiativeRefinementService } from '../../initiatives/initiative-refinement.service';
import { TaskOptimizationService } from '../../tasks/task-optimization.service';
import { TaskRefinementService } from '../../tasks/task-refinement.service';
import { WorkflowRouterService } from '../../workflows/workflow-router.service';
import { WorkflowTypeRegistryService } from '../../workflows/workflow-type-registry.service';
import { ContentTypeRegistryService } from '../content-type-registry.service';
import { StagedContentService } from '../staged-content.service';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { WorkStatus } from '@prisma/client';

const { testIds } = TestUtils;

describe('StagedContentService (design docs)', () => {
  let service: StagedContentService;
  let contentTypeRegistry: jest.Mocked<ContentTypeRegistryService>;
  let designDocAdapter: jest.Mocked<DesignDocStagedContentAdapter>;
  let workItemAdapter: jest.Mocked<WorkItemStagedContentAdapter>;
  let taskRefinementService: jest.Mocked<TaskRefinementService>;
  let taskOptimizationService: jest.Mocked<TaskOptimizationService>;
  let initiativeRefinementService: jest.Mocked<InitiativeRefinementService>;
  let initiativeOptimizationService: jest.Mocked<InitiativeOptimizationService>;
  let conversationService: jest.Mocked<ConversationService>;
  let workflowRouter: jest.Mocked<WorkflowRouterService>;
  let workflowTypeRegistry: jest.Mocked<WorkflowTypeRegistryService>;
  let taskRefinementEntity: ReturnType<typeof toTaskRefinableEntity>;
  let initiativeRefinementEntity: InitiativeRefinableEntity;

  const now = new Date().toISOString();
  const designDocEntity: StagedDesignDoc = {
    id: testIds.designDoc,
    name: 'Test ADR',
    template: 'ADR',
    context: 'Initial context for the architectural decision.',
    decision: 'Initial decision summary.',
    consequences: 'Initial consequences summary.',
    statusNotes: 'Initial status notes.',
    sections: {
      context: 'Initial context for the architectural decision.',
      decision: 'Initial decision summary.',
      consequences: 'Initial consequences summary.',
      statusNotes: 'Initial status notes.',
    },
    organizationId: testIds.organization,
    projectId: testIds.project,
    currentStage: 'context',
    status: 'ADR_CONTEXT',
    tags: [],
    createdAt: now,
    updatedAt: now,
  };

  const workItemEntity = {
    id: testIds.task,
    entityType: 'task' as const,
    name: 'Sample task',
    description: 'Original task description',
    details: 'Existing details',
    acceptanceCriteria: 'Existing AC',
    status: 'REFINING_DESCRIPTION' as WorkStatus,
    currentStage: 'description',
    projectId: testIds.project,
    organizationId: testIds.organization,
    createdAt: now,
    updatedAt: now,
  };

  const initiativeEntity = {
    id: testIds.initiative,
    entityType: 'initiative' as const,
    name: 'Sample initiative',
    description: 'Original initiative description',
    details: 'Existing initiative details',
    acceptanceCriteria: 'Existing initiative AC',
    status: 'REFINING_DESCRIPTION',
    currentStage: 'description',
    projectId: testIds.project,
    organizationId: testIds.organization,
    createdAt: now,
    updatedAt: now,
  };

  const baseRefineOperation: StageOperation = {
    contentTypeId: 'adr',
    entityId: designDocEntity.id,
    organizationId: testIds.organization,
    projectId: testIds.project,
    operationType: 'refine',
    payload: {
      message: 'Please help refine this ADR.',
    },
  };

  beforeEach(async () => {
    contentTypeRegistry = {
      get: jest.fn((contentTypeId: ContentTypeDefinition['id']) => {
        if (contentTypeId === 'adr') {
          return ADR_DESIGN_DOC_CONTENT_TYPE;
        }
        if (contentTypeId === 'initiative') {
          return INITIATIVE_CONTENT_TYPE;
        }
        if (contentTypeId === 'work-item') {
          return WORK_ITEM_CONTENT_TYPE;
        }
        throw new Error(`Unsupported content type ${contentTypeId}`);
      }),
      register: jest.fn(),
      getAll: jest.fn(),
      isRegistered: jest.fn(),
    } as unknown as jest.Mocked<ContentTypeRegistryService>;

    designDocAdapter = {
      findEntity: jest.fn(),
      findActiveConversation: jest.fn(),
      createConversation: jest.fn(),
      updateEntity: jest.fn(),
      validateStageContent: jest.fn(),
    } as unknown as jest.Mocked<DesignDocStagedContentAdapter>;

    workItemAdapter =
      TestUtils.createMockWorkItemAdapter() as unknown as jest.Mocked<WorkItemStagedContentAdapter>;

    taskRefinementService = TestUtils.createMockTaskRefinementService();

    taskOptimizationService = {
      detectChanges: jest.fn(),
      generateOptimizationContext: jest.fn(),
      isFieldEmpty: jest.fn(),
    } as unknown as jest.Mocked<TaskOptimizationService>;

    initiativeRefinementService =
      TestUtils.createMockInitiativeRefinementService();

    // Default refinable entity lookups
    taskRefinementEntity = toTaskRefinableEntity(
      TestUtils.createMockTaskResponseDto({
        id: workItemEntity.id,
        name: workItemEntity.name,
        sections: TestUtils.createMockMaterializedTaskSections({
          description: workItemEntity.description,
          acceptanceCriteria: workItemEntity.acceptanceCriteria,
        }),
        organizationId: workItemEntity.organizationId,
        status: workItemEntity.status,
        initiativeId: testIds.initiative,
        createdAt: workItemEntity.createdAt,
        updatedAt: workItemEntity.updatedAt,
      }),
    );

    initiativeRefinementEntity = TestUtils.createMockInitiativeRefinableEntity({
      id: initiativeEntity.id,
      name: initiativeEntity.name,
      description: initiativeEntity.description,
      details: initiativeEntity.details,
      acceptanceCriteria: initiativeEntity.acceptanceCriteria,
      organizationId: initiativeEntity.organizationId,
      status: initiativeEntity.status,
      createdAt: initiativeEntity.createdAt,
      updatedAt: initiativeEntity.updatedAt,
    });

    taskRefinementService.findOne.mockResolvedValue(taskRefinementEntity);
    taskRefinementService.findOneForAdapter.mockResolvedValue(
      taskRefinementEntity,
    );
    initiativeRefinementService.findOne.mockResolvedValue(
      initiativeRefinementEntity,
    );

    initiativeOptimizationService = {
      detectChanges: jest.fn(),
      generateOptimizationContext: jest.fn(),
      shouldForceGenerationForEmptyField: jest.fn(),
    } as unknown as jest.Mocked<InitiativeOptimizationService>;

    const setup = await createServiceTestingModule({
      providers: [StagedContentService],
      overrides: [
        [ContentTypeRegistryService, contentTypeRegistry],
        [DesignDocStagedContentAdapter, designDocAdapter],
        [WorkItemStagedContentAdapter, workItemAdapter],
        [TaskRefinementService, taskRefinementService],
        [TaskOptimizationService, taskOptimizationService],
        [InitiativeRefinementService, initiativeRefinementService],
        [InitiativeOptimizationService, initiativeOptimizationService],
      ],
    });

    service = setup.module.get(StagedContentService);
    conversationService = setup.mocks.conversationService;
    workflowRouter = setup.mocks.workflowRouterService;
    workflowTypeRegistry = setup.mocks.workflowTypeRegistryService;
    workflowTypeRegistry.validateWorkflowName.mockImplementation(
      (workflowName: string) => workflowName as WorkflowName,
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  function createConversationRecord(
    overrides: Partial<ConversationResponseDto> = {},
  ): ConversationResponseDto {
    return TestUtils.createMockConversation({
      id: testIds.conversation,
      projectId: testIds.project,
      organizationId: testIds.organization,
      workflowId: testIds.workflow,
      workflowAboutType: 'design-doc',
      triggerEvent: 'staged_content_session_created',
      status: ConversationStatus.Started,
      title: 'Design Document Refinement',
      workflowName: WorkflowName.Adr,
      workflowAboutId: designDocEntity.id,
      initiatedBy: InitiationType.User,
      ...overrides,
    });
  }

  function createWorkItemConversationRecord(
    overrides: Partial<ConversationResponseDto> = {},
  ): ConversationResponseDto {
    return TestUtils.createMockConversation({
      id: testIds.conversation,
      projectId: testIds.project,
      organizationId: testIds.organization,
      workflowId: testIds.workflow,
      workflowAboutType: 'task',
      triggerEvent: 'staged_content_session_created',
      status: ConversationStatus.Started,
      title: 'Task Refinement',
      workflowName: WorkflowName.TaskRefinement,
      workflowAboutId: workItemEntity.id,
      initiatedBy: InitiationType.User,
      ...overrides,
    });
  }

  function createInitiativeConversationRecord(
    overrides: Partial<ConversationResponseDto> = {},
  ): ConversationResponseDto {
    return createWorkItemConversationRecord({
      workflowAboutType: 'initiative',
      workflowName: WorkflowName.InitiativeRefinement,
      workflowAboutId: initiativeEntity.id,
      title: 'Initiative Refinement',
      ...overrides,
    });
  }

  describe('processStageOperation – refine', () => {
    it('returns existing conversation/workflow when an active workflow is running', async () => {
      designDocAdapter.findEntity.mockResolvedValue({
        ...designDocEntity,
        decision:
          'This decision content is already comprehensive and exceeds all validation thresholds required for this stage.',
      });
      designDocAdapter.findActiveConversation.mockResolvedValue({
        id: testIds.conversation,
        workflowId: testIds.workflow,
      });
      conversationService.getConversation.mockResolvedValue(
        createConversationRecord(),
      );
      workflowRouter.isWorkflowRunning.mockResolvedValue(true);

      const result = await service.processStageOperation(baseRefineOperation);

      expect(result.success).toBe(true);
      expect(result.conversationId).toBe(testIds.conversation);
      expect(result.workflowId).toBe(testIds.workflow);
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
      expect(workflowRouter.isWorkflowRunning).toHaveBeenCalledWith(
        testIds.workflow,
      );
      expect(
        conversationService.updateConversationWorkflowId,
      ).not.toHaveBeenCalled();
    });

    it('starts a new workflow when none is active', async () => {
      designDocAdapter.findEntity.mockResolvedValue({
        ...designDocEntity,
        decision: '',
      });
      designDocAdapter.findActiveConversation.mockResolvedValue({
        id: testIds.conversation,
        workflowId: undefined,
      });
      conversationService.getConversation.mockResolvedValue(
        createConversationRecord({ workflowId: undefined }),
      );
      conversationService.updateConversationWorkflowId.mockResolvedValue(
        createConversationRecord(),
      );
      workflowTypeRegistry.startWorkflowByType.mockResolvedValue({
        success: true,
        conversationId: testIds.conversation,
        workflowId: testIds.workflow,
      });

      const result = await service.processStageOperation(baseRefineOperation);

      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledWith(
        WorkflowName.Adr,
        testIds.conversation,
        testIds.project,
        testIds.organization,
        'system',
        'Design Document Refinement',
        'design-doc',
        designDocEntity.id,
      );
      expect(result.workflowId).toBe(testIds.workflow);
      expect(
        conversationService.updateConversationWorkflowId,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.workflow,
        testIds.organization,
      );
    });

    it('throws when project context is missing for refinement', async () => {
      designDocAdapter.findEntity.mockResolvedValue({
        ...designDocEntity,
        projectId: undefined,
      });
      designDocAdapter.findActiveConversation.mockResolvedValue(null);

      await expect(
        service.processStageOperation({
          ...baseRefineOperation,
          projectId: undefined as unknown as typeof testIds.project,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(workflowTypeRegistry.startWorkflowByType).not.toHaveBeenCalled();
    });

    it('starts initiative refinement workflow when no active workflow exists', async () => {
      workItemAdapter.findEntity.mockResolvedValue(initiativeEntity);
      initiativeRefinementService.getActiveRefinementConversation.mockResolvedValue(
        testIds.conversation,
      );
      conversationService.getConversation.mockResolvedValue(
        createInitiativeConversationRecord({ workflowId: undefined }),
      );
      workflowTypeRegistry.startWorkflowByType.mockResolvedValue({
        success: true,
        conversationId: testIds.conversation,
        workflowId: testIds.workflow,
      });
      conversationService.updateConversationWorkflowId.mockResolvedValue(
        createInitiativeConversationRecord(),
      );

      const result = await service.processStageOperation({
        contentTypeId: 'initiative',
        entityId: initiativeEntity.id,
        organizationId: testIds.organization,
        projectId: testIds.project,
        operationType: 'refine',
        payload: {
          message: 'Please help refine this initiative.',
        },
      });

      expect(workflowTypeRegistry.startWorkflowByType).toHaveBeenCalledWith(
        WorkflowName.InitiativeRefinement,
        testIds.conversation,
        testIds.project,
        testIds.organization,
        'system',
        'Initiative Refinement',
        'initiative',
        initiativeEntity.id,
      );
      expect(
        conversationService.updateConversationWorkflowId,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        testIds.workflow,
        testIds.organization,
      );
      expect(result.workflowId).toBe(testIds.workflow);
      expect(result.conversationId).toBe(testIds.conversation);
      expect(result.newStage).toBe('description');
    });
  });

  describe('processStageOperation – advance', () => {
    it('returns validation warnings when overriding validation failures', async () => {
      const operation: StageOperation = {
        contentTypeId: 'adr',
        entityId: designDocEntity.id,
        organizationId: testIds.organization,
        projectId: testIds.project,
        operationType: 'advance',
        payload: {
          targetStage: 'decision',
          validationOverride: true,
        },
      };

      const validationErrors: ValidationError[] = [
        {
          field: 'context',
          rule: 'min_length',
          message: 'Context must include additional detail.',
          code: 'MIN_LENGTH',
          severity: 'error',
        },
      ];

      designDocAdapter.findEntity.mockResolvedValue({ ...designDocEntity });
      designDocAdapter.validateStageContent.mockResolvedValue(validationErrors);
      designDocAdapter.updateEntity.mockResolvedValue({
        ...designDocEntity,
        status: AdrStatus.AdrDecision,
        currentStage: 'decision',
        updatedAt: new Date().toISOString(),
      });
      designDocAdapter.findActiveConversation.mockResolvedValue({
        id: testIds.conversation,
        workflowId: testIds.workflow,
      });
      conversationService.getConversation.mockResolvedValue(
        createConversationRecord(),
      );
      workflowRouter.isWorkflowRunning.mockResolvedValue(true);

      const result = await service.processStageOperation(operation);

      expect(result.validationErrors).toEqual(validationErrors);
      expect(result.warnings).toEqual([
        'Context must include additional detail.',
      ]);
      expect(result.newStage).toBe('decision');
      expect(designDocAdapter.updateEntity).toHaveBeenCalledWith(
        designDocEntity.id,
        { status: AdrStatus.AdrGeneratingDecision },
        testIds.organization,
      );
    });

    it('skips workflow routing when the target stage already contains content', async () => {
      const operation: StageOperation = {
        contentTypeId: 'adr',
        entityId: designDocEntity.id,
        organizationId: testIds.organization,
        projectId: testIds.project,
        operationType: 'advance',
        payload: {
          targetStage: 'decision',
        },
      };

      designDocAdapter.findEntity.mockResolvedValue({
        ...designDocEntity,
        decision:
          'A sufficiently long decision statement that needs no AI generation.',
      });
      designDocAdapter.validateStageContent.mockResolvedValue([]);
      designDocAdapter.updateEntity.mockResolvedValue({
        ...designDocEntity,
        status: AdrStatus.AdrDecision,
        currentStage: 'decision',
        decision:
          'A sufficiently long decision statement that needs no AI generation.',
      });

      jest
        .spyOn(
          service as unknown as {
            shouldTriggerDesignDocWorkflow: () => boolean;
          },
          'shouldTriggerDesignDocWorkflow',
        )
        .mockReturnValue(false);

      const result = await service.processStageOperation(operation);

      expect(result.workflowId).toBeUndefined();
      expect(designDocAdapter.findActiveConversation).not.toHaveBeenCalled();
      expect(workflowRouter.sendSkipToNode).not.toHaveBeenCalled();
      expect(designDocAdapter.updateEntity).toHaveBeenCalledWith(
        designDocEntity.id,
        { status: AdrStatus.AdrDecision },
        testIds.organization,
      );
    });
  });

  describe('processStageOperation – work item advance with change detection', () => {
    const baseAdvanceOperation: StageOperation = {
      contentTypeId: 'work-item',
      entityId: workItemEntity.id,
      organizationId: testIds.organization,
      projectId: testIds.project,
      operationType: 'advance',
      payload: {
        targetStage: 'acceptanceCriteria',
      },
    };

    beforeEach(() => {
      taskRefinementService.canAdvanceToNextLevel.mockReturnValue(true);
      taskRefinementService.getActiveRefinementConversation.mockResolvedValue(
        testIds.conversation,
      );
      conversationService.getConversation.mockResolvedValue(
        createWorkItemConversationRecord(),
      );
      workflowRouter.isWorkflowRunning.mockResolvedValue(true);
      workItemAdapter.validateStageTransition.mockResolvedValue([]);
      workItemAdapter.canAdvanceToStage?.mockResolvedValue(true);
      taskRefinementService.findOne.mockResolvedValue(taskRefinementEntity);
      taskRefinementService.findOneForAdapter.mockResolvedValue(
        taskRefinementEntity,
      );
      initiativeRefinementService.canAdvanceToNextLevel?.mockReturnValue(true);
      initiativeRefinementService.getActiveRefinementConversation.mockResolvedValue(
        testIds.conversation,
      );
    });

    it('skips generation and routes to editor when no changes are detected', async () => {
      workItemAdapter.findEntity
        .mockResolvedValueOnce({ ...workItemEntity }) // initial load
        .mockResolvedValueOnce({
          ...workItemEntity,
          currentStage: 'acceptanceCriteria',
          status: 'REFINING_ACCEPTANCE_CRITERIA',
        }); // reload after status update

      workItemAdapter.updateEntity.mockResolvedValue({
        ...workItemEntity,
        status: 'REFINING_ACCEPTANCE_CRITERIA',
      });

      const changeDetectionResult: ChangeDetectionResult = {
        hasChanges: false,
        changesSummary: 'No changes',
        confidenceScore: 1,
        affectedFields: [],
        changeType: 'minor',
      };
      const optimizationContext: TaskOptimizationContext = {
        shouldSkipLlm: true,
        optimizationHints: [],
        processingRecommendation: 'skip',
      };

      taskOptimizationService.detectChanges.mockResolvedValue(
        changeDetectionResult,
      );
      taskOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      const result = await service.processStageOperation(baseAdvanceOperation);

      expect(workItemAdapter.updateEntity).toHaveBeenCalledWith(
        workItemEntity.id,
        { status: 'REFINING_ACCEPTANCE_CRITERIA' },
        testIds.organization,
        'task',
      );
      expect(workflowRouter.sendSkipToNode).not.toHaveBeenCalled();
      expect(result.message).toContain('without regeneration');
      expect(result.workflowId).toBe(testIds.workflow);
    });

    it('triggers generation and routes to next-level node when changes are detected', async () => {
      workItemAdapter.findEntity
        .mockResolvedValueOnce({ ...workItemEntity })
        .mockResolvedValueOnce({
          ...workItemEntity,
          currentStage: 'description',
          status: 'GENERATING_ACCEPTANCE_CRITERIA',
        });

      workItemAdapter.updateEntity.mockResolvedValue({
        ...workItemEntity,
        status: 'GENERATING_ACCEPTANCE_CRITERIA',
      });

      const changeDetectionResult: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Description changed',
        confidenceScore: 0.9,
        affectedFields: ['description'],
        changeType: 'major',
      };
      const optimizationContext: TaskOptimizationContext = {
        shouldSkipLlm: false,
        optimizationHints: [],
        processingRecommendation: 'generate',
      };

      taskOptimizationService.detectChanges.mockResolvedValue(
        changeDetectionResult,
      );
      taskOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      const result = await service.processStageOperation(baseAdvanceOperation);

      expect(workItemAdapter.updateEntity).toHaveBeenCalledWith(
        workItemEntity.id,
        { status: 'GENERATING_ACCEPTANCE_CRITERIA' },
        testIds.organization,
        'task',
      );
      expect(workflowRouter.sendSkipToNode).toHaveBeenCalledWith(
        testIds.workflow,
        'task-refinement-agent-next-level',
      );
      expect(result.message).toContain('Generating');
    });

    it('forces generation when the target field is empty', async () => {
      const entityWithEmptyAcceptanceCriteria = {
        ...workItemEntity,
        acceptanceCriteria: '',
      };

      workItemAdapter.findEntity
        .mockResolvedValueOnce(entityWithEmptyAcceptanceCriteria)
        .mockResolvedValueOnce({
          ...entityWithEmptyAcceptanceCriteria,
          currentStage: 'description',
          status: 'GENERATING_ACCEPTANCE_CRITERIA',
        });

      workItemAdapter.updateEntity.mockResolvedValue({
        ...entityWithEmptyAcceptanceCriteria,
        status: 'GENERATING_ACCEPTANCE_CRITERIA',
      });

      const optimizationContext: TaskOptimizationContext = {
        shouldSkipLlm: true,
        optimizationHints: [],
        processingRecommendation: 'skip',
      };

      taskOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      const result = await service.processStageOperation(baseAdvanceOperation);

      // Should not rely on change detection when the field is empty
      expect(taskOptimizationService.detectChanges).not.toHaveBeenCalled();
      expect(workItemAdapter.updateEntity).toHaveBeenCalledWith(
        workItemEntity.id,
        { status: 'GENERATING_ACCEPTANCE_CRITERIA' },
        testIds.organization,
        'task',
      );
      expect(workflowRouter.sendSkipToNode).toHaveBeenCalledWith(
        testIds.workflow,
        'task-refinement-agent-next-level',
      );
      expect(result.message).toContain('Generating');
    });

    it('respects acceptanceCriteria stage mapping and uses editor when skipping generation', async () => {
      const entityAtDescription = {
        ...workItemEntity,
        currentStage: 'description',
        status: 'REFINING_DESCRIPTION',
        acceptanceCriteria: 'Existing AC',
      };

      workItemAdapter.findEntity
        .mockResolvedValueOnce(entityAtDescription)
        .mockResolvedValueOnce({
          ...entityAtDescription,
          currentStage: 'acceptanceCriteria',
          status: 'REFINING_ACCEPTANCE_CRITERIA',
        });
      workItemAdapter.updateEntity.mockResolvedValue({
        ...entityAtDescription,
        status: 'REFINING_ACCEPTANCE_CRITERIA',
      });

      const changeDetectionResult: ChangeDetectionResult = {
        hasChanges: false,
        confidenceScore: 1,
      };
      const optimizationContext: TaskOptimizationContext = {
        shouldSkipLlm: true,
        optimizationHints: [],
        processingRecommendation: 'skip',
      };

      taskOptimizationService.detectChanges.mockResolvedValue(
        changeDetectionResult,
      );
      taskOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      const result = await service.processStageOperation({
        ...baseAdvanceOperation,
        payload: { targetStage: 'acceptanceCriteria' },
      });

      expect(workItemAdapter.updateEntity).toHaveBeenCalledWith(
        workItemEntity.id,
        { status: 'REFINING_ACCEPTANCE_CRITERIA' },
        testIds.organization,
        'task',
      );
      expect(workflowRouter.sendSkipToNode).not.toHaveBeenCalled();
      expect(result.newStage).toBe('acceptanceCriteria');
    });

    it('routes initiatives through initiative optimization and next-level node when changes detected', async () => {
      const initiativeWithDetails = {
        ...initiativeEntity,
        currentStage: 'description',
        status: 'REFINING_DESCRIPTION',
      };

      workItemAdapter.findEntity
        .mockResolvedValueOnce(initiativeWithDetails)
        .mockResolvedValueOnce({
          ...initiativeWithDetails,
          currentStage: 'description',
          status: 'GENERATING_ACCEPTANCE_CRITERIA',
        });
      workItemAdapter.updateEntity.mockResolvedValue({
        ...initiativeWithDetails,
        status: 'GENERATING_ACCEPTANCE_CRITERIA',
      });

      const changeDetectionResult: InitiativeChangeDetection = {
        hasChanges: true,
        changesSummary: 'Details updated',
        changedFields: ['details'],
        confidenceScore: 0.9,
        originalData: null,
        currentData: {
          name: initiativeWithDetails.name,
          description: initiativeWithDetails.description,
          priority: 'medium',
          tags: [],
          status: initiativeWithDetails.status,
          details: initiativeWithDetails.details,
          acceptanceCriteria: initiativeWithDetails.acceptanceCriteria,
        },
        semanticSimilarity: {
          name: 0.9,
          description: 0.4,
          overall: 0.6,
        },
        fieldLevelChanges: {},
      };
      const optimizationContext: InitiativeOptimizationContext = {
        shouldSkipLlm: false,
        confidenceScore: 0.9,
        changesSummary: 'Details updated',
        optimizationHints: [],
      };

      initiativeOptimizationService.detectChanges.mockResolvedValue(
        changeDetectionResult,
      );
      initiativeOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      conversationService.getConversation.mockResolvedValue(
        createInitiativeConversationRecord(),
      );

      const result = await service.processStageOperation({
        ...baseAdvanceOperation,
        entityId: initiativeEntity.id,
        payload: { targetStage: 'acceptanceCriteria' },
      });

      expect(workItemAdapter.updateEntity).toHaveBeenCalledWith(
        initiativeEntity.id,
        { status: 'GENERATING_ACCEPTANCE_CRITERIA' },
        testIds.organization,
        'initiative',
      );
      expect(workflowRouter.sendSkipToNode).toHaveBeenCalledWith(
        testIds.workflow,
        'initiative-refinement-agent-next-level',
      );
      expect(result.conversationId).toBe(testIds.conversation);
    });

    it('fails when refinement session cannot be established', async () => {
      const entityWithoutProject = {
        ...workItemEntity,
        projectId: undefined as typeof testIds.project | undefined,
      };

      workItemAdapter.findEntity.mockResolvedValue(entityWithoutProject);
      taskRefinementService.findOne.mockResolvedValue(
        toTaskRefinableEntity(
          TestUtils.createMockTaskResponseDto({
            id: entityWithoutProject.id,
            name: entityWithoutProject.name,
            sections: TestUtils.createMockMaterializedTaskSections({
              description: entityWithoutProject.description,
              acceptanceCriteria: entityWithoutProject.acceptanceCriteria,
            }),
            organizationId: entityWithoutProject.organizationId,
            status: entityWithoutProject.status,
            initiativeId: testIds.initiative,
            createdAt: entityWithoutProject.createdAt,
            updatedAt: entityWithoutProject.updatedAt,
          }),
        ),
      );
      taskRefinementService.getActiveRefinementConversation.mockResolvedValue(
        null,
      );
      conversationService.getConversation.mockResolvedValue(null);
      workItemAdapter.validateStageTransition.mockResolvedValue([]);
      const changeDetectionResult: ChangeDetectionResult = {
        hasChanges: true,
        confidenceScore: 0.9,
      };
      const optimizationContext: TaskOptimizationContext = {
        shouldSkipLlm: false,
        optimizationHints: [],
        processingRecommendation: 'generate',
      };

      taskOptimizationService.detectChanges.mockResolvedValue(
        changeDetectionResult,
      );
      taskOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      await expect(
        service.processStageOperation({
          ...baseAdvanceOperation,
          projectId: undefined as unknown as typeof testIds.project,
        }),
      ).rejects.toThrow('Project context is required');
      expect(workItemAdapter.updateEntity).not.toHaveBeenCalled();
    });

    it('throws when a target stage cannot be mapped to a refinement level', async () => {
      const customContentType: ContentTypeDefinition = {
        ...WORK_ITEM_CONTENT_TYPE,
        id: WORK_ITEM_CONTENT_TYPE.id,
        stages: [
          {
            id: 'overview',
            name: 'overview',
            displayName: 'Overview',
            order: 1,
            contentFields: ['description'],
            nextStages: [],
            validationRules: [],
            interactionType: 'user_input',
            isTerminal: true,
            estimatedDuration: 5,
          },
        ],
        entitySchema: {
          entityType: 'WorkItem',
          statusMapping: {
            overview: 'REFINING_DESCRIPTION',
          },
          progressCalculation: 'linear',
        },
      };

      contentTypeRegistry.get = jest.fn(
        (contentTypeId: ContentTypeDefinition['id']) =>
          contentTypeId === 'work-item'
            ? customContentType
            : ADR_DESIGN_DOC_CONTENT_TYPE,
      );

      const entityForCustomStage = {
        ...workItemEntity,
        currentStage: 'overview',
      };

      workItemAdapter.findEntity.mockResolvedValue(entityForCustomStage);
      taskRefinementService.findOne.mockResolvedValue(
        toTaskRefinableEntity(
          TestUtils.createMockTaskResponseDto({
            id: entityForCustomStage.id,
            name: entityForCustomStage.name,
            sections: TestUtils.createMockMaterializedTaskSections({
              description: entityForCustomStage.description,
              acceptanceCriteria: entityForCustomStage.acceptanceCriteria,
            }),
            organizationId: entityForCustomStage.organizationId,
            status: entityForCustomStage.status,
            initiativeId: testIds.initiative,
            createdAt: entityForCustomStage.createdAt,
            updatedAt: entityForCustomStage.updatedAt,
          }),
        ),
      );
      workItemAdapter.validateStageTransition.mockResolvedValue([]);
      const changeDetectionResult: ChangeDetectionResult = {
        hasChanges: false,
        confidenceScore: 1,
      };
      const optimizationContext: TaskOptimizationContext = {
        shouldSkipLlm: true,
        optimizationHints: [],
        processingRecommendation: 'skip',
      };

      taskOptimizationService.detectChanges.mockResolvedValue(
        changeDetectionResult,
      );
      taskOptimizationService.generateOptimizationContext.mockResolvedValue(
        optimizationContext,
      );

      await expect(
        service.processStageOperation({
          ...baseAdvanceOperation,
          payload: { targetStage: 'overview' },
        }),
      ).rejects.toThrow("Unsupported stage id 'overview'");
    });
  });

  describe('triggerDesignDocWorkflow', () => {
    it('routes generating statuses to the next-level node', async () => {
      designDocAdapter.findActiveConversation.mockResolvedValue({
        id: testIds.conversation,
        workflowId: testIds.workflow,
      });
      conversationService.getConversation.mockResolvedValue(
        createConversationRecord(),
      );
      workflowRouter.isWorkflowRunning.mockResolvedValue(true);

      const fallbackStage = ADR_DESIGN_DOC_CONTENT_TYPE.stages[0];
      if (!fallbackStage) {
        throw new Error('Expected design doc stage');
      }
      const targetStage =
        ADR_DESIGN_DOC_CONTENT_TYPE.stages.find(
          (stage) => stage.id === 'decision',
        ) ?? fallbackStage;

      await (
        service as unknown as {
          triggerDesignDocWorkflow: (
            entity: StagedDesignDoc,
            organizationId: typeof testIds.organization,
            projectId: typeof testIds.project,
            targetStage: StageDefinition,
          ) => Promise<void>;
        }
      ).triggerDesignDocWorkflow(
        {
          ...designDocEntity,
          status: AdrStatus.AdrGeneratingDecision,
        },
        testIds.organization,
        testIds.project,
        targetStage,
      );

      expect(workflowRouter.sendSkipToNode).toHaveBeenCalledWith(
        testIds.workflow,
        'adr-refinement-agent-next-level',
      );
    });
  });
});
