import { DemoSandboxStage, DemoSandboxStatus } from '@prisma/client';
import { DemoSandboxDiscardService } from '../demo-sandbox-discard.service';

const tombstone = {
  status: DemoSandboxStatus.DELETED,
  stage: DemoSandboxStage.FAILED,
  organizationId: null,
  projectId: null,
  demoUserId: null,
  readinessFeatureIds: [],
  connectedFeatureCount: 0,
};

function setup(status: DemoSandboxStatus = DemoSandboxStatus.PROVISIONING) {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValue([
        { status, organizationId: 'org-1', projectId: 'project-1' },
      ]),
    demoSandbox: { update: jest.fn() },
    demoGraphCopyIntent: { deleteMany: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    demoSandbox: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn(),
    },
    organizationClosureExecution: { findMany: jest.fn() },
    user: { deleteMany: jest.fn() },
  };
  const lifecycle = {
    closeImmediatelyForSystemOrganization: jest.fn(),
  };
  const service = new DemoSandboxDiscardService(
    prisma as never,
    lifecycle as never,
  );
  return { service, tx, prisma, lifecycle };
}

describe('DemoSandboxDiscardService', () => {
  it('commits DISCARDING with the FAILED stage, stops clone dispatch and irreversibly closes in one transaction', async () => {
    const { service, tx, prisma, lifecycle } = setup();

    await expect(service.discard('sandbox-1')).resolves.toBe(true);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.demoSandbox.update).toHaveBeenCalledWith({
      where: { id: 'sandbox-1' },
      data: {
        status: DemoSandboxStatus.DISCARDING,
        stage: DemoSandboxStage.FAILED,
      },
    });
    expect(tx.demoGraphCopyIntent.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1' },
    });
    expect(
      lifecycle.closeImmediatelyForSystemOrganization,
    ).toHaveBeenCalledWith(
      tx,
      'org-1',
      'demo-sandbox-discard',
      expect.any(String),
    );
  });

  it('turns a reservation whose preparation never committed straight into a FAILED tombstone', async () => {
    const { service, tx, lifecycle } = setup();
    tx.$queryRaw.mockResolvedValue([
      {
        status: DemoSandboxStatus.PROVISIONING,
        organizationId: null,
        projectId: null,
      },
    ]);

    await expect(service.discard('sandbox-1')).resolves.toBe(true);

    expect(tx.demoSandbox.update).toHaveBeenCalledTimes(1);
    expect(tx.demoSandbox.update).toHaveBeenCalledWith({
      where: { id: 'sandbox-1' },
      data: tombstone,
    });
    expect(
      lifecycle.closeImmediatelyForSystemOrganization,
    ).not.toHaveBeenCalled();
  });

  it('locks the attempt row, so discard and activation are serialized', async () => {
    const { service, tx } = setup();
    await service.discard('sandbox-1');
    expect(String(tx.$queryRaw.mock.calls[0]![0].strings)).toContain(
      'FOR UPDATE',
    );
  });

  it.each([DemoSandboxStatus.ACTIVE, DemoSandboxStatus.DISCARDING])(
    'does nothing when the attempt is already %s',
    async (status) => {
      const { service, tx, lifecycle } = setup(status);

      await expect(service.discard('sandbox-1')).resolves.toBe(false);

      expect(tx.demoSandbox.update).not.toHaveBeenCalled();
      expect(
        lifecycle.closeImmediatelyForSystemOrganization,
      ).not.toHaveBeenCalled();
    },
  );

  describe('sweep', () => {
    it('discards attempts whose persisted deadline passed, e.g. after an API restart', async () => {
      const { service, prisma } = setup();
      prisma.demoSandbox.findMany
        .mockResolvedValueOnce([{ id: 'sandbox-1' }])
        .mockResolvedValueOnce([]);

      await service.sweep();

      expect(prisma.demoSandbox.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          status: DemoSandboxStatus.PROVISIONING,
          provisioningDeadline: { lte: expect.any(Date) },
        },
        select: { id: true },
        take: 20,
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    function discarding(prisma: ReturnType<typeof setup>['prisma']) {
      prisma.demoSandbox.findMany.mockResolvedValueOnce([]);
      const cleanup = { user: prisma.user, demoSandbox: prisma.demoSandbox };
      prisma.$transaction.mockImplementation(((
        callback: (client: typeof cleanup) => unknown,
      ) => callback(cleanup)) as never);
    }

    it('removes the demo user and leaves a cleared FAILED tombstone only after final deletion completed', async () => {
      const { service, prisma } = setup();
      discarding(prisma);
      prisma.demoSandbox.findMany.mockResolvedValueOnce([
        { id: 'a', organizationId: 'org-a', demoUserId: 'user-a' },
        { id: 'b', organizationId: 'org-b', demoUserId: 'user-b' },
      ]);
      prisma.organizationClosureExecution.findMany.mockResolvedValueOnce([
        { organizationId: 'org-a' },
      ]);

      await service.sweep();

      expect(prisma.user.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.user.deleteMany).toHaveBeenCalledWith({
        where: { id: 'user-a' },
      });
      expect(prisma.demoSandbox.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.demoSandbox.updateMany).toHaveBeenCalledWith({
        where: { id: 'a', status: DemoSandboxStatus.DISCARDING },
        data: tombstone,
      });
    });

    it('does not let one failing cleanup block the rest of the batch', async () => {
      const { service, prisma } = setup();
      discarding(prisma);
      prisma.demoSandbox.findMany.mockResolvedValueOnce([
        { id: 'a', organizationId: 'org-a', demoUserId: 'user-a' },
        { id: 'b', organizationId: 'org-b', demoUserId: 'user-b' },
      ]);
      prisma.organizationClosureExecution.findMany.mockResolvedValueOnce([
        { organizationId: 'org-a' },
        { organizationId: 'org-b' },
      ]);
      prisma.user.deleteMany.mockRejectedValueOnce(new Error('fk violation'));

      await expect(service.sweep()).resolves.toBeUndefined();

      expect(prisma.demoSandbox.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.demoSandbox.updateMany).toHaveBeenCalledWith({
        where: { id: 'b', status: DemoSandboxStatus.DISCARDING },
        data: tombstone,
      });
    });
  });
});
