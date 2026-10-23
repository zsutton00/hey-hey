import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunStore } from '../../run-store/run-store';
import type { ServerLogger } from '../logger';
import { createTestPlatformAuthContext } from '../monitors/test-owners.test-support';
import type { PlatformWebSocketEvent } from '../platform-ws';
import { ReportUpdateDispatcher } from './dispatch-report-update';
import { createTestLocalAgentService } from '../local-agent-service.test-support';
import { EntityReportIndex } from './entity-report-index';
import {
  computeReportUpdateThreshold,
  extractEntityRefsFromEvent,
  ReportInfluenceAccumulator,
} from './report-influence-accumulator';

const createMockLogger = (): ServerLogger =>
  ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  }) as unknown as ServerLogger;

const makeTaskEvent = (taskId: string): PlatformWebSocketEvent => ({
  type: 'task.status_changed',
  timestamp: '2026-04-15T12:00:00.000Z',
  organizationId: 'org-1',
  projectId: 'proj-1',
  taskId,
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const createAccumulator = (index: EntityReportIndex, dispatchResult: string | null = 'run-xyz') => {
  const dispatch = vi
    .spyOn(ReportUpdateDispatcher.prototype, 'dispatch')
    .mockResolvedValue(dispatchResult);
  const runStore = new RunStore();
  return {
    accumulator: new ReportInfluenceAccumulator({
      index,
      apiBaseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(),
      authContext: createTestPlatformAuthContext(null),
      runStore,
      agentService: createTestLocalAgentService({ runStore }),
      logger: createMockLogger(),
    }),
    dispatch,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('computeReportUpdateThreshold', () => {
  it('matches the rounded 50% cases from the spec', () => {
    expect(computeReportUpdateThreshold(2)).toBe(1); // 1 of 2
    expect(computeReportUpdateThreshold(3)).toBe(2); // 2 of 3
    expect(computeReportUpdateThreshold(4)).toBe(2); // 2 of 4
    expect(computeReportUpdateThreshold(5)).toBe(3); // 3 of 5
    expect(computeReportUpdateThreshold(6)).toBe(3); // 3 of 6
  });

  it('returns 0 for non-positive ref counts', () => {
    expect(computeReportUpdateThreshold(0)).toBe(0);
    expect(computeReportUpdateThreshold(-1)).toBe(0);
  });
});

describe('extractEntityRefsFromEvent', () => {
  it('indexes PLAN work-item event identifiers as TASK references', () => {
    expect(
      extractEntityRefsFromEvent({
        type: 'agent_session.created',
        timestamp: '2026-09-08T05:49:30.373Z',
        organizationId: 'org-1',
        planId: 'plan-task-1',
      }),
    ).toEqual([{ entityType: 'TASK', entityId: 'plan-task-1' }]);
  });

  it('extracts task events', () => {
    const refs = extractEntityRefsFromEvent(makeTaskEvent('task-1'));
    expect(refs).toEqual([{ entityType: 'TASK', entityId: 'task-1' }]);
  });

  it('extracts multiple identifiers from a single event', () => {
    const refs = extractEntityRefsFromEvent({
      type: 'agent_session.status_changed',
      timestamp: '2026-04-15T12:00:00.000Z',
      organizationId: 'org-1',
      taskId: 'task-1',
      agentSessionId: 'session-9',
    });
    expect(refs).toEqual([
      { entityType: 'TASK', entityId: 'task-1' },
      { entityType: 'AGENT_SESSION', entityId: 'session-9' },
    ]);
  });

  it('returns an empty list when no identifiers are present', () => {
    expect(
      extractEntityRefsFromEvent({
        type: 'something.else',
        timestamp: '2026-04-15T12:00:00.000Z',
        organizationId: 'org-1',
      }),
    ).toEqual([]);
  });
});

describe('report-influence-accumulator', () => {
  it('fires exactly when the 50%-rounded threshold is reached', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
      { entityType: 'TASK', entityId: 'task-c' },
    ]);

    const { accumulator: acc, dispatch } = createAccumulator(index);

    // Threshold for 3 is 2. First event accumulates; second triggers dispatch.
    expect(acc.handleEvent(makeTaskEvent('task-a'))).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();

    expect(acc.handleEvent(makeTaskEvent('task-b'))).toEqual(['rpt-1']);
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'rpt-1',
        totalReferencedEntities: 3,
      }),
    );
    const call = dispatch.mock.calls[0]![0];
    expect(call.changedEntities).toHaveLength(2);
    expect(call.events).toHaveLength(2);
  });

  it('fires with 1-of-2 when only two entities are tracked', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-2', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
    ]);
    const { accumulator: acc, dispatch } = createAccumulator(index);

    expect(acc.handleEvent(makeTaskEvent('task-a'))).toEqual(['rpt-2']);
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeat events for the same entity within one report', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
      { entityType: 'TASK', entityId: 'task-c' },
      { entityType: 'TASK', entityId: 'task-d' },
    ]);
    const { accumulator: acc, dispatch } = createAccumulator(index);

    // Threshold for 4 is 2. Same task changing twice counts as 1.
    acc.handleEvent(makeTaskEvent('task-a'));
    acc.handleEvent(makeTaskEvent('task-a'));
    await flush();
    expect(dispatch).not.toHaveBeenCalled();

    acc.handleEvent(makeTaskEvent('task-b'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('does not re-fire while an update is in flight', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
    ]);
    const { accumulator: acc, dispatch } = createAccumulator(index);

    acc.handleEvent(makeTaskEvent('task-a'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);

    // The dispatcher returned a runId, so the in-flight guard blocks re-entry.
    acc.handleEvent(makeTaskEvent('task-b'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Still in flight; events keep being skipped until the run finishes.
    acc.handleEvent(makeTaskEvent('task-b'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);

    // Run completes — guard is released, future events can accumulate again.
    acc.onRunFinished('run-xyz');
    acc.handleEvent(makeTaskEvent('task-b'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('releases the guard when dispatch fails before a runId is bound', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [
      { entityType: 'TASK', entityId: 'task-a' },
      { entityType: 'TASK', entityId: 'task-b' },
    ]);
    const { accumulator: acc, dispatch } = createAccumulator(index, null);

    acc.handleEvent(makeTaskEvent('task-a'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);

    // A null dispatcher outcome releases the guard without a run event.
    acc.handleEvent(makeTaskEvent('task-b'));
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('ignores onRunFinished for untracked runIds', () => {
    const index = new EntityReportIndex();
    const { accumulator: acc } = createAccumulator(index);

    expect(() => acc.onRunFinished('unknown-run')).not.toThrow();
  });

  it('only fires the affected report; unrelated reports are not re-evaluated', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-a', [
      { entityType: 'TASK', entityId: 'task-1' },
      { entityType: 'TASK', entityId: 'task-2' },
    ]);
    index.registerReport('rpt-b', [
      { entityType: 'INITIATIVE', entityId: 'init-1' },
      { entityType: 'INITIATIVE', entityId: 'init-2' },
    ]);
    const { accumulator: acc, dispatch } = createAccumulator(index);

    acc.handleEvent(makeTaskEvent('task-1'));
    await flush();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0].reportId).toBe('rpt-a');
  });

  it('ignores events for untracked entities', async () => {
    const index = new EntityReportIndex();
    index.registerReport('rpt-1', [{ entityType: 'TASK', entityId: 'task-a' }]);
    const { accumulator: acc, dispatch } = createAccumulator(index);

    expect(acc.handleEvent(makeTaskEvent('task-z'))).toEqual([]);
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
