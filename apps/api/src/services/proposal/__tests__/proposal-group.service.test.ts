import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import type { PrismaService } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { ProposalGroupService } from '../proposal-group.service';

function createService(prisma: PrismaService, currentName = 'Reviewed') {
  const basis = {
    entityType: 'TASK',
    entityId: 'task-1',
    version: 'authoring',
    content: { name: 'Reviewed', sections: {} },
  };
  const revision = {
    id: 'revision',
    proposalId: 'proposal-1',
    source: 'AUTHORING',
    previousRevisionId: null,
    bases: [basis],
    proposedResult: { name: 'Proposed', sections: {} },
    createdAt: new Date(),
    intent: 'Rename',
  };
  const findTasks = prisma.db.task?.findMany ?? jest.fn(async () => []);
  Object.assign(prisma.db, {
    proposalGroupMember: { findUnique: jest.fn(async () => null) },
    workItemChangeSetMaterialization: { findUnique: jest.fn(async () => null) },
    proposalReconciliationReplacement: { findFirst: jest.fn(async () => null) },
    proposalReconciliationRevision: {
      findFirst: jest.fn(async () => revision),
      findMany: jest.fn(async () => [revision]),
    },
    proposal: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
    task: {
      ...prisma.db.task,
      findMany: jest.fn(async (input) =>
        input.include
          ? [
              {
                id: 'task-1',
                name: currentName,
                type: 'STANDARD',
                updatedAt: new Date(),
                sections: [],
                serviceRelations: [],
              },
            ]
          : findTasks(input),
      ),
    },
  });
  const reconciliation = new ProposalReconciliationService(
    new ProposalReconciliationAdapterService(
      { getSectionDefinition: () => undefined } as never,
      {} as never,
    ),
    {} as never,
    () => 'test',
  );
  const service = new ProposalGroupService(prisma);
  Object.assign(service, { reconciliation });
  return service;
}

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

  it('adds pending linked-work identity to canonical member responses without changing frozen mutation content', async () => {
    const proposal = storedProposal('future-preview', [], {
      action: 'VERSIONED_UPDATE',
      status: 'REJECTED',
      updates: {
        operation: 'REVISE',
        dependencies: [
          {
            edgeType: 'DEPENDS_ON',
            targetEntityType: 'TASK',
            targetEntityId: 'work',
          },
        ],
      },
    });
    const group = canonicalGroup(proposal);
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { id: 'work', name: 'Implementation', type: 'STANDARD' },
      ]);
    const prisma = {
      db: {
        proposalGroup: { findFirst: jest.fn().mockResolvedValue(group) },
        task: { findMany },
      },
    } as unknown as PrismaService;
    const snapshot = await createService(prisma).findOne(
      'org-1' as OrganizationId,
      'project-1' as ProjectId,
      'group-1',
    );
    expect(snapshot.members).toHaveLength(1);
    for (const member of snapshot.members) {
      expect(member.proposal?.dependencyPresentation).toEqual([
        {
          targetEntityId: 'work',
          availability: 'AVAILABLE',
          title: 'Implementation',
          workItemType: 'STANDARD',
        },
      ]);
      expect(member.proposal?.updates).toEqual(proposal.updates);
    }
    expect(findMany).toHaveBeenCalledTimes(1);
  });

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

    const result = await createService(prisma).findOne(
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
      createService(prisma).findOne(
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
      currentName: 'Reviewed',
      expected: 'NOT_APPLICABLE',
    },
    {
      action: 'UPDATE',
      targetEntityType: 'TASK',
      currentName: 'Reviewed',
      expected: 'CURRENT',
    },
    {
      action: 'UPDATE',
      targetEntityType: 'TASK',
      currentName: 'Later edit',
      expected: 'OUT_OF_DATE',
    },
    {
      action: 'DELETE',
      targetEntityType: 'TASK',
      currentName: 'Reviewed',
      expected: 'CURRENT',
    },
  ] as const)(
    'maps grouped $action $targetEntityType proposals through the API-owned status resolver',
    async ({ action, targetEntityType, currentName, expected }) => {
      const findFirst = jest.fn().mockResolvedValue(
        canonicalGroup(
          storedProposal('proposal-1', [], {
            action,
            targetEntityType,
            targetEntityId: 'task-1',
            targetLastAppliedProposalId: 'unchanged-marker',
          }),
        ),
      );
      const taskFindMany = jest
        .fn()
        .mockResolvedValue([
          { id: 'task-1', lastAppliedProposalId: 'unchanged-marker' },
        ]);
      const prisma = {
        db: {
          proposalGroup: { findFirst },
          task: { findMany: taskFindMany },
        },
      } as unknown as PrismaService;

      const result = await createService(prisma, currentName).findOne(
        'org-1' as OrganizationId,
        'project-1' as ProjectId,
        'group-1',
      );

      expect(result.members[0]?.proposal.outOfDateStatus).toBe(expected);
      expect(result.members[0]?.proposal.requiredApprovals).toBe(2);
    },
  );
});
