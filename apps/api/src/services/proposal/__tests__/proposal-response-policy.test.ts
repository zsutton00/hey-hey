import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { createDefaultProjectApprovalPolicy } from '../project-approval-policy.service';
import {
  mapProposalResponse,
  mapProposalResponses,
  resolveProjectApprovalPolicies,
  deriveProposalOutOfDateStatus,
} from '../proposal-response-policy';
import {
  toProposalResponseDto,
  type ProposalWithApprovals,
} from '../proposal.types';

function proposal(
  id: string,
  approvalRecords: ProposalWithApprovals['approvalRecords'],
): ProposalWithApprovals {
  return {
    id,
    organizationId: 'organization-1',
    projectId: 'project-1',
    type: 'SINGLE',
    action: 'CREATE',
    status: 'DRAFT',
    targetEntityId: '00000000-0000-0000-0000-000000000000',
    targetEntityType: 'DESIGN_DOC',
    title: 'Design doc',
    updates: { title: 'Design doc' },
    requestorId: 'agent-1',
    requestorContext: { source: 'agent' },
    influences: null,
    generatedWithVersion: null,
    validationSessionId: null,
    conversationId: null,
    messageId: null,
    edges: null,
    createdAt: new Date('2026-07-22T00:00:00.000Z'),
    updatedAt: new Date('2026-07-22T00:00:00.000Z'),
    approvalRecords,
  } as unknown as ProposalWithApprovals;
}

describe('mapProposalResponses', () => {
  it('loads reviewed futures once for a page and leaves an absent first revision null', async () => {
    const reviewedProposal = (id: string, futureId: string) =>
      ({
        ...proposal(id, []),
        action: 'VERSIONED_UPDATE',
        targetEntityType: 'TASK',
        targetEntityId: `target-${id}`,
        updates: { futureId },
        groupMembership: {
          id: `member-${id}`,
          groupId: 'group-1',
          memberOrder: 0,
          requiredApprovals: 1,
          group: { status: 'FROZEN', revision: 1, frozenRevision: 1 },
        },
      }) as unknown as ProposalWithApprovals;
    const present = {
      id: 'future-1',
      organizationId: 'organization-1',
      projectId: 'project-1',
      targetEntityType: 'TASK',
      targetEntityId: 'target-proposal-1',
      revision: 1,
      outcome: 'STAGED',
      originatingProposalId: 'proposal-1',
      latestProposalId: 'proposal-1',
      baseline: {},
      result: {},
      appliedAt: null,
      appliedRevision: null,
      cancelledAt: null,
      history: [],
      dependencies: [],
    };
    const ordinaryProposal = {
      ...proposal('proposal-3', []),
      groupMembership: {
        id: 'member-proposal-3',
        groupId: 'group-1',
        memberOrder: 0,
        requiredApprovals: 1,
        group: { status: 'FROZEN', revision: 1, frozenRevision: 1 },
      },
    } as unknown as ProposalWithApprovals;
    const futureFindMany = jest.fn().mockResolvedValue([present]);
    const proposalFindMany = jest.fn().mockResolvedValue([]);
    const tx = {
      proposalFuture: { findMany: futureFindMany },
      proposal: { findMany: proposalFindMany },
    } as unknown as AnyTransactionClient;

    const result = await mapProposalResponses(
      tx,
      [
        reviewedProposal('proposal-1', 'future-1'),
        reviewedProposal('proposal-2', 'future-not-staged'),
        ordinaryProposal,
      ],
      createDefaultProjectApprovalPolicy(),
      {
        workItemTypeRegistry: {} as WorkItemTypeRegistryService,
      },
    );

    expect(futureFindMany).toHaveBeenCalledTimes(1);
    expect(futureFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ['future-1', 'future-not-staged'] },
        }),
      }),
    );
    expect(proposalFindMany).toHaveBeenCalledTimes(1);
    expect(result.map((item) => item.reviewedFuture?.id ?? null)).toEqual([
      'future-1',
      null,
      null,
    ]);
  });

  it('maps a complete authoring write result without reloading proposal relations', async () => {
    const stored = {
      ...proposal('proposal-1', []),
      groupMembership: null,
      workItemChangeSetMaterialization: null,
    } satisfies ProposalWithApprovals;
    const findUnique = jest.fn(() => {
      throw new Error(
        'response mapping must not reload a complete write result',
      );
    });
    const tx = {
      proposal: { findUnique },
    } as unknown as AnyTransactionClient;

    const result = await mapProposalResponse(
      tx,
      stored,
      createDefaultProjectApprovalPolicy(2),
      { requiredApprovals: 2 },
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(result).toEqual(toProposalResponseDto(stored, 2));
  });

  it('resolves one policy per project for a batched read', async () => {
    const resolve = jest.fn((projectId: string) =>
      Promise.resolve(
        createDefaultProjectApprovalPolicy(projectId === 'project-1' ? 2 : 3),
      ),
    );
    const first = proposal('proposal-1', []);
    const second = { ...proposal('proposal-2', []), projectId: 'project-2' };

    const policies = await resolveProjectApprovalPolicies({ resolve }, [
      first,
      proposal('proposal-3', []),
      second,
    ]);

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenNthCalledWith(1, 'project-1');
    expect(resolve).toHaveBeenNthCalledWith(2, 'project-2');
    expect(policies.get('project-1')?.requiredApprovals).toBe(2);
    expect(policies.get('project-2')?.requiredApprovals).toBe(3);
  });

  it('preserves stored influence task types and legacy absence unchanged', async () => {
    const stored = proposal('proposal-1', []);
    stored.influences = [
      {
        entityId: '00000000-0000-0000-0000-000000000001',
        entityType: 'TASK',
        taskType: 'BUG',
        reasoning: 'built-in task type',
        reasonType: 'explicit_mention',
      },
      {
        entityId: '00000000-0000-0000-0000-000000000002',
        entityType: 'TASK',
        taskType: 'customer_request',
        reasoning: 'project-defined task type',
        reasonType: 'derived',
      },
      {
        entityId: '00000000-0000-0000-0000-000000000003',
        entityType: 'DESIGN_DOC',
        reasoning: 'non-task influence',
        reasonType: 'implied',
      },
      {
        entityId: '00000000-0000-0000-0000-000000000004',
        entityType: 'TASK',
        reasoning: 'legacy influence',
        reasonType: 'derived',
      },
    ];

    const result = toProposalResponseDto(stored, 1).influences!;

    expect(result[0]).toHaveProperty('taskType', 'BUG');
    expect(result[1]).toHaveProperty('taskType', 'customer_request');
    expect(result[2]).not.toHaveProperty('taskType');
    expect(result[3]).not.toHaveProperty('taskType');
  });

  it.each([
    ['CREATE', 'TASK', null, null, 'NOT_APPLICABLE'],
    ['UPDATE', 'DESIGN_DOC', null, null, 'NOT_APPLICABLE'],
    ['UPDATE', 'TASK', null, null, 'CURRENT'],
    ['DELETE', 'TASK', 'proposal-1', 'proposal-1', 'CURRENT'],
    ['UPDATE', 'TASK', 'proposal-1', 'proposal-2', 'OUT_OF_DATE'],
  ] as const)(
    'derives %s %s with captured %s and current %s as %s',
    (action, targetEntityType, captured, current, expected) => {
      expect(
        deriveProposalOutOfDateStatus(
          {
            action,
            targetEntityType,
            targetLastAppliedProposalId: captured,
          } as any,
          current,
        ),
      ).toBe(expected);
    },
  );

  it('serializes API-owned requirements and approval records with one member lookup per project', async () => {
    const projectMemberFindMany = jest
      .fn()
      .mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);
    const tx = {
      projectMember: { findMany: projectMemberFindMany },
      proposal: { findMany: jest.fn() },
      proposalGroupMember: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as AnyTransactionClient;
    const approvedAt = new Date('2026-07-22T01:00:00.000Z');
    const proposals = [
      proposal('proposal-1', [
        {
          id: 'record-1',
          proposalId: 'proposal-1',
          userId: 'user-1',
          type: 'APPROVAL',
          reason: null,
          createdAt: approvedAt,
        },
        {
          id: 'record-2',
          proposalId: 'proposal-1',
          userId: 'user-2',
          type: 'REJECTION',
          reason: 'Needs work',
          createdAt: approvedAt,
        },
      ]),
      proposal('proposal-2', []),
    ];

    const result = await mapProposalResponses(
      tx,
      proposals,
      createDefaultProjectApprovalPolicy(),
    );

    expect(projectMemberFindMany).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0]?.requiredApprovals).toBe(1);
    expect(result[0]?.approvals.map((record) => record.type)).toEqual([
      'APPROVAL',
      'REJECTION',
    ]);
    expect(result[1]?.requiredApprovals).toBe(1);
    expect(result[1]?.approvals).toEqual([]);
  });

  it('uses the supplied project policy when mapping API-owned requirements', async () => {
    const tx = {
      projectMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]),
      },
      proposal: { findMany: jest.fn() },
      proposalGroupMember: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as AnyTransactionClient;

    const [result] = await mapProposalResponses(
      tx,
      [proposal('proposal-1', [])],
      createDefaultProjectApprovalPolicy(3),
    );

    expect(result?.requiredApprovals).toBe(3);
  });

  it('can omit one stale proposal target without failing a collection response', async () => {
    const tx = {
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      },
      proposal: { findMany: jest.fn() },
      proposalGroupMember: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as AnyTransactionClient;
    const stale = {
      ...proposal('proposal-stale', []),
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: 'missing-task',
      updates: { name: 'Cannot be applied' },
    } as ProposalWithApprovals;
    const valid = proposal('proposal-valid', []);

    const result = await mapProposalResponses(
      tx,
      [stale, valid],
      createDefaultProjectApprovalPolicy(),
      { omitUnresolvableTargets: true },
    );

    expect(result.map((entry) => entry.id)).toEqual(['proposal-valid']);
  });

  it('still surfaces an unresolvable target outside tolerant collection reads', async () => {
    const tx = {
      projectMember: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      },
      proposal: { findMany: jest.fn() },
      proposalGroupMember: { findMany: jest.fn().mockResolvedValue([]) },
      task: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as AnyTransactionClient;
    const stale = {
      ...proposal('proposal-stale', []),
      action: 'UPDATE',
      targetEntityType: 'TASK',
      targetEntityId: 'missing-task',
      updates: { name: 'Cannot be applied' },
    } as ProposalWithApprovals;

    await expect(
      mapProposalResponses(tx, [stale], createDefaultProjectApprovalPolicy()),
    ).rejects.toThrow('Target task not found: missing-task');
  });

  it.each([
    [null, 'QUEUED'],
    ['retryable graph failure', 'RECOVERABLE_FAILURE'],
  ] as const)(
    'maps a prepared durable intent with lastError %s to %s',
    (lastError, expectedState) => {
      const stored = proposal('proposal-1', []);
      stored.workItemChangeSetMaterialization = {
        id: 'materialization-1',
        proposalId: 'proposal-1',
        organizationId: 'organization-1',
        projectId: 'project-1',
        rootWorkItemId: null,
        validationRevision: 'revision-1',
        status: 'PREPARED',
        operationSet: {},
        workItemIdMappings: {},
        relationshipIdMappings: {},
        priorProjection: {},
        targetProjection: {},
        affectedWorkItemIds: [],
        affectedRelationshipIds: [],
        priorProjectionRevision: 'revision-1',
        attemptCount: lastError ? 1 : 0,
        lastError,
        lastAttemptedAt: null,
        completedAt: null,
        publishedAt: null,
        fencesReleasedAt: null,
        claimToken: null,
        claimExpiresAt: null,
        createdAt: new Date('2026-07-22T00:00:00.000Z'),
        updatedAt: new Date('2026-07-22T00:00:00.000Z'),
        checkpoints: [],
      };

      expect(toProposalResponseDto(stored, 1).materialization?.state).toBe(
        expectedState,
      );
    },
  );

  it('batch-loads optional persisted group membership without changing ungrouped records', async () => {
    const projectMemberFindMany = jest
      .fn()
      .mockResolvedValue([{ userId: 'user-1' }]);
    const proposalGroupMemberFindMany = jest.fn().mockResolvedValue([
      {
        id: 'member-1',
        groupId: 'group-1',
        proposalId: 'proposal-1',
        memberOrder: 0,
        requiredApprovals: 3,
        group: {
          status: 'REVIEWABLE',
          revision: 4,
          frozenRevision: 4,
        },
      },
    ]);
    const tx = {
      projectMember: { findMany: projectMemberFindMany },
      proposal: { findMany: jest.fn() },
      proposalGroupMember: { findMany: proposalGroupMemberFindMany },
    } as unknown as AnyTransactionClient;

    const result = await mapProposalResponses(
      tx,
      [proposal('proposal-1', []), proposal('proposal-2', [])],
      createDefaultProjectApprovalPolicy(),
    );

    expect(proposalGroupMemberFindMany).toHaveBeenCalledTimes(1);
    expect(proposalGroupMemberFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { proposalId: { in: ['proposal-1', 'proposal-2'] } },
      }),
    );
    expect(result[0]?.groupMembership).toEqual({
      groupId: 'group-1',
      memberId: 'member-1',
      memberOrder: 0,
      revision: 4,
      lifecycle: 'REVIEWABLE',
    });
    expect(result[0]?.requiredApprovals).toBe(3);
    expect(result[1]?.groupMembership).toBeUndefined();
  });
});
