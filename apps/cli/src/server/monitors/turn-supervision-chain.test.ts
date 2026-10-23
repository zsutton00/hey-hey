import { describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from '../logger';
import type { PlatformAuth } from '../platform-auth-context';
import { SETTLED_TURN_EVENT_KIND, type CanonicalSettledTurnMonitorEvent } from './normalizer';
import {
  TurnSupervisionChain,
  type CompletedTurnSupervisionDisposition,
  type TurnSupervisionClaim,
  type TurnSupervisionDisposition,
  type TurnSupervisionReceiptStore,
  type TurnSupervisor,
} from './turn-supervision-chain';

const AUTH: PlatformAuth = {
  accessToken: 'token',
  organizationId: 'organization',
  projectId: 'project',
  userId: 'user',
};

const settledTurn = (
  turnId: string,
  agentSessionId = 'session-1',
  reports: CanonicalSettledTurnMonitorEvent['reports'] = [],
): CanonicalSettledTurnMonitorEvent => ({
  kind: SETTLED_TURN_EVENT_KIND,
  eventType: SETTLED_TURN_EVENT_KIND,
  entityId: agentSessionId,
  agentSessionId,
  turnId,
  promptType: 'coding_freeform',
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: null,
  reports,
  settledAt: '2026-08-01T00:00:00.000Z',
  timestamp: '2026-08-01T00:00:00.000Z',
  origin: 'self',
});

class MemoryReceipts implements TurnSupervisionReceiptStore {
  private readonly dispositions = new Map<string, CompletedTurnSupervisionDisposition>();

  public claim(turnId: string): Promise<TurnSupervisionClaim> {
    const disposition = this.dispositions.get(turnId);
    return Promise.resolve(
      disposition ? { status: 'RECORDED', disposition } : { status: 'CLAIMED' },
    );
  }

  public record(
    turnId: string,
    disposition: CompletedTurnSupervisionDisposition,
  ): Promise<CompletedTurnSupervisionDisposition> {
    const recorded = this.dispositions.get(turnId) ?? disposition;
    this.dispositions.set(turnId, recorded);
    return Promise.resolve(recorded);
  }

  public releaseClaim(_turnId: string): Promise<void> {
    return Promise.resolve();
  }
}

const supervisor = (
  id: TurnSupervisor['id'],
  invoke: TurnSupervisor['invoke'],
): TurnSupervisor => ({ id, invoke });

const chain = (
  supervisors: readonly TurnSupervisor[],
  receipts: TurnSupervisionReceiptStore = new MemoryReceipts(),
  logger = NOOP_LOGGER,
): TurnSupervisionChain =>
  new TurnSupervisionChain({
    resolver: { resolve: async () => supervisors },
    receipts,
    logger,
  });

describe('TurnSupervisionChain', () => {
  it('runs Session Monitor first and advances only after explicit release', async () => {
    const order: string[] = [];
    const session = supervisor('SESSION_MONITOR', async () => {
      order.push('session');
      return { status: 'RELEASED', supervisor: 'SESSION_MONITOR', reason: 'NOT_APPLICABLE' };
    });
    const task = supervisor('TASK_MONITOR', async (event) => {
      order.push(`task:${String(event.reports.length)}`);
      return { status: 'HANDLED', supervisor: 'TASK_MONITOR' };
    });

    await expect(
      chain([session, task]).dispatch(
        settledTurn('event-1', 'session-1', [
          { reportId: 'report-1', reportType: 'IMPLEMENT' },
          { reportId: 'report-2', reportType: 'REVIEW' },
        ]),
        AUTH,
      ),
    ).resolves.toEqual({
      status: 'HANDLED',
      supervisor: 'TASK_MONITOR',
    });
    expect(order).toEqual(['session', 'task:2']);
  });

  it.each([
    { status: 'HANDLED' as const },
    { status: 'FAILED' as const, reason: 'EVALUATION_FAILED' },
  ])('stops after a Session Monitor $status disposition', async (result) => {
    const taskInvoke = vi.fn<TurnSupervisor['invoke']>();
    const session = supervisor('SESSION_MONITOR', async () => ({
      ...result,
      supervisor: 'SESSION_MONITOR',
    }));

    await chain([session, supervisor('TASK_MONITOR', taskInvoke)]).dispatch(
      settledTurn(`event-${result.status}`),
      AUTH,
    );

    expect(taskInvoke).not.toHaveBeenCalled();
  });

  it('logs a visible halt when a supervisor fails', async () => {
    const error = vi.fn();
    const logger = {
      trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
      debug: NOOP_LOGGER.debug.bind(NOOP_LOGGER),
      info: NOOP_LOGGER.info.bind(NOOP_LOGGER),
      warn: NOOP_LOGGER.warn.bind(NOOP_LOGGER),
      error,
      child: () => logger,
    };
    const session = supervisor('SESSION_MONITOR', async () => ({
      status: 'FAILED',
      supervisor: 'SESSION_MONITOR',
      reason: 'BROKEN_EFFECT',
    }));

    await chain([session], new MemoryReceipts(), logger).dispatch(settledTurn('event-1'), AUTH);

    expect(error).toHaveBeenCalledWith(
      'turn_supervision.dispatch.halted',
      expect.objectContaining({ reason: 'BROKEN_EFFECT' }),
    );
  });

  it('does not receipt failures and retries the same Turn', async () => {
    const invoke = vi.fn<TurnSupervisor['invoke']>(async () => ({
      status: 'FAILED',
      supervisor: 'SESSION_MONITOR',
      reason: 'TRANSIENT_FAILURE',
    }));
    const owner = chain([supervisor('SESSION_MONITOR', invoke)]);

    await owner.dispatch(settledTurn('event-1'), AUTH);
    await owner.dispatch(settledTurn('event-1'), AUTH);

    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('serializes one Agent Session while allowing another session to proceed', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];
    const session = supervisor('SESSION_MONITOR', async (event) => {
      started.push(event.turnId);
      if (event.turnId === 'event-1') await firstBlocked;
      return { status: 'HANDLED', supervisor: 'SESSION_MONITOR' };
    });
    const owner = chain([session]);

    const first = owner.dispatch(settledTurn('event-1'), AUTH);
    const second = owner.dispatch(settledTurn('event-2'), AUTH);
    const other = owner.dispatch(settledTurn('event-3', 'session-2'), AUTH);
    await other;

    expect(started).toEqual(['event-1', 'event-3']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(started).toEqual(['event-1', 'event-3', 'event-2']);
  });

  it('coalesces duplicate in-flight delivery into one supervisor invocation', async () => {
    const invoke = vi.fn<TurnSupervisor['invoke']>(async () => ({
      status: 'HANDLED',
      supervisor: 'SESSION_MONITOR',
    }));
    const owner = chain([supervisor('SESSION_MONITOR', invoke)]);
    const event = settledTurn('event-1');

    const [first, duplicate] = await Promise.all([
      owner.dispatch(event, AUTH),
      owner.dispatch(event, AUTH),
    ]);

    expect(first).toEqual(duplicate);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('returns a recorded disposition without repeating either supervisor', async () => {
    const receipts = new MemoryReceipts();
    await receipts.record('event-1', { status: 'HANDLED', supervisor: 'TASK_MONITOR' });
    const sessionInvoke = vi.fn<TurnSupervisor['invoke']>();
    const taskInvoke = vi.fn<TurnSupervisor['invoke']>();

    await expect(
      chain(
        [supervisor('SESSION_MONITOR', sessionInvoke), supervisor('TASK_MONITOR', taskInvoke)],
        receipts,
      ).dispatch(settledTurn('event-1'), AUTH),
    ).resolves.toEqual({ status: 'HANDLED', supervisor: 'TASK_MONITOR' });
    expect(sessionInvoke).not.toHaveBeenCalled();
    expect(taskInvoke).not.toHaveBeenCalled();
  });
});
