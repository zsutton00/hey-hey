import { OnboardingGenerateFeaturesNode } from '../onboarding-generate-features.node';
import type { FeatureListLifecycleService } from '../../../../services/feature-list/feature-list-lifecycle.service';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import type {
  FlowUserMessage,
  OnboardingFeatureProposalState,
  RepositoryImportFlowContext as OnboardingFlowContext,
} from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { ONBOARDING_NODES, REPOSITORY_IMPORT_NODES } from '../../../constants';
import { RepositoryFeatureEnrichmentChoice } from '../../../../generated';
import {
  RepositoryImportEnrichmentChoiceNode,
  ENRICHMENT_CHOICE_FIELD,
} from '../../repository-import/repository-import-enrichment-choice.node';

const ids = {
  root: '11111111-1111-4111-8111-111111111111',
  rootMember: '22222222-2222-4222-8222-222222222222',
  rootProposal: '33333333-3333-4333-8333-333333333333',
  group: '44444444-4444-4444-8444-444444444444',
};

const state: OnboardingFeatureProposalState = {
  proposalGroupId: ids.group,
  proposalGroupRevision: 2,
  narrative: 'Imported capabilities',
  topLevels: [
    {
      rootKey: ids.root,
      proposalId: ids.rootProposal,
      proposalGroupMemberId: ids.rootMember,
      reservedFeatureId: ids.root,
      name: 'Ordering',
      description: 'Customer ordering capability.',
      tag: 'product',
      priority: 'high',
      reasoning: 'Repository evidence',
      influences: [],
      children: [],
    },
  ],
};

const context = (
  entryMode: 'new_project' | 'existing_project',
): OnboardingFlowContext => ({
  core: {
    workflowId: '55555555-5555-4555-8555-555555555555' as WorkflowId,
    projectId: '66666666-6666-4666-8666-666666666666' as ProjectId,
    organizationId: '77777777-7777-4777-8777-777777777777' as OrganizationId,
    conversationId: '88888888-8888-4888-8888-888888888888' as ConversationId,
    workflowAboutId: '66666666-6666-4666-8666-666666666666',
    workflowAboutType: 'project',
    user: {
      id: '99999999-9999-4999-8999-999999999999' as UserId,
      role: 'admin',
    },
    session: {
      startTime: new Date('2026-09-15T00:00:00Z'),
      interactionCount: 1,
    },
  },
  flowId: 'onboarding',
  flowPath: { pathTaken: [], previousNode: '', previousTransition: '' },
  repositoryGrounding: {
    prerequisites: {
      entryMode,
      serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      confirmedServiceBrief: 'Existing product',
      machineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    analysisConfiguration: {
      scope: { scope: 'comprehensive' },
      provider: 'codex',
      resolvedFrontierModel: 'gpt-5',
      reasoningEffort: 'medium',
      fastMode: false,
      bounds: {
        maxFiles: 5000,
        maxTotalBytes: 25000000,
        maxFileBytes: 1000000,
        maxDepth: 12,
        maxGeneratedFiles: 1000,
        maxIgnoredFiles: 1000,
        maxUnsupportedFiles: 1000,
        maxBinaryFiles: 1000,
      },
    },
  },
  repositoryGroundingCompletion: {
    outcome: 'success',
    serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  } as OnboardingFlowContext['repositoryGroundingCompletion'],
  onboardingFeatureProposal: state,
});

const approvedMessage = {
  data: {
    'feature-list': {
      action: 'APPROVED',
      payload: {},
    },
  },
} as unknown as FlowUserMessage;

describe('OnboardingGenerateFeaturesNode placement routing', () => {
  const makeNode = () => {
    const lifecycle = {
      approve: jest.fn(),
      recordRefinement: jest.fn(),
    } as unknown as FeatureListLifecycleService;
    return { node: new OnboardingGenerateFeaturesNode(lifecycle), lifecycle };
  };

  it('accepts the reviewed outline without materialization and asks about enrichment', async () => {
    const { node, lifecycle } = makeNode();
    const tracker = createMutableContextHandle(context('existing_project'));
    await node.processUserResponse(tracker, approvedMessage);
    expect(lifecycle.approve).not.toHaveBeenCalled();
    expect(
      tracker.getContext().repositoryFeatureEnrichmentReviewedCandidates
        ?.topLevels[0],
    ).toMatchObject({
      id: ids.root,
      name: 'Ordering',
      description: 'Customer ordering capability.',
    });
    await expect(
      node.determineRoutingFromUserMessage(
        tracker.getContext(),
        approvedMessage,
      ),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE);
  });

  it.each([
    [
      RepositoryFeatureEnrichmentChoice.Enrich,
      REPOSITORY_IMPORT_NODES.ENRICHMENT,
    ],
    [
      RepositoryFeatureEnrichmentChoice.Skip,
      REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
    ],
  ])(
    'persists %s and resumes the selected branch without approving',
    async (choice, destination) => {
      const { node, lifecycle } = makeNode();
      const tracker = createMutableContextHandle(context('existing_project'));
      await node.processUserResponse(tracker, approvedMessage);
      const choiceNode = new RepositoryImportEnrichmentChoiceNode();
      await choiceNode.processUserResponse(tracker, {
        data: { [ENRICHMENT_CHOICE_FIELD]: choice },
      } as unknown as FlowUserMessage);
      const resumed = JSON.parse(
        JSON.stringify(tracker.getContext()),
      ) as OnboardingFlowContext;
      expect(resumed.repositoryFeatureEnrichmentChoice).toBe(choice);
      await expect(
        choiceNode.determineRoutingFromUserMessage(resumed),
      ).resolves.toBe(destination);
      expect(lifecycle.approve).not.toHaveBeenCalled();
      await expect(
        node.determineRoutingFromUserMessage(resumed, approvedMessage),
      ).resolves.toBe(REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY);
    },
  );

  it('retains continuing analysis identities after outline corrections', async () => {
    const { node } = makeNode();
    const initial = context('existing_project');
    initial.onboardingFeatureProposal = {
      ...state,
      topLevels: [
        {
          ...state.topLevels[0]!,
          candidateId: 'analysis-ordering',
          name: 'Order Management',
        },
      ],
    };
    const tracker = createMutableContextHandle(initial);
    await node.processUserResponse(tracker, approvedMessage);
    expect(
      tracker.getContext().repositoryFeatureEnrichmentReviewedCandidates
        ?.topLevels[0],
    ).toMatchObject({ id: 'analysis-ordering', name: 'Order Management' });
  });

  it('approves a new-project import immediately at project root', async () => {
    const { node, lifecycle } = makeNode();
    const tracker = createMutableContextHandle(context('new_project'));
    await node.processUserResponse(tracker, approvedMessage);
    expect(lifecycle.approve).toHaveBeenCalledTimes(1);
    await expect(
      node.determineRoutingFromUserMessage(
        context('new_project'),
        approvedMessage,
      ),
    ).resolves.toBe(ONBOARDING_NODES.FINALIZE);
  });
});
