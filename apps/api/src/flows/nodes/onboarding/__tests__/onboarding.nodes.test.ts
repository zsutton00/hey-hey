import { PendingEdgeService } from '../../../../services/proposal/pending-edge.service';
import { TestingModule } from '@nestjs/testing';
import * as TestUtils from '../../../../utils/testUtils';
import { OnboardingWelcomeNode } from '../onboarding-welcome.node';
import { OnboardingClarifyConceptNode } from '../onboarding-clarify-concept.node';
import { OnboardingGenerateInitiativesNode } from '../onboarding-generate-initiatives.node';
import { OnboardingCreatePlansNode } from '../onboarding-create-plans.node';
import { OnboardingGeneratePlansNode } from '../onboarding-generate-plans.node';
import { OnboardingSelectOutcomeNode } from '../onboarding-select-outcome.node';
import { FeatureFlagService } from '../../../../services/feature-flag/feature-flag.service';
import { ContextResolutionService } from '../../../../context/services/context-resolution.service';
import {
  NodeType,
  RepositoryImportFlowContext as OnboardingFlowContext,
} from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { createServiceTestingModule } from '../../../../../test/setup/testing-module.factory';
import { ConversationService } from '../../../../services/conversation.service';
import { InitiativeService } from '../../../../services/initiatives/initiative.service';
import { TaskService } from '../../../../services/tasks/task.service';
import {
  ConversationStatus,
  ExtendedUIFieldType,
  MultipleChoiceAction,
  WorkflowName,
} from '../../../../generated';
import { SHARED_NODES } from '../../../constants';
import {
  ClaudeModel,
  LLMProviderName,
} from '../../../../services/llm/llm-shared';

const createFlowContext = (): OnboardingFlowContext =>
  TestUtils.createMockFlowContext({
    core: {
      ...TestUtils.createMockFlowContext().core,
      projectId: TestUtils.testIds.project,
      organizationId: TestUtils.testIds.organization,
      workflowId: TestUtils.testIds.workflow,
    },
  });

describe('Onboarding nodes', () => {
  it('OnboardingClarifyConceptNode forces schema-constrained LLM output', () => {
    const node = new OnboardingClarifyConceptNode();

    expect(node.promptConfig).toEqual(
      expect.objectContaining({
        modelCriteria: {
          model: ClaudeModel.CLAUDE_5_HAIKU_5,
          provider: LLMProviderName.CLAUDE,
        },
        useToolCallSchema: true,
        toolName: 'onboarding_clarify_concept',
      }),
    );

    const providerResult = node.promptConfig.responseSchema.safeParse({
      response: 'I need one detail.',
      detectedIntent: 'assess_current_implementation',
      intentConfidence: 0.85,
      uiElements: [],
    });

    expect(providerResult.success).toBe(true);
    if (providerResult.success) {
      expect(providerResult.data).not.toHaveProperty('type');
    }
  });

  it('OnboardingClarifyConceptNode adds the server-owned message discriminator after validation', async () => {
    const node = new OnboardingClarifyConceptNode();

    const result = await node.processLlmResponse({
      response: 'I need one detail.',
      detectedIntent: 'assess_current_implementation',
      intentConfidence: 0.85,
      uiElements: [],
    });

    expect(result.modifiedResult).toEqual({
      type: 'QUESTIONS',
      response: 'I need one detail.',
      detectedIntent: 'assess_current_implementation',
      intentConfidence: 0.85,
      uiElements: [],
    });
  });

  it.each([
    ['TIMEOUT', 5000],
    ['RATE_LIMITED', 8000],
    ['RETRYABLE', 5000],
  ] as const)(
    'OnboardingClarifyConceptNode retries recoverable %s failures within the bound',
    async (errorType, retryDelayMs) => {
      const node = new OnboardingClarifyConceptNode();

      const result = await node.compensate(
        createFlowContext(),
        new Error('structured output failed'),
        {
          nodeId: node.id,
          requestId: 'request-1',
          failurePhase: 'execution',
          attemptCount: 1,
          errorClassification: {
            type: errorType,
            permanent: false,
            circuitBreakerTriggered: false,
          },
          transactionState: {
            messageCreated: true,
            jobQueued: true,
            contextModified: false,
            artifactsCreated: false,
          },
          timestamp: new Date(),
        },
      );

      expect(result).toEqual({
        action: 'RETRY',
        retryDelayMs,
        reason: `Concept clarification attempt 2/2 failed with ${errorType}; retrying`,
      });
    },
  );

  it('OnboardingClarifyConceptNode continues to project analysis after recovery is exhausted', async () => {
    const node = new OnboardingClarifyConceptNode();

    const result = await node.compensate(
      createFlowContext(),
      new Error('structured output failed'),
      {
        nodeId: node.id,
        requestId: 'request-1',
        failurePhase: 'execution',
        attemptCount: 2,
        errorClassification: {
          type: 'RETRYABLE',
          permanent: false,
          circuitBreakerTriggered: false,
        },
        transactionState: {
          messageCreated: true,
          jobQueued: true,
          contextModified: false,
          artifactsCreated: false,
        },
        timestamp: new Date(),
      },
    );

    expect(result).toEqual({
      action: 'SKIP_TO_NODE',
      nextNodeId: 'onboarding-analyze-project-concept',
      reason:
        'Concept clarification could not be recovered after 3 attempts; continuing to project analysis',
    });
  });

  it('OnboardingClarifyConceptNode fails non-recoverable errors instead of skipping clarification', async () => {
    const node = new OnboardingClarifyConceptNode();

    const result = await node.compensate(
      createFlowContext(),
      new Error('invalid provider configuration'),
      {
        nodeId: node.id,
        requestId: 'request-1',
        failurePhase: 'execution',
        attemptCount: 0,
        errorClassification: {
          type: 'NON_RETRYABLE',
          permanent: true,
          circuitBreakerTriggered: false,
        },
        transactionState: {
          messageCreated: true,
          jobQueued: true,
          contextModified: false,
          artifactsCreated: false,
        },
        timestamp: new Date(),
      },
    );

    expect(result).toEqual({
      action: 'FAIL',
      reason:
        'Concept clarification failed with non-recoverable NON_RETRYABLE',
    });
  });

  it('OnboardingWelcomeNode returns questions with default UI', async () => {
    const featureFlagService = {
      isEnabled: jest.fn().mockResolvedValue(false),
    };
    const contextResolutionService = { resolveContext: jest.fn() };

    const node = new OnboardingWelcomeNode(
      featureFlagService as unknown as FeatureFlagService,
      contextResolutionService as unknown as ContextResolutionService,
    );

    const context = createFlowContext();
    const result = await node.execute(
      createMutableContextHandle(context) as any,
    );

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements?.[0]).toEqual(
      expect.objectContaining({
        id: 'project_concept',
        required: true,
      }),
    );
    expect(featureFlagService.isEnabled).toHaveBeenCalledWith(
      'organizational_intelligence',
      expect.objectContaining({
        organizationId: TestUtils.testIds.organization,
      }),
    );
  });

  it('OnboardingGenerateInitiativesNode converts LLM response into action data', async () => {
    const initiativeService = TestUtils.createMockInitiativeService();
    const conversationService = TestUtils.createMockConversationService();

    initiativeService.createFromDrafts.mockResolvedValue([
      {
        id: 'initiative-1',
        name: 'Improve deployment pipeline',
        status: 'REFINING_DESCRIPTION',
        organizationId: TestUtils.testIds.organization,
      },
    ] as any);
    conversationService.createConversation.mockResolvedValue({
      id: 'conversation-1',
      workflowName: WorkflowName.InitiativeRefinement,
      status: ConversationStatus.InProgress,
    } as any);

    const setup = await createServiceTestingModule({
      providers: [OnboardingGenerateInitiativesNode],
      overrides: [
        [InitiativeService, initiativeService],
        [ConversationService, conversationService],
      ],
    });

    const module: TestingModule = setup.module;
    const node = module.get(OnboardingGenerateInitiativesNode);

    const tracker = createMutableContextHandle(createFlowContext());
    const { modifiedResult } = await node.processLlmResponse(
      {
        initiatives: [
          {
            name: 'Improve deployment pipeline',
            description: 'Automate build and release workflows',
            details: 'Introduce CI/CD with automated tests',
            acceptanceCriteria: 'Deployments are automated with rollback',
            estimatedEffort: 'medium',
            priority: 'high',
            tags: ['devops'],
            reasoning: 'Enables faster releases',
            influences: [],
          },
        ],
        detectedIntent: 'initiative_generation_complete',
        intentConfidence: 0.9,
        type: 'INITIATIVES',
        response: 'Created initiatives for your project.',
      } as any,
      undefined,
      tracker as any,
    );

    expect(initiativeService.createFromDrafts).toHaveBeenCalled();
    expect(conversationService.createConversation).toHaveBeenCalled();
    expect(modifiedResult.generatedInitiativeIds).toHaveLength(1);
    expect(modifiedResult.conversationIds).toHaveLength(1);

    await module.close();
  });

  it('OnboardingSelectOutcomeNode emits multiple-choice payload with onboarding branch actions', async () => {
    const node = new OnboardingSelectOutcomeNode();
    const result = await node.execute(
      createMutableContextHandle(createFlowContext()),
    );

    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements).toHaveLength(1);
    expect(result.uiElements?.[0]).toEqual({
      id: 'onboarding_output_path',
      type: ExtendedUIFieldType.MultipleChoice,
      label: 'What would you like to create next?',
      required: true,
      influences: [],
      payload: {
        options: [
          {
            title: 'Create Plan',
            description:
              'Use this for fast-moving, simpler projects that need a lightweight starting point.',
            action: MultipleChoiceAction.CreatePlan,
          },
          {
            title: 'Create Initiative',
            description:
              'Use this for longer-running, multi-user projects with deeper coordination needs.',
            action: MultipleChoiceAction.CreateInitiative,
          },
        ],
      },
    });
  });

  it('OnboardingSelectOutcomeNode routes to plan generation when user picks create-plan', async () => {
    const node = new OnboardingSelectOutcomeNode();
    const context = createFlowContext();
    const nextNode = await node.determineRoutingFromUserMessage(context, {
      data: {
        onboarding_output_path: MultipleChoiceAction.CreatePlan,
      },
    } as any);

    expect(nextNode).toBe(SHARED_NODES.GENERATE_PLANS);
  });

  it('OnboardingSelectOutcomeNode routes to initiative generation when user picks create-initiative', async () => {
    const node = new OnboardingSelectOutcomeNode();
    const context = createFlowContext();
    const nextNode = await node.determineRoutingFromUserMessage(context, {
      data: {
        onboarding_output_path: {
          action: MultipleChoiceAction.CreateInitiative,
        },
      },
    } as any);

    expect(nextNode).toBe(SHARED_NODES.GENERATE_INITIATIVES);
  });

  it('OnboardingSelectOutcomeNode ignores legacy snake_case onboarding actions after hard switch', async () => {
    const node = new OnboardingSelectOutcomeNode();
    const context = createFlowContext();
    const nextNode = await node.determineRoutingFromUserMessage(context, {
      data: {
        onboarding_output_path: 'create_initiatives',
      },
    } as any);

    expect(nextNode).toBeUndefined();
  });

  it('OnboardingGeneratePlansNode stores ranked proposals and routes accepted selections to create plans', async () => {
    const node = new OnboardingGeneratePlansNode();
    const tracker = createMutableContextHandle(createFlowContext());

    const llmResult = await node.processLlmResponse(
      {
        response: 'Here are the top plan candidates.',
        plans: [
          {
            title: 'Candidate A',
            description: 'First candidate',
            outcome: 'Outcome A',
            evidenceWeight: 0.82,
            rationale: 'Strong signal from onboarding discussion',
          },
          {
            title: 'Candidate B',
            description: 'Second candidate',
            outcome: 'Outcome B',
            evidenceWeight: 0.61,
            rationale: 'Useful but secondary signal',
          },
        ],
      } as any,
      undefined,
      tracker as any,
    );

    expect(llmResult.modifiedResult?.detectedIntent).toBe(
      'onboarding_plan_candidates_proposed',
    );
    expect(
      (tracker.getContext() as OnboardingFlowContext).onboardingPlanProposal
        ?.candidates,
    ).toHaveLength(2);

    const approveMessage = {
      data: {
        onboarding_plan_candidate_proposals: {
          action: 'APPROVED',
          payload: {
            userMessage: 'Looks good',
            stageFeedback: [
              {
                sequenceOrder: 1,
                title: 'Candidate A',
                action: 'accept',
              },
              {
                sequenceOrder: 2,
                title: 'Candidate B',
                action: 'reject',
              },
            ],
          },
        },
      },
    } as any;

    await node.processUserResponse(tracker as any, approveMessage);
    const route = await node.determineRoutingFromUserMessage(
      tracker.getContext(),
      approveMessage,
    );

    expect(route).toBe(SHARED_NODES.CREATE_PLANS);
    expect(
      (tracker.getContext() as OnboardingFlowContext).onboardingPlanProposal
        ?.acceptedCandidateIds,
    ).toHaveLength(1);
  });

  it('OnboardingCreatePlansNode creates only accepted plans and links onboarding conversation', async () => {
    const planService = {
      create: jest
        .fn()
        .mockResolvedValueOnce({
          id: 'plan-1',
          title: 'Plan A',
        })
        .mockResolvedValueOnce({
          id: 'plan-2',
          title: 'Plan B',
        }),
    } as unknown as jest.Mocked<TaskService>;

    const edges = { materializeEdges: jest.fn().mockResolvedValue(undefined) };
    const setup = await createServiceTestingModule({
      providers: [OnboardingCreatePlansNode],
      overrides: [[TaskService, planService], [PendingEdgeService, edges]],
    });

    const module: TestingModule = setup.module;
    const node = module.get(OnboardingCreatePlansNode);
    const baseContext = createFlowContext();
    const tracker = createMutableContextHandle({
      ...baseContext,
      onboardingPlanProposal: {
        round: 2,
        response: 'Refined plan candidates.',
        candidates: [
          {
            id: 'candidate-1',
            title: 'Plan A',
            description: 'Desc A',
            outcome: 'Outcome A',
            evidenceWeight: 0.92,
            rationale: 'Top signal',
          },
          {
            id: 'candidate-2',
            title: 'Plan B',
            description: 'Desc B',
            outcome: 'Outcome B',
            evidenceWeight: 0.81,
            rationale: 'Second signal',
          },
          {
            id: 'candidate-3',
            title: 'Plan C',
            description: 'Desc C',
            outcome: 'Outcome C',
            evidenceWeight: 0.52,
            rationale: 'Lower signal',
          },
        ],
        acceptedCandidateIds: ['candidate-1', 'candidate-2'],
      } as any,
    });

    const result = await node.execute(tracker as any);

    expect(planService.create).toHaveBeenCalledTimes(2);
    expect(edges.materializeEdges).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('action');
    expect(result.message).toContain('Created 2 accepted plans');

    await module.close();
  });

  it('OnboardingCreatePlansNode fails with manual-link compensation guidance when relationship linking fails', async () => {
    const planService = {
      create: jest.fn().mockResolvedValue({
        id: 'plan-1',
        title: 'Plan A',
      }),
    } as unknown as jest.Mocked<TaskService>;

    const edges = { materializeEdges: jest.fn().mockRejectedValue(new Error('relationship insert failed')) };
    const setup = await createServiceTestingModule({
      providers: [OnboardingCreatePlansNode],
      overrides: [[TaskService, planService], [PendingEdgeService, edges]],
    });

    const module: TestingModule = setup.module;
    const node = module.get(OnboardingCreatePlansNode);
    const tracker = createMutableContextHandle({
      ...createFlowContext(),
      onboardingPlanProposal: {
        round: 1,
        response: 'Candidate list',
        candidates: [
          {
            id: 'candidate-1',
            title: 'Plan A',
            description: 'Desc A',
            outcome: 'Outcome A',
            evidenceWeight: 0.9,
            rationale: 'Top signal',
          },
        ],
        acceptedCandidateIds: ['candidate-1'],
      } as any,
    });

    let thrown: Error | undefined;
    try {
      await node.execute(tracker as any);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown).toBeDefined();
    expect(planService.create).toHaveBeenCalledTimes(1);
    expect(edges.materializeEdges).toHaveBeenCalledTimes(1);

    const compensation = await node.compensate(
      tracker.getContext(),
      thrown as Error,
      {
        nodeId: SHARED_NODES.CREATE_PLANS,
        requestId: 'request-1',
        failurePhase: 'execution',
        attemptCount: 1,
        errorClassification: {
          type: 'NON_RETRYABLE',
          permanent: true,
          circuitBreakerTriggered: false,
        },
        transactionState: {
          messageCreated: true,
          jobQueued: true,
          contextModified: false,
          artifactsCreated: false,
        },
        timestamp: new Date(),
      },
    );

    expect(compensation.action).toBe('FAIL');
    expect(compensation.reason).toContain('linked manually');

    await module.close();
  });
});
