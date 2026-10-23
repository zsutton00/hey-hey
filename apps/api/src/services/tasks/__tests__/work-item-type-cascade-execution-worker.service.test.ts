import { WorkItemTypeCascadeExecutionState } from '@prisma/client';
import { WorkItemTypeCascadeExecutionWorkerService } from '../work-item-type-cascade-execution-worker.service';

describe('WorkItemTypeCascadeExecutionWorkerService', () => {
  const baseExecution = {
    id: 'cascade-execution-id',
    proposalId: 'proposal-id',
    organizationId: 'organization-id',
    projectId: 'project-id',
    typeKey: 'CUSTOM',
    workItemIds: ['item-a', 'item-b'],
    state: WorkItemTypeCascadeExecutionState.PROCESSING,
    attemptCount: 1,
    nextRetryAt: new Date(),
    claimToken: 'claim-token',
    claimedAt: new Date(),
    claimExpiresAt: new Date(Date.now() + 60_000),
    graphCompletedAt: null,
    graphDeletedEdgeCount: 0,
    lastError: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup() {
    const prisma = {
      db: {
        workItemTypeCascadeExecution: {
          findFirst: jest.fn(),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
      },
    };
    const impact = { deleteCascadeIncidentEdges: jest.fn() };
    const approval = { finalizeCascadeDeleteExecution: jest.fn() };
    const tokenFactory = jest.fn().mockReturnValue('service-token');
    return {
      prisma,
      impact,
      approval,
      tokenFactory,
      service: new WorkItemTypeCascadeExecutionWorkerService(
        prisma as any,
        impact as any,
        approval as any,
        tokenFactory,
      ),
    };
  }

  it('claims due executions atomically and fences the claim with a token', async () => {
    const { service, prisma } = setup();
    prisma.db.workItemTypeCascadeExecution.findFirst.mockResolvedValue({
      ...baseExecution,
      state: WorkItemTypeCascadeExecutionState.PENDING,
    });
    prisma.db.workItemTypeCascadeExecution.findUniqueOrThrow.mockResolvedValue(
      baseExecution,
    );

    await expect(service.claimNext(new Date())).resolves.toEqual(baseExecution);
    expect(
      prisma.db.workItemTypeCascadeExecution.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: baseExecution.id }),
        data: expect.objectContaining({
          state: WorkItemTypeCascadeExecutionState.PROCESSING,
          attemptCount: { increment: 1 },
          claimToken: expect.any(String),
        }),
      }),
    );
  });

  it('leaves Graph cleanup retryable when Graph is unavailable', async () => {
    const { service, prisma, impact, approval, tokenFactory } = setup();
    impact.deleteCascadeIncidentEdges.mockRejectedValue(
      new Error('Graph unavailable'),
    );

    await service.execute(baseExecution as any);

    expect(tokenFactory).toHaveBeenCalledWith('organization-id', 'project-id');
    expect(approval.finalizeCascadeDeleteExecution).not.toHaveBeenCalled();
    expect(
      prisma.db.workItemTypeCascadeExecution.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: baseExecution.id,
          state: WorkItemTypeCascadeExecutionState.PROCESSING,
          claimToken: baseExecution.claimToken,
        }),
        data: expect.objectContaining({
          state: WorkItemTypeCascadeExecutionState.FAILED,
          lastError: 'Graph unavailable',
          claimToken: null,
        }),
      }),
    );
  });

  it('persists Graph success before finalization and never sends Graph from the finalizer', async () => {
    const { service, prisma, impact, approval } = setup();
    impact.deleteCascadeIncidentEdges.mockResolvedValue({
      deletedEdgeCount: 4,
    });

    await service.execute(baseExecution as any);

    expect(impact.deleteCascadeIncidentEdges).toHaveBeenCalledWith(
      'organization-id',
      'project-id',
      ['item-a', 'item-b'],
      'service-token',
    );
    expect(
      prisma.db.workItemTypeCascadeExecution.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
          graphDeletedEdgeCount: 4,
        }),
      }),
    );
    expect(approval.finalizeCascadeDeleteExecution).toHaveBeenCalledWith(
      baseExecution.id,
      baseExecution.claimToken,
    );
  });

  it('resumes after process loss following Graph cleanup without repeating Graph deletion', async () => {
    const { service, impact, approval } = setup();
    const graphCleaned = {
      ...baseExecution,
      graphCompletedAt: new Date(),
      state: WorkItemTypeCascadeExecutionState.PROCESSING,
    };

    await service.execute(graphCleaned as any);

    expect(impact.deleteCascadeIncidentEdges).not.toHaveBeenCalled();
    expect(approval.finalizeCascadeDeleteExecution).toHaveBeenCalledWith(
      graphCleaned.id,
      graphCleaned.claimToken,
    );
  });

  it('does not finalize after losing the claim during Graph success persistence', async () => {
    const { service, prisma, impact, approval } = setup();
    impact.deleteCascadeIncidentEdges.mockResolvedValue({
      deletedEdgeCount: 1,
    });
    prisma.db.workItemTypeCascadeExecution.updateMany.mockResolvedValue({
      count: 0,
    });

    await service.execute(baseExecution as any);

    expect(approval.finalizeCascadeDeleteExecution).not.toHaveBeenCalled();
  });

  it('does not claim a concurrently claimed execution', async () => {
    const { service, prisma } = setup();
    prisma.db.workItemTypeCascadeExecution.findFirst.mockResolvedValue(
      baseExecution,
    );
    prisma.db.workItemTypeCascadeExecution.updateMany.mockResolvedValue({
      count: 0,
    });

    await expect(service.claimNext(new Date())).resolves.toBeNull();
    expect(
      prisma.db.workItemTypeCascadeExecution.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
  });

  it('recovers an exhausted Graph-cleaned execution without resetting its Graph checkpoint', async () => {
    const { service, prisma } = setup();
    prisma.db.workItemTypeCascadeExecution.findUniqueOrThrow.mockResolvedValue({
      ...baseExecution,
      graphCompletedAt: new Date(),
      state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
    });

    await service.recover(baseExecution.id);

    expect(prisma.db.workItemTypeCascadeExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: baseExecution.id },
        data: expect.objectContaining({
          state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
          claimToken: null,
          lastError: null,
        }),
      }),
    );
  });
});
