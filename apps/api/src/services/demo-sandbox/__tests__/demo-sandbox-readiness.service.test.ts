import type { GraphsClientService } from '../../graphs-client.service';
import {
  DemoSandboxReadinessService,
  ReadinessAttempt,
} from '../demo-sandbox-readiness.service';

const attempt = (deadlineInMs: number): ReadinessAttempt => ({
  organizationId: 'org-1',
  projectId: 'project-1',
  readinessFeatureId: 'feature-copy',
  provisioningDeadline: new Date(Date.now() + deadlineInMs),
});

describe('DemoSandboxReadinessService', () => {
  const checkFeatureProjectConnection = jest.fn();
  const build = () =>
    new DemoSandboxReadinessService(
      { checkFeatureProjectConnection } as unknown as GraphsClientService,
      () => 'token',
    );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('checks only the persisted feature in its destination scope', async () => {
    checkFeatureProjectConnection.mockResolvedValue({ connected: true });

    await expect(build().waitUntilConnected(attempt(120_000))).resolves.toBe(
      true,
    );

    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(checkFeatureProjectConnection).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      {
        featureId: 'feature-copy',
      },
      'token',
    );
  });

  it('waits once per second while the chosen sample is missing, then permits activation on the exact match', async () => {
    checkFeatureProjectConnection
      .mockResolvedValueOnce({ connected: false })
      .mockResolvedValueOnce({ connected: false })
      .mockResolvedValueOnce({ connected: true });

    const outcome = build().waitUntilConnected(attempt(120_000));
    await jest.advanceTimersByTimeAsync(0);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
  });

  it('treats an unavailable Graph like a missing sample', async () => {
    checkFeatureProjectConnection
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({ connected: true });

    const outcome = build().waitUntilConnected(attempt(120_000));
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(2);
  });

  it('gives up at the persisted deadline', async () => {
    checkFeatureProjectConnection.mockResolvedValue({ connected: false });

    const outcome = build().waitUntilConnected(attempt(3_000));
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
  });

  it('after a restart resumes against the persisted sample and deadline without extending it', async () => {
    checkFeatureProjectConnection.mockResolvedValue({ connected: false });
    const persisted = attempt(2_000);
    await jest.advanceTimersByTimeAsync(1_500);

    const outcome = build().waitUntilConnected(persisted);
    await jest.advanceTimersByTimeAsync(500);

    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(1);
    expect(checkFeatureProjectConnection.mock.calls[0]![2].featureId).toBe(
      'feature-copy',
    );
  });

  it('retries persistent read errors only within the persisted budget', async () => {
    checkFeatureProjectConnection.mockRejectedValue(
      new Error('Graph unavailable'),
    );
    const outcome = build().waitUntilConnected(attempt(2_500));
    await jest.advanceTimersByTimeAsync(2_500);
    await expect(outcome).resolves.toBe(false);
    expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(3);
    for (const call of checkFeatureProjectConnection.mock.calls) {
      expect(call.slice(0, 3)).toEqual([
        'org-1',
        'project-1',
        { featureId: 'feature-copy' },
      ]);
    }
  });

  it('does not query once the deadline has already passed', async () => {
    await expect(build().waitUntilConnected(attempt(-1))).resolves.toBe(false);
    expect(checkFeatureProjectConnection).not.toHaveBeenCalled();
  });
});
