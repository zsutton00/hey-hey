import {
  FeatureTag,
  MachineExecutionReadinessState,
  RepositoryGroundingAnalysisConfiguration,
  RepositoryGroundingEntryMode,
  RepositoryGroundingPrerequisites,
  RepositoryGroundingSuccess,
  RepositoryGroundingWorkflowContext,
} from '../../../../generated';
import { MachineExecutionReadinessService } from '../../../../services/machine-pairing/machine-execution-readiness.service';
import { MachinePairingService } from '../../../../services/machine-pairing/machine-pairing.service';
import { ServiceService } from '../../../../services/service/service.service';
import {
  RepositoryImportFlowContext as OnboardingFlowContext,
  NodeType,
} from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import * as TestUtils from '../../../../utils/testUtils';
import { ONBOARDING_NODES } from '../../../constants';
import { OnboardingRepositoryGroundingAnalysisNode } from '../repository-grounding-analysis.node';
import { OnboardingRepositoryGroundingConfigurationNode } from '../repository-grounding-configuration.node';
import { OnboardingRepositoryGroundingIntentNode } from '../repository-grounding-intent.node';
import { OnboardingRepositoryGroundingPrerequisitesNode } from '../repository-grounding-prerequisites.node';
import { OnboardingRepositoryGroundingRecoveryNode } from '../repository-grounding-recovery.node';
import { OnboardingRepositoryGroundingStartNode } from '../repository-grounding-start.node';
import {
  buildOnboardingConversationContext,
  REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS,
  REPOSITORY_GROUNDING_FIELDS,
  REPOSITORY_GROUNDING_INTENT_HELPER,
  REPOSITORY_GROUNDING_INTENT_OPTIONS,
  REPOSITORY_GROUNDING_INTENT_QUESTION,
  REPOSITORY_GROUNDING_TYPED_FIELDS,
  parseRepositoryGroundingCompletion,
  parseRepositoryGroundingScopeAnswer,
} from '../repository-grounding.contract';

const createContext = (
  overrides: Partial<OnboardingFlowContext> = {},
): OnboardingFlowContext =>
  TestUtils.createMockFlowContext({
    flowId: 'onboarding',
    ...overrides,
  }) as OnboardingFlowContext;

const userMessage = (data: Record<string, unknown>) =>
  TestUtils.createMockFlowUserMessage({ data: data as never });

const prerequisites: RepositoryGroundingPrerequisites = {
  entryMode: RepositoryGroundingEntryMode.NewProject,
  serviceId: 'service-1',
  confirmedServiceBrief: 'Owns the public API and its persistence boundary.',
  machineId: 'machine-1',
};

const configuration: RepositoryGroundingAnalysisConfiguration = {
  scope: { scope: 'comprehensive' },
  provider: 'codex',
  resolvedFrontierModel: 'gpt-5.4',
  reasoningEffort: 'high',
  fastMode: false,
  bounds: REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS,
};

const acceptedContext: RepositoryGroundingWorkflowContext = {
  prerequisites,
  analysisConfiguration: configuration,
};

const successCompletion: RepositoryGroundingSuccess = {
  outcome: 'success',
  serviceId: 'service-1',
  provider: configuration.provider,
  resolvedFrontierModel: configuration.resolvedFrontierModel,
  narrative: 'The repository centers on a bounded API capability surface.',
  hierarchy: {
    topLevels: [
      {
        id: 'feature-1',
        name: 'API Platform',
        description: 'A product-facing API capability.',
        tag: FeatureTag.Product,
        children: [
          {
            id: 'feature-1-child',
            name: 'API Delivery',
            description: 'Delivers the public API boundary.',
            tag: FeatureTag.Backend,
          },
          {
            id: 'feature-1-child-2',
            name: 'API Discovery',
            description: 'Makes the API capability discoverable to clients.',
            tag: FeatureTag.Frontend,
          },
        ],
      },
    ],
  },
  evidence: [
    {
      path: 'src/app.ts',
      summary: 'Bootstraps the API application.',
      lineStart: 1,
      lineEnd: 12,
    },
  ],
  briefDiscrepancies: [],
};

describe('repository-grounding contract', () => {
  it('keeps the exact intent gate text', () => {
    expect(REPOSITORY_GROUNDING_INTENT_QUESTION).toBe(
      'Do you have an existing body of work you’d like Hey Hey to use to understand this project?',
    );
    expect(REPOSITORY_GROUNDING_INTENT_HELPER).toBe(
      'This might include an existing codebase or other project materials available on your computer.',
    );
    expect(REPOSITORY_GROUNDING_INTENT_OPTIONS).toEqual([
      { value: 'yes', label: 'Yes, import existing work' },
      { value: 'no', label: 'No, continue without it' },
    ]);
  });

  it('requires focused scope text and accepts a typed bounded completion only for its declared action', () => {
    expect(
      parseRepositoryGroundingScopeAnswer('focused', 'authentication'),
    ).toEqual({ scope: 'focused', focus: 'authentication' });
    expect(() => parseRepositoryGroundingScopeAnswer('focused', '  ')).toThrow(
      'focus is required',
    );
    expect(
      parseRepositoryGroundingCompletion('success', successCompletion),
    ).toEqual(successCompletion);
    expect(
      parseRepositoryGroundingCompletion(
        'retryable_failure',
        successCompletion,
      ),
    ).toBeUndefined();
    expect(
      parseRepositoryGroundingCompletion('unknown', successCompletion),
    ).toBeUndefined();
    expect(
      parseRepositoryGroundingCompletion('success', {
        ...successCompletion,
        unexpected: true,
      }),
    ).toBeUndefined();
  });

  it('exposes only the generated onboarding context envelope to conversation creation', () => {
    expect(
      buildOnboardingConversationContext({
        repositoryGrounding: acceptedContext,
        repositoryGroundingIntentRequired: true,
        mockLlmSessionId: 'test-only',
      }),
    ).toEqual({ repositoryGrounding: acceptedContext });
  });
});

describe('repository-grounding onboarding nodes', () => {
  it('renders the exact intent question and routes yes/no without mutating on invalid input', async () => {
    const node = new OnboardingRepositoryGroundingIntentNode();
    const context = createContext({ repositoryGroundingIntentRequired: true });

    const result = await node.execute(createMutableContextHandle(context));
    expect(result.type).toBe(NodeType.QUESTIONS);
    expect(result.uiElements?.[0]).toEqual(
      expect.objectContaining({
        id: REPOSITORY_GROUNDING_FIELDS.intent,
        label: REPOSITORY_GROUNDING_INTENT_QUESTION,
        placeholder: REPOSITORY_GROUNDING_INTENT_HELPER,
        options: REPOSITORY_GROUNDING_INTENT_OPTIONS,
      }),
    );

    const tracker = createMutableContextHandle(context);
    await node.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_FIELDS.intent]: { choice: 'maybe' },
      }),
    );
    expect(tracker.getContext().repositoryGroundingIntentRequired).toBe(true);

    await node.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_FIELDS.intent]: { choice: 'no' },
      }),
    );
    expect(tracker.getContext().repositoryGroundingIntentRequired).toBe(false);
    await expect(
      node.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({
          [REPOSITORY_GROUNDING_FIELDS.intent]: { choice: 'yes' },
        }),
      ),
    ).resolves.toBe(ONBOARDING_NODES.END);
    await expect(
      node.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({
          [REPOSITORY_GROUNDING_FIELDS.intent]: { choice: 'no' },
        }),
      ),
    ).resolves.toBe(ONBOARDING_NODES.CLARIFY_CONCEPT);
  });

  it('normalizes the selected yes/no option value from the select field', async () => {
    const node = new OnboardingRepositoryGroundingIntentNode();
    const context = createContext({ repositoryGroundingIntentRequired: true });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_FIELDS.intent]: 'no',
      }),
    );

    expect(tracker.getContext().repositoryGroundingIntentRequired).toBe(false);
    await expect(
      node.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({
          [REPOSITORY_GROUNDING_FIELDS.intent]: 'yes',
        }),
      ),
    ).resolves.toBe(ONBOARDING_NODES.END);
  });

  it('persists prerequisites only after Service and paired-machine revalidation', async () => {
    const serviceService = {
      findAll: jest.fn().mockResolvedValue([{ id: 'service-1', name: 'API' }]),
    } as unknown as ServiceService;
    const machinePairingService = {
      listMachines: jest.fn().mockResolvedValue([
        {
          machineId: 'machine-1',
          name: 'Laptop',
          pairedAt: new Date(),
          lastSeen: new Date(),
          revokedAt: null,
          authorizationProtocolVersion: 2,
        },
      ]),
    } as unknown as MachinePairingService;
    const machineReadinessService = {
      resolve: jest.fn().mockResolvedValue({
        executionReadiness: MachineExecutionReadinessState.Ready,
      }),
    } as unknown as MachineExecutionReadinessService;
    const node = new OnboardingRepositoryGroundingPrerequisitesNode(
      serviceService,
      machinePairingService,
      machineReadinessService,
    );
    const context = createContext();
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);
    expect(result.uiElements).toHaveLength(1);
    expect(result.uiElements?.[0]).toEqual(
      expect.objectContaining({
        id: 'repository_grounding',
        type: 'repository_grounding',
        payload: expect.objectContaining({
          bounds: expect.any(Object),
          state: { phase: 'prerequisites' },
        }),
      }),
    );

    await node.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_FIELDS.service]: 'service-1',
        [REPOSITORY_GROUNDING_FIELDS.brief]: ' Owns the public API. ',
        [REPOSITORY_GROUNDING_FIELDS.machine]: 'machine-1',
      }),
    );
    expect(tracker.getContext().repositoryGroundingPrerequisites).toEqual({
      entryMode: RepositoryGroundingEntryMode.NewProject,
      serviceId: 'service-1',
      confirmedServiceBrief: 'Owns the public API.',
      machineId: 'machine-1',
    });
    expect(
      await node.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({}),
      ),
    ).toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_CONFIGURATION);
  });

  it('stores the complete runtime configuration and lets the dedicated launch action enter analysis', async () => {
    const context = createContext({
      repositoryGroundingPrerequisites: prerequisites,
    });
    const configurationNode =
      new OnboardingRepositoryGroundingConfigurationNode();
    const tracker = createMutableContextHandle(context);

    await configurationNode.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_TYPED_FIELDS.analysisConfiguration]: {
          ...configuration,
          scope: { scope: 'focused', focus: 'authentication boundaries' },
        },
      }),
    );
    expect(tracker.getContext().repositoryGrounding).toEqual({
      prerequisites,
      analysisConfiguration: {
        ...configuration,
        scope: { scope: 'focused', focus: 'authentication boundaries' },
      },
    });

    const typedStartAnswers = {
      [REPOSITORY_GROUNDING_TYPED_FIELDS.prerequisites]: prerequisites,
      [REPOSITORY_GROUNDING_TYPED_FIELDS.analysisConfiguration]: {
        ...configuration,
        scope: { scope: 'focused', focus: 'authentication boundaries' },
      },
      [REPOSITORY_GROUNDING_TYPED_FIELDS.action]: 'START_ANALYSIS',
    };
    expect(
      await configurationNode.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage(typedStartAnswers),
      ),
    ).toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_ANALYSIS);

    const startNode = new OnboardingRepositoryGroundingStartNode();
    const startResult = await startNode.execute(tracker);
    expect(startResult.uiElements).toEqual([
      expect.objectContaining({
        id: REPOSITORY_GROUNDING_FIELDS.start,
        type: 'select',
      }),
    ]);
    expect(
      await startNode.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({ [REPOSITORY_GROUNDING_FIELDS.start]: 'start' }),
      ),
    ).toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_ANALYSIS);
    expect(
      await startNode.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({ [REPOSITORY_GROUNDING_FIELDS.start]: 'finish_later' }),
      ),
    ).toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_RECOVERY);
  });

  it('keeps saved choices across retry and clears them only when continuing without analysis', async () => {
    const retryableFailure = {
      outcome: 'retryable_failure' as const,
      code: 'machine_unavailable' as const,
      message: 'The paired machine is offline.',
    };
    const context = createContext({
      repositoryGrounding: acceptedContext,
      repositoryGroundingPrerequisites: prerequisites,
      repositoryGroundingAnalysisConfiguration: configuration,
      repositoryGroundingCompletion: retryableFailure,
    });
    const node = new OnboardingRepositoryGroundingRecoveryNode();
    const tracker = createMutableContextHandle(context);

    const result = await node.execute(tracker);
    expect(result.message).toContain('can be retried');

    await node.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_FIELDS.recovery]: 'retry',
      }),
    );
    expect(tracker.getContext().repositoryGrounding).toEqual(acceptedContext);
    expect(
      await node.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({ [REPOSITORY_GROUNDING_FIELDS.recovery]: 'retry' }),
      ),
    ).toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_START);
    expect(
      await node.determineRoutingFromUserMessage(
        tracker.getContext(),
        userMessage({
          [REPOSITORY_GROUNDING_TYPED_FIELDS.prerequisites]: prerequisites,
          [REPOSITORY_GROUNDING_TYPED_FIELDS.analysisConfiguration]:
            configuration,
          [REPOSITORY_GROUNDING_TYPED_FIELDS.action]: 'RETRY_ANALYSIS',
        }),
      ),
    ).toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_ANALYSIS);

    await node.processUserResponse(
      tracker,
      userMessage({
        [REPOSITORY_GROUNDING_FIELDS.recovery]: 'continue_without_analysis',
      }),
    );
    expect(tracker.getContext().repositoryGrounding).toBeUndefined();
    expect(
      tracker.getContext().repositoryGroundingPrerequisites,
    ).toBeUndefined();
    expect(
      tracker.getContext().repositoryGroundingAnalysisConfiguration,
    ).toBeUndefined();
  });

  it('emits a typed machine-addressed trigger and routes a valid result into Feature enrichment', async () => {
    const node = new OnboardingRepositoryGroundingAnalysisNode();
    const context = createContext({ repositoryGrounding: acceptedContext });
    const tracker = createMutableContextHandle(context);

    const trigger = await node.buildTriggerMessage(tracker);
    expect(trigger.triggersAgent).toMatchObject({
      payload: {
        promptType: 'repository_grounding',
        projectId: context.core.projectId,
        conversationId: context.core.conversationId,
        workflowId: context.core.workflowId,
        workflowNodeId: node.id,
        entryMode: prerequisites.entryMode,
        serviceId: prerequisites.serviceId,
        confirmedServiceBrief: prerequisites.confirmedServiceBrief,
        machineId: prerequisites.machineId,
        scope: configuration.scope,
        provider: configuration.provider,
        resolvedFrontierModel: configuration.resolvedFrontierModel,
        reasoningEffort: configuration.reasoningEffort,
        fastMode: configuration.fastMode,
        bounds: configuration.bounds,
      },
    });
    expect(trigger.triggersAgent).not.toHaveProperty('localPath');
    expect(trigger.triggersAgent).not.toHaveProperty('sourceBody');

    await node.processUserResponse(
      tracker,
      userMessage({ action: 'success', payload: successCompletion }),
    );
    expect(tracker.getContext().repositoryGroundingCompletion).toEqual(
      successCompletion,
    );
    expect(tracker.getContext().repositoryGroundingBaseline).toEqual(
      successCompletion,
    );
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe('repository-import-generate-features');
  });

  it('turns a mismatched completion into a terminal failure without mutating features', async () => {
    const node = new OnboardingRepositoryGroundingAnalysisNode();
    const context = createContext({ repositoryGrounding: acceptedContext });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      userMessage({
        action: 'success',
        payload: { ...successCompletion, serviceId: 'different-service' },
      }),
    );
    expect(tracker.getContext().repositoryGroundingCompletion).toEqual(
      expect.objectContaining({
        outcome: 'terminal_failure',
        code: 'invalid_completion',
      }),
    );
    expect(tracker.getContext().projectData).toBeUndefined();
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(ONBOARDING_NODES.REPOSITORY_GROUNDING_RECOVERY);
  });

  it('rejects a successful completion that changes the accepted provider envelope', async () => {
    const node = new OnboardingRepositoryGroundingAnalysisNode();
    const context = createContext({ repositoryGrounding: acceptedContext });
    const tracker = createMutableContextHandle(context);

    await node.processUserResponse(
      tracker,
      userMessage({
        action: 'success',
        payload: {
          ...successCompletion,
          provider: 'claude',
        },
      }),
    );

    expect(tracker.getContext().repositoryGroundingCompletion).toEqual(
      expect.objectContaining({
        outcome: 'terminal_failure',
        code: 'invalid_completion',
        message: expect.stringContaining('provider configuration'),
      }),
    );
  });
});
