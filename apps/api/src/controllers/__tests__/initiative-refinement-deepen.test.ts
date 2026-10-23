/* eslint-disable @typescript-eslint/unbound-method */
import { InitiativeLifecycleService } from '../../services/initiatives/initiative-lifecycle.service';
import { InitiativeOptimizationService } from '../../services/initiatives/initiative-optimization.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { MessageClassificationService } from '../../services/message-classification/message-classification.service';
import { WorkflowRouterService } from '../../services/workflows/workflow-router.service';
import { INITIATIVE_REFINEMENT_NODES } from '../../flows/constants';
import * as TestUtils from '../../utils/testUtils';
import { InitiativeRefinementController } from '../initiative-refinement.controller';
import { createServiceTestingModule } from '../../../test/setup/testing-module.factory';

const { testIds } = TestUtils;

describe('InitiativeRefinementController - POST /conversations/{conversationId}/initiatives/{initiativeId}/deepen', () => {
  let controller: InitiativeRefinementController;
  let mockInitiativeLifecycleService: jest.Mocked<InitiativeLifecycleService>;
  let mockWorkflowRouterService: jest.Mocked<
    Pick<
      WorkflowRouterService,
      'isWorkflowRunning' | 'sendStructuredMessage' | 'sendSkipToNode'
    >
  >;
  let mockInitiativeService: jest.Mocked<InitiativeService>;
  let mockInitiativeOptimizationService: jest.Mocked<InitiativeOptimizationService>;
  let mockMessageClassificationService: jest.Mocked<MessageClassificationService>;

  beforeEach(async () => {
    mockInitiativeLifecycleService =
      TestUtils.createMockInitiativeLifecycleService() as unknown as jest.Mocked<InitiativeLifecycleService>;
    mockWorkflowRouterService = {
      isWorkflowRunning: jest.fn(),
      sendStructuredMessage: jest.fn(),
      sendSkipToNode: jest.fn(),
    } as jest.Mocked<
      Pick<
        WorkflowRouterService,
        'isWorkflowRunning' | 'sendStructuredMessage' | 'sendSkipToNode'
      >
    >;
    mockInitiativeService = TestUtils.createMockInitiativeService();
    mockInitiativeOptimizationService =
      TestUtils.createMockInitiativeOptimizationService();
    mockMessageClassificationService =
      TestUtils.createMockMessageClassificationService() as unknown as jest.Mocked<MessageClassificationService>;

    const setup = await createServiceTestingModule({
      controllers: [InitiativeRefinementController],
      providers: [
        InitiativeLifecycleService,
        WorkflowRouterService,
        InitiativeService,
        InitiativeOptimizationService,
        MessageClassificationService,
      ],
      overrides: [
        [InitiativeLifecycleService, mockInitiativeLifecycleService],
        [WorkflowRouterService, mockWorkflowRouterService],
        [InitiativeService, mockInitiativeService],
        [InitiativeOptimizationService, mockInitiativeOptimizationService],
        [MessageClassificationService, mockMessageClassificationService],
      ],
    });

    controller = setup.module.get<InitiativeRefinementController>(
      InitiativeRefinementController,
    );
  });

  const mockConversation = TestUtils.createMockConversation({
    id: testIds.conversation,
    workflowId: testIds.workflow,
  });

  const wireValidPrerequisites = async (initiative: any): Promise<void> => {
    mockInitiativeService.findOne.mockResolvedValue(initiative);
    mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
      testIds.conversation,
    );
    mockInitiativeLifecycleService.getInitiativeCreationConversation.mockResolvedValue(
      mockConversation,
    );
    mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(true);
    mockInitiativeService.update.mockResolvedValue(initiative);
  };

  it('advances status and skips generation when optimization says to skip', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Updated description',
      details: 'Existing details content',
      acceptanceCriteria: '',
    } as any;

    await wireValidPrerequisites(mockInitiative);
    mockInitiativeOptimizationService.detectChanges.mockResolvedValue({
      hasChanges: false,
      changesSummary: 'No significant changes',
      confidenceScore: 0.95,
      semanticSimilarity: { name: 0.95, description: 0.95, overall: 0.95 },
      fieldLevelChanges: {},
    } as any);
    mockInitiativeOptimizationService.generateOptimizationContext.mockResolvedValue(
      {
        hasChanges: false,
        shouldSkipLlm: true,
        confidenceScore: 0.95,
      } as any,
    );

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'description' },
    );

    expect(result.status).toBe('status_advanced');
    expect(result.currentLevel).toBe('details');
    expect(result.targetNode).toBe(INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT);
    expect(mockInitiativeService.update).toHaveBeenCalledWith(
      testIds.initiative,
      expect.objectContaining({ status: 'REFINING_DETAILS' }),
      testIds.organization,
    );
    expect(mockWorkflowRouterService.sendSkipToNode).toHaveBeenCalledWith(
      testIds.workflow,
      INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT,
    );
  });

  it('forces initial generation when next-level field is empty', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Some description',
      details: '',
      acceptanceCriteria: '',
    } as any;

    await wireValidPrerequisites(mockInitiative);

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'description' },
    );

    expect(result.status).toBe('generating_initial_content');
    expect(result.currentLevel).toBe('description');
    expect(result.targetNode).toBe(
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
    expect(mockInitiativeService.update).toHaveBeenCalledWith(
      testIds.initiative,
      expect.objectContaining({ status: 'GENERATING_DETAILS' }),
      testIds.organization,
    );
  });

  it('falls back to generation when optimization throws', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Some description',
      details: 'Existing details',
      acceptanceCriteria: '',
    } as any;

    await wireValidPrerequisites(mockInitiative);
    mockInitiativeOptimizationService.detectChanges.mockRejectedValue(
      new Error('detectChanges failed'),
    );

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'description' },
    );

    expect(result.success).toBe(true);
    expect(result.status).toBe('deepening_in_progress');
    expect(result.targetNode).toBe(
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
    expect(mockInitiativeService.update).toHaveBeenCalledWith(
      testIds.initiative,
      expect.objectContaining({ status: 'GENERATING_DETAILS' }),
      testIds.organization,
    );
  });

  it('throws when attempting to deepen from final acceptance criteria level', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_ACCEPTANCE_CRITERIA',
      description: 'Some description',
      details: 'Existing details',
      acceptanceCriteria: 'Existing criteria',
    } as any;

    await wireValidPrerequisites(mockInitiative);
    mockInitiativeOptimizationService.detectChanges.mockResolvedValue({
      hasChanges: true,
      changesSummary: 'Changes detected',
      confidenceScore: 0.8,
      semanticSimilarity: { name: 0.9, description: 0.8, overall: 0.85 },
      fieldLevelChanges: { acceptanceCriteria: 'MAJOR' },
    } as any);
    mockInitiativeOptimizationService.generateOptimizationContext.mockResolvedValue(
      {
        hasChanges: true,
        shouldSkipLlm: false,
        confidenceScore: 0.8,
      } as any,
    );

    await expect(
      controller.deepenInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
        { currentLevel: 'details' },
      ),
    ).rejects.toThrow(
      'Cannot determine next section for level acceptanceCriteria',
    );
  });

  it('blocks deepen while initiative is generating', async () => {
    const generatingStatuses = [
      'GENERATING_DESCRIPTION',
      'GENERATING_DETAILS',
      'GENERATING_ACCEPTANCE_CRITERIA',
    ];

    for (const status of generatingStatuses) {
      mockInitiativeService.findOne.mockResolvedValue({
        id: testIds.initiative,
        organizationId: testIds.organization,
        status,
      } as any);

      await expect(
        controller.deepenInitiativeByConversation(
          testIds.organization,
          testIds.project,
          testIds.conversation,
          testIds.initiative,
          { currentLevel: 'description' },
        ),
      ).rejects.toThrow(
        'Cannot deepen initiative while AI is generating content',
      );
    }
  });

  it('throws when conversation cannot be loaded', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Some description',
      details: 'Existing details',
      acceptanceCriteria: '',
    } as any;

    mockInitiativeService.findOne.mockResolvedValue(mockInitiative);
    mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
      testIds.conversation,
    );
    mockInitiativeLifecycleService.getInitiativeCreationConversation.mockResolvedValue(
      null,
    );

    await expect(
      controller.deepenInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
        { currentLevel: 'description' },
      ),
    ).rejects.toThrow('Conversation not found');
  });

  it('throws when workflow is not running', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Some description',
      details: 'Existing details',
      acceptanceCriteria: '',
    } as any;

    mockInitiativeService.findOne.mockResolvedValue(mockInitiative);
    mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
      testIds.conversation,
    );
    mockInitiativeLifecycleService.getInitiativeCreationConversation.mockResolvedValue(
      mockConversation,
    );
    mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(false);

    await expect(
      controller.deepenInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
        { currentLevel: 'description' },
      ),
    ).rejects.toThrow('Workflow is not running or has completed');
  });

  it('throws when provided conversation is not the active refinement conversation', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Some description',
      details: 'Existing details',
      acceptanceCriteria: '',
    } as any;

    mockInitiativeService.findOne.mockResolvedValue(mockInitiative);
    mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
      'different-conversation-id' as any,
    );

    await expect(
      controller.deepenInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
        { currentLevel: 'description' },
      ),
    ).rejects.toThrow(
      'Provided conversation ID does not match active refinement conversation',
    );
  });
});
