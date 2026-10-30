import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { ProposalGroupDecisionService } from '../proposal-group-decision.service';
import * as permissionContext from '../permission-evaluation-context';
import * as permissionEvaluation from '../permission-evaluation';
import { ProjectApprovalPolicyService } from '../project-approval-policy.service';

const decisionMember = (overrides: Record<string, unknown> = {}) => ({
  id: 'member-1',
  groupId: 'group-1',
  proposalId: 'proposal-1',
  memberOrder: 1,
  requiredApprovals: 1,
  approvalSatisfiedAt: null,
  executionState: 'PENDING_APPROVAL',
  group: {
    id: 'group-1',
    status: 'REVIEWABLE',
    revision: 3,
    frozenRevision: 3,
  },
  proposal: {
    id: 'proposal-1',
    requestorId: 'requestor-1',
    requestorContext: { source: 'agent' },
    targetEntityType: 'TASK',
    targetEntityId: 'task-1',
    action: 'UPDATE',
    updates: {},
  },
  dependenciesAsDependent: [],
  ...overrides,
});

describe('ProposalGroupDecisionService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('injects the registry for grouped future section approval before implementation completes', async () => {
    const content = {
      type: 'FEATURE',
      name: 'Live',
      sections: [{ key: 'description', materializedMarkdown: 'Before' }],
    };
    const member = decisionMember({
      proposal: {
        ...decisionMember().proposal,
        action: 'VERSIONED_UPDATE',
        updates: {
          operation: 'REVISE',
          baseline: { kind: 'LIVE', content },
          result: {
            ...content,
            sections: [{ key: 'description', materializedMarkdown: 'After' }],
          },
          dependencies: [
            { targetEntityType: 'TASK', targetEntityId: 'unfinished-work' },
          ],
        },
      },
      dependenciesAsDependent: [
        { prerequisiteMember: { executionState: 'PENDING_APPROVAL' } },
      ],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      },
      task: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ type: 'FEATURE', parentTaskId: null }),
        update: jest.fn(),
      },
      proposalGroupMember: {
        findFirst: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue({}),
      },
      proposalApprovalRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const registry = {
      getSectionDefinitions: jest
        .fn()
        .mockReturnValue([{ key: 'description', kind: 'markdown' }]),
    };
    const module = await Test.createTestingModule({
      providers: [
        ProposalGroupDecisionService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              $transaction: (callback: (client: typeof tx) => unknown) =>
                callback(tx),
            },
          },
        },
        { provide: WorkItemTypeRegistryService, useValue: registry },
      ],
    })
      .useMocker((token) =>
        token === Object
          ? undefined
          : { publishInTransaction: jest.fn(), assertApplicable: jest.fn() },
      )
      .compile();
    try {
      const result = await module.get(ProposalGroupDecisionService).approve(
        {
          proposalId: 'proposal-1',
          organizationId: 'organization-1' as never,
          projectId: 'project-1' as never,
          userId: 'user-1' as never,
        },
        await new ProjectApprovalPolicyService().resolve('project-1' as never),
      );
      expect(result.recorded).toBe(true);
      expect(registry.getSectionDefinitions).toHaveBeenCalledWith(
        'FEATURE',
        'project-1',
      );
      expect(tx.proposalApprovalRecord.create).toHaveBeenCalledTimes(1);
      expect(tx.task.update).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  function setupGroupedRejection(action: 'CREATE' | 'UPDATE' | 'DELETE') {
    const member = decisionMember({
      proposal: {
        ...decisionMember().proposal,
        action,
      },
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      proposalGroupMember: {
        findFirst: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue({}),
      },
      proposalApprovalRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      proposal: {
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const lifecycleEvents = {
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const coordinator = {
      propagateTerminalImpossibility: jest.fn().mockResolvedValue(0),
    };
    jest
      .spyOn(permissionContext, 'resolvePermissionEvaluationContext')
      .mockResolvedValue({
        entity: { type: 'TASK', parentTaskId: null, initiativeId: null },
        proposal: {
          source: 'agent',
          action,
          authorId: 'requestor-1',
          toolName: null,
          eligibleProjectMemberIds: ['user-1'],
          changedFields: [],
        },
      });
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 1,
      allowsProposerApproval: false,
    });
    const service = new ProposalGroupDecisionService(
      prisma as never,
      lifecycleEvents as never,
      { get: jest.fn().mockReturnValue(coordinator) } as never,
      new ProjectApprovalPolicyService(),
      { assertProjectRole: jest.fn() } as never,
      undefined,
      { assertApplicable: jest.fn() } as never,
    );

    return { service, tx };
  }

  it('records one ordinary approval and waits when a prerequisite is not applied', async () => {
    const member = decisionMember({
      dependenciesAsDependent: [
        { prerequisiteMember: { executionState: 'READY' } },
      ],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      proposalGroupMember: {
        findFirst: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue({}),
      },
      proposalApprovalRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const lifecycleEvents = {
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    jest
      .spyOn(permissionContext, 'resolvePermissionEvaluationContext')
      .mockResolvedValue({
        entity: { type: 'TASK', parentTaskId: null, initiativeId: null },
        proposal: {
          source: 'agent',
          action: 'UPDATE',
          authorId: 'requestor-1',
          toolName: null,
          eligibleProjectMemberIds: ['user-1'],
          changedFields: [],
        },
      });
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 1,
      allowsProposerApproval: false,
    });
    const service = new ProposalGroupDecisionService(
      prisma as never,
      lifecycleEvents as never,
      {} as never,
      new ProjectApprovalPolicyService(),
      { assertProjectRole: jest.fn() } as never,
      undefined,
      { assertApplicable: jest.fn() } as never,
    );

    const result = await service.approve({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
    });

    expect(tx.proposalApprovalRecord.create).toHaveBeenCalledWith({
      data: {
        proposalId: 'proposal-1',
        userId: 'user-1',
        type: 'APPROVAL',
      },
    });
    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: {
        approvalSatisfiedAt: expect.any(Date),
        executionState: 'WAITING_ON_DEPENDENCIES',
      },
    });
    expect(result.result).toMatchObject({
      outcome: 'APPROVAL_RECORDED',
      approvalSatisfied: true,
      dependencyReady: false,
      executionState: 'WAITING_ON_DEPENDENCIES',
      blockedReason: 'DEPENDENCIES_PENDING',
    });
    expect(lifecycleEvents.publishInTransaction).toHaveBeenCalledWith(tx, {
      organizationId: 'organization-1',
      projectId: 'project-1',
      groupId: 'group-1',
      revision: 3,
      changedMemberIds: ['member-1'],
    });
  });

  it('dispatches the exact READY member after approval commits', async () => {
    const member = decisionMember();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      proposalGroupMember: {
        findFirst: jest.fn().mockResolvedValue(member),
        update: jest.fn().mockResolvedValue({}),
      },
      proposalApprovalRecord: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const lifecycleEvents = {
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    };
    const dispatchReadyMembers = jest.fn().mockResolvedValue(undefined);
    const moduleRef = {
      get: jest.fn().mockReturnValue({ dispatchReadyMembers }),
    };
    jest
      .spyOn(permissionContext, 'resolvePermissionEvaluationContext')
      .mockResolvedValue({
        entity: { type: 'TASK', parentTaskId: null, initiativeId: null },
        proposal: {
          source: 'agent',
          action: 'UPDATE',
          authorId: 'requestor-1',
          toolName: null,
          eligibleProjectMemberIds: ['user-1'],
          changedFields: [],
        },
      });
    jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
      requiresProposal: true,
      threshold: 1,
      allowsProposerApproval: false,
    });
    const service = new ProposalGroupDecisionService(
      prisma as never,
      lifecycleEvents as never,
      moduleRef as never,
      new ProjectApprovalPolicyService(),
      { assertProjectRole: jest.fn() } as never,
      undefined,
      { assertApplicable: jest.fn() } as never,
    );

    await service.approve({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
    });

    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ executionState: 'READY' }),
      }),
    );
    expect(dispatchReadyMembers).toHaveBeenCalledWith({
      memberIds: ['member-1'],
      organizationId: 'organization-1',
      projectId: 'project-1',
    });
    const transactionOrder = prisma.db.$transaction.mock.invocationCallOrder[0];
    const requestOrder = dispatchReadyMembers.mock.invocationCallOrder[0];
    expect(transactionOrder).toBeDefined();
    expect(requestOrder).toBeDefined();
    expect(requestOrder!).toBeGreaterThan(transactionOrder!);
  });

  it('uses repeat approval to retry only the selected failed member', async () => {
    const member = decisionMember({
      approvalSatisfiedAt: new Date('2026-07-31T00:00:00.000Z'),
      executionState: 'RETRYABLE_FAILURE',
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      proposalGroupMember: { findFirst: jest.fn().mockResolvedValue(member) },
      proposalApprovalRecord: {
        findUnique: jest.fn().mockResolvedValue({ type: 'APPROVAL' }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const retrySelectedMember = jest.fn().mockResolvedValue(undefined);
    const service = new ProposalGroupDecisionService(
      prisma as never,
      {} as never,
      {
        get: jest.fn().mockReturnValue({ retrySelectedMember }),
      } as never,
      new ProjectApprovalPolicyService(),
      { assertProjectRole: jest.fn() } as never,
      undefined,
      { assertApplicable: jest.fn() } as never,
    );

    const result = await service.approve({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
    });

    expect(result.result.outcome).toBe('ALREADY_APPROVED');
    expect(retrySelectedMember).toHaveBeenCalledWith({
      memberId: 'member-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
    });
  });

  it('uses repeat approval to redispatch a contended READY member', async () => {
    const member = decisionMember({
      approvalSatisfiedAt: new Date('2026-07-31T00:00:00.000Z'),
      executionState: 'READY',
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      proposalGroupMember: { findFirst: jest.fn().mockResolvedValue(member) },
      proposalApprovalRecord: {
        findUnique: jest.fn().mockResolvedValue({ type: 'APPROVAL' }),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const dispatchReadyMembers = jest.fn().mockResolvedValue(undefined);
    const service = new ProposalGroupDecisionService(
      prisma as never,
      {} as never,
      {
        get: jest.fn().mockReturnValue({ dispatchReadyMembers }),
      } as never,
      new ProjectApprovalPolicyService(),
      { assertProjectRole: jest.fn() } as never,
      undefined,
      { assertApplicable: jest.fn() } as never,
    );

    const result = await service.approve({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
    });

    expect(result.result.outcome).toBe('ALREADY_APPROVED');
    expect(dispatchReadyMembers).toHaveBeenCalledWith({
      memberIds: ['member-1'],
      organizationId: 'organization-1',
      projectId: 'project-1',
    });
  });

  it.each(['READY', 'RETRYABLE_FAILURE'] as const)(
    'records rejection while a member is %s',
    async (executionState) => {
      const member = decisionMember({
        approvalSatisfiedAt: new Date('2026-07-31T00:00:00.000Z'),
        executionState,
      });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        proposalGroupMember: {
          findFirst: jest.fn().mockResolvedValue(member),
          update: jest.fn().mockResolvedValue({}),
        },
        proposalApprovalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockResolvedValue(1),
        },
        proposal: {
          update: jest.fn().mockResolvedValue({}),
        },
      };
      const prisma = {
        db: {
          $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
            callback(tx),
          ),
        },
      };
      const lifecycleEvents = {
        publishInTransaction: jest.fn().mockResolvedValue(undefined),
      };
      const coordinator = {
        propagateTerminalImpossibility: jest.fn().mockResolvedValue(0),
      };
      const moduleRef = {
        get: jest.fn().mockReturnValue(coordinator),
      };
      jest
        .spyOn(permissionContext, 'resolvePermissionEvaluationContext')
        .mockResolvedValue({
          entity: { type: 'TASK', parentTaskId: null, initiativeId: null },
          proposal: {
            source: 'agent',
            action: 'UPDATE',
            authorId: 'requestor-1',
            toolName: null,
            eligibleProjectMemberIds: ['user-1'],
            changedFields: [],
          },
        });
      jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
        requiresProposal: true,
        threshold: 1,
        allowsProposerApproval: false,
      });
      const service = new ProposalGroupDecisionService(
        prisma as never,
        lifecycleEvents as never,
        moduleRef as never,
        new ProjectApprovalPolicyService(),
        { assertProjectRole: jest.fn() } as never,
        undefined,
        { assertApplicable: jest.fn() } as never,
      );

      const result = await service.reject({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as never,
        projectId: 'project-1' as never,
        userId: 'user-1' as never,
        reason: 'No longer valid',
      });

      expect(tx.proposalApprovalRecord.create).toHaveBeenCalledWith({
        data: {
          proposalId: 'proposal-1',
          userId: 'user-1',
          type: 'REJECTION',
          reason: 'No longer valid',
        },
      });
      expect(tx.proposalGroupMember.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: {
          executionState: 'REJECTED',
          rejectedAt: expect.any(Date),
          completedAt: expect.any(Date),
          terminalReason: 'No longer valid',
          claimToken: null,
          leaseExpiresAt: null,
        },
      });
      expect(result).toMatchObject({
        recorded: true,
        result: {
          outcome: 'ALREADY_REJECTED',
          executionState: 'REJECTED',
        },
      });
      expect(coordinator.propagateTerminalImpossibility).toHaveBeenCalledWith({
        sourceMemberId: 'member-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
      });
    },
  );

  it.each([
    ['omitted', undefined],
    ['blank', '   '],
  ])('allows grouped CREATE rejection with an %s reason', async (_, reason) => {
    const { service, tx } = setupGroupedRejection('CREATE');

    await service.reject({
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
      reason,
    });

    expect(tx.proposalApprovalRecord.create).toHaveBeenCalledWith({
      data: {
        proposalId: 'proposal-1',
        userId: 'user-1',
        type: 'REJECTION',
        reason: null,
      },
    });
    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      data: expect.objectContaining({
        executionState: 'REJECTED',
        terminalReason: null,
      }),
    });
  });

  it.each(['UPDATE', 'DELETE'] as const)(
    'preserves a supplied reason for grouped %s rejection',
    async (action) => {
      const { service, tx } = setupGroupedRejection(action);

      await service.reject({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as never,
        projectId: 'project-1' as never,
        userId: 'user-1' as never,
        reason: '  No longer valid  ',
      });

      expect(tx.proposalApprovalRecord.create).toHaveBeenCalledWith({
        data: {
          proposalId: 'proposal-1',
          userId: 'user-1',
          type: 'REJECTION',
          reason: 'No longer valid',
        },
      });
      expect(tx.proposalGroupMember.update).toHaveBeenCalledWith({
        where: { id: 'member-1' },
        data: expect.objectContaining({ terminalReason: 'No longer valid' }),
      });
    },
  );

  it.each([
    ['UPDATE', 'omitted', undefined],
    ['UPDATE', 'blank', '   '],
    ['DELETE', 'omitted', undefined],
    ['DELETE', 'blank', '   '],
  ] as const)(
    'rejects grouped %s rejection with an %s reason without mutations',
    async (action, _, reason) => {
      const { service, tx } = setupGroupedRejection(action);

      await expect(
        service.reject({
          proposalId: 'proposal-1',
          organizationId: 'organization-1' as never,
          projectId: 'project-1' as never,
          userId: 'user-1' as never,
          reason,
        }),
      ).rejects.toThrow(
        'A reason is required when rejecting an UPDATE or DELETE proposal',
      );

      expect(tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(tx.proposal.update).not.toHaveBeenCalled();
      expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
    },
  );

  it.each([
    'APPLYING',
    'APPLIED',
    'REJECTED',
    'INVALIDATED',
    'FAILED',
  ] as const)(
    'does not record rejection while a member is %s',
    async (executionState) => {
      const member = decisionMember({
        approvalSatisfiedAt: new Date('2026-07-31T00:00:00.000Z'),
        executionState,
      });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        proposalGroupMember: {
          findFirst: jest.fn().mockResolvedValue(member),
          update: jest.fn(),
        },
        proposalApprovalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          count: jest.fn().mockResolvedValue(1),
        },
        proposal: {
          update: jest.fn(),
        },
      };
      const prisma = {
        db: {
          $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
            callback(tx),
          ),
        },
      };
      const coordinator = {
        propagateTerminalImpossibility: jest.fn().mockResolvedValue(0),
      };
      const moduleRef = { get: jest.fn().mockReturnValue(coordinator) };
      const service = new ProposalGroupDecisionService(
        prisma as never,
        {} as never,
        moduleRef as never,
        new ProjectApprovalPolicyService(),
        { assertProjectRole: jest.fn() } as never,
        undefined,
        { assertApplicable: jest.fn() } as never,
      );

      const result = await service.reject({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as never,
        projectId: 'project-1' as never,
        userId: 'user-1' as never,
        reason: 'No longer valid',
      });

      expect(result).toMatchObject({
        recorded: false,
        result: {
          outcome: 'ALREADY_TERMINAL',
          executionState,
        },
      });
      expect(tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
      expect(tx.proposal.update).not.toHaveBeenCalled();
      if (executionState === 'REJECTED') {
        expect(coordinator.propagateTerminalImpossibility).toHaveBeenCalledWith(
          {
            sourceMemberId: 'member-1',
            organizationId: 'organization-1',
            projectId: 'project-1',
          },
        );
      } else {
        expect(moduleRef.get).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['READY', 'RETRYABLE_FAILURE'] as const)(
    'does not reopen approval while a member is %s',
    async (executionState) => {
      const member = decisionMember({
        approvalSatisfiedAt: new Date('2026-07-31T00:00:00.000Z'),
        executionState,
      });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        proposalGroupMember: {
          findFirst: jest.fn().mockResolvedValue(member),
          update: jest.fn(),
        },
        proposalApprovalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn(),
          count: jest.fn().mockResolvedValue(1),
        },
      };
      const prisma = {
        db: {
          $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
            callback(tx),
          ),
        },
      };
      const service = new ProposalGroupDecisionService(
        prisma as never,
        {} as never,
        {} as never,
        new ProjectApprovalPolicyService(),
        { assertProjectRole: jest.fn() } as never,
        undefined,
        { assertApplicable: jest.fn() } as never,
      );

      const result = await service.approve({
        proposalId: 'proposal-1',
        organizationId: 'organization-1' as never,
        projectId: 'project-1' as never,
        userId: 'user-1' as never,
      });

      expect(result).toMatchObject({
        recorded: false,
        result: {
          outcome: 'ALREADY_TERMINAL',
          executionState,
        },
      });
      expect(tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
      expect(tx.proposalGroupMember.update).not.toHaveBeenCalled();
    },
  );

  it('attempts every frozen member in order and isolates failures', async () => {
    const members = [
      { id: 'member-2', memberOrder: 2, proposalId: 'proposal-2' },
      { id: 'member-1', memberOrder: 1, proposalId: 'proposal-1' },
    ].map((member) => ({
      ...member,
      requiredApprovals: 1,
      approvalSatisfiedAt: null,
      executionState: 'PENDING_APPROVAL',
    }));
    const persistedFailedMember = decisionMember({
      id: 'member-2',
      proposalId: 'proposal-2',
      requiredApprovals: 2,
      approvalSatisfiedAt: new Date('2026-07-31T00:00:00.000Z'),
      executionState: 'RETRYABLE_FAILURE',
      dependenciesAsDependent: [
        { prerequisiteMember: { executionState: 'APPLIED' } },
      ],
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      proposalGroupMember: {
        findFirst: jest.fn().mockResolvedValue(persistedFailedMember),
      },
      proposalApprovalRecord: {
        count: jest.fn().mockResolvedValue(2),
      },
    };
    const prisma = {
      db: {
        proposalGroup: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'group-1',
            status: 'REVIEWABLE',
            revision: 3,
            frozenRevision: 3,
            members: [...members].sort((a, b) => a.memberOrder - b.memberOrder),
          }),
        },
        $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
      },
    };
    const service = new ProposalGroupDecisionService(
      prisma as never,
      {} as never,
      {} as never,
      new ProjectApprovalPolicyService(),
      { assertProjectRole: jest.fn() } as never,
      undefined,
      { assertApplicable: jest.fn() } as never,
    );
    const approve = jest
      .spyOn(service, 'approve')
      .mockResolvedValueOnce({
        proposalId: 'proposal-1',
        recorded: true,
        result: {
          memberId: 'member-1',
          proposalId: 'proposal-1' as never,
          outcome: 'APPROVAL_RECORDED',
          receivedApprovals: 1,
          requiredApprovals: 1,
          approvalSatisfied: true,
          dependencyReady: true,
          executionState: 'READY',
        },
      })
      .mockRejectedValueOnce(new Error('conflict'));

    const result = await service.approveAll({
      groupId: 'group-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
    });

    expect(approve.mock.calls.map(([call]) => call.proposalId)).toEqual([
      'proposal-1',
      'proposal-2',
    ]);
    expect(result.results.map((item) => item.outcome)).toEqual([
      'APPROVAL_RECORDED',
      'FAILED',
    ]);
    expect(result.results[1]).toEqual({
      memberId: 'member-2',
      proposalId: 'proposal-2',
      outcome: 'FAILED',
      receivedApprovals: 2,
      requiredApprovals: 2,
      approvalSatisfied: true,
      dependencyReady: true,
      executionState: 'RETRYABLE_FAILURE',
      message: 'conflict',
      diagnostic: {
        issues: [],
        issueCount: 0,
        truncated: false,
        correlationId: expect.any(String),
      },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.proposalGroupMember.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'member-2',
        proposalId: 'proposal-2',
        group: {
          organizationId: 'organization-1',
          projectId: 'project-1',
        },
      },
      include: {
        group: true,
        proposal: true,
        dependenciesAsDependent: {
          include: { prerequisiteMember: true },
        },
      },
    });
  });

  describe('work-item type proposal role gate', () => {
    function setup(targetEntityType: string, assertProjectRole: jest.Mock) {
      const member = decisionMember({
        proposal: { ...decisionMember().proposal, targetEntityType },
      });
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        proposalGroupMember: {
          findFirst: jest.fn().mockResolvedValue(member),
          update: jest.fn().mockResolvedValue({}),
        },
        proposalApprovalRecord: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockResolvedValue(0),
        },
      };
      const prisma = {
        db: {
          $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
            callback(tx),
          ),
          proposalGroup: {
            findFirst: jest.fn().mockResolvedValue({
              id: 'group-1',
              status: 'REVIEWABLE',
              revision: 3,
              frozenRevision: 3,
              members: [
                { id: 'member-1', memberOrder: 1, proposalId: 'proposal-1' },
              ],
            }),
          },
        },
      };
      jest
        .spyOn(permissionContext, 'resolvePermissionEvaluationContext')
        .mockResolvedValue({
          entity: { type: 'TASK', parentTaskId: null, initiativeId: null },
          proposal: {
            source: 'agent',
            action: 'UPDATE',
            authorId: 'requestor-1',
            toolName: null,
            eligibleProjectMemberIds: ['user-1'],
            changedFields: [],
          },
        });
      jest.spyOn(permissionEvaluation, 'evaluatePermissions').mockReturnValue({
        requiresProposal: true,
        threshold: 1,
        allowsProposerApproval: false,
      });
      const service = new ProposalGroupDecisionService(
        prisma as never,
        {
          publishInTransaction: jest.fn().mockResolvedValue(undefined),
        } as never,
        { get: jest.fn() } as never,
        new ProjectApprovalPolicyService(),
        { assertProjectRole } as never,
        undefined,
        { assertApplicable: jest.fn() } as never,
      );
      return { service, tx };
    }

    const params = {
      proposalId: 'proposal-1',
      organizationId: 'organization-1' as never,
      projectId: 'project-1' as never,
      userId: 'user-1' as never,
    };

    it('denies a caller without the work-item-types capability before recording approval', async () => {
      const assertProjectRole = jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Insufficient permissions'));
      const { service, tx } = setup('WORK_ITEM_TYPE', assertProjectRole);

      await expect(service.approve(params)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(assertProjectRole).toHaveBeenCalledWith(
        'project-1',
        'user-1',
        'manageWorkItemTypes',
      );
      expect(tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
    });

    it('reports a denied type member as FAILED in approve-all', async () => {
      const assertProjectRole = jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Insufficient permissions'));
      const { service, tx } = setup('WORK_ITEM_TYPE', assertProjectRole);

      const { results } = await service.approveAll({
        groupId: 'group-1',
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.userId,
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        outcome: 'FAILED',
        message: 'Insufficient permissions',
      });
      expect(tx.proposalApprovalRecord.create).not.toHaveBeenCalled();
    });

    it('does not apply the role gate to non-type proposals', async () => {
      const assertProjectRole = jest.fn();
      const { service, tx } = setup('TASK', assertProjectRole);

      const decision = await service.approve(params);

      expect(assertProjectRole).not.toHaveBeenCalled();
      expect(decision.result.outcome).toBe('APPROVAL_RECORDED');
      expect(tx.proposalApprovalRecord.create).toHaveBeenCalledTimes(1);
    });
  });
});
