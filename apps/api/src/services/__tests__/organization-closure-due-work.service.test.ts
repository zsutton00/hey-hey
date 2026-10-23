import { OrganizationClosureExecutionStage } from '@prisma/client';
import { OrganizationClosureDueWorkService } from '../organization-closure-due-work.service';

describe('OrganizationClosureDueWorkService', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');

  function setup() {
    const prisma = {
      $queryRaw: jest.fn(),
      db: {
        organizationClosureExecution: {
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
      },
    };
    const lifecycleOwner = { materializeReachedClosure: jest.fn() };
    return {
      prisma,
      lifecycleOwner,
      service: new OrganizationClosureDueWorkService(
        prisma as any,
        lifecycleOwner as any,
      ),
    };
  }

  it('materializes only the reached snapshot selected by the due query', async () => {
    const { service, prisma, lifecycleOwner } = setup();
    prisma.$queryRaw.mockResolvedValue([{ organizationId: 'organization-id' }]);

    await expect(service.materializeNextReachedSnapshot(now)).resolves.toBe(
      true,
    );

    expect(lifecycleOwner.materializeReachedClosure).toHaveBeenCalledWith(
      'organization-id',
      now,
    );
  });

  it('returns no work when no reached snapshot exists', async () => {
    const { service, prisma, lifecycleOwner } = setup();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.materializeNextReachedSnapshot(now)).resolves.toBe(
      false,
    );
    expect(lifecycleOwner.materializeReachedClosure).not.toHaveBeenCalled();
  });

  it('returns only the execution won by the atomic skip-locked claim', async () => {
    const { service, prisma } = setup();
    const execution = {
      organizationId: 'organization-id',
      stage: OrganizationClosureExecutionStage.PENDING,
      attemptCount: 1,
    };
    prisma.$queryRaw.mockResolvedValue([{ organizationId: 'organization-id' }]);
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue(
      execution,
    );

    await expect(service.claimNext(now)).resolves.toBe(execution);
    expect(
      prisma.db.organizationClosureExecution.findUniqueOrThrow,
    ).toHaveBeenCalledWith({ where: { organizationId: 'organization-id' } });
  });

  it('does not fabricate a claim when another worker wins', async () => {
    const { service, prisma } = setup();
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.claimNext(now)).resolves.toBeNull();
    expect(
      prisma.db.organizationClosureExecution.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
  });

  it('marks a crashed execution terminal before it can exceed the attempt bound', async () => {
    const { service, prisma } = setup();
    prisma.db.organizationClosureExecution.updateMany.mockResolvedValue({
      count: 1,
    });
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(
      service.claimNext(now, 'organization-id' as any),
    ).resolves.toBeNull();

    expect(
      prisma.db.organizationClosureExecution.updateMany,
    ).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'organization-id',
        stage: { notIn: ['COMPLETED', 'FAILED'] },
        attemptCount: { gte: 8 },
      }),
      data: expect.objectContaining({
        stage: OrganizationClosureExecutionStage.FAILED,
        failedAt: now,
        lastFailure: 'RETRY_BOUND_EXHAUSTED',
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        nextRetryAt: null,
      }),
    });
  });

  it('recovers a lease without rewinding its durable stage', async () => {
    const { service, prisma } = setup();
    prisma.db.organizationClosureExecution.updateMany.mockResolvedValue({
      count: 1,
    });

    await service.recover('organization-id' as any, now);

    expect(
      prisma.db.organizationClosureExecution.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        organizationId: 'organization-id',
        stage: { notIn: ['COMPLETED', 'FAILED'] },
      },
      data: {
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastFailure: null,
        nextRetryAt: now,
        revision: { increment: 1 },
      },
    });
  });
});
