import type { GraphsClientService } from '../../graphs-client.service';
import {
  DemoSandboxReadinessService,
  READINESS_QUERY,
  ReadinessAttempt,
} from '../demo-sandbox-readiness.service';

const attempt = (deadlineInMs: number): ReadinessAttempt => ({
  organizationId: 'org-1',
  projectId: 'project-1',
  readinessFeatureId: 'feature-copy',
  provisioningDeadline: new Date(Date.now() + deadlineInMs),
});

describe('DemoSandboxReadinessService', () => {
  const executeQuery = jest.fn();
  const build = () =>
    new DemoSandboxReadinessService(
      { executeQuery } as unknown as GraphsClientService,
      () => 'token',
    );

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('sends the one parameterized query with destination identifiers only', async () => {
    executeQuery.mockResolvedValue({ relationships: [{}] });

    await expect(build().waitUntilConnected(attempt(120_000))).resolves.toBe(
      true,
    );

    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery).toHaveBeenCalledWith(
      'org-1',
      'project-1',
      {
        query: READINESS_QUERY,
        parameters: {
          featureId: 'feature-copy',
          projectId: 'project-1',
          organizationId: 'org-1',
        },
      },
      'token',
    );
    expect(READINESS_QUERY).toBe(
      'MATCH (f {id: $featureId})-[r:SCOPED_TO_PROJECT]->(p:Project {id: $projectId}) WHERE f.organizationId = $organizationId AND p.organizationId = $organizationId RETURN f, r, p LIMIT 1',
    );
  });

  it('waits once per second while the chosen sample is missing, then permits activation on the exact match', async () => {
    executeQuery
      .mockResolvedValueOnce({ nodes: [], relationships: [] })
      .mockResolvedValueOnce({ nodes: [], relationships: [] })
      .mockResolvedValueOnce({ nodes: [{}], relationships: [{}] });

    const outcome = build().waitUntilConnected(attempt(120_000));
    await jest.advanceTimersByTimeAsync(0);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(999);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(executeQuery).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(executeQuery).toHaveBeenCalledTimes(3);
  });

  it('treats an unavailable Graph like a missing sample', async () => {
    executeQuery
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce({ relationships: [{}] });

    const outcome = build().waitUntilConnected(attempt(120_000));
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(outcome).resolves.toBe(true);
    expect(executeQuery).toHaveBeenCalledTimes(2);
  });

  it('gives up at the persisted deadline', async () => {
    executeQuery.mockResolvedValue({ nodes: [], relationships: [] });

    const outcome = build().waitUntilConnected(attempt(3_000));
    await jest.advanceTimersByTimeAsync(3_000);

    await expect(outcome).resolves.toBe(false);
    expect(executeQuery).toHaveBeenCalledTimes(3);
  });

  it('after a restart resumes against the persisted sample and deadline without extending it', async () => {
    executeQuery.mockResolvedValue({ nodes: [], relationships: [] });
    const persisted = attempt(2_000);
    await jest.advanceTimersByTimeAsync(1_500);

    const outcome = build().waitUntilConnected(persisted);
    await jest.advanceTimersByTimeAsync(500);

    await expect(outcome).resolves.toBe(false);
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0]![2].parameters.featureId).toBe(
      'feature-copy',
    );
  });

  it('does not query once the deadline has already passed', async () => {
    await expect(build().waitUntilConnected(attempt(-1))).resolves.toBe(false);
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
