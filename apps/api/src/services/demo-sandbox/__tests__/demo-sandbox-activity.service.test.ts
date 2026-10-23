import { DemoSandboxStatus } from '@prisma/client';
import { DemoSandboxActivityService } from '../demo-sandbox-activity.service';

const now = new Date('2026-10-17T10:00:00.000Z');

function setup(timeout?: string) {
  const prisma = {
    demoSandbox: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const config = { get: jest.fn().mockReturnValue(timeout) };
  const service = new DemoSandboxActivityService(
    prisma as never,
    config as never,
  );
  return { service, prisma };
}

describe('DemoSandboxActivityService', () => {
  it('pushes expiresAt two hours past the activity by default, with no fixed maximum', async () => {
    const { service, prisma } = setup();

    await service.recordActivity('demo-user-1', now);
    await service.recordActivity(
      'demo-user-1',
      new Date(now.getTime() + 6 * 60 * 60 * 1000),
    );

    const [first, second] = prisma.demoSandbox.updateMany.mock.calls.map(
      ([args]: [{ data: { lastActivityAt: Date; expiresAt: Date } }]) =>
        args.data,
    ) as Array<{ lastActivityAt: Date; expiresAt: Date }>;
    expect(first).toEqual({
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 7200 * 1000),
    });
    expect(second!.expiresAt.getTime() - second!.lastActivityAt.getTime()).toBe(
      7200 * 1000,
    );
  });

  it('uses the configured inactivity timeout', async () => {
    const { service, prisma } = setup('900');

    await service.recordActivity('demo-user-1', now);

    expect(
      prisma.demoSandbox.updateMany.mock.calls[0]![0].data.expiresAt,
    ).toEqual(new Date(now.getTime() + 900 * 1000));
  });

  it('only refreshes an ACTIVE, unexpired sandbox of that user, throttled in the database too', async () => {
    const { service, prisma } = setup();

    await service.recordActivity('demo-user-1', now);

    expect(prisma.demoSandbox.updateMany).toHaveBeenCalledWith({
      where: {
        demoUserId: 'demo-user-1',
        status: DemoSandboxStatus.ACTIVE,
        expiresAt: { gt: now },
        OR: [
          { lastActivityAt: null },
          { lastActivityAt: { lte: new Date(now.getTime() - 60_000) } },
        ],
      },
      data: expect.any(Object),
    });
  });

  it('writes at most once a minute per user', async () => {
    const { service, prisma } = setup();

    await service.recordActivity('demo-user-1', now);
    await service.recordActivity(
      'demo-user-1',
      new Date(now.getTime() + 30_000),
    );
    await service.recordActivity(
      'demo-user-2',
      new Date(now.getTime() + 30_000),
    );
    await service.recordActivity(
      'demo-user-1',
      new Date(now.getTime() + 60_000),
    );

    expect(prisma.demoSandbox.updateMany).toHaveBeenCalledTimes(3);
  });

  it('never fails the caller when the write fails, and retries on the next request', async () => {
    const { service, prisma } = setup();
    prisma.demoSandbox.updateMany.mockRejectedValueOnce(new Error('down'));

    await expect(
      service.recordActivity('demo-user-1', now),
    ).resolves.toBeUndefined();
    await service.recordActivity(
      'demo-user-1',
      new Date(now.getTime() + 1_000),
    );

    expect(prisma.demoSandbox.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid configured timeout instead of extending forever', async () => {
    const { service, prisma } = setup('not-a-number');

    await service.recordActivity('demo-user-1', now);

    expect(prisma.demoSandbox.updateMany).not.toHaveBeenCalled();
  });
});
