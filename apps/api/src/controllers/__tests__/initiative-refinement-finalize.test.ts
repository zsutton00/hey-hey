import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { InitiativeLifecycleService } from '../../services/initiatives/initiative-lifecycle.service';
import { InitiativeOptimizationService } from '../../services/initiatives/initiative-optimization.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { MessageClassificationService } from '../../services/message-classification/message-classification.service';
import { WorkflowRouterService } from '../../services/workflows/workflow-router.service';
import { WorkStatus } from '../../generated';
import * as TestUtils from '../../utils/testUtils';
import { InitiativeRefinementController } from '../initiative-refinement.controller';

const { testIds } = TestUtils;

describe('InitiativeRefinementController - POST /conversations/{conversationId}/initiatives/{initiativeId}/finalize', () => {
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

  it('finalizes initiative when status is REFINING_ACCEPTANCE_CRITERIA', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: WorkStatus.RefiningAcceptanceCriteria as any,
      description: 'Description',
      details: 'Details',
      acceptanceCriteria: 'Criteria',
    } as any;

    mockInitiativeService.findOne.mockResolvedValue(mockInitiative);
    mockInitiativeService.update.mockResolvedValue({
      ...mockInitiative,
      status: WorkStatus.Active,
    } as any);

    const result = await controller.finalizeInitiativeByConversation(
      testIds.organization,
      testIds.project,
      testIds.conversation,
      testIds.initiative,
    );

    expect(mockInitiativeService.update).toHaveBeenCalledWith(
      testIds.initiative,
      { status: 'ACTIVE' },
      testIds.organization,
    );
    expect(result).toEqual({
      success: true,
      data: {
        message: 'Initiative successfully finalized',
        initiative: mockInitiative,
        conversationId: testIds.conversation,
      },
    });
  });

  it('throws when initiative is not found', async () => {
    mockInitiativeService.findOne.mockResolvedValue(null);

    await expect(
      controller.finalizeInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
      ),
    ).rejects.toThrow('Initiative not found');
  });

  it('throws when initiative is not at acceptance criteria stage', async () => {
    mockInitiativeService.findOne.mockResolvedValue({
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: WorkStatus.RefiningDetails as any,
    } as any);

    await expect(
      controller.finalizeInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
      ),
    ).rejects.toThrow('Initiative must be complete before finalization');

    expect(mockInitiativeService.update).not.toHaveBeenCalled();
  });

  it('propagates service failures from status update', async () => {
    const mockInitiative = {
      id: testIds.initiative,
      organizationId: testIds.organization,
      name: 'Test Initiative',
      status: WorkStatus.RefiningAcceptanceCriteria as any,
    } as any;

    mockInitiativeService.findOne.mockResolvedValue(mockInitiative);
    mockInitiativeService.update.mockRejectedValue(
      new Error('db write failed'),
    );

    await expect(
      controller.finalizeInitiativeByConversation(
        testIds.organization,
        testIds.project,
        testIds.conversation,
        testIds.initiative,
      ),
    ).rejects.toThrow('db write failed');
  });
});
