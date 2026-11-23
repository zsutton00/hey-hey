import { randomUUID } from 'node:crypto';
import { ProposalApprovalService } from '../proposal-approval.service';

describe('approving a future cancellation', () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const targetEntityId = randomUUID();
  const futureId = randomUUID();
  const actorId = randomUUID();

  function cancellation(operation: 'CANCEL' | 'REVISE' = 'CANCEL') {
    return {
      id: randomUUID(),
      organizationId,
      projectId,
      targetEntityId,
      targetEntityType: 'TASK',
      action: 'VERSIONED_UPDATE',
      updates:
        operation === 'CANCEL'
          ? { operation, futureId, expectedRevision: 1 }
          : { operation },
    };
  }

  function harness(outstanding: string[]) {
    const tx = {
      proposal: {
        findMany: jest.fn(async (_args: any) =>
          outstanding.map((id) => ({ id })),
        ),
        updateMany: jest.fn(async () => ({ count: outstanding.length })),
      },
      proposalApprovalRecord: {
        createMany: jest.fn(async (_args: any) => ({})),
      },
    };
    const pendingEdgeService = { cleanupForProposal: jest.fn() };
    const proposalGroupDecisionService = {
      invalidateFutureRefinementsInTransaction: jest.fn(),
    };
    const service = Object.assign(
      Object.create(ProposalApprovalService.prototype),
      { pendingEdgeService, proposalGroupDecisionService },
    ) as unknown as {
      rejectRefinementsOfCancelledFuture: (
        tx: unknown,
        proposal: unknown,
        actorId: string,
      ) => Promise<void>;
    };
    return { tx, service, pendingEdgeService, proposalGroupDecisionService };
  }

  it('rejects other pending refinements with a recorded reason, never the cancel itself', async () => {
    const refinements = [randomUUID(), randomUUID()];
    const { tx, service, pendingEdgeService, proposalGroupDecisionService } =
      harness(refinements);
    const cancel = cancellation();

    await service.rejectRefinementsOfCancelledFuture(tx, cancel, actorId);

    expect(tx.proposal.findMany.mock.calls[0]![0].where.id).toEqual({
      not: cancel.id,
    });
    expect(tx.proposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: refinements },
          status: 'DRAFT',
        }),
        data: { status: 'REJECTED' },
      }),
    );
    const records = tx.proposalApprovalRecord.createMany.mock.calls[0]![0].data;
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      userId: actorId,
      type: 'REJECTION',
      reason: expect.stringContaining(futureId),
    });
    expect(pendingEdgeService.cleanupForProposal).toHaveBeenCalledTimes(2);
    expect(
      proposalGroupDecisionService.invalidateFutureRefinementsInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      organizationId,
      projectId,
      refinements,
      expect.any(String),
    );
  });

  it('does nothing when no refinements are pending', async () => {
    const { tx, service } = harness([]);
    await service.rejectRefinementsOfCancelledFuture(
      tx,
      cancellation(),
      actorId,
    );
    expect(tx.proposal.updateMany).not.toHaveBeenCalled();
  });
});
