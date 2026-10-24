import { randomUUID } from 'node:crypto';
import { ProposalApprovalService } from '../proposal-approval.service';
import { DEFAULT_PROJECT_APPROVAL_POLICY } from '../project-approval-policy.service';
import {
  futureBaselineBlocker,
  futureTargetUpdates,
  matchesFutureConfirmation,
  parseFutureApplyRequest,
} from '../future-application';
import { lockFutureForMutation } from '../future-revision';
import { ProposalController } from 'src/controllers/proposal.controller';
import { ProposalGroupCoordinatorService } from '../proposal-group-coordinator.service';
import { ProposalReconciliationService } from '../proposal-reconciliation.service';
import { ProposalReconciliationAdapterService } from '../proposal-reconciliation-adapter.service';

describe('manual future application', () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const futureId = randomUUID();
  const targetId = randomUUID();
  const proposalId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const workId = randomUUID();
  const timestamp = new Date('2026-09-27T12:00:00Z');
  let state: any;
  let db: any;
  let service: ProposalApprovalService;
  let enact: jest.Mock;
  let groupInvalidation: jest.Mock;
  let registry: any;
  let reconciliation: ProposalReconciliationService;
  const stored = (target: any) =>
    target && {
      updatedAt: timestamp,
      archivedAt: null,
      serviceRelations: [],
      ...target,
      sections: target.sections.map((section: any) => ({
        id: section.key,
        updatedAt: timestamp,
        crdtSnapshotSeq: 0,
        updates: [],
        ...section,
      })),
    };

  beforeEach(() => {
    const content = {
      id: targetId,
      organizationId,
      projectId,
      name: 'Current',
      type: 'FEATURE',
      status: 'BACKLOG',
      source: 'user',
      priority: 'MEDIUM',
      sections: [
        {
          id: randomUUID(),
          key: 'description',
          order: 0,
          materializedMarkdown: 'Current body',
          materializedProposalId: proposalId,
        },
      ],
    };
    state = {
      future: {
        id: futureId,
        organizationId,
        projectId,
        targetEntityId: targetId,
        targetEntityType: 'TASK',
        revision: 1,
        outcome: 'STAGED',
        originatingProposalId: proposalId,
        latestProposalId: proposalId,
        baseline: { kind: 'LIVE', revision: 'opaque-owned-token', content },
        result: { ...content, name: 'Reviewed' },
        dependencies: [],
        history: [],
        appliedAt: null,
        appliedRevision: null,
        cancelledAt: null,
      },
      target: {
        ...content,
        tag: null,
        config: null,
        assigneeId: null,
        parentTaskId: null,
        initiativeId: null,
        dueDate: null,
      },
      proposal: {
        id: proposalId,
        organizationId,
        projectId,
        targetEntityId: targetId,
        targetEntityType: 'TASK',
        action: 'VERSIONED_UPDATE',
        status: 'APPROVED',
        requestorId: otherUserId,
        requestorContext: { source: 'agent', toolName: 'edit_work_item' },
        updates: {},
        approvalRecords: [{ userId, type: 'APPROVAL' }],
        groupMembership: null,
      },
      refinements: [],
      members: [{ userId }, { userId: otherUserId }],
      work: {
        id: workId,
        type: 'STANDARD',
        status: 'COMPLETED',
        archivedAt: null,
      },
    };
    state.proposal.updates = {
      operation: 'REVISE',
      futureId,
      expectedRevision: 0,
      baseline: state.future.baseline,
      result: state.future.result,
      dependencies: [],
    };
    db = {
      $queryRaw: jest.fn(),
      proposalFuture: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === futureId ? state.future : null,
        ),
        update: jest.fn(async ({ data }: any) =>
          Object.assign(state.future, data),
        ),
      },
      proposal: {
        findFirst: jest.fn(async () => state.proposal),
        findMany: jest.fn(async () =>
          state.refinements.filter((entry: any) => entry.status === 'DRAFT'),
        ),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const rows = state.refinements.filter(
            (entry: any) =>
              where.id.in.includes(entry.id) && entry.status === 'DRAFT',
          );
          rows.forEach((entry: any) => Object.assign(entry, data));
          return { count: rows.length };
        }),
      },
      task: {
        findFirst: jest.fn(async () => stored(state.target)),
        findMany: jest.fn(async () => (state.work ? [state.work] : [])),
      },
      designDoc: { findFirst: jest.fn(async () => stored(state.target)) },
      projectMember: { findMany: jest.fn(async () => state.members) },
    };
    db.$transaction = jest.fn(async (run: any) => {
      const snapshot = structuredClone(state);
      try {
        return await run(db);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    });
    registry = {
      getDefinition: jest.fn(() => ({ definition: { role: 'work-item' } })),
      getSectionDefinitions: jest.fn(() => [
        { key: 'description', kind: 'markdown' },
        { key: 'config', kind: 'json' },
      ]),
      getSectionDefinition: jest.fn((_type: string, key: string) =>
        registry
          .getSectionDefinitions()
          .find((definition: any) => definition.key === key),
      ),
    };
    reconciliation = new ProposalReconciliationService(
      new ProposalReconciliationAdapterService(registry, {} as any),
      {} as any,
      {} as any,
    );
    enact = jest.fn(async () => {
      state.target.name = state.future.result.name;
      return {
        proposal: state.proposal,
        materializableEdges: [],
        runPostCommit: jest.fn().mockResolvedValue(undefined),
      };
    });
    groupInvalidation = jest.fn().mockResolvedValue(undefined);
    service = Object.assign(Object.create(ProposalApprovalService.prototype), {
      logger: { log: jest.fn(), warn: jest.fn() },
      prisma: { db },
      workItemTypeRegistry: registry,
      reconciliation,
      projectApprovalPolicyService: {
        resolve: jest.fn(async () => DEFAULT_PROJECT_APPROVAL_POLICY),
      },
      pendingEdgeService: {
        cleanupForProposal: jest.fn(),
        materializeEdges: jest.fn(),
      },
      proposalGroupDecisionService: {
        invalidateFutureRefinementsInTransaction: groupInvalidation,
      },
      applyInTransaction: enact,
    });
  });

  const apply = (request: any = { expectedRevision: 1 }) =>
    service.applyFuture(
      futureId,
      organizationId as any,
      projectId as any,
      userId as any,
      request,
    );
  function graphScenario() {
    const nodeId = randomUUID();
    const graph = {
      valid: true,
      projectedRoot: {
        identity: { refType: 'existing', id: targetId },
        label: state.target.name,
        name: state.target.name,
        type: 'DIAGRAM',
        sections: [],
        deleted: false,
      },
      children: [
        {
          identity: { refType: 'existing', id: nodeId },
          label: 'Element',
          name: 'Element',
          type: 'DIAGRAM_ELEMENT',
          parent: { refType: 'existing', id: targetId },
          sections: [],
          deleted: false,
        },
      ],
      sections: [],
      incidentRelationships: [],
      identityLabels: {},
      issues: [],
      warnings: [],
    };
    state.future.baseline.content.graph = structuredClone(graph);
    state.future.result.graph = structuredClone(graph);
    state.future.result.graph.projectedRoot.name = state.future.result.name;
    state.future.result.graph.children[0]!.name = 'Reviewed element';
    const adapter = (reconciliation as any).adapter;
    adapter.readFutureGraph = jest.fn(async () => graph);
    db.proposalGroupMember = { findUnique: jest.fn().mockResolvedValue(null) };
    db.workItemChangeSetMaterialization = {
      findUnique: jest.fn(async () => state.intent ?? null),
    };
    const materializer = {
      projectPreparation: jest.fn(async ({ request }) => ({
        operationSet: request,
        validationRevision: 'graph-validation',
        snapshots: { target: state.future.result.graph },
      })),
      enqueuePreparedIntent: jest.fn(async (_tx, input) => {
        state.intent = { id: randomUUID(), status: 'PREPARED', ...input };
      }),
      materializeApprovedChangeSet: jest.fn(async () => {
        state.future.outcome = 'APPLIED';
        state.future.appliedRevision = state.future.revision;
        state.target.name = state.future.result.name;
        return { enacted: true };
      }),
    };
    Object.assign(service, { workItemChangeSetMaterializer: materializer });
    return { graph, materializer };
  }

  it('routes an explicitly applied reviewed graph through the durable generic intent, preserving the non-live approval', async () => {
    const { materializer } = graphScenario();
    expect(state.future.outcome).toBe('STAGED');
    const response = await apply();
    expect(response.status).toBe('APPLIED');
    expect(response.future.outcome).toBe('APPLIED');
    expect(materializer.enqueuePreparedIntent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        proposalId,
        futureApplication: expect.objectContaining({
          futureId,
          revision: 1,
          refinementIds: [],
        }),
      }),
    );
    expect(
      materializer.projectPreparation.mock.calls[0]![0].request.operations,
    ).toContainEqual(
      expect.objectContaining({
        op: 'workItem.update',
        name: 'Reviewed element',
      }),
    );
    expect(enact).not.toHaveBeenCalled();
    expect(state.proposal.action).toBe('VERSIONED_UPDATE');
  });

  it('blocks graph application when linked work is incomplete without creating an intent', async () => {
    const { materializer } = graphScenario();
    dependent();
    state.work.status = 'ACTIVE';
    expect(await apply()).toMatchObject({
      status: 'BLOCKED',
      blocker: 'COMPLETION_INCOMPLETE',
    });
    expect(materializer.enqueuePreparedIntent).not.toHaveBeenCalled();
    expect(materializer.materializeApprovedChangeSet).not.toHaveBeenCalled();
    expect(state.future.outcome).toBe('STAGED');
  });

  it('detects element-only drift even when the Diagram root and its sections did not change', async () => {
    const { graph, materializer } = graphScenario();
    graph.children[0]!.name = 'Concurrent live edit';
    expect(await apply()).toMatchObject({
      status: 'BLOCKED',
      blocker: 'BASELINE_CHANGED',
    });
    expect(materializer.enqueuePreparedIntent).not.toHaveBeenCalled();
    expect(materializer.materializeApprovedChangeSet).not.toHaveBeenCalled();
  });

  it('leaves a failed graph application staged and resumes its stored intent on explicit retry', async () => {
    const { materializer } = graphScenario();
    materializer.materializeApprovedChangeSet.mockRejectedValueOnce(
      new Error('Graph unavailable'),
    );
    await expect(apply()).rejects.toThrow('Graph unavailable');
    expect(state.future.outcome).toBe('STAGED');
    expect(state.target.name).toBe('Current');
    const intent = state.intent;
    expect(await apply()).toMatchObject({
      status: 'APPLIED',
      future: { outcome: 'APPLIED' },
    });
    expect(state.intent).toBe(intent);
    expect(materializer.enqueuePreparedIntent).toHaveBeenCalledTimes(1);
    expect(materializer.projectPreparation).toHaveBeenCalledTimes(1);
  });

  function pending() {
    state.refinements.push({
      id: randomUUID(),
      updatedAt: timestamp,
      status: 'DRAFT',
    });
  }
  function dependent() {
    state.future.dependencies = [
      {
        edgeType: 'DEPENDS_ON',
        targetEntityType: 'TASK',
        targetEntityId: workId,
      },
    ];
  }

  it('returns unresolved links and resolves unfinalized group approvals in one batch', async () => {
    const missingProposalId = randomUUID();
    const nonFutureProposalId = randomUUID();
    const missingFutureIdProposalId = randomUUID();
    const linkedFuture = {
      ...state.proposal,
      title: null,
      action: 'VERSIONED_UPDATE',
      status: 'DRAFT',
      updates: {
        operation: 'REVISE',
        futureId,
        expectedRevision: 1,
        baseline: state.future.baseline,
        result: state.future.result,
        dependencies: [],
      },
      approvalRecords: [{ userId, type: 'APPROVAL' }],
      groupMembership: {
        requiredApprovals: null,
        group: { status: 'BUILDING', revision: 1, frozenRevision: null },
      },
    };
    const nonFutureProposal = {
      ...linkedFuture,
      id: nonFutureProposalId,
      action: 'UPDATE',
      updates: { name: 'Updated' },
    };
    const missingFutureIdProposal = {
      ...linkedFuture,
      id: missingFutureIdProposalId,
      updates: { operation: 'REVISE' },
    };
    db.proposal.findMany.mockResolvedValue([
      linkedFuture,
      nonFutureProposal,
      missingFutureIdProposal,
    ]);
    const resolvePolicy = jest
      .fn()
      .mockResolvedValue(DEFAULT_PROJECT_APPROVAL_POLICY);
    (service as any).projectApprovalPolicyService = { resolve: resolvePolicy };

    const states = await service.readFutureProposalApprovalStates(
      [
        missingProposalId,
        nonFutureProposalId,
        missingFutureIdProposalId,
        proposalId,
      ],
      organizationId as any,
      projectId as any,
    );

    expect(db.proposal.findMany).toHaveBeenCalledTimes(1);
    expect(db.proposal.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [
            missingProposalId,
            nonFutureProposalId,
            missingFutureIdProposalId,
            proposalId,
          ],
        },
        organizationId,
        projectId,
      },
      include: {
        approvalRecords: true,
        groupMembership: {
          include: {
            group: {
              select: {
                status: true,
                revision: true,
                frozenRevision: true,
              },
            },
          },
        },
      },
    });
    expect(resolvePolicy).toHaveBeenCalledTimes(1);
    expect(states).toEqual([
      {
        kind: 'unresolved',
        proposalId: missingProposalId,
        reason: 'NOT_FOUND',
      },
      {
        kind: 'unresolved',
        proposalId: nonFutureProposalId,
        reason: 'NOT_FUTURE_REVISION',
      },
      {
        kind: 'unresolved',
        proposalId: missingFutureIdProposalId,
        reason: 'NOT_FUTURE_REVISION',
      },
      {
        kind: 'future',
        proposalId,
        proposalTitle: null,
        futureId,
        status: 'DRAFT',
        approvalsRecorded: 1,
        requiredApprovals: 1,
      },
    ]);
  });

  const applicability = () =>
    service.getFutureApplicability(
      futureId,
      organizationId as Parameters<
        ProposalApprovalService['getFutureApplicability']
      >[1],
      projectId as Parameters<
        ProposalApprovalService['getFutureApplicability']
      >[2],
      userId as Parameters<
        ProposalApprovalService['getFutureApplicability']
      >[3],
    );

  it('reads application gates without applying or invalidating refinements', async () => {
    pending();
    expect(await applicability()).toEqual({
      revision: 1,
      canApply: true,
      blockers: [],
      completionEligibility: { eligible: true, blockers: [] },
    });
    expect(enact).not.toHaveBeenCalled();
    expect(db.proposal.updateMany).not.toHaveBeenCalled();
    expect(state.future.outcome).toBe('STAGED');
  });

  it('distinguishes approval, permission, completion and baseline blockers', async () => {
    dependent();
    state.work.status = 'ACTIVE';
    state.target.name = 'Changed live content';
    state.proposal.approvalRecords = [];
    expect(await applicability()).toEqual({
      revision: 1,
      canApply: false,
      blockers: [
        'APPROVAL_REQUIRED',
        'COMPLETION_INCOMPLETE',
        'BASELINE_CHANGED',
      ],
      completionEligibility: {
        eligible: false,
        blockers: [expect.objectContaining({ reason: 'INCOMPLETE' })],
      },
    });
    state.proposal.approvalRecords = [{ userId, type: 'APPROVAL' }];
    state.members = [{ userId: otherUserId }];
    expect((await applicability()).blockers).toContain('PERMISSION_DENIED');
    expect(enact).not.toHaveBeenCalled();
  });

  it('applies an approved future without recording another vote and retains its identity', async () => {
    state.target.status = 'ACTIVE';
    const result = await apply();
    expect(result.status).toBe('APPLIED');
    expect(result.future).toMatchObject({
      id: futureId,
      revision: 1,
      appliedRevision: 1,
      outcome: 'APPLIED',
    });
    expect(enact).toHaveBeenCalledWith(
      db,
      state.proposal,
      organizationId,
      projectId,
      { reviewedFuture: expect.objectContaining({ id: futureId }) },
    );
    expect(state.proposal.approvalRecords).toEqual([
      { userId, type: 'APPROVAL' },
    ]);
    expect(state.target.status).toBe('ACTIVE');
  });
  it('returns the same applied result on a duplicate Apply without enacting twice', async () => {
    await apply();
    await apply();
    expect(enact).toHaveBeenCalledTimes(1);
  });
  it('uses the frozen group approval threshold', async () => {
    state.proposal.groupMembership = { requiredApprovals: 2 };
    await expect(apply()).rejects.toThrow('insufficient approvals');
    expect(enact).not.toHaveBeenCalled();
  });
  it.each(['permissions', 'approvals', 'approval status'])(
    'rejects insufficient %s even with a confirmation',
    async (gate) => {
      if (gate === 'permissions') state.members = [{ userId: otherUserId }];
      if (gate === 'approvals') state.proposal.approvalRecords = [];
      if (gate === 'approval status') state.proposal.status = 'DRAFT';
      await expect(
        apply({
          expectedRevision: 1,
          confirmation: { revision: 1, refinements: [] },
        }),
      ).rejects.toThrow();
      expect(enact).not.toHaveBeenCalled();
    },
  );
  it('does not count duplicate approval records as distinct votes', async () => {
    state.proposal.groupMembership = { requiredApprovals: 2 };
    state.proposal.approvalRecords.push({ userId, type: 'APPROVAL' });
    await expect(apply()).rejects.toThrow('insufficient approvals');
  });
  it.each(['ACTIVE', 'CANCELLED', 'ARCHIVED', 'SUPERSEDED'])(
    'blocks a dependency in %s, including reopened work',
    async (status) => {
      dependent();
      state.work.status = status;
      expect(await apply()).toMatchObject({
        status: 'BLOCKED',
        blocker: 'COMPLETION_INCOMPLETE',
      });
      expect(enact).not.toHaveBeenCalled();
    },
  );
  it('applies once implementation work reaches verification', async () => {
    dependent();
    state.work.status = 'VERIFYING';
    expect(await apply()).toMatchObject({ status: 'APPLIED' });
  });
  it('blocks when any one of several dependencies is not ready', async () => {
    const otherWorkId = randomUUID();
    state.future.dependencies = [
      {
        edgeType: 'DEPENDS_ON',
        targetEntityType: 'TASK',
        targetEntityId: workId,
      },
      {
        edgeType: 'DEPENDS_ON',
        targetEntityType: 'TASK',
        targetEntityId: otherWorkId,
      },
    ];
    state.work.status = 'VERIFYING';
    const other = {
      id: otherWorkId,
      type: 'STANDARD',
      status: 'ACTIVE',
      archivedAt: null,
    };
    db.task.findMany.mockImplementation(async () => [state.work, other]);
    expect(await apply()).toMatchObject({ blocker: 'COMPLETION_INCOMPLETE' });
    other.status = 'COMPLETED';
    expect(await apply()).toMatchObject({ status: 'APPLIED' });
  });
  it('lists staged futures linked to a work item with truthful readiness', async () => {
    dependent();
    state.work.status = 'VERIFYING';
    db.proposalFuture.findMany = jest.fn(async () => [state.future]);
    db.proposal.findMany.mockResolvedValueOnce([
      { id: proposalId, title: 'Reviewed knowledge' },
    ]);
    const offers = await service.listFutureOffers(
      workId,
      organizationId as any,
      projectId as any,
      userId as any,
    );
    expect(offers).toEqual([
      expect.objectContaining({
        futureId,
        proposalId,
        proposalTitle: 'Reviewed knowledge',
        applicability: expect.objectContaining({ canApply: true }),
      }),
    ]);
    expect(db.proposalFuture.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: 'STAGED',
          dependencies: { some: { targetEntityId: workId } },
        }),
      }),
    );
    expect(enact).not.toHaveBeenCalled();
    state.work.status = 'ACTIVE';
    db.proposal.findMany.mockResolvedValueOnce([]);
    const [reopened] = await service.listFutureOffers(
      workId,
      organizationId as any,
      projectId as any,
      userId as any,
    );
    expect(reopened?.applicability.blockers).toContain('COMPLETION_INCOMPLETE');
  });
  it('requires explicit Plan completion', async () => {
    dependent();
    state.work.type = 'PLAN';
    state.work.status = 'VERIFYING';
    expect(await apply()).toMatchObject({ blocker: 'COMPLETION_INCOMPLETE' });
    state.work.status = 'COMPLETED';
    expect(await apply()).toMatchObject({ status: 'APPLIED' });
  });
  it('does not treat missing dependencies as complete', async () => {
    dependent();
    state.work = null;
    expect(await apply()).toMatchObject({ blocker: 'COMPLETION_INCOMPLETE' });
  });
  it('returns the current reviewed revision when the selected revision changed', async () => {
    state.future.revision = 2;
    expect(await apply()).toMatchObject({
      status: 'BLOCKED',
      blocker: 'REVISION_CHANGED',
      future: { revision: 2 },
    });
    expect(enact).not.toHaveBeenCalled();
  });
  it('keeps cancelled futures non-live', async () => {
    state.future.outcome = 'CANCELLED';
    expect(await apply()).toMatchObject({ blocker: 'CANCELLED' });
    expect(enact).not.toHaveBeenCalled();
  });
  it.each(['scalar', 'section', 'section order'])(
    'blocks changed baseline %s content without accepting acknowledgement',
    async (kind) => {
      if (kind === 'scalar') state.target.name = 'Concurrent edit';
      if (kind === 'section')
        state.target.sections = [
          {
            ...state.target.sections[0],
            materializedMarkdown: 'Concurrent edit',
          },
        ];
      if (kind === 'section order')
        state.target.sections = [{ ...state.target.sections[0], order: 2 }];
      expect(
        await apply({
          expectedRevision: 1,
          confirmation: { revision: 1, refinements: [] },
        }),
      ).toMatchObject({ blocker: 'BASELINE_CHANGED' });
      expect(enact).not.toHaveBeenCalled();
    },
  );
  it('requires an applied selected parent baseline', async () => {
    state.future.baseline = {
      ...state.future.baseline,
      kind: 'FUTURE',
      futureId: randomUUID(),
      revision: '1',
    };
    expect(await apply()).toMatchObject({ blocker: 'BASELINE_UNAVAILABLE' });
  });
  it('checks design-document baselines and applies their reviewed result', async () => {
    const content = {
      id: targetId,
      organizationId,
      projectId,
      template: 'DESIGN_DOC',
      name: 'Current',
      status: 'DRAFT',
      tags: [],
      parentEntityId: null,
      parentEntityType: null,
      summary: null,
      sections: [],
    };
    state.future.targetEntityType = 'DESIGN_DOC';
    state.proposal.targetEntityType = 'DESIGN_DOC';
    state.future.baseline.content = structuredClone(content);
    state.future.result = { ...content, name: 'Reviewed' };
    state.target = structuredClone(content);
    state.target.name = 'New live content';
    expect(await apply()).toMatchObject({ blocker: 'BASELINE_CHANGED' });
    state.target.name = 'Current';
    state.target.status = 'IN_REVIEW';
    expect(await apply()).toMatchObject({ status: 'APPLIED' });
    expect(futureTargetUpdates(state.future, registry)).not.toHaveProperty(
      'status',
    );
    expect(state.target.status).toBe('IN_REVIEW');
  });
  it('does not invent a live revision token from timestamps', async () => {
    state.target.updatedAt = new Date();
    expect(await apply()).toMatchObject({ status: 'APPLIED' });
  });
  it('requires confirmation and leaves both live content and pending refinements untouched', async () => {
    pending();
    expect(await apply()).toMatchObject({
      status: 'CONFIRMATION_REQUIRED',
      confirmation: {
        revision: 1,
        refinements: [
          {
            proposalId: state.refinements[0].id,
            updatedAt: timestamp.toISOString(),
          },
        ],
      },
    });
    expect(enact).not.toHaveBeenCalled();
    expect(state.refinements[0].status).toBe('DRAFT');
    expect(state.target.name).toBe('Current');
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId,
          projectId,
          targetEntityId: targetId,
          updates: { path: ['futureId'], equals: futureId },
          status: 'DRAFT',
        }),
      }),
    );
  });
  it('invalidates only the confirmed refinements after successful enactment', async () => {
    pending();
    const warning = await apply();
    expect(
      await apply({ expectedRevision: 1, confirmation: warning.confirmation }),
    ).toMatchObject({ status: 'APPLIED' });
    expect(state.refinements[0].status).toBe('REJECTED');
    expect(groupInvalidation).toHaveBeenCalledWith(
      db,
      organizationId,
      projectId,
      [state.refinements[0].id],
    );
    expect(enact.mock.invocationCallOrder[0]).toBeLessThan(
      db.proposal.updateMany.mock.invocationCallOrder[0],
    );
  });
  it.each(['added', 'edited', 'removed'])(
    'requires fresh confirmation when refinements are %s',
    async (change) => {
      pending();
      const warning = await apply();
      if (change === 'added') pending();
      if (change === 'edited')
        state.refinements[0].updatedAt = new Date(timestamp.getTime() + 1);
      if (change === 'removed') state.refinements = [];
      expect(
        await apply({
          expectedRevision: 1,
          confirmation: warning.confirmation,
        }),
      ).toMatchObject({ status: 'CONFIRMATION_REQUIRED' });
      expect(enact).not.toHaveBeenCalled();
    },
  );
  it('rechecks dependencies after confirmation', async () => {
    pending();
    dependent();
    const warning = await apply();
    state.work.status = 'ACTIVE';
    expect(
      await apply({ expectedRevision: 1, confirmation: warning.confirmation }),
    ).toMatchObject({ blocker: 'COMPLETION_INCOMPLETE' });
    expect(state.refinements[0].status).toBe('DRAFT');
  });
  it('rolls back target and refinement changes when application fails, then allows explicit retry', async () => {
    pending();
    const warning = await apply();
    enact.mockImplementationOnce(async () => {
      state.target.name = 'Partial';
      throw new Error('mutation failed');
    });
    await expect(
      apply({ expectedRevision: 1, confirmation: warning.confirmation }),
    ).rejects.toThrow('mutation failed');
    expect(state.target.name).toBe('Current');
    expect(state.refinements[0].status).toBe('DRAFT');
    expect(state.future.outcome).toBe('STAGED');
    expect(
      await apply({ expectedRevision: 1, confirmation: warning.confirmation }),
    ).toMatchObject({ status: 'APPLIED' });
  });
  it('rolls back application if refinement invalidation fails', async () => {
    pending();
    const warning = await apply();
    groupInvalidation.mockRejectedValueOnce(new Error('write failed'));
    await expect(
      apply({ expectedRevision: 1, confirmation: warning.confirmation }),
    ).rejects.toThrow('write failed');
    expect(state.target.name).toBe('Current');
    expect(state.refinements[0].status).toBe('DRAFT');
  });
  it('does not claim application when a reviewed field cannot be materialized by the target contract', async () => {
    pending();
    state.future.result.config = { schemaVersion: 1 };
    const warning = await apply();
    await expect(
      apply({ expectedRevision: 1, confirmation: warning.confirmation }),
    ).rejects.toThrow('complete reviewed result');
    expect(state.target.name).toBe('Current');
    expect(state.refinements[0].status).toBe('DRAFT');
    expect(state.future.outcome).toBe('STAGED');
  });
  it('prevents admitting a refinement after the future was applied', async () => {
    await apply();
    await expect(
      lockFutureForMutation(
        db,
        { operation: 'CANCEL', futureId, expectedRevision: 1 },
        organizationId,
        projectId,
      ),
    ).rejects.toThrow('Future target');
  });
  it('compares structured section values semantically', async () => {
    state.future.baseline.content.sections = [
      { key: 'config', order: 0, materializedMarkdown: '{"a":1,"b":2}' },
    ];
    state.target.sections = [
      { key: 'config', order: 0, materializedMarkdown: '{"b":2,"a":1}' },
    ];
    expect(
      await futureBaselineBlocker(db, state.future, reconciliation),
    ).toBeUndefined();
  });
  it('maps reviewed sections to existing target updates', () => {
    state.future.result.sections = [
      {
        ...state.future.result.sections[0],
        materializedMarkdown: 'Reviewed body',
      },
    ];
    expect(futureTargetUpdates(state.future, registry)).toMatchObject({
      name: 'Reviewed',
      sections: [{ key: 'description', order: 0, content: 'Reviewed body' }],
    });
  });
  it('applies a title change while preserving an unset structured section', async () => {
    const section = { key: 'config', order: 0, materializedMarkdown: '' };
    state.future.baseline.content.sections = [section];
    state.future.result.sections = [section];
    state.target.sections = [{ ...section, materializedMarkdown: null }];
    enact.mockImplementationOnce(async () => {
      const updates = futureTargetUpdates(state.future, registry);
      expect(updates.sections).toEqual([]);
      state.target.name = updates.name;
      return {
        proposal: state.proposal,
        materializableEdges: [],
        runPostCommit: jest.fn(),
      };
    });
    expect(await apply()).toMatchObject({ status: 'APPLIED' });
    expect(state.target.sections[0].materializedMarkdown).toBeNull();
  });
  it('uses schemaRef section semantics for comparisons and changed content', async () => {
    registry.getSectionDefinitions.mockReturnValue([
      {
        key: 'config',
        schemaRef: '#/components/schemas/WorkItemGraphLayoutValue',
      },
    ]);
    state.future.baseline.content.sections = [
      { key: 'config', order: 0, materializedMarkdown: '{"a":1,"b":2}' },
    ];
    state.target.sections = [
      { key: 'config', order: 0, materializedMarkdown: '{"b":2,"a":1}' },
    ];
    expect(
      await futureBaselineBlocker(db, state.future, reconciliation),
    ).toBeUndefined();
    state.future.result.sections = [
      { key: 'config', order: 0, materializedMarkdown: '{"a":2,"b":2}' },
    ];
    expect(futureTargetUpdates(state.future, registry).sections).toEqual([
      { key: 'config', order: 0, content: { a: 2, b: 2 } },
    ]);
  });
  it('carries Mockup presentation content through to the target update', () => {
    registry.getSectionDefinitions.mockReturnValue([
      { key: 'description', kind: 'markdown' },
      { key: 'mockup', kind: 'html/css' },
    ]);
    const presentation = (html: string) =>
      JSON.stringify({ html, css: 'main{padding:8px}', sizeKey: 'desktop' });
    state.future.baseline.content.type = 'MOCKUP';
    state.future.baseline.content.sections = [
      state.future.baseline.content.sections[0],
      {
        key: 'mockup',
        order: 1,
        materializedMarkdown: presentation('<main/>'),
      },
    ];
    state.future.result = {
      ...state.future.baseline.content,
      sections: [
        state.future.baseline.content.sections[0],
        {
          key: 'mockup',
          order: 1,
          materializedMarkdown: presentation('<main>New</main>'),
        },
      ],
    };
    expect(futureTargetUpdates(state.future, registry).sections).toEqual([
      {
        key: 'mockup',
        order: 1,
        content: {
          html: '<main>New</main>',
          css: 'main{padding:8px}',
          sizeKey: 'desktop',
        },
      },
    ]);
  });
  it('treats refinement ordering as a set and rejects duplicate entries', () => {
    const a = { proposalId: randomUUID(), updatedAt: timestamp.toISOString() };
    const b = { ...a, proposalId: randomUUID() };
    expect(
      matchesFutureConfirmation(
        { revision: 1, refinements: [b, a] },
        { revision: 1, refinements: [a, b] },
      ),
    ).toBe(true);
    expect(
      matchesFutureConfirmation(
        { revision: 1, refinements: [a, a] },
        { revision: 1, refinements: [a, b] },
      ),
    ).toBe(false);
  });
  it('validates the HTTP boundary from OpenAPI and delegates the parsed request', async () => {
    expect(parseFutureApplyRequest({ expectedRevision: 1 })).toEqual({
      expectedRevision: 1,
    });
    for (const request of [
      {},
      { expectedRevision: 0 },
      { expectedRevision: '1' },
      { expectedRevision: 1, bypass: true },
    ])
      expect(() => parseFutureApplyRequest(request)).toThrow();
    const boundary = {
      applyFuture: jest.fn().mockResolvedValue({ status: 'APPLIED' }),
    };
    const controller = new ProposalController(
      {} as any,
      boundary as any,
      {} as never,
    );
    await controller.applyFuture(
      organizationId as any,
      projectId as any,
      futureId,
      { userId } as any,
      { expectedRevision: 1 },
    );
    expect(boundary.applyFuture).toHaveBeenCalledWith(
      futureId,
      organizationId,
      projectId,
      userId,
      { expectedRevision: 1 },
    );
    await expect(
      controller.applyFuture(
        organizationId as any,
        projectId as any,
        futureId,
        { userId } as any,
        {},
      ),
    ).rejects.toThrow();
    expect(boundary.applyFuture).toHaveBeenCalledTimes(1);
  });
});

describe('confirmed refinement group invalidation', () => {
  it('uses existing dependent invalidation and settlement inside the application transaction', async () => {
    const proposalId = randomUUID();
    const member = { id: randomUUID(), groupId: randomUUID() };
    const dependentId = randomUUID();
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const tx = {
      proposalGroupMember: {
        findMany: jest.fn().mockResolvedValue([member]),
        update: jest.fn(),
      },
    };
    const invalidate = jest.fn().mockResolvedValue([dependentId]);
    const settle = jest.fn().mockResolvedValue(true);
    const publish = jest.fn();
    const coordinator: ProposalGroupCoordinatorService = Object.assign(
      Object.create(ProposalGroupCoordinatorService.prototype),
      {
        invalidateImpossibleDependents: invalidate,
        settleIfTerminal: settle,
        publishLifecycleInTransaction: publish,
      },
    );
    await coordinator.invalidateFutureRefinementsInTransaction(
      tx as any,
      organizationId as any,
      projectId as any,
      [proposalId],
    );
    expect(tx.proposalGroupMember.findMany).toHaveBeenCalledWith({
      where: {
        proposalId: { in: [proposalId] },
        group: { organizationId, projectId },
      },
      select: { id: true, groupId: true },
    });
    expect(tx.proposalGroupMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: member.id },
        data: expect.objectContaining({ executionState: 'INVALIDATED' }),
      }),
    );
    expect(invalidate).toHaveBeenCalledWith(
      tx,
      member.id,
      member.groupId,
      expect.any(Date),
    );
    expect(settle).toHaveBeenCalledWith(tx, member.groupId, expect.any(Date));
    expect(publish).toHaveBeenCalledWith(
      tx,
      organizationId,
      projectId,
      member.id,
      [member.id, dependentId],
    );
  });
});
