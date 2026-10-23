import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { ProposalGroupService } from '../proposal-group.service';

describe('ProposalGroupService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function storedProposal(
    id: string,
    approvalRecords: Array<Record<string, unknown>>,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id,
      organizationId: 'org-1',
      projectId: 'project-1',
      type: 'SINGLE',
      action: 'CREATE',
      status: 'DRAFT',
      targetEntityId: '00000000-0000-0000-0000-000000000000',
      targetEntityType: 'TASK',
      updates: { name: `Task for ${id}` },
      title: null,
      requestorId: 'user-1',
      requestorContext: null,
      influences: null,
      edges: null,
      generatedWithVersion: null,
      validationSessionId: null,
      conversationId: null,
      messageId: null,
      targetLastAppliedProposalId: null,
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
      updatedAt: new Date('2026-07-23T00:00:00.000Z'),
      approvalRecords,
      ...overrides,
    };
  }

  function canonicalGroup(
    proposal: ReturnType<typeof storedProposal>,
    requiredApprovals = 2,
  ) {
    return {
      id: 'group-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: null,
      messageId: null,
      status: 'REVIEWABLE',
      revision: 1,
      frozenRevision: 1,
      frozenAt: null,
      settledAt: null,
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
      updatedAt: new Date('2026-07-23T00:00:00.000Z'),
      members: [
        {
          id: 'member-1',
          groupId: 'group-1',
          proposalId: proposal.id,
          memberOrder: 0,
          reservedTargetEntityId: null,
          requiredApprovals,
          approvalPolicyRevision: 'policy-1',
          approvalSatisfiedAt: null,
          executionState: 'PENDING_APPROVAL',
          attemptCount: 0,
          attemptId: null,
          startedAt: null,
          completedAt: null,
          lastAttemptedAt: null,
          appliedAt: null,
          rejectedAt: null,
          invalidatedAt: null,
          failedAt: null,
          lastError: null,
          terminalReason: null,
          proposal,
        },
      ],
      dependencies: [],
    };
  }

  it('reads a scoped snapshot in persisted order and preserves per-member policy state', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'group-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      messageId: 'message-1',
      status: 'SETTLED',
      revision: 3,
      frozenRevision: 3,
      frozenAt: new Date('2026-07-23T01:00:00.000Z'),
      settledAt: new Date('2026-07-23T02:00:00.000Z'),
      createdAt: new Date('2026-07-23T00:00:00.000Z'),
      updatedAt: new Date('2026-07-23T02:00:00.000Z'),
      members: [
        {
          id: 'member-1',
          groupId: 'group-1',
          proposalId: 'proposal-1',
          memberOrder: 0,
          reservedTargetEntityId: 'reserved-1',
          requiredApprovals: 2,
          approvalPolicyRevision: 'policy-1',
          approvalSatisfiedAt: null,
          executionState: 'REJECTED',
          attemptCount: 0,
          attemptId: null,
          startedAt: null,
          completedAt: null,
          lastAttemptedAt: null,
          appliedAt: null,
          rejectedAt: new Date('2026-07-23T01:30:00.000Z'),
          invalidatedAt: null,
          failedAt: null,
          lastError: null,
          terminalReason: 'User rejected the member',
          proposal: storedProposal('proposal-1', [
            {
              id: 'approval-1',
              proposalId: 'proposal-1',
              userId: 'user-1',
              type: 'APPROVAL',
              reason: null,
              createdAt: new Date('2026-07-23T01:10:00.000Z'),
            },
          ]),
        },
        {
          id: 'member-2',
          groupId: 'group-1',
          proposalId: 'proposal-2',
          memberOrder: 1,
          reservedTargetEntityId: null,
          requiredApprovals: 1,
          approvalPolicyRevision: 'policy-2',
          approvalSatisfiedAt: new Date('2026-07-23T01:20:00.000Z'),
          executionState: 'WAITING_ON_DEPENDENCIES',
          attemptCount: 0,
          attemptId: null,
          startedAt: null,
          completedAt: null,
          lastAttemptedAt: null,
          appliedAt: null,
          rejectedAt: null,
          invalidatedAt: new Date('2026-07-23T02:00:00.000Z'),
          failedAt: null,
          lastError: null,
          terminalReason: 'Prerequisite rejected',
          proposal: storedProposal('proposal-2', []),
        },
      ],
      dependencies: [
        {
          id: 'dependency-1',
          groupId: 'group-1',
          dependentMemberId: 'member-2',
          prerequisiteMemberId: 'member-1',
          createdAt: new Date('2026-07-23T00:30:00.000Z'),
        },
      ],
    });
    const findProjectMembers = jest.fn(() => {
      throw new Error('canonical group reads must not evaluate live policy');
    });
    const prisma = {
      db: {
        proposalGroup: { findFirst },
        projectMember: {
          findMany: findProjectMembers,
        },
      },
    } as unknown as PrismaService;

    const result = await new ProposalGroupService(prisma).findOne(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      'group-1',
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'group-1',
          organizationId: 'org-1',
          projectId: 'project-1',
        },
        include: expect.objectContaining({
          members: expect.objectContaining({
            orderBy: { memberOrder: 'asc' },
          }),
        }),
      }),
    );
    expect(result.members.map((member) => member.memberId)).toEqual([
      'member-1',
      'member-2',
    ]);
    expect(result.members[0]?.approvalProgress).toMatchObject({
      receivedApprovals: 1,
      requiredApprovals: 2,
      approvalSatisfied: false,
    });
    expect(result.members[1]?.blockedReason).toBe('PREREQUISITE_REJECTED');
    expect(result.members[0]?.proposal.requiredApprovals).toBe(2);
    expect(result.members[0]?.proposal.groupMembership).toEqual({
      groupId: 'group-1',
      memberId: 'member-1',
      memberOrder: 0,
      revision: 3,
      lifecycle: 'SETTLED',
    });
    expect(findProjectMembers).not.toHaveBeenCalled();
    expect(result.dependencies).toEqual([
      {
        dependentMemberId: 'member-2',
        prerequisiteMemberId: 'member-1',
      },
    ]);
  });

  it('fails closed when a canonical member has no frozen approval requirement', async () => {
    const prisma = {
      db: {
        proposalGroup: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'group-1',
            organizationId: 'org-1',
            projectId: 'project-1',
            status: 'REVIEWABLE',
            revision: 1,
            frozenRevision: 1,
            frozenAt: null,
            settledAt: null,
            conversationId: null,
            messageId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            members: [
              {
                id: 'member-1',
                proposalId: 'proposal-1',
                requiredApprovals: null,
                proposal: storedProposal('proposal-1', []),
                executionState: 'PENDING_APPROVAL',
                attemptCount: 0,
                attemptId: null,
                startedAt: null,
                completedAt: null,
                lastAttemptedAt: null,
                appliedAt: null,
                rejectedAt: null,
                invalidatedAt: null,
                failedAt: null,
                lastError: null,
                reservedTargetEntityId: null,
                approvalSatisfiedAt: null,
              },
            ],
            dependencies: [],
          }),
        },
      },
    } as unknown as PrismaService;
    await expect(
      new ProposalGroupService(prisma).findOne(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'group-1',
      ),
    ).rejects.toThrow('no frozen approval requirement');
  });

  it.each([
    {
      action: 'CREATE',
      targetEntityType: 'TASK',
      captured: null,
      current: null,
      expected: 'NOT_APPLICABLE',
    },
    {
      action: 'UPDATE',
      targetEntityType: 'TASK',
      captured: null,
      current: null,
      expected: 'CURRENT',
    },
    {
      action: 'UPDATE',
      targetEntityType: 'TASK',
      captured: 'proposal-1',
      current: 'proposal-2',
      expected: 'OUT_OF_DATE',
    },
    {
      action: 'DELETE',
      targetEntityType: 'TASK',
      captured: 'proposal-1',
      current: 'proposal-1',
      expected: 'CURRENT',
    },
  ] as const)(
    'maps grouped $action $targetEntityType proposals through the API-owned status resolver',
    async ({ action, targetEntityType, captured, current, expected }) => {
      const findFirst = jest.fn().mockResolvedValue(
        canonicalGroup(
          storedProposal('proposal-1', [], {
            action,
            targetEntityType,
            targetEntityId: 'task-1',
            targetLastAppliedProposalId: captured,
          }),
        ),
      );
      const taskFindMany = jest
        .fn()
        .mockResolvedValue([{ id: 'task-1', lastAppliedProposalId: current }]);
      const prisma = {
        db: {
          proposalGroup: { findFirst },
          task: { findMany: taskFindMany },
        },
      } as unknown as PrismaService;

      const result = await new ProposalGroupService(prisma).findOne(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'group-1',
      );

      expect(result.members[0]?.proposal.outOfDateStatus).toBe(expected);
      expect(result.members[0]?.proposal.requiredApprovals).toBe(2);
      if (action === 'UPDATE' || action === 'DELETE') {
        expect(taskFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              organizationId: 'org-1',
              projectId: 'project-1',
              id: { in: ['task-1'] },
            }),
          }),
        );
      } else {
        expect(taskFindMany).not.toHaveBeenCalled();
      }
    },
  );
});
