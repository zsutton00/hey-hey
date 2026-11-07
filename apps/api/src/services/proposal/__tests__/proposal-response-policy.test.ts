import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { Logger } from '@nestjs/common';
import { evaluateApprovalPolicy } from '../permission-evaluation';
import type { AnyTransactionClient } from 'src/prisma/prisma.service';
import type { WorkItemTypeRegistryService } from '../../tasks/work-item-type-registry.service';
import { createDefaultProjectApprovalPolicy } from '../project-approval-policy.service';
import {
  mapProposalResponse as mapSingle,
  mapProposalResponses as mapMany,
  resolveProjectApprovalPolicies,
  resolveProposalOutOfDateStatuses,
} from '../proposal-response-policy';
import {
  toProposalResponseDto,
  type ProposalWithApprovals,
} from '../proposal.types';

const reconciliation = new ProposalReconciliationService(
  {} as never,
  {} as never,
  jest.fn(),
);
const mapProposalResponse = (
  ...[tx, proposal, policy, options]: [
    Parameters<typeof mapSingle>[0],
    Parameters<typeof mapSingle>[1],
    Parameters<typeof mapSingle>[2],
    Omit<Parameters<typeof mapSingle>[3], 'reconciliation'>?,
  ]
) => mapSingle(tx, proposal, policy, { ...options, reconciliation });
const mapProposalResponses = (
  ...[tx, proposals, policy, options]: [
    Parameters<typeof mapMany>[0],
    Parameters<typeof mapMany>[1],
    Parameters<typeof mapMany>[2],
    Omit<Parameters<typeof mapMany>[3], 'reconciliation'>?,
  ]
) => mapMany(tx, proposals, policy, { ...options, reconciliation });

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
  it('carries response-only linked-work identity through single and collection reads', async () => {
    const stored = {
      ...proposal('preview', []),
      action: 'VERSIONED_UPDATE',
      status: 'REJECTED',
      updates: {
        operation: 'REVISE',
        dependencies: [
          {
            edgeType: 'DEPENDS_ON',
            targetEntityType: 'TASK',
            targetEntityId: 'bug',
          },
        ],
      },
      groupMembership: {
        id: 'member',
        groupId: 'group',
        memberOrder: 0,
        requiredApprovals: 1,
        group: { status: 'REVIEWABLE', revision: 1, frozenRevision: 1 },
      },
      workItemChangeSetMaterialization: null,
    } as unknown as ProposalWithApprovals;
    const findMany = jest
      .fn()
      .mockResolvedValue([{ id: 'bug', name: 'Repair review', type: 'BUG' }]);
    const tx = { task: { findMany } } as unknown as AnyTransactionClient;
    const policy = createDefaultProjectApprovalPolicy();
    const single = await mapProposalResponse(tx, stored, policy, {
      requiredApprovals: 1,
    });
    const listed = await mapProposalResponses(tx, [stored], policy);
    expect(listed).toHaveLength(1);
    for (const response of [single, ...listed]) {
      expect(response?.dependencyPresentation).toEqual([
        {
          targetEntityId: 'bug',
          availability: 'AVAILABLE',
          title: 'Repair review',
          workItemType: 'BUG',
        },
      ]);
      expect(response?.updates).toEqual(stored.updates);
    }
  });

  it('loads reviewed futures once for a page and leaves an absent first revision null', async () => {
    const reviewedProposal = (id: string, futureId: string) =>
      ({
        ...proposal(id, []),
        action: 'VERSIONED_UPDATE',
        status: 'REJECTED',
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
      {
        evaluation: evaluateApprovalPolicy(
          { type: 'DESIGN_DOC', parentTaskId: null, initiativeId: null },
          {
            source: 'agent',
            action: 'CREATE',
            authorId: stored.requestorId,
            toolName: null,
            changedFields: [],
            eligibleProjectMemberIds: ['reviewer', 'another'],
          },
          createDefaultProjectApprovalPolicy(2),
        ),
      },
    );

    expect(findUnique).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ...toProposalResponseDto(stored, 2),
      approvalExplanation: {
        evidence: 'LIVE',
        requirement: { requiredApprovals: 2 },
      },
    });
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

describe('out-of-date comparison batch', () => {
  it('leaves applied futures outside the comparison without loading their history', async () => {
    const stored = {
      ...proposal('applied-future', []),
      action: 'VERSIONED_UPDATE' as const,
      status: 'APPROVED' as const,
      updates: { operation: 'REVISE' },
    };
    // Applied futures are excluded before inspecting their authoring payload.
    const tx = {
      proposalFuture: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { latestProposalId: stored.id, outcome: 'APPLIED' },
          ]),
      },
    };
    const owner = new ProposalReconciliationService(
      {} as never,
      {} as never,
      () => 'test',
    );
    const statuses = await resolveProposalOutOfDateStatuses(
      tx as unknown as AnyTransactionClient,
      [stored],
      owner,
    );
    expect(statuses.get(stored.id)).toBe('NOT_APPLICABLE');
  });
  it('distinguishes drift, missing history and unsupported kinds without reading review history per row', async () => {
    const items = Array.from({ length: 50 }, (_, index) => ({
      ...proposal(`item-${index}`, []),
      targetEntityType: 'TASK' as const,
      targetEntityId: 'target',
      targetLastAppliedProposalId: null,
      action: 'UPDATE' as const,
    }));
    const missing = { ...items[0]!, id: 'missing' };
    const unsupported = {
      ...items[0]!,
      id: 'unsupported',
      targetEntityType: 'DESIGN_DOC' as const,
    };
    const current = { ...items[0]!, id: 'current' };
    const revisions = [...items, current].map((item) => ({
      proposalId: item.id,
      bases: [
        {
          entityType: 'TASK',
          entityId: 'target',
          version: 'authoring',
          content: {
            name: item.id === 'current' ? 'Live' : 'Old',
            sections: {},
          },
        },
      ],
    }));
    const tx = {
      proposalReconciliationRevision: {
        findMany: jest.fn().mockResolvedValue(revisions),
      },
      task: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'target',
            lastAppliedProposalId: null,
            name: 'Live',
            updatedAt: new Date(),
            sections: [],
            serviceRelations: [],
          },
        ]),
      },
    };
    const owner = new ProposalReconciliationService(
      new ProposalReconciliationAdapterService({} as never, {} as never),
      {} as never,
      () => 'test',
    );
    const statuses = await resolveProposalOutOfDateStatuses(
      tx as unknown as AnyTransactionClient,
      [...items, missing, unsupported, current],
      owner,
    );
    expect(statuses.get('item-0')).toBe('OUT_OF_DATE');
    expect(statuses.get('missing')).toBe('UNKNOWN');
    expect(statuses.get('unsupported')).toBe('NOT_APPLICABLE');
    expect(statuses.get('current')).toBe('CURRENT');
    expect(tx.proposalReconciliationRevision.findMany).toHaveBeenCalledTimes(1);
    expect(tx.task.findMany).toHaveBeenCalledTimes(1);
describe('ordinary approval explanations', () => {
  const members = [
    { userId: 'author' },
    { userId: 'reviewer' },
    { userId: 'third' },
  ];
  const stored = (id = 'ordinary') => ({
    ...proposal(id, []),
    action: 'UPDATE' as const,
    targetEntityType: 'TASK' as const,
    targetLastAppliedProposalId: null,
    requestorId: 'author',
    requestorContext: { source: 'user' },
    updates: { status: 'COMPLETED' },
    groupMembership: null,
    workItemChangeSetMaterialization: null,
  });
  function txFor(type = 'MARKETING') {
    return {
      projectMember: { findMany: jest.fn().mockResolvedValue(members) },
      task: {
        findFirst: jest.fn().mockResolvedValue({
          type,
          parentTaskId: null,
          initiativeId: null,
          lastAppliedProposalId: null,
        }),
      },
    };
  }
  function policy(requiredApprovals: number) {
    return {
      ...createDefaultProjectApprovalPolicy(),
      rules: [
        {
          source: 'PROJECT' as const,
          match: {
            proposal: {
              source: 'user' as const,
              action: 'UPDATE' as const,
              statusOnlyChange: true,
            },
          },
          config: {
            requiresProposal: true,
            threshold: { policy: 'IMMEDIATE' as const },
            allowsProposerApproval: true,
          },
        },
        {
          source: 'PROJECT' as const,
          match: {},
          config: {
            requiresProposal: true,
            threshold: {
              policy: 'PROJECT_REQUIRED' as const,
              requiredApprovals,
            },
            allowsProposerApproval: true,
          },
        },
      ],
    };
  }

  it.each(['GOAL', 'MARKETING'])(
    'explains status-only and combined custom-section writes for %s using live saved rules',
    async (type) => {
      const db = txFor(type);
      const single = await mapProposalResponse(
        db as unknown as AnyTransactionClient,
        stored(),
        policy(2),
        { viewerId: 'reviewer' },
      );
      expect(single.approvalExplanation).toMatchObject({
        evidence: 'LIVE',
        source: 'PROJECT',
        requirement: { category: 'IMMEDIATE', requiredApprovals: 0 },
        changedFields: ['status'],
        viewerEligibility: { eligibleToApprove: true },
      });
      const combined = {
        ...stored(),
        updates: {
          status: 'COMPLETED',
          sections: [{ key: 'audience', content: 'Teams' }],
        },
      };
      for (const count of [3, 1, 2]) {
        const response = await mapProposalResponse(
          db as unknown as AnyTransactionClient,
          combined,
          policy(count),
          { viewerId: 'author' },
        );
        expect(response.requiredApprovals).toBe(count);
        expect(response.approvalExplanation).toMatchObject({
          requirement: { requiredApprovals: count },
          changedFields: ['status', 'sections.audience'],
          changedFieldClassification: {
            statusOnlyChange: false,
            contentChange: true,
          },
        });
      }
    },
  );

  it('keeps captured history and explicit legacy absence independent of current policy', async () => {
    const { evaluateApprovalPolicy } = await import('../permission-evaluation');
    const { captureApprovalEvidence } = await import('../approval-explanation');
    const evaluation = evaluateApprovalPolicy(
      { type: 'MARKETING', parentTaskId: null, initiativeId: null },
      {
        source: 'user',
        action: 'UPDATE',
        authorId: 'author',
        toolName: null,
        changedFields: ['status'],
        eligibleProjectMemberIds: ['author', 'reviewer'],
      },
      policy(2),
    );
    const evidence = captureApprovalEvidence(evaluation, 1);
    expect(evidence).not.toHaveProperty('viewerEligibility');
    const terminal = {
      ...stored(),
      status: 'APPROVED' as const,
      approvalDecisionEvidence: evidence,
    };
    const historyDb = {
      task: {
        findFirst: jest.fn().mockResolvedValue({ lastAppliedProposalId: null }),
      },
    } as unknown as AnyTransactionClient;
    for (const currentPolicy of [policy(1), policy(3)]) {
      const response = await mapProposalResponse(
        historyDb,
        terminal,
        currentPolicy,
        { viewerId: 'reviewer' },
      );
      expect(response.approvalExplanation).toMatchObject({
        ...evidence,
        viewerEligibility: { eligibleToApprove: false },
      });
      expect(response.requiredApprovals).toBe(0);
    }
    const legacy = await mapProposalResponse(
      historyDb,
      { ...terminal, approvalDecisionEvidence: null },
      policy(3),
    );
    expect(legacy.requiredApprovals).toBeNull();
    expect(legacy.approvalExplanation).toMatchObject({
      evidence: 'UNAVAILABLE',
      source: null,
      requirement: null,
      changedFields: null,
    });
    const removedTargetHistory = await mapProposalResponse(
      {
        task: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as AnyTransactionClient,
      { ...terminal, status: 'REJECTED', approvalDecisionEvidence: null },
      new Map(),
    );
    expect(removedTargetHistory).toMatchObject({
      status: 'REJECTED',
      requiredApprovals: null,
      outOfDateStatus: 'NOT_APPLICABLE',
      approvalExplanation: { evidence: 'UNAVAILABLE' },
    });
    const rejected = await mapProposalResponse(
      historyDb,
      { ...terminal, status: 'REJECTED' },
      policy(3),
    );
    expect(rejected.approvalExplanation?.evidence).toBe('CAPTURED');
    const diagnostic = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const isolated = await mapProposalResponses(
      txFor() as unknown as AnyTransactionClient,
      [
        {
          ...terminal,
          id: 'corrupt-history',
          approvalDecisionEvidence: { evidence: 'CAPTURED' },
        },
        terminal,
        {
          ...stored('healthy-review'),
          updates: { name: 'Content needing review' },
        },
      ],
      policy(2),
      { omitUnresolvableTargets: true },
    );
    expect(isolated.map((item) => item.id)).toEqual([
      terminal.id,
      'healthy-review',
    ]);
    expect(isolated[1]).toMatchObject({
      status: 'DRAFT',
      requiredApprovals: 2,
      approvalExplanation: { evidence: 'LIVE', source: 'PROJECT' },
    });
    expect(diagnostic).toHaveBeenCalledWith(
      'Proposal decision evidence unavailable in collection',
      { proposalId: 'corrupt-history' },
    );
    expect(diagnostic.mock.calls.flat()).not.toContain('CAPTURED');
    diagnostic.mockRestore();
  });

  it('returns healthy review work when another project or individual target fails, resolving each project once', async () => {
    const db = txFor();
    db.task.findFirst.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === 'missing'
          ? null
          : {
              type: 'MARKETING',
              parentTaskId: null,
              initiativeId: null,
              lastAppliedProposalId: null,
            },
    );
    const proposals = [
      stored('healthy'),
      { ...stored('broken-project'), projectId: 'broken-project' },
      { ...stored('missing-target'), targetEntityId: 'missing' },
    ];
    const resolver = {
      resolve: jest.fn(async (id: string) => {
        if (id === 'broken-project') {
          throw new Error('secret connection string');
        }
        return policy(2);
      }),
    };
    const policies = await resolveProjectApprovalPolicies(resolver, proposals);
    const responses = await mapProposalResponses(
      db as unknown as AnyTransactionClient,
      proposals,
      policies,
      { omitUnresolvableTargets: true },
    );
    expect(resolver.resolve).toHaveBeenCalledTimes(2);
    expect(db.projectMember.findMany).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => response.id)).toEqual(['healthy']);
  });
});
