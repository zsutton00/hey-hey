import { randomUUID } from 'node:crypto';
import {
  parseFutureRevisionMutation,
  readFutureRevision,
  readFutureCompletionEligibility,
  stageFutureRevision,
  validateFutureRevision,
} from '../future-revision';
import { deriveChangedFields } from '../entity-context-resolver';
import { evaluatePermissions } from '../permission-evaluation';
import { createDefaultProjectApprovalPolicy } from '../project-approval-policy.service';

describe('reviewed future persistence', () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const targetEntityId = randomUUID();
  const workId = randomUUID();
  const futureId = randomUUID();
  const content = {
    id: targetEntityId,
    organizationId,
    projectId,
    name: 'Live',
    type: 'FEATURE',
    status: 'BACKLOG',
    source: 'user',
    sections: [],
  };
  let futures: Map<string, any>;
  let history: any[];
  let dependencies: any[];
  let tx: any;
  let registry: any;

  function mutation(overrides: any = {}) {
    return {
      operation: 'REVISE',
      futureId,
      expectedRevision: 0,
      baseline: { kind: 'LIVE', revision: 'live-revision-1', content },
      result: { ...content, name: 'Tomorrow' },
      dependencies: [
        {
          edgeType: 'DEPENDS_ON',
          targetEntityType: 'TASK',
          targetEntityId: workId,
        },
      ],
      ...overrides,
    };
  }
  function proposal(updates: any) {
    return {
      id: randomUUID(),
      organizationId,
      projectId,
      targetEntityId,
      targetEntityType: 'TASK',
      action: 'VERSIONED_UPDATE',
      updates,
      edges: null,
    } as any;
  }
  beforeEach(() => {
    futures = new Map();
    history = [];
    dependencies = [];
    registry = {
      getDefinition: jest.fn(() => ({ definition: { role: 'work-item' } })),
      getSectionDefinitions: jest.fn(() => [
        { key: 'description', kind: 'markdown' },
      ]),
    };
    tx = {
      $queryRaw: jest.fn(),
      proposal: { findMany: jest.fn(async () => []) },
      task: {
        findFirst: jest.fn(async () => ({ type: 'FEATURE' })),
        findMany: jest.fn(async () => [
          { id: workId, type: 'BUG', status: 'COMPLETED', archivedAt: null },
        ]),
      },
      proposalFuture: {
        findFirst: jest.fn(async ({ where }: any) => {
          const row = futures.get(where.id);
          if (
            !row ||
            row.organizationId !== where.organizationId ||
            row.projectId !== where.projectId
          )
            return null;
          return {
            ...row,
            history: history.filter((h) => h.futureId === row.id),
            dependencies: dependencies.filter((d) => d.futureId === row.id),
          };
        }),
        create: jest.fn(async ({ data }: any) => {
          if (futures.has(data.id)) throw new Error('duplicate');
          futures.set(data.id, {
            appliedAt: null,
            appliedRevision: null,
            cancelledAt: null,
            ...data,
          });
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = futures.get(where.id);
          if (
            !row ||
            row.revision !== where.revision ||
            row.outcome !== where.outcome
          )
            return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      proposalReconciliationRevision: { findFirst: jest.fn(async () => null) },
      proposalFutureRevision: {
        findFirst: jest.fn(async ({ where }: any) =>
          history.find(
            (h) =>
              h.proposalId === where.proposalId &&
              h.candidateRevisionId === where.candidateRevisionId,
          ),
        ),
        create: jest.fn(async ({ data }: any) =>
          history.push(structuredClone(data)),
        ),
      },
      proposalFutureDependency: {
        deleteMany: jest.fn(async ({ where }: any) => {
          dependencies = dependencies.filter(
            (d) => d.futureId !== where.futureId,
          );
        }),
        createMany: jest.fn(async ({ data }: any) => {
          dependencies.push(...data);
        }),
      },
    };
  });

  it('stages fresh content on the same proposal once without replaying its older approved result', async () => {
    const first = proposal(mutation());
    tx.proposalReconciliationRevision.findFirst.mockResolvedValue({
      id: 'content-one',
    });
    await stageFutureRevision(tx, registry, first);
    const next = {
      ...first,
      updates: mutation({
        expectedRevision: 1,
        result: { ...content, name: 'Saved resolution' },
      }),
    };
    tx.proposalReconciliationRevision.findFirst.mockResolvedValue({
      id: 'content-two',
    });
    await stageFutureRevision(tx, registry, next);
    await stageFutureRevision(tx, registry, next);
    expect(history).toHaveLength(2);
    expect(history.map((entry) => entry.proposalId)).toEqual([
      first.id,
      first.id,
    ]);
    expect(futures.get(futureId).result.name).toBe('Saved resolution');
    expect(futures.get(futureId).revision).toBe(2);
    expect(dependencies.map((entry) => entry.targetEntityId)).toEqual([workId]);
  });

  it('round trips complete reviewed content, baseline, lineage and future-owned dependencies', async () => {
    const first = proposal(mutation());
    await stageFutureRevision(tx, registry, first);
    await stageFutureRevision(tx, registry, first); // idempotent retry
    const result = await readFutureRevision(
      tx,
      registry,
      futureId,
      organizationId,
      projectId,
    );
    expect(result).toMatchObject({
      id: futureId,
      revision: 1,
      outcome: 'STAGED',
      result: { ...content, name: 'Tomorrow' },
      baseline: mutation().baseline,
      originatingProposalId: first.id,
      latestProposalId: first.id,
      dependencies: mutation().dependencies,
    });
    expect(result.history).toHaveLength(1);
    expect(result.outstandingRefinementProposalIds).toEqual([]);
    expect(result.completionEligibility).toEqual({
      eligible: true,
      blockers: [],
    });
    expect(content.name).toBe('Live');
    expect(Object.keys(tx.task)).toEqual(['findFirst', 'findMany']);
  });

  it('imposes no completion wait on an empty dependency set', async () => {
    expect(
      await readFutureCompletionEligibility(
        tx,
        registry,
        organizationId,
        projectId,
        [],
      ),
    ).toEqual({ eligible: true, blockers: [] });
    expect(tx.task.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['STANDARD', 'ACTIVE', null, 'INCOMPLETE'],
    ['STANDARD', 'VERIFYING', null, undefined],
    ['BUG', 'COMPLETED', null, undefined],
    ['PLAN', 'VERIFYING', null, 'INCOMPLETE'],
    ['PLAN', 'COMPLETED', null, undefined],
    ['BUG', 'CANCELLED', null, 'CANCELLED'],
    ['BUG', 'SUPERSEDED', null, 'SUPERSEDED'],
    ['BUG', 'ARCHIVED', null, 'ARCHIVED'],
    ['BUG', 'COMPLETED', new Date(), 'ARCHIVED'],
  ])(
    'uses canonical %s status %s',
    async (type, status, archivedAt, reason) => {
      tx.task.findMany.mockResolvedValue([
        { id: workId, type, status, archivedAt },
      ]);
      const dependencies = mutation().dependencies;
      const result = await readFutureCompletionEligibility(
        tx,
        registry,
        organizationId,
        projectId,
        dependencies,
      );
      expect(result).toEqual({
        eligible: reason === undefined,
        blockers: reason
          ? [{ dependency: dependencies[0], reason, status }]
          : [],
      });
    },
  );

  it('requires every dependency, including missing and unresolvable targets', async () => {
    const missing = randomUUID();
    registry.getDefinition.mockReturnValue(undefined);
    const dependencies = [
      ...mutation().dependencies,
      {
        edgeType: 'DEPENDS_ON' as const,
        targetEntityType: 'TASK' as const,
        targetEntityId: missing,
      },
    ];
    expect(
      await readFutureCompletionEligibility(
        tx,
        registry,
        organizationId,
        projectId,
        dependencies,
      ),
    ).toEqual({
      eligible: false,
      blockers: [
        {
          dependency: dependencies[0],
          reason: 'UNRESOLVABLE',
          status: 'COMPLETED',
        },
        { dependency: dependencies[1], reason: 'MISSING' },
      ],
    });
    expect(tx.task.findMany).toHaveBeenCalledWith({
      where: { organizationId, projectId, id: { in: [workId, missing] } },
      select: { id: true, type: true, status: true, archivedAt: true },
    });
  });

  it('reflects reopening without changing the future or live target', async () => {
    await stageFutureRevision(tx, registry, proposal(mutation()));
    expect(
      (
        await readFutureRevision(
          tx,
          registry,
          futureId,
          organizationId,
          projectId,
        )
      ).completionEligibility.eligible,
    ).toBe(true);
    tx.task.findMany.mockResolvedValue([
      { id: workId, type: 'BUG', status: 'ACTIVE', archivedAt: null },
    ]);
    expect(
      (
        await readFutureRevision(
          tx,
          registry,
          futureId,
          organizationId,
          projectId,
        )
      ).completionEligibility.eligible,
    ).toBe(false);
    expect(tx.proposalFuture.updateMany).not.toHaveBeenCalled();
    expect(history).toHaveLength(1);
  });

  it('does not let a completed dependency hide another incomplete dependency', async () => {
    const incompleteId = randomUUID();
    tx.task.findMany.mockResolvedValue([
      { id: workId, type: 'STANDARD', status: 'COMPLETED', archivedAt: null },
      {
        id: incompleteId,
        type: 'STANDARD',
        status: 'ACTIVE',
        archivedAt: null,
      },
    ]);
    const incomplete = {
      edgeType: 'DEPENDS_ON' as const,
      targetEntityType: 'TASK' as const,
      targetEntityId: incompleteId,
    };
    expect(
      await readFutureCompletionEligibility(
        tx,
        registry,
        organizationId,
        projectId,
        [...mutation().dependencies, incomplete],
      ),
    ).toEqual({
      eligible: false,
      blockers: [
        { dependency: incomplete, reason: 'INCOMPLETE', status: 'ACTIVE' },
      ],
    });
  });

  it('keeps approved state intact while a refinement is authored, edited, or rejected', async () => {
    const first = proposal(mutation());
    await stageFutureRevision(tx, registry, first);
    const approved = structuredClone(
      await readFutureRevision(
        tx,
        registry,
        futureId,
        organizationId,
        projectId,
      ),
    );
    const refinement = proposal(
      mutation({
        expectedRevision: 1,
        baseline: { kind: 'LIVE', revision: 'new-basis', content },
        result: { ...content, name: 'Pending direction' },
        dependencies: [],
      }),
    );
    tx.proposal.findMany.mockResolvedValue([{ id: refinement.id }]);
    await validateFutureRevision(
      tx,
      registry,
      refinement,
      organizationId,
      projectId,
    );
    refinement.updates.result.name = 'Edited pending direction';
    await validateFutureRevision(
      tx,
      registry,
      refinement,
      organizationId,
      projectId,
    );
    expect(
      await readFutureRevision(
        tx,
        registry,
        futureId,
        organizationId,
        projectId,
      ),
    ).toEqual({
      ...approved,
      outstandingRefinementProposalIds: [refinement.id],
    });
    // Rejection removes the proposal from the DRAFT read, not from approved history.
    tx.proposal.findMany.mockResolvedValue([]);
    expect(
      await readFutureRevision(
        tx,
        registry,
        futureId,
        organizationId,
        projectId,
      ),
    ).toEqual(approved);
    expect(tx.proposalFuture.updateMany).not.toHaveBeenCalled();
    expect(history).toHaveLength(1);
  });

  it('reads outstanding proposals by future and scope, independently of approved history or expected revision', async () => {
    await stageFutureRevision(tx, registry, proposal(mutation()));
    const pending = [randomUUID(), randomUUID()];
    tx.proposal.findMany.mockResolvedValue(pending.map((id) => ({ id })));
    const result = await readFutureRevision(
      tx,
      registry,
      futureId,
      organizationId,
      projectId,
    );
    expect(result.outstandingRefinementProposalIds).toEqual(pending);
    expect(result.history).toHaveLength(1);
    expect(tx.proposal.findMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        projectId,
        targetEntityId,
        targetEntityType: 'TASK',
        action: 'VERSIONED_UPDATE',
        status: 'DRAFT',
        legacyReconciliationSuggestion: null,
        updates: { path: ['futureId'], equals: futureId },
        NOT: {
          groupMembership: { is: { group: { is: { status: 'BUILDING' } } } },
        },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('accepts a refinement through ordinary staging while retaining the prior approved result in history', async () => {
    const first = proposal(mutation());
    await stageFutureRevision(tx, registry, first);
    const next = proposal(
      mutation({
        expectedRevision: 1,
        result: { ...content, name: 'Accepted' },
        dependencies: [],
      }),
    );
    tx.proposal.findMany.mockResolvedValue([{ id: next.id }]);
    expect(
      (
        await readFutureRevision(
          tx,
          registry,
          futureId,
          organizationId,
          projectId,
        )
      ).result.name,
    ).toBe('Tomorrow');
    await stageFutureRevision(tx, registry, next);
    tx.proposal.findMany.mockResolvedValue([]);
    const accepted = await readFutureRevision(
      tx,
      registry,
      futureId,
      organizationId,
      projectId,
    );
    expect(accepted).toMatchObject({
      id: futureId,
      revision: 2,
      result: { name: 'Accepted' },
      dependencies: [],
      latestProposalId: next.id,
      outstandingRefinementProposalIds: [],
    });
    expect(accepted.history.map((entry) => entry.proposalId)).toEqual([
      first.id,
      next.id,
    ]);
    expect(accepted.history[0]!.mutation).toEqual(first.updates);
  });

  it('retains stable identity and immutable prior revisions during refinement and cancellation', async () => {
    const first = proposal(mutation());
    await stageFutureRevision(tx, registry, first);
    const next = proposal(
      mutation({
        expectedRevision: 1,
        result: { ...content, name: 'Refined' },
        dependencies: [],
      }),
    );
    await stageFutureRevision(tx, registry, next);
    await stageFutureRevision(
      tx,
      registry,
      proposal({ operation: 'CANCEL', futureId, expectedRevision: 2 }),
    );
    const result = await readFutureRevision(
      tx,
      registry,
      futureId,
      organizationId,
      projectId,
    );
    expect(result).toMatchObject({
      revision: 3,
      outcome: 'CANCELLED',
      result: { name: 'Refined' },
      dependencies: [],
      originatingProposalId: first.id,
    });
    expect(result.history.map((h) => h.revision)).toEqual([1, 2, 3]);
    expect(result.history[0]!.mutation).toEqual(first.updates);
    expect(content.name).toBe('Live');
    await expect(
      stageFutureRevision(
        tx,
        registry,
        proposal(mutation({ expectedRevision: 3 })),
      ),
    ).rejects.toThrow('outcome changed');
  });

  it('keeps independent futures separate and selects exact reviewed parent content', async () => {
    await stageFutureRevision(tx, registry, proposal(mutation()));
    const childId = randomUUID();
    await stageFutureRevision(
      tx,
      registry,
      proposal(
        mutation({
          futureId: childId,
          baseline: {
            kind: 'FUTURE',
            futureId,
            revision: '1',
            content: mutation().result,
          },
          result: { ...content, name: 'Child' },
        }),
      ),
    );
    expect(
      (
        await readFutureRevision(
          tx,
          registry,
          futureId,
          organizationId,
          projectId,
        )
      ).result.name,
    ).toBe('Tomorrow');
    expect(
      (
        await readFutureRevision(
          tx,
          registry,
          childId,
          organizationId,
          projectId,
        )
      ).result.name,
    ).toBe('Child');
    await expect(
      stageFutureRevision(
        tx,
        registry,
        proposal(
          mutation({
            futureId: randomUUID(),
            baseline: { kind: 'FUTURE', futureId, revision: '1', content },
          }),
        ),
      ),
    ).rejects.toThrow('exact reviewed baseline');
  });

  it('rejects stale and concurrent refinements without overwriting approved history', async () => {
    await stageFutureRevision(tx, registry, proposal(mutation()));
    await expect(
      stageFutureRevision(
        tx,
        registry,
        proposal(mutation({ expectedRevision: 5 })),
      ),
    ).rejects.toThrow('revision or outcome changed');
    tx.proposalFuture.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      stageFutureRevision(
        tx,
        registry,
        proposal(mutation({ expectedRevision: 1 })),
      ),
    ).rejects.toThrow('during review');
    expect(history).toHaveLength(1);
  });

  it('admits registry-role work and Plans but rejects project-info dependencies', async () => {
    registry.getDefinition.mockReturnValue({
      definition: { role: 'project-info' },
    });
    await expect(
      validateFutureRevision(
        tx,
        registry,
        proposal(mutation()),
        organizationId,
        projectId,
      ),
    ).rejects.toThrow('work-item-role');
    tx.task.findMany.mockResolvedValue([{ id: workId, type: 'PLAN' }]);
    await expect(
      validateFutureRevision(
        tx,
        registry,
        proposal(mutation()),
        organizationId,
        projectId,
      ),
    ).resolves.toEqual(mutation());
  });

  it('admits typed CREATE reservations only inside a valid group context', async () => {
    tx.task.findMany.mockResolvedValue([]);
    await expect(
      validateFutureRevision(
        tx,
        registry,
        proposal(mutation()),
        organizationId,
        projectId,
      ),
    ).rejects.toThrow('work-item-role');
    await expect(
      validateFutureRevision(
        tx,
        registry,
        proposal(mutation()),
        organizationId,
        projectId,
        [{ entityId: workId, entityType: 'TASK', workItemType: 'BUG' }],
      ),
    ).resolves.toEqual(mutation());
  });

  it('rejects cross-project reads, malformed patches and live-target edges', async () => {
    await stageFutureRevision(tx, registry, proposal(mutation()));
    await expect(
      readFutureRevision(tx, registry, futureId, organizationId, randomUUID()),
    ).rejects.toThrow('not found');
    expect(() =>
      parseFutureRevisionMutation(mutation({ result: { name: 'Patch' } })),
    ).toThrow('OpenAPI');
    expect(() =>
      parseFutureRevisionMutation(
        mutation({
          dependencies: [
            {
              edgeType: 'RELATED_TO',
              targetEntityType: 'TASK',
              targetEntityId: workId,
            },
          ],
        }),
      ),
    ).toThrow('OpenAPI');
    await expect(
      validateFutureRevision(
        tx,
        registry,
        { ...proposal(mutation()), edges: [{}] },
        organizationId,
        projectId,
      ),
    ).rejects.toThrow('live-target edges');
  });

  it('uses the same content approval for a changed future section and a live update', async () => {
    const section = (materializedMarkdown: string) => ({
      id: randomUUID(),
      key: 'description',
      order: 0,
      materializedMarkdown,
      materializedProposalId: randomUUID(),
    });
    const baselineContent = {
      ...content,
      sections: [section('Before')],
    };
    const resultContent = {
      ...baselineContent,
      sections: [section('After')],
    };
    const futureFields = await deriveChangedFields(
      tx,
      proposal(
        mutation({
          baseline: {
            kind: 'LIVE',
            revision: 'live-revision-1',
            content: baselineContent,
          },
          result: resultContent,
        }),
      ),
      { organizationId, projectId, workItemTypeRegistry: registry },
    );
    const liveFields = await deriveChangedFields(tx, {
      targetEntityType: 'TASK',
      action: 'UPDATE',
      targetEntityId,
      updates: { sections: [{ key: 'description', content: 'After' }] },
    });

    const entity = { type: 'FEATURE', parentTaskId: null, initiativeId: null };
    const makeProposalContext = (changedFields: string[]) => ({
      source: 'agent' as const,
      action: 'UPDATE' as const,
      authorId: randomUUID(),
      eligibleProjectMemberIds: [randomUUID(), randomUUID()],
      toolName: 'proposal-tool',
      changedFields,
    });
    const projectPolicy = createDefaultProjectApprovalPolicy(2);
    const futureApproval = evaluatePermissions(
      entity,
      makeProposalContext(futureFields),
      projectPolicy,
    );
    const liveApproval = evaluatePermissions(
      entity,
      makeProposalContext(liveFields),
      projectPolicy,
    );

    expect(futureFields).toEqual(['sections.description']);
    expect(futureApproval.threshold).toBe(2);
    expect(futureApproval.threshold).toBe(liveApproval.threshold);
  });

  it('uses only the name field when name is the only future content change', async () => {
    await expect(
      deriveChangedFields(tx, proposal(mutation()), {
        organizationId,
        projectId,
        workItemTypeRegistry: registry,
      }),
    ).resolves.toEqual(['name']);
  });

  it('keeps staged content approval fields when a refinement changes dependencies', async () => {
    await expect(
      deriveChangedFields(
        tx,
        proposal(
          mutation({
            dependencies: [
              {
                edgeType: 'DEPENDS_ON',
                targetEntityType: 'TASK',
                targetEntityId: randomUUID(),
              },
            ],
          }),
        ),
        { organizationId, projectId, workItemTypeRegistry: registry },
      ),
    ).resolves.toEqual(['name']);
  });

  it('uses the stored future baseline and result for cancellation approval', async () => {
    const baselineContent = { ...content, name: 'Live' };
    const resultContent = { ...content, name: 'Tomorrow' };
    futures.set(futureId, {
      id: futureId,
      organizationId,
      projectId,
      targetEntityId,
      targetEntityType: 'TASK',
      baseline: {
        kind: 'LIVE',
        revision: 'live-revision-1',
        content: baselineContent,
      },
      result: resultContent,
      outcome: 'STAGED',
      revision: 1,
    });

    await expect(
      deriveChangedFields(
        tx,
        proposal({ operation: 'CANCEL', futureId, expectedRevision: 1 }),
        { organizationId, projectId, workItemTypeRegistry: registry },
      ),
    ).resolves.toEqual(['name']);
    expect(tx.proposalFuture.findFirst).toHaveBeenCalledWith({
      where: {
        id: futureId,
        organizationId,
        projectId,
        targetEntityId,
        targetEntityType: 'TASK',
      },
      select: { baseline: true, result: true },
    });
  });

  it('compares structured future sections by parsed content', async () => {
    registry.getSectionDefinitions.mockReturnValue([
      { key: 'metadata', kind: 'json' },
    ]);
    const section = (materializedMarkdown: string) => ({
      id: randomUUID(),
      key: 'metadata',
      order: 0,
      materializedMarkdown,
      materializedProposalId: randomUUID(),
    });
    const baselineContent = {
      ...content,
      sections: [section('{"first":1,"second":2}')],
    };
    const resultContent = {
      ...baselineContent,
      sections: [section('{"second":2,"first":1}')],
    };

    await expect(
      deriveChangedFields(
        tx,
        proposal(
          mutation({
            baseline: {
              kind: 'LIVE',
              revision: 'live-revision-1',
              content: baselineContent,
            },
            result: resultContent,
          }),
        ),
        { organizationId, projectId, workItemTypeRegistry: registry },
      ),
    ).resolves.toEqual([]);
  });

  it.each([
    ['status', { status: 'ACTIVE' }],
    ['config', { config: { kind: 'INITIAL_WORKTREE', version: 'v1' } }],
    ['source', { source: 'agent' }],
  ])('rejects a task future that changes %s', async (field, change) => {
    const candidate = mutation({
      result: { ...content, name: 'Tomorrow', ...change },
    });
    await expect(
      validateFutureRevision(
        tx,
        registry,
        proposal(candidate),
        organizationId,
        projectId,
      ),
    ).rejects.toThrow(field);
  });

  it('accepts task futures that preserve status, config and source', async () => {
    await expect(
      validateFutureRevision(
        tx,
        registry,
        proposal(mutation()),
        organizationId,
        projectId,
      ),
    ).resolves.toEqual(mutation());
  });

  it('rejects a design-doc future that changes status', async () => {
    const document = {
      id: targetEntityId,
      organizationId,
      projectId,
      name: 'Design',
      template: 'ADR',
      status: 'READY',
      tags: [],
      sections: [],
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    };
    tx.designDoc = { findFirst: jest.fn(async () => ({ id: targetEntityId })) };
    const draft = proposal(
      mutation({
        baseline: {
          kind: 'LIVE',
          revision: 'document-revision',
          content: document,
        },
        result: { ...document, name: 'Reviewed design', status: 'IN_REVIEW' },
      }),
    );
    draft.targetEntityType = 'DESIGN_DOC';
    await expect(
      validateFutureRevision(tx, registry, draft, organizationId, projectId),
    ).rejects.toThrow('status');
  });

  it('stages a complete design document without using its live update path', async () => {
    const document = {
      id: targetEntityId,
      organizationId,
      projectId,
      name: 'Design',
      template: 'ADR',
      status: 'READY',
      tags: [],
      sections: [],
      createdAt: '2026-09-27T00:00:00.000Z',
      updatedAt: '2026-09-27T00:00:00.000Z',
    };
    tx.designDoc = { findFirst: jest.fn(async () => ({ id: targetEntityId })) };
    const draft = proposal(
      mutation({
        baseline: {
          kind: 'LIVE',
          revision: 'document-revision',
          content: document,
        },
        result: { ...document, name: 'Reviewed design' },
      }),
    );
    draft.targetEntityType = 'DESIGN_DOC';
    await stageFutureRevision(tx, registry, draft);
    expect(
      (
        await readFutureRevision(
          tx,
          registry,
          futureId,
          organizationId,
          projectId,
        )
      ).result,
    ).toEqual({ ...document, name: 'Reviewed design' });
    expect(Object.keys(tx.designDoc)).toEqual(['findFirst']);
  });
});
