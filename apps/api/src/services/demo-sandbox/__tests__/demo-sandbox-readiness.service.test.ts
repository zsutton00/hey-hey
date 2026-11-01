import { DemoSandboxStatus } from '@prisma/client';
import type { GraphsClientService } from '../../graphs-client.service';
import { DemoSandboxReadinessService } from '../demo-sandbox-readiness.service';

const FEATURES = ['feature-a', 'feature-b', 'feature-c'];
const row = (deadlineInMs: number) => ({
  organizationId: 'org-1',
  projectId: 'project-1',
  readinessFeatureIds: FEATURES,
  provisioningDeadline: new Date(Date.now() + deadlineInMs),
});

describe('DemoSandboxReadinessService', () => {
  const checkFeatureProjectConnection = jest.fn();
  const db = {
    demoSandbox: { findUnique: jest.fn(), updateMany: jest.fn() },
  };
  // A fresh instance each time, as after an API restart.
  const build = () =>
    new DemoSandboxReadinessService(
      { db } as never,
      { checkFeatureProjectConnection } as unknown as GraphsClientService,
      () => 'token',
    );
  const connected = (count: number) => ({ connectedCount: count });
  const recordedCounts = () =>
    db.demoSandbox.updateMany.mock.calls.map(
      ([{ data }]: [{ data: { connectedFeatureCount: number } }]) =>
        data.connectedFeatureCount,
    );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
    db.demoSandbox.findUnique.mockResolvedValue(row(120_000));
  });
  afterEach(() => jest.useRealTimers());

  it('checks every persisted feature in its destination scope in one call', async () => {
    checkFeatureProjectConnection.mockResolvedValue(connected(3));

    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(true);

    expect(db.demoSandbox.findUnique).toHaveBeenCalledWith({
      where: { id: 'sandbox-1' },
      select: {
        organizationId: true,
        projectId: true,
        readinessFeatureIds: true,
        provisioningDeadline: true,
      },
    });
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(checkFeatureProjectConnection).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      { featureIds: FEATURES },
      'token',
    );
    expect(db.demoSandbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'sandbox-1', status: DemoSandboxStatus.PROVISIONING },
      data: { connectedFeatureCount: 3 },
    });
  });

  it('keeps waiting once per second on a partial set and records the counts, then permits activation on the full set', async () => {
    checkFeatureProjectConnection
      .mockResolvedValueOnce(connected(1))
      .mockResolvedValueOnce(connected(2))
      .mockResolvedValueOnce(connected(2))
      .mockResolvedValueOnce(connected(3));

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(0);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(recordedCounts()).toEqual([1]);
    await jest.advanceTimersByTimeAsync(999);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(outcome).resolves.toBe(true);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(4);
    // An unchanged count is not rewritten.
    expect(recordedCounts()).toEqual([1, 2, 3]);
  });

  it('treats an unavailable Graph like missing features', async () => {
    checkFeatureProjectConnection
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(connected(3));

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(2);
  });

  it('gives up at the persisted deadline while some features are still missing', async () => {
    db.demoSandbox.findUnique.mockResolvedValue(row(3_000));
    checkFeatureProjectConnection.mockResolvedValue(connected(2));

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
  });

  it('after a restart resumes against the persisted features and deadline without extending it', async () => {
    const persisted = row(2_000);
    db.demoSandbox.findUnique.mockResolvedValue(persisted);
    checkFeatureProjectConnection.mockResolvedValue(connected(0));
    await jest.advanceTimersByTimeAsync(1_500);

    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(500);

    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(checkFeatureProjectConnection.mock.calls[0]![2]).toEqual({
      featureIds: FEATURES,
    });
  });

  it('retries persistent read errors only within the persisted budget', async () => {
    db.demoSandbox.findUnique.mockResolvedValue(row(2_500));
    checkFeatureProjectConnection.mockRejectedValue(
      new Error('Graph unavailable'),
    );
    const outcome = build().waitUntilConnected('sandbox-1');
    await jest.advanceTimersByTimeAsync(2_500);
    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
    expect(db.demoSandbox.updateMany).not.toHaveBeenCalled();
  });

  it('does not query once the deadline has already passed', async () => {
    db.demoSandbox.findUnique.mockResolvedValue(row(-1));
    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(false);
    expect(checkFeatureProjectConnection).not.toHaveBeenCalled();
  });

  it('fails an attempt that was discarded before it could be checked', async () => {
    db.demoSandbox.findUnique.mockResolvedValue(null);
    await expect(build().waitUntilConnected('sandbox-1')).resolves.toBe(false);
    expect(checkFeatureProjectConnection).not.toHaveBeenCalled();
  });
});
