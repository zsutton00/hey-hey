import { TrackingCleanupOperationStatus } from '@prisma/client';
import { TrackingCleanupWorkerService } from '../tracking-cleanup-worker.service';

describe('TrackingCleanupWorkerService', () => {
  const operation = {
    id: 'cleanup-operation-id',
    proposalId: 'proposal-id',
    organizationId: 'organization-id',
    projectId: 'project-id',
    operationKind: 'REVOKED_TRACKS',
    targetTypeKey: 'GOAL',
    revokedSourceTypeKeys: ['BUG'],
    status: TrackingCleanupOperationStatus.PROCESSING,
    attemptCount: 1,
    nextRetryAt: new Date(),
    claimedAt: new Date(),
    claimExpiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    lastError: null,
    clearedRelationshipCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function setup() {
    const prisma = {
      db: {
        trackingCleanupOperation: {
          findFirst: jest.fn(),
          updateMany: jest.fn(),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
      },
    };
    const tracks = {
      clearRevokedTrackingSourceEdges: jest.fn(),
    };
    const tokenFactory = jest.fn().mockReturnValue('service-token');
    return {
      prisma,
      tracks,
      tokenFactory,
      service: new TrackingCleanupWorkerService(
        prisma as any,
        tracks as any,
        tokenFactory,
      ),
    };
  }

  it('claims due work atomically and increments its attempt', async () => {
    const { service, prisma } = setup();
    prisma.db.trackingCleanupOperation.findFirst.mockResolvedValue(operation);
    prisma.db.trackingCleanupOperation.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.db.trackingCleanupOperation.findUniqueOrThrow.mockResolvedValue(
      operation,
    );

    await expect(service.claimNext(new Date())).resolves.toEqual(operation);
    expect(prisma.db.trackingCleanupOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: operation.id }),
        data: expect.objectContaining({
          status: TrackingCleanupOperationStatus.PROCESSING,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it('uses a project-scoped service credential and records the completed count', async () => {
    const { service, prisma, tracks, tokenFactory } = setup();
    tracks.clearRevokedTrackingSourceEdges.mockResolvedValue({
      clearedLinkCount: 3,
      clearedEdges: [],
    });

    await service.execute(operation as any);

    expect(tokenFactory).toHaveBeenCalledWith('organization-id', 'project-id');
    expect(tracks.clearRevokedTrackingSourceEdges).toHaveBeenCalledWith(
      'organization-id',
      'project-id',
      'GOAL',
      ['BUG'],
      'service-token',
    );
    expect(prisma.db.trackingCleanupOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: operation.id,
          status: TrackingCleanupOperationStatus.PROCESSING,
          claimedAt: operation.claimedAt,
        }),
        data: expect.objectContaining({
          status: TrackingCleanupOperationStatus.COMPLETED,
          clearedRelationshipCount: 3,
        }),
      }),
    );
  });

  it('keeps a failed operation durable for retry without storing a credential', async () => {
    const { service, prisma, tracks } = setup();
    tracks.clearRevokedTrackingSourceEdges.mockRejectedValue(
      new Error('Graph unavailable'),
    );

    await service.execute(operation as any);

    expect(prisma.db.trackingCleanupOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: operation.id,
          status: TrackingCleanupOperationStatus.PROCESSING,
          claimedAt: operation.claimedAt,
        }),
        data: expect.objectContaining({
          status: TrackingCleanupOperationStatus.FAILED,
          lastError: 'Graph unavailable',
          claimExpiresAt: null,
        }),
      }),
    );
  });

  it('does not overwrite a newer worker result after its claim expires', async () => {
    const { service, prisma, tracks } = setup();
    tracks.clearRevokedTrackingSourceEdges.mockResolvedValue({
      clearedLinkCount: 3,
      clearedEdges: [],
    });
    prisma.db.trackingCleanupOperation.updateMany.mockResolvedValue({
      count: 0,
    });

    await service.execute(operation as any);

    expect(prisma.db.trackingCleanupOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: operation.id,
          status: TrackingCleanupOperationStatus.PROCESSING,
          claimedAt: operation.claimedAt,
        }),
      }),
    );
  });

  it('allows an operator to requeue exhausted work without recreating the proposal', async () => {
    const { service, prisma } = setup();

    await service.recover(operation.id);

    expect(prisma.db.trackingCleanupOperation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: operation.id },
        data: expect.objectContaining({
          status: TrackingCleanupOperationStatus.PENDING,
          claimedAt: null,
          claimExpiresAt: null,
          lastError: null,
        }),
      }),
    );
  });
});
