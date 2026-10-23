import { AgentSessionCurrentState } from '../../generated';
import {
  AgentSessionCurrentStateProjection,
  AgentSessionCurrentStateProjectionEntry,
} from '../agent-session-current-state-projection.service';

function entry(
  overrides: Partial<AgentSessionCurrentStateProjectionEntry> = {},
): AgentSessionCurrentStateProjectionEntry {
  return {
    schemaVersion: 1,
    agentSessionId: 'session-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    userId: 'user-1',
    machineId: 'machine-1',
    currentState: AgentSessionCurrentState.Thinking,
    revision: 2,
    transitionedAt: '2026-08-07T12:00:00.000Z',
    observedAt: '2026-08-07T12:00:00.000Z',
    observedAtMs: 1780000000000,
    runtimeOwnerMachineId: 'machine-1',
    runtimeOwnerUserId: 'user-1',
    runtimeOwnerConnectionId: 'socket-1',
    runtimeLeaseExpiresAt: '2026-08-07T12:00:25.000Z',
    runtimeLeaseExpiresAtMs: 1780000025000,
    ...overrides,
  };
}

function makeHarness() {
  const redis = {
    get: jest.fn(),
    mget: jest.fn(),
    eval: jest.fn(),
    scan: jest.fn(),
    set: jest.fn(),
  };
  const service = new AgentSessionCurrentStateProjection({
    getClient: () => redis,
  } as any);
  const sink = jest.fn().mockResolvedValue(undefined);
  service.setTransitionSink(sink);
  return { service, redis, sink };
}

const projectionKey = `${AgentSessionCurrentStateProjection.KEY_PREFIX}:session-1`;

describe('AgentSessionCurrentStateProjection', () => {
  it('publishes only effective transitions and suppresses duplicates and stale delivery', async () => {
    const { service, redis, sink } = makeHarness();
    redis.eval
      .mockResolvedValueOnce(
        JSON.stringify({
          outcome: 'transition',
          entry: entry({ revision: 1 }),
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ outcome: 'duplicate', entry: entry({ revision: 1 }) }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ outcome: 'stale', entry: entry({ revision: 1 }) }),
      );

    const context = {
      agentSessionId: 'session-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      userId: 'user-1',
      machineId: 'machine-1',
      connectionId: 'socket-1',
      conversationId: 'conversation-1',
    };
    const observation = '2026-08-07T12:00:00.000Z';

    await expect(
      service.observe(context, AgentSessionCurrentState.Thinking, observation),
    ).resolves.toMatchObject({ outcome: 'transition' });
    await expect(
      service.observe(context, AgentSessionCurrentState.Thinking, observation),
    ).resolves.toMatchObject({ outcome: 'duplicate' });
    await expect(
      service.observe(context, AgentSessionCurrentState.Starting, observation),
    ).resolves.toMatchObject({ outcome: 'stale' });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'observation',
        entry: expect.objectContaining({ revision: 1 }),
      }),
    );
    for (const call of redis.eval.mock.calls) {
      expect(call[1]).toBe(2);
      expect(call[2]).toBe(projectionKey);
      expect(call[3]).toBe(AgentSessionCurrentStateProjection.LEASE_INDEX_KEY);
    }
    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('ZADD'");
    expect(redis.eval.mock.calls[1][0]).toContain("redis.call('ZREM'");
  });

  it('keeps missing projections absent in single and batch reads', async () => {
    const { service, redis } = makeHarness();
    redis.get.mockResolvedValue(null);
    redis.mget.mockResolvedValue([null, JSON.stringify(entry())]);

    await expect(service.read('session-missing')).resolves.toBeNull();
    await expect(
      service.readMany(['session-missing', 'session-1']),
    ).resolves.toEqual(
      new Map([['session-1', expect.objectContaining({ revision: 2 })]]),
    );
  });

  it('turns runtime-owned state idle once on disconnect and removes its lease index member', async () => {
    const { service, redis, sink } = makeHarness();
    redis.scan.mockResolvedValue(['0', [projectionKey]]);
    redis.eval
      .mockResolvedValueOnce(
        JSON.stringify({
          outcome: 'transition',
          entry: entry({
            currentState: AgentSessionCurrentState.Idle,
            revision: 3,
          }),
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          outcome: 'unchanged',
          entry: entry({ currentState: AgentSessionCurrentState.Idle }),
        }),
      );

    const context = {
      organizationId: 'org-1',
      userId: 'user-1',
      machineId: 'machine-1',
      connectionId: 'socket-1',
    };
    await expect(service.disconnect(context)).resolves.toBe(1);
    await expect(service.disconnect(context)).resolves.toBe(0);
    expect(sink).toHaveBeenCalledTimes(1);

    const disconnectCall = redis.eval.mock.calls[0];
    expect(disconnectCall[1]).toBe(2);
    expect(disconnectCall[2]).toBe(projectionKey);
    expect(disconnectCall[3]).toBe(
      AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
    );
    expect(disconnectCall.at(-1)).toBe('session-1');
    expect(disconnectCall[0]).toContain("redis.call('ZREM'");
    expect(disconnectCall[0]).toContain("'GATHERING_CONTEXT'");
  });

  it('does not lease or clear actionable AWAITING_APPROVAL state', async () => {
    const { service, redis } = makeHarness();
    redis.eval.mockResolvedValue(
      JSON.stringify({
        outcome: 'transition',
        entry: entry({
          currentState: AgentSessionCurrentState.AwaitingApproval,
          runtimeOwnerMachineId: undefined,
          runtimeOwnerUserId: undefined,
          runtimeOwnerConnectionId: undefined,
          runtimeLeaseExpiresAt: undefined,
          runtimeLeaseExpiresAtMs: undefined,
        }),
      }),
    );

    await expect(
      service.observe(
        {
          agentSessionId: 'session-1',
          organizationId: 'org-1',
          projectId: 'project-1',
          userId: 'user-1',
          machineId: 'machine-1',
          connectionId: 'socket-1',
        },
        AgentSessionCurrentState.AwaitingApproval,
        '2026-08-07T12:00:00.000Z',
      ),
    ).resolves.toMatchObject({ outcome: 'transition' });

    const observeCall = redis.eval.mock.calls[0];
    expect(observeCall[13]).toBe('0');
    expect(observeCall[0]).toContain("redis.call('ZREM'");
  });

  it('claims only due index members and expires them without scanning projection keys', async () => {
    const { service, redis, sink } = makeHarness();
    redis.set.mockResolvedValue('OK');
    redis.eval
      .mockResolvedValueOnce(JSON.stringify(['session-1']))
      .mockResolvedValueOnce(
        JSON.stringify({
          outcome: 'transition',
          entry: entry({
            currentState: AgentSessionCurrentState.Idle,
            revision: 3,
          }),
        }),
      )
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce('1');

    await expect(
      service.sweepExpiredLeases(new Date('2026-08-07T12:01:00.000Z')),
    ).resolves.toBe(1);

    expect(redis.scan).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(
      AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_KEY,
      expect.any(String),
      'PX',
      AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_TTL_MS,
      'NX',
    );
    expect(redis.eval.mock.calls[0][0]).toContain('ZRANGEBYSCORE');
    expect(redis.eval.mock.calls[0][1]).toBe(1);
    expect(redis.eval.mock.calls[0][2]).toBe(
      AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
    );
    expect(redis.eval.mock.calls[1][2]).toBe(projectionKey);
    expect(redis.eval.mock.calls[1][3]).toBe(
      AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
    );
    expect(redis.eval.mock.calls[1].at(-1)).toBe('session-1');
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'lease_expiry' }),
    );
  });

  it('returns without claiming when another replica owns the sweep lock', async () => {
    const { service, redis } = makeHarness();
    redis.set.mockResolvedValue(null);

    await expect(service.sweepExpiredLeases()).resolves.toBe(0);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('rebuilds the lease index for persisted runtime projections', async () => {
    const { service, redis } = makeHarness();
    redis.scan.mockResolvedValue([
      '0',
      [
        projectionKey,
        AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
        AgentSessionCurrentStateProjection.LEASE_SWEEP_LOCK_KEY,
      ],
    ]);
    redis.eval.mockResolvedValue(JSON.stringify(1));

    await (
      service as unknown as { rebuildLeaseIndex: () => Promise<void> }
    ).rebuildLeaseIndex();

    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval.mock.calls[0][0]).toContain("redis.call('ZADD'");
    expect(redis.eval.mock.calls[0][1]).toBe(2);
    expect(redis.eval.mock.calls[0][2]).toBe(projectionKey);
    expect(redis.eval.mock.calls[0][3]).toBe(
      AgentSessionCurrentStateProjection.LEASE_INDEX_KEY,
    );
    expect(redis.eval.mock.calls[0].at(-1)).toBe('session-1');
  });

  it('handles an empty index and reschedules a renewed lease after claiming it', async () => {
    const empty = makeHarness();
    empty.redis.set.mockResolvedValue('OK');
    empty.redis.eval
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce('1');
    await expect(empty.service.sweepExpiredLeases()).resolves.toBe(0);
    expect(empty.redis.scan).not.toHaveBeenCalled();
    expect(empty.redis.eval.mock.calls[0][0]).toContain(
      "if #members == 0 then\n  return '[]'",
    );

    const renewed = makeHarness();
    renewed.redis.set.mockResolvedValue('OK');
    renewed.redis.eval
      .mockResolvedValueOnce(JSON.stringify(['session-1']))
      .mockResolvedValueOnce(
        JSON.stringify({
          outcome: 'unchanged',
          entry: entry({ runtimeLeaseExpiresAtMs: Date.now() + 10_000 }),
        }),
      )
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce('1');

    await expect(renewed.service.sweepExpiredLeases()).resolves.toBe(0);
    expect(renewed.redis.eval.mock.calls[1][0]).toContain("redis.call('ZADD'");
    expect(renewed.sink).not.toHaveBeenCalled();
  });

  it('removes stale claimed members without publishing a transition', async () => {
    const { service, redis, sink } = makeHarness();
    redis.set.mockResolvedValue('OK');
    redis.eval
      .mockResolvedValueOnce(JSON.stringify(['session-missing']))
      .mockResolvedValueOnce(JSON.stringify({ outcome: 'missing' }))
      .mockResolvedValueOnce(JSON.stringify([]))
      .mockResolvedValueOnce('1');

    await expect(service.sweepExpiredLeases()).resolves.toBe(0);
    expect(sink).not.toHaveBeenCalled();
    expect(redis.eval.mock.calls[1][0]).toContain("redis.call('ZREM'");
  });
});
