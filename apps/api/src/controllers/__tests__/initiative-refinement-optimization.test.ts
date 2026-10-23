import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { INITIATIVE_REFINEMENT_NODES } from '../../flows/constants';
import { InitiativeLifecycleService } from '../../services/initiatives/initiative-lifecycle.service';
import { InitiativeOptimizationService } from '../../services/initiatives/initiative-optimization.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { MessageClassificationService } from '../../services/message-classification/message-classification.service';
import { WorkflowRouterService } from '../../services/workflows/workflow-router.service';
import * as TestUtils from '../../utils/testUtils';
import { InitiativeRefinementController } from '../initiative-refinement.controller';

const { testIds } = TestUtils;

describe('InitiativeRefinementController - Optimization Service Integration', () => {
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
    };
    mockInitiativeService = TestUtils.createMockInitiativeService();
    mockInitiativeOptimizationService =
      TestUtils.createMockInitiativeOptimizationService();
    mockMessageClassificationService =
      TestUtils.createMockMessageClassificationService() as unknown as jest.Mocked<MessageClassificationService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InitiativeRefinementController],
      providers: [
        {
          provide: InitiativeLifecycleService,
          useValue: mockInitiativeLifecycleService,
        },
        { provide: WorkflowRouterService, useValue: mockWorkflowRouterService },
        { provide: InitiativeService, useValue: mockInitiativeService },
        {
          provide: InitiativeOptimizationService,
          useValue: mockInitiativeOptimizationService,
        },
        {
          provide: MessageClassificationService,
          useValue: mockMessageClassificationService,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InitiativeRefinementController>(
      InitiativeRefinementController,
    );
  });

  const wireBasePrerequisites = async (initiative: any): Promise<void> => {
    mockInitiativeService.findOne.mockResolvedValue(initiative);
    mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
      testIds.conversation,
    );
    mockInitiativeLifecycleService.getInitiativeCreationConversation.mockResolvedValue(
      TestUtils.createMockConversation({ workflowId: testIds.workflow }),
    );
    mockWorkflowRouterService.isWorkflowRunning.mockResolvedValue(true);
    mockInitiativeService.update.mockResolvedValue(initiative);
  };

  it('calls detectChanges and generateOptimizationContext when next-level content exists', async () => {
    const initiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Updated description',
      details: 'Existing details',
      acceptanceCriteria: '',
    } as any;

    const changeDetection = {
      hasChanges: false,
      changesSummary: 'No significant changes',
      confidenceScore: 0.95,
      semanticSimilarity: { name: 0.95, description: 0.95, overall: 0.95 },
      fieldLevelChanges: {},
    } as any;

    await wireBasePrerequisites(initiative);
    mockInitiativeOptimizationService.detectChanges.mockResolvedValue(
      changeDetection,
    );
    mockInitiativeOptimizationService.generateOptimizationContext.mockResolvedValue(
      {
        shouldSkipLlm: true,
        confidenceScore: 0.95,
      } as any,
    );

    await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'description' },
    );

    expect(
      mockInitiativeOptimizationService.detectChanges,
    ).toHaveBeenCalledWith(testIds.initiative, testIds.organization);
    expect(
      mockInitiativeOptimizationService.generateOptimizationContext,
    ).toHaveBeenCalledWith(changeDetection);
  });

  it('routes to prompt input when optimization says to skip generation', async () => {
    const initiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DETAILS',
      description: 'Description',
      details: 'Existing details',
      acceptanceCriteria: 'Existing criteria',
    } as any;

    await wireBasePrerequisites(initiative);
    mockInitiativeOptimizationService.detectChanges.mockResolvedValue({
      hasChanges: false,
      confidenceScore: 0.95,
      semanticSimilarity: { name: 0.95, description: 0.95, overall: 0.95 },
      fieldLevelChanges: {},
    } as any);
    mockInitiativeOptimizationService.generateOptimizationContext.mockResolvedValue(
      {
        shouldSkipLlm: true,
        confidenceScore: 0.95,
      } as any,
    );

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'details' },
    );

    expect(result.targetNode).toBe(INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT);
    expect(mockWorkflowRouterService.sendSkipToNode).toHaveBeenCalledWith(
      testIds.workflow,
      INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT,
    );
  });

  it('routes to agent next level when optimization indicates generation is needed', async () => {
    const initiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DETAILS',
      description: 'Description',
      details: 'Existing details',
      acceptanceCriteria: 'Existing criteria',
    } as any;

    await wireBasePrerequisites(initiative);
    mockInitiativeOptimizationService.detectChanges.mockResolvedValue({
      hasChanges: true,
      confidenceScore: 0.85,
      semanticSimilarity: { name: 0.9, description: 0.8, overall: 0.85 },
      fieldLevelChanges: { details: 'MAJOR' },
    } as any);
    mockInitiativeOptimizationService.generateOptimizationContext.mockResolvedValue(
      {
        shouldSkipLlm: false,
        confidenceScore: 0.85,
      } as any,
    );

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'details' },
    );

    expect(result.targetNode).toBe(
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
    expect(mockWorkflowRouterService.sendSkipToNode).toHaveBeenCalledWith(
      testIds.workflow,
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
  });

  it('skips optimization service calls when next-level field is empty', async () => {
    const initiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DESCRIPTION',
      description: 'Description',
      details: '',
      acceptanceCriteria: '',
    } as any;

    await wireBasePrerequisites(initiative);

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'description' },
    );

    expect(result.targetNode).toBe(
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
    expect(
      mockInitiativeOptimizationService.detectChanges,
    ).not.toHaveBeenCalled();
    expect(
      mockInitiativeOptimizationService.generateOptimizationContext,
    ).not.toHaveBeenCalled();
  });

  it('falls back to agent routing when optimization service throws', async () => {
    const initiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: 'REFINING_DETAILS',
      description: 'Description',
      details: 'Existing details',
      acceptanceCriteria: 'Existing criteria',
    } as any;

    await wireBasePrerequisites(initiative);
    mockInitiativeOptimizationService.detectChanges.mockRejectedValue(
      new Error('Optimization service unavailable'),
    );

    const result = await controller.deepenInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
      { currentLevel: 'details' },
    );

    expect(result.success).toBe(true);
    expect(result.targetNode).toBe(
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
    expect(mockWorkflowRouterService.sendSkipToNode).toHaveBeenCalledWith(
      testIds.workflow,
      INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
    );
  });
});
