import {
  RepositoryPlacementValidationError,
  type FeatureListLifecycleService,
} from '../../../../services/feature-list/feature-list-lifecycle.service';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../../types';
import type {
  FlowUserMessage,
  RepositoryImportFlowContext as OnboardingFlowContext,
} from '../../../../types/flow-internal.types';
import { createMutableContextHandle } from '../../../../utils/mutable-context';
import { REPOSITORY_IMPORT_NODES } from '../../../constants';
import { RepositoryGroundingPlacementStrategyNode } from '../repository-grounding-placement-strategy.node';
import { RepositoryGroundingPlacementNode } from '../repository-grounding-placement.node';
import { RepositoryGroundingPlacementReviewNode } from '../repository-grounding-placement-review.node';

const rootKey = '11111111-1111-4111-8111-111111111111';
const context = (): OnboardingFlowContext => ({
  core: {
    workflowId: '22222222-2222-4222-8222-222222222222' as WorkflowId,
    projectId: '33333333-3333-4333-8333-333333333333' as ProjectId,
    organizationId: '44444444-4444-4444-8444-444444444444' as OrganizationId,
    conversationId: '55555555-5555-4555-8555-555555555555' as ConversationId,
    workflowAboutId: '33333333-3333-4333-8333-333333333333',
    workflowAboutType: 'project',
    user: {
      id: '66666666-6666-4666-8666-666666666666' as UserId,
      role: 'admin',
    },
    session: { startTime: new Date(), interactionCount: 1 },
  },
  flowId: 'repository-import',
  flowPath: { pathTaken: [], previousNode: '', previousTransition: '' },
  onboardingFeatureProposal: {
    proposalGroupId: '77777777-7777-4777-8777-777777777777',
    proposalGroupRevision: 1,
    narrative: 'narrative',
    topLevels: [
      {
        rootKey,
        proposalId: '88888888-8888-4888-8888-888888888888',
        proposalGroupMemberId: '99999999-9999-4999-8999-999999999999',
        reservedFeatureId: rootKey,
        name: 'Orders',
        description: 'Orders',
        tag: 'product',
        priority: 'high',
        reasoning: '',
        influences: [],
        children: [],
      },
    ],
    placementAssignments: [{ rootKey, target: { kind: 'PROJECT_ROOT' } }],
    placementStrategy: { action: 'INTELLIGENTLY_INTEGRATE' },
  },
  repositoryGrounding: {
    prerequisites: {
      entryMode: 'existing_project',
      serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      machineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
    analysisConfiguration: {
      provider: 'codex',
      resolvedFrontierModel: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      fastMode: false,
    },
  } as OnboardingFlowContext['repositoryGrounding'],
});

describe('repository placement nodes', () => {
  const makeLifecycle = () => ({
    toPlacementRoots: jest.fn().mockReturnValue([
      {
        rootKey,
        name: 'Orders',
        description: 'Orders',
        tag: 'product',
        children: [],
      },
    ]),
    applyPlacementStrategy: jest.fn(),
    applyPlacementSuggestions: jest.fn(),
    buildPlacementReview: jest.fn().mockResolvedValue({ roots: [] }),
    applyPlacementOverrides: jest.fn(),
    approve: jest.fn(),
  });

  it('approves deterministic project-root placement once and routes to finalization', async () => {
    const lifecycle = makeLifecycle();
    const node = new RepositoryGroundingPlacementStrategyNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const tracker = createMutableContextHandle(context());
    const message = {
      data: { repository_placement_strategy: { action: 'ADD_AT_ROOT' } },
    } as unknown as FlowUserMessage;
    await node.processUserResponse(tracker, message);
    expect(lifecycle.applyPlacementStrategy).toHaveBeenCalledWith(
      { action: 'ADD_AT_ROOT' },
      tracker,
      node.id,
    );
    expect(lifecycle.approve).toHaveBeenCalledTimes(1);
    expect(lifecycle.approve).toHaveBeenCalledWith(tracker, node.id);
    await expect(
      node.determineRoutingFromUserMessage(tracker.getContext(), message),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.FINALIZE);
  });

  it.each([
    {
      name: 'an existing Feature',
      parent: {
        targetType: 'EXISTING_FEATURE' as const,
        featureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    },
    {
      name: 'a pending holder Feature',
      parent: {
        targetType: 'PENDING_HOLDER' as const,
        name: 'Imported capabilities',
        description: 'Groups imported roots.',
        tag: 'product' as const,
      },
    },
  ])(
    'approves shared-parent placement beneath $name once',
    async ({ parent }) => {
      const lifecycle = makeLifecycle();
      const node = new RepositoryGroundingPlacementStrategyNode(
        lifecycle as unknown as FeatureListLifecycleService,
      );
      const tracker = createMutableContextHandle(context());
      const message = {
        data: {
          repository_placement_strategy: {
            action: 'ADD_TO_EXISTING',
            parent,
          },
        },
      } as unknown as FlowUserMessage;

      await node.processUserResponse(tracker, message);

      expect(lifecycle.applyPlacementStrategy).toHaveBeenCalledTimes(1);
      expect(lifecycle.approve).toHaveBeenCalledTimes(1);
      await expect(
        node.determineRoutingFromUserMessage(tracker.getContext(), message),
      ).resolves.toBe(REPOSITORY_IMPORT_NODES.FINALIZE);
    },
  );

  it('keeps intelligent placement at its typed CLI handoff without early approval', async () => {
    const lifecycle = makeLifecycle();
    const node = new RepositoryGroundingPlacementStrategyNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const message = {
      data: {
        repository_placement_strategy: { action: 'INTELLIGENTLY_INTEGRATE' },
      },
    } as unknown as FlowUserMessage;
    const tracker = createMutableContextHandle(context());
    await node.processUserResponse(tracker, message);
    expect(lifecycle.approve).not.toHaveBeenCalled();
    await expect(
      node.determineRoutingFromUserMessage(context(), message),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.PLACEMENT_AGENT);
  });

  it('routes complete intelligent suggestions into contextual review without early approval', async () => {
    const lifecycle = makeLifecycle();
    const node = new RepositoryGroundingPlacementNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const tracker = createMutableContextHandle(context());
    const trigger = await node.buildTriggerMessage(tracker);
    expect(trigger.triggersAgent).toMatchObject({
      promptType: 'repository_placement',
      payload: {
        conversationId: tracker.getContext().core.conversationId,
        workflowId: tracker.getContext().core.workflowId,
        serviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        machineId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        provider: 'codex',
        resolvedFrontierModel: 'gpt-5.6-sol',
        reasoningEffort: 'high',
        fastMode: false,
      },
    });

    await node.processUserResponse(tracker, {
      data: {
        action: 'success',
        payload: {
          outcome: 'success',
          placements: [
            {
              rootKey,
              target: { kind: 'PROJECT_ROOT' },
              rationale: 'No suitable existing parent.',
              confidence: 0.8,
            },
          ],
        },
      },
    } as unknown as FlowUserMessage);
    expect(lifecycle.applyPlacementSuggestions).toHaveBeenCalledWith(
      [
        {
          rootKey,
          target: { kind: 'PROJECT_ROOT' },
          rationale: 'No suitable existing parent.',
          confidence: 0.8,
        },
      ],
      tracker,
      node.id,
    );
    expect(lifecycle.approve).not.toHaveBeenCalled();
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.PLACEMENT_REVIEW);
  });

  it('renders contextual review and approves only after applying root overrides', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.buildPlacementReview.mockResolvedValue({
      roots: [
        {
          root: {
            rootKey,
            name: 'Orders',
            description: 'Orders',
            tag: 'product',
            children: [],
          },
          selectedParent: { kind: 'PROJECT_ROOT' },
          selectedParentLineage: [],
        },
      ],
    });
    const node = new RepositoryGroundingPlacementReviewNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const tracker = createMutableContextHandle(context());

    await expect(node.execute(tracker)).resolves.toMatchObject({
      uiElements: [
        {
          id: 'repository_placement_review',
          type: 'repository_placement_review',
          payload: { roots: [{ root: { rootKey } }] },
        },
      ],
    });

    const override = {
      rootKey,
      target: {
        kind: 'EXISTING_FEATURE' as const,
        featureId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    };
    await node.processUserResponse(tracker, {
      data: {
        repository_placement_review: {
          action: 'APPROVED',
          payload: { overrides: [override] },
        },
      },
    } as unknown as FlowUserMessage);

    expect(lifecycle.applyPlacementOverrides).toHaveBeenCalledWith(
      [override],
      tracker,
      node.id,
    );
    expect(
      lifecycle.applyPlacementOverrides.mock.invocationCallOrder[0],
    ).toBeLessThan(lifecycle.approve.mock.invocationCallOrder[0]!);
    expect(lifecycle.approve).toHaveBeenCalledWith(tracker, node.id);
  });

  it('rejects placement outside existing-project intelligent integration', async () => {
    const lifecycle = makeLifecycle();
    const node = new RepositoryGroundingPlacementNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const nextContext = context();
    nextContext.repositoryGrounding!.prerequisites.entryMode = 'new_project';

    await expect(
      node.buildTriggerMessage(createMutableContextHandle(nextContext)),
    ).rejects.toThrow('existing-project');
  });

  it('returns invalid mappings to strategy while preserving completed analysis', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.applyPlacementSuggestions.mockRejectedValue(
      new RepositoryPlacementValidationError(
        'Every root requires exactly one placement.',
      ),
    );
    const node = new RepositoryGroundingPlacementNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const nextContext = context();
    nextContext.repositoryGroundingCompletion = {
      outcome: 'success',
    } as OnboardingFlowContext['repositoryGroundingCompletion'];
    const tracker = createMutableContextHandle(nextContext);

    await node.processUserResponse(tracker, {
      data: {
        action: 'success',
        payload: {
          outcome: 'success',
          placements: [],
        },
      },
    } as unknown as FlowUserMessage);

    expect(tracker.getContext().repositoryGroundingCompletion).toEqual({
      outcome: 'success',
    });
    expect(tracker.getContext().repositoryPlacementCompletion).toMatchObject({
      outcome: 'terminal_failure',
      code: 'invalid_completion',
    });
    await expect(
      node.determineRoutingFromAgentCompletion(tracker.getContext(), 'success'),
    ).resolves.toBe(REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY);
    expect(lifecycle.approve).not.toHaveBeenCalled();
  });

  it('propagates placement authoring failures without relabeling them as invalid input', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.applyPlacementSuggestions.mockRejectedValue(
      new Error('Proposal group revision conflict.'),
    );
    const node = new RepositoryGroundingPlacementNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const tracker = createMutableContextHandle(context());

    await expect(
      node.processUserResponse(tracker, {
        data: {
          action: 'success',
          payload: {
            outcome: 'success',
            placements: [
              {
                rootKey,
                target: { kind: 'PROJECT_ROOT' },
                rationale: 'No suitable existing parent.',
                confidence: 0.8,
              },
            ],
          },
        },
      } as unknown as FlowUserMessage),
    ).rejects.toThrow('Proposal group revision conflict');

    expect(tracker.getContext().repositoryPlacementCompletion).toBeUndefined();
    expect(lifecycle.approve).not.toHaveBeenCalled();
  });

  it('preserves grouped approval failures at the review boundary', async () => {
    const lifecycle = makeLifecycle();
    lifecycle.approve.mockRejectedValue(
      new Error('Feature-list grouped approval failed for 1 member(s).'),
    );
    const node = new RepositoryGroundingPlacementReviewNode(
      lifecycle as unknown as FeatureListLifecycleService,
    );
    const tracker = createMutableContextHandle(context());

    await expect(
      node.processUserResponse(tracker, {
        data: {
          repository_placement_review: {
            action: 'APPROVED',
            payload: { overrides: [] },
          },
        },
      } as unknown as FlowUserMessage),
    ).rejects.toThrow('Feature-list grouped approval failed');

    expect(lifecycle.applyPlacementOverrides).toHaveBeenCalledTimes(1);
    expect(lifecycle.approve).toHaveBeenCalledTimes(1);
    expect(tracker.getContext().repositoryPlacementCompletion).toBeUndefined();
  });
});
