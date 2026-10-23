import { FeatureListLifecycleService } from '../feature-list-lifecycle.service';
import type { RepositoryImportFlowContext as OnboardingFlowContext } from '../../../types/flow-internal.types';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../../../types';
import { createMutableContextHandle } from '../../../utils/mutable-context';

const rootKey = '11111111-1111-4111-8111-111111111111';
const featureId = '22222222-2222-4222-8222-222222222222';
const secondRootKey = '12121212-1212-4212-8212-121212121212';
const secondRootMemberId = '13131313-1313-4313-8313-131313131313';
const secondChildKey = '14141414-1414-4414-8414-141414141414';
const secondChildMemberId = '15151515-1515-4515-8515-151515151515';

const makeContext = (): OnboardingFlowContext => ({
  core: {
    workflowId: '33333333-3333-4333-8333-333333333333' as WorkflowId,
    projectId: '44444444-4444-4444-8444-444444444444' as ProjectId,
    organizationId: '55555555-5555-4555-8555-555555555555' as OrganizationId,
    conversationId: '66666666-6666-4666-8666-666666666666' as ConversationId,
    workflowAboutId: '44444444-4444-4444-8444-444444444444',
    workflowAboutType: 'project',
    user: {
      id: '77777777-7777-4777-8777-777777777777' as UserId,
      role: 'admin',
    },
    session: {
      startTime: new Date('2026-09-15T00:00:00Z'),
      interactionCount: 1,
    },
  },
  flowId: 'onboarding',
  flowPath: { pathTaken: [], previousNode: '', previousTransition: '' },
  onboardingFeatureProposal: {
    proposalGroupId: '88888888-8888-4888-8888-888888888888',
    proposalGroupRevision: 5,
    narrative: 'Imported hierarchy',
    topLevels: [
      {
        rootKey,
        proposalId: '99999999-9999-4999-8999-999999999999',
        proposalGroupMemberId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        reservedFeatureId: rootKey,
        name: 'Ordering',
        description: 'Orders',
        tag: 'product',
        priority: 'high',
        reasoning: '',
        influences: [],
        children: [
          {
            localId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            proposalId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            proposalGroupMemberId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            reservedFeatureId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            name: 'Checkout',
            description: 'Checkout',
            tag: 'frontend',
            priority: 'medium',
            reasoning: '',
            influences: [],
          },
        ],
      },
    ],
  },
});

const makeMultiRootContext = (): OnboardingFlowContext => {
  const context = makeContext();
  context.onboardingFeatureProposal!.topLevels.push({
    rootKey: secondRootKey,
    proposalId: '16161616-1616-4616-8616-161616161616',
    proposalGroupMemberId: secondRootMemberId,
    reservedFeatureId: secondRootKey,
    name: 'Inventory',
    description: 'Inventory',
    tag: 'product',
    priority: 'medium',
    reasoning: '',
    influences: [],
    children: [
      {
        localId: secondChildKey,
        proposalId: '17171717-1717-4717-8717-171717171717',
        proposalGroupMemberId: secondChildMemberId,
        reservedFeatureId: secondChildKey,
        name: 'Stock Levels',
        description: 'Stock levels',
        tag: 'backend',
        priority: 'medium',
        reasoning: '',
        influences: [],
      },
    ],
  });
  return context;
};

const makeExistingProjectContext = (): OnboardingFlowContext => {
  const context = makeContext();
  context.repositoryGrounding = {
    prerequisites: {
      entryMode: 'existing_project',
      serviceId: '18181818-1818-4818-8818-181818181818',
      machineId: '19191919-1919-4919-8919-191919191919',
    },
    analysisConfiguration: {
      provider: 'codex',
      resolvedFrontierModel: 'gpt-5.6-sol',
      reasoningEffort: 'high',
      fastMode: false,
    },
  } as OnboardingFlowContext['repositoryGrounding'];
  return context;
};

describe('FeatureListLifecycleService placement', () => {
  const makeService = () => {
    const authoring = {
      updateMember: jest.fn().mockResolvedValue({ currentRevision: 6 }),
      replacePrerequisites: jest.fn().mockResolvedValue({ currentRevision: 7 }),
      addMember: jest.fn(),
      removeMember: jest.fn().mockResolvedValue({ currentRevision: 8 }),
    };
    const finalization = {
      finalize: jest
        .fn()
        .mockResolvedValue({ outcome: 'FINALIZED', issues: [] }),
    };
    const decision = {
      approveAll: jest
        .fn()
        .mockResolvedValue({ results: [{ outcome: 'APPROVED' }] }),
    };
    const prisma = {
      db: {
        task: { findMany: jest.fn().mockResolvedValue([{ id: featureId }]) },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            email: 'owner@example.com',
            name: 'Owner',
            isDevAdmin: false,
            devAdminMode: false,
          }),
        },
        proposalGroupMember: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              { executionState: 'APPLIED', proposalId: 'proposal-1' },
            ]),
        },
        proposal: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ targetEntityId: featureId }]),
        },
      },
    };
    const service = new FeatureListLifecycleService(
      { reject: jest.fn() } as never,
      authoring as never,
      finalization as never,
      decision as never,
      prisma as never,
    );
    return { service, authoring, finalization, decision, prisma };
  };

  it('updates only root proposal parents and preserves child wiring', async () => {
    const { service, authoring } = makeService();
    const tracker = createMutableContextHandle(makeContext());
    await service.applyPlacementStrategy(
      { action: 'ADD_AT_ROOT' },
      tracker,
      'placement',
    );
    expect(authoring.updateMember).toHaveBeenCalledTimes(1);
    expect(authoring.updateMember.mock.calls[0][3]).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(
      authoring.updateMember.mock.calls[0][5].proposal.updates.parentTaskId,
    ).toBeUndefined();
    expect(
      tracker.getContext().onboardingFeatureProposal?.topLevels[0]?.children[0]
        ?.proposalGroupMemberId,
    ).toBe('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  });

  it('rejects a non-Feature existing parent before changing proposals', async () => {
    const { service, authoring, prisma } = makeService();
    prisma.db.task.findMany.mockResolvedValue([]);
    const tracker = createMutableContextHandle(makeContext());
    await expect(
      service.applyPlacementStrategy(
        {
          action: 'ADD_TO_EXISTING',
          parent: {
            targetType: 'EXISTING_FEATURE',
            featureId: featureId as never,
          },
        },
        tracker,
        'placement',
      ),
    ).rejects.toThrow('active Features');
    expect(authoring.updateMember).not.toHaveBeenCalled();
  });

  it('places every root beneath one validated existing Feature', async () => {
    const { service, authoring } = makeService();
    const tracker = createMutableContextHandle(makeContext());
    await service.applyPlacementStrategy(
      {
        action: 'ADD_TO_EXISTING',
        parent: {
          targetType: 'EXISTING_FEATURE',
          featureId: featureId as never,
        },
      },
      tracker,
      'placement',
    );
    expect(
      authoring.updateMember.mock.calls[0][5].proposal.updates.parentTaskId,
    ).toBe(featureId);
  });

  it('orders a pending holder before roots that reference it', async () => {
    const { service, authoring, prisma } = makeService();
    const holderMemberId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const holderFeatureId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    authoring.addMember.mockResolvedValue({
      currentRevision: 6,
      members: [
        {
          memberId: holderMemberId,
          reservedEntityId: holderFeatureId,
        },
      ],
    });
    authoring.updateMember.mockResolvedValue({ currentRevision: 7 });
    authoring.replacePrerequisites.mockResolvedValue({ currentRevision: 8 });
    prisma.db.proposalGroupMember.findMany.mockResolvedValue([
      {
        id: holderMemberId,
        proposalId: '10101010-1010-4010-8010-101010101010',
      },
    ]);
    const tracker = createMutableContextHandle(makeContext());
    await service.applyPlacementStrategy(
      {
        action: 'ADD_TO_EXISTING',
        parent: {
          targetType: 'PENDING_HOLDER',
          name: 'Imported capabilities',
          description: 'Groups imported roots.',
          tag: 'product',
        },
      },
      tracker,
      'placement',
    );
    expect(authoring.replacePrerequisites).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expect.objectContaining({
        prerequisiteMemberIds: new Set([holderMemberId]),
      }),
    );
    expect(
      tracker.getContext().onboardingFeatureProposal?.pendingHolder
        ?.reservedFeatureId,
    ).toBe(holderFeatureId);
  });

  it('keeps every child attached to its discovered root through holder placement and approval', async () => {
    const { service, authoring, finalization, decision, prisma } =
      makeService();
    const holderMemberId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const holderFeatureId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const tracker = createMutableContextHandle(makeMultiRootContext());
    tracker.mutate((draft) => {
      draft.repositoryGrounding =
        makeExistingProjectContext().repositoryGrounding;
    });
    authoring.addMember.mockResolvedValue({
      currentRevision: 6,
      members: [
        {
          memberId: holderMemberId,
          reservedEntityId: holderFeatureId,
        },
      ],
    });
    authoring.updateMember
      .mockResolvedValueOnce({ currentRevision: 7 })
      .mockResolvedValueOnce({ currentRevision: 9 });
    authoring.replacePrerequisites
      .mockResolvedValueOnce({ currentRevision: 8 })
      .mockResolvedValueOnce({ currentRevision: 10 });
    prisma.db.proposalGroupMember.findMany
      .mockResolvedValueOnce([
        {
          id: holderMemberId,
          proposalId: '10101010-1010-4010-8010-101010101010',
        },
      ])
      .mockResolvedValueOnce(
        Array.from({ length: 5 }, () => ({ executionState: 'APPLIED' })),
      );
    decision.approveAll.mockResolvedValue({
      results: Array.from({ length: 5 }, () => ({ outcome: 'APPROVED' })),
    });

    await service.applyPlacementStrategy(
      {
        action: 'ADD_TO_EXISTING',
        parent: {
          targetType: 'PENDING_HOLDER',
          name: 'Imported capabilities',
          description: 'Groups imported roots.',
          tag: 'product',
        },
      },
      tracker,
      'placement',
    );

    const updatedMemberIds = authoring.updateMember.mock.calls.map(
      (call) => call[3],
    );
    expect(updatedMemberIds).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      secondRootMemberId,
    ]);
    expect(updatedMemberIds).not.toContain(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    );
    expect(updatedMemberIds).not.toContain(secondChildMemberId);
    expect(
      authoring.updateMember.mock.calls.map(
        (call) => call[5].proposal.updates.parentTaskId,
      ),
    ).toEqual([holderFeatureId, holderFeatureId]);
    expect(
      authoring.replacePrerequisites.mock.calls.map((call) => [
        call[3],
        [...call[4].prerequisiteMemberIds],
      ]),
    ).toEqual([
      ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', [holderMemberId]],
      [secondRootMemberId, [holderMemberId]],
    ]);

    const placementState = tracker.getContext().onboardingFeatureProposal!;
    expect(placementState.placementAssignments).toEqual([
      {
        rootKey,
        target: { kind: 'EXISTING_FEATURE', featureId: holderFeatureId },
      },
      {
        rootKey: secondRootKey,
        target: { kind: 'EXISTING_FEATURE', featureId: holderFeatureId },
      },
    ]);
    expect(
      placementState.topLevels.map((root) => ({
        rootKey: root.rootKey,
        childMemberId: root.children[0]?.proposalGroupMemberId,
        childParentId: root.children[0] ? root.reservedFeatureId : undefined,
      })),
    ).toEqual([
      {
        rootKey,
        childMemberId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        childParentId: rootKey,
      },
      {
        rootKey: secondRootKey,
        childMemberId: secondChildMemberId,
        childParentId: secondRootKey,
      },
    ]);

    await service.approve(tracker, 'review');

    expect(finalization.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '88888888-8888-4888-8888-888888888888',
      expect.anything(),
      { expectedRevision: 10 },
    );
    expect(decision.approveAll).toHaveBeenCalledTimes(1);
    expect(tracker.getContext().onboardingFeatureProposal).toMatchObject({
      proposalGroupRevision: 10,
      topLevels: [
        {
          rootKey,
          children: [{ localId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
        },
        {
          rootKey: secondRootKey,
          children: [{ localId: secondChildKey }],
        },
      ],
    });
  });

  it.each([
    {
      name: 'missing roots',
      placements: [],
      message: 'Every root requires exactly one placement',
    },
    {
      name: 'duplicate roots',
      placements: [
        { rootKey, target: { kind: 'PROJECT_ROOT' as const } },
        { rootKey, target: { kind: 'PROJECT_ROOT' as const } },
      ],
      message: 'Duplicate root placement',
    },
    {
      name: 'child keys',
      placements: [
        {
          rootKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          target: { kind: 'PROJECT_ROOT' as const },
        },
      ],
      message: 'Child placement is not allowed',
    },
    {
      name: 'unknown keys',
      placements: [
        {
          rootKey: '20202020-2020-4020-8020-202020202020',
          target: { kind: 'PROJECT_ROOT' as const },
        },
      ],
      message: 'Unknown root placement',
    },
  ])(
    'rejects $name before changing or approving proposals',
    async ({ placements, message }) => {
      const { service, authoring, finalization, decision } = makeService();
      const tracker = createMutableContextHandle(makeExistingProjectContext());

      await expect(
        service.applyPlacementSuggestions(
          placements,
          tracker,
          'placement-agent',
        ),
      ).rejects.toThrow(message);

      expect(authoring.updateMember).not.toHaveBeenCalled();
      expect(finalization.finalize).not.toHaveBeenCalled();
      expect(decision.approveAll).not.toHaveBeenCalled();
    },
  );

  it('builds highest-ancestor-first lineage and preserves discovered children', async () => {
    const { service, prisma } = makeService();
    const nextContext = makeExistingProjectContext();
    const ancestorId = '21212121-2121-4121-8121-212121212121';
    nextContext.onboardingFeatureProposal!.placementStrategy = {
      action: 'INTELLIGENTLY_INTEGRATE',
    };
    nextContext.onboardingFeatureProposal!.placementAssignments = [
      {
        rootKey,
        target: { kind: 'EXISTING_FEATURE', featureId: featureId as never },
      },
    ];
    prisma.db.task.findMany.mockResolvedValue([
      {
        id: ancestorId,
        name: 'Commerce',
        tag: 'product',
        parentTaskId: null,
      },
      {
        id: featureId,
        name: 'Orders',
        tag: 'backend',
        parentTaskId: ancestorId,
      },
    ]);

    await expect(service.buildPlacementReview(nextContext)).resolves.toEqual({
      roots: [
        {
          root: {
            rootKey,
            name: 'Ordering',
            description: 'Orders',
            tag: 'product',
            children: [
              {
                childKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                name: 'Checkout',
                description: 'Checkout',
                tag: 'frontend',
              },
            ],
          },
          selectedParent: {
            kind: 'EXISTING_FEATURE',
            featureId,
          },
          selectedParentLineage: [
            {
              featureId: ancestorId,
              name: 'Commerce',
              tag: 'product',
            },
            {
              featureId,
              name: 'Orders',
              tag: 'backend',
              parentFeatureId: ancestorId,
            },
          ],
        },
      ],
    });
  });

  it('uses an empty lineage for project-root intelligent placement', async () => {
    const { service, prisma } = makeService();
    const nextContext = makeExistingProjectContext();
    nextContext.onboardingFeatureProposal!.placementStrategy = {
      action: 'INTELLIGENTLY_INTEGRATE',
    };
    nextContext.onboardingFeatureProposal!.placementAssignments = [
      { rootKey, target: { kind: 'PROJECT_ROOT' } },
    ];
    prisma.db.task.findMany.mockResolvedValue([]);

    const review = await service.buildPlacementReview(nextContext);
    expect(review.roots[0]).toMatchObject({
      selectedParent: { kind: 'PROJECT_ROOT' },
      selectedParentLineage: [],
    });
  });

  it('refuses contextual review until intelligent placement is complete', async () => {
    const { service } = makeService();
    const nextContext = makeMultiRootContext();
    nextContext.onboardingFeatureProposal!.placementStrategy = {
      action: 'INTELLIGENTLY_INTEGRATE',
    };
    nextContext.onboardingFeatureProposal!.placementAssignments = [
      { rootKey, target: { kind: 'PROJECT_ROOT' } },
    ];

    await expect(service.buildPlacementReview(nextContext)).rejects.toThrow(
      'Every root requires exactly one placement',
    );
  });

  it('applies a partial root override without changing other roots or descendants', async () => {
    const { service, authoring, prisma } = makeService();
    const nextContext = makeMultiRootContext();
    nextContext.onboardingFeatureProposal!.placementStrategy = {
      action: 'INTELLIGENTLY_INTEGRATE',
    };
    nextContext.onboardingFeatureProposal!.placementAssignments = [
      { rootKey, target: { kind: 'PROJECT_ROOT' } },
      { rootKey: secondRootKey, target: { kind: 'PROJECT_ROOT' } },
    ];
    prisma.db.task.findMany.mockResolvedValue([
      {
        id: featureId,
        name: 'Existing parent',
        tag: 'product',
        parentTaskId: null,
      },
    ]);
    const tracker = createMutableContextHandle(nextContext);

    await service.applyPlacementOverrides(
      [
        {
          rootKey,
          target: { kind: 'EXISTING_FEATURE', featureId: featureId as never },
        },
      ],
      tracker,
      'placement-review',
    );

    expect(authoring.updateMember).toHaveBeenCalledTimes(1);
    expect(authoring.updateMember.mock.calls[0][3]).toBe(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(
      tracker.getContext().onboardingFeatureProposal?.placementAssignments,
    ).toEqual([
      {
        rootKey,
        target: { kind: 'EXISTING_FEATURE', featureId },
      },
      { rootKey: secondRootKey, target: { kind: 'PROJECT_ROOT' } },
    ]);
    expect(
      tracker
        .getContext()
        .onboardingFeatureProposal?.topLevels.map((root) =>
          root.children.map((child) => child.proposalGroupMemberId),
        ),
    ).toEqual([
      ['dddddddd-dddd-4ddd-8ddd-dddddddddddd'],
      [secondChildMemberId],
    ]);
  });

  it('rejects duplicate or inactive override targets before changing proposals', async () => {
    const { service, authoring, prisma } = makeService();
    const nextContext = makeContext();
    nextContext.onboardingFeatureProposal!.placementStrategy = {
      action: 'INTELLIGENTLY_INTEGRATE',
    };
    nextContext.onboardingFeatureProposal!.placementAssignments = [
      { rootKey, target: { kind: 'PROJECT_ROOT' } },
    ];
    prisma.db.task.findMany.mockResolvedValue([]);
    const tracker = createMutableContextHandle(nextContext);

    await expect(
      service.applyPlacementOverrides(
        [
          {
            rootKey,
            target: {
              kind: 'EXISTING_FEATURE',
              featureId: featureId as never,
            },
          },
        ],
        tracker,
        'placement-review',
      ),
    ).rejects.toThrow('active Features');
    expect(authoring.updateMember).not.toHaveBeenCalled();
  });

  it('revalidates unchanged placement targets before final review approval', async () => {
    const { service, authoring, prisma } = makeService();
    const nextContext = makeContext();
    nextContext.onboardingFeatureProposal!.placementStrategy = {
      action: 'INTELLIGENTLY_INTEGRATE',
    };
    nextContext.onboardingFeatureProposal!.placementAssignments = [
      {
        rootKey,
        target: { kind: 'EXISTING_FEATURE', featureId: featureId as never },
      },
    ];
    prisma.db.task.findMany.mockResolvedValue([]);
    const tracker = createMutableContextHandle(nextContext);

    await expect(
      service.applyPlacementOverrides([], tracker, 'placement-review'),
    ).rejects.toThrow('active Features');
    expect(authoring.updateMember).not.toHaveBeenCalled();
  });

  it('removes an unused pending holder when suggestions move every root elsewhere', async () => {
    const { service, authoring } = makeService();
    const nextContext = makeContext();
    nextContext.onboardingFeatureProposal!.pendingHolder = {
      targetType: 'PENDING_HOLDER',
      name: 'Imported capabilities',
      description: 'Groups imported roots.',
      tag: 'product',
      proposalId: '10101010-1010-4010-8010-101010101010',
      proposalGroupMemberId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      reservedFeatureId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    };
    const tracker = createMutableContextHandle(nextContext);

    await service.applyPlacementSuggestions(
      [{ rootKey, target: { kind: 'PROJECT_ROOT' } }],
      tracker,
      'placement-agent',
    );

    expect(authoring.removeMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '88888888-8888-4888-8888-888888888888',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      { expectedRevision: 7 },
    );
    expect(
      tracker.getContext().onboardingFeatureProposal?.pendingHolder,
    ).toBeUndefined();
  });

  it('finalizes and approves the whole dependency-ordered group at the final boundary', async () => {
    const { service, finalization, decision } = makeService();
    const tracker = createMutableContextHandle(makeExistingProjectContext());
    await service.approve(tracker, 'review');
    expect(finalization.finalize).toHaveBeenCalledTimes(1);
    expect(decision.approveAll).toHaveBeenCalledTimes(1);
    expect(tracker.getContext().onboardingFeatureProposal).toBeDefined();
  });

  it('records only Feature targets as materialized Feature ids', async () => {
    const { service, prisma } = makeService();
    const tracker = createMutableContextHandle(makeExistingProjectContext());
    prisma.db.proposal.findMany.mockResolvedValue([
      { targetEntityId: featureId },
      { targetEntityId: 'non-feature-target' },
    ]);
    prisma.db.task.findMany.mockResolvedValue([{ id: featureId }]);

    await service.approve(tracker, 'review');

    expect(prisma.db.task.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [featureId, 'non-feature-target'] },
          type: 'FEATURE',
        }),
      }),
    );
    expect(tracker.getContext().repositoryImportMaterializedFeatureIds).toEqual(
      [featureId],
    );
  });

  it('preserves the grouped finalization failure and does not attempt approval', async () => {
    const { service, finalization, decision } = makeService();
    finalization.finalize.mockResolvedValue({
      outcome: 'FAILED',
      issues: [{ message: 'Dependency order is invalid.' }],
    });
    const tracker = createMutableContextHandle(makeExistingProjectContext());

    await expect(service.approve(tracker, 'review')).rejects.toThrow(
      'Dependency order is invalid.',
    );
    expect(decision.approveAll).not.toHaveBeenCalled();
    expect(tracker.getContext().onboardingFeatureProposal).toBeDefined();
  });

  it('preserves a grouped approval failure without marking completion', async () => {
    const { service, decision } = makeService();
    decision.approveAll.mockResolvedValue({
      results: [{ outcome: 'FAILED', executionState: 'FAILED' }],
    });
    const tracker = createMutableContextHandle(makeExistingProjectContext());

    await expect(service.approve(tracker, 'review')).rejects.toThrow(
      'grouped approval failed',
    );
    expect(tracker.getContext().onboardingFeatureProposal).toBeDefined();
  });

  it('keeps review state when grouped proposals have not all applied', async () => {
    const { service, decision, prisma } = makeService();
    decision.approveAll.mockResolvedValue({
      results: [
        {
          outcome: 'APPROVAL_RECORDED',
          executionState: 'PENDING_APPROVAL',
        },
      ],
    });
    prisma.db.proposalGroupMember.findMany.mockResolvedValue([
      { executionState: 'PENDING_APPROVAL' },
    ]);
    const tracker = createMutableContextHandle(makeContext());

    await expect(service.approve(tracker, 'review')).rejects.toThrow(
      '1 unapplied member',
    );
    expect(tracker.getContext().onboardingFeatureProposal).toBeDefined();
  });
});
