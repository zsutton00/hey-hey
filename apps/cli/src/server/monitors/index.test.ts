import { describe, expect, it, vi } from 'vitest';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import { NOOP_LOGGER } from '../logger';
import { MonitorPipeline, type MonitorPipelineDependencies } from './index';
import { DEFAULT_EVENT_THRESHOLD, DEFAULT_TRIGGER_CONFIG } from './trigger-config';
import {
  SETTLED_TURN_EVENT_KIND,
  REPORT_EMISSION_KIND,
  type CanonicalMonitorEvent,
  type CanonicalSettledTurnMonitorEvent,
  type ReportEmissionMonitorEvent,
} from './normalizer';
import type { Monitor } from './declarations/types';
import { DailySessionMonitor } from './declarations/daily-session';
import { DEFAULT_DAILY_SESSION_LAUNCH } from './daily-session-settings';
import { SessionMonitor } from './declarations/session-monitor';
import { MonitorPreSubscribeFilter } from './pre-filter';
import { MonitorRunner } from './runner';
import { createTestMonitorRunnerDependencies } from './test-owners.test-support';

const THRESHOLD = DEFAULT_TRIGGER_CONFIG.eventThreshold ?? DEFAULT_EVENT_THRESHOLD;
const ACTIVITY_EVENT_TYPE = DEFAULT_TRIGGER_CONFIG.rules[0]!.eventType;

/**
 * Fresh declarations per pipeline, mirroring the shipped ones (real subscribe
 * predicates + the same gate kinds) but with their own gate state so each test
 * starts from zero accumulation. The session-monitor opt-in is wired to a stub
 * reader so each test controls the autoDecide branch.
 */
const buildDeclarations = (): Monitor[] => [
  new DailySessionMonitor({
    enabled: true,
    countThreshold: THRESHOLD,
    eventTypes: [ACTIVITY_EVENT_TYPE],
    ...DEFAULT_DAILY_SESSION_LAUNCH,
  }),
  new SessionMonitor(),
];

/** Drain microtasks that the fire-and-forget ingest enqueued. */
const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

const activityEvent = (): CanonicalMonitorEvent => ({
  eventType: ACTIVITY_EVENT_TYPE,
  conversationId: 'conv-platform',
  timestamp: '2026-06-24T00:00:00.000Z',
  origin: 'platform',
});

const reportEmissionEvent = (reportId: string): ReportEmissionMonitorEvent => ({
  kind: REPORT_EMISSION_KIND,
  eventType: REPORT_EMISSION_KIND,
  targetSessionId: 'session-1',
  targetConversationId: 'conv-target',
  reportId,
  timestamp: '2026-06-24T00:00:00.000Z',
  origin: 'self',
});

const managedCompletionEvent = (): CanonicalSettledTurnMonitorEvent => ({
  kind: SETTLED_TURN_EVENT_KIND,
  eventType: SETTLED_TURN_EVENT_KIND,
  agentSessionId: 'session-1',
  turnId: 'turn-1',
  promptType: 'coding_freeform',
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: 'message-1',
  reports: [],
  settledAt: '2026-07-22T00:00:00.000Z',
  entityId: 'session-1',
  timestamp: '2026-07-22T00:00:00.000Z',
  origin: 'self',
});

const stubRunner = () => {
  const run = vi.spyOn(MonitorRunner.prototype, 'run');
  run.mockReset().mockResolvedValue(undefined);
  return { run };
};

const createPipeline = (
  dependencies: Pick<MonitorPipelineDependencies, 'monitors' | 'triggerConfig' | 'logger'>,
): MonitorPipeline =>
  new MonitorPipeline({
    ...createTestMonitorRunnerDependencies(),
    ...dependencies,
  });

const triggerConfig = { debounceMs: 0 };

describe('MonitorPipeline', () => {
  it('emits the Daily Session lifecycle under one searchable info event name', async () => {
    stubRunner();
    const stages: string[] = [];
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: {
        trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
        debug: NOOP_LOGGER.debug.bind(NOOP_LOGGER),
        info: (event: string, fields?: Record<string, unknown>): void => {
          const stage = fields?.['stage'];
          if (event === DAILY_SESSION_MONITOR_LOG_EVENT && typeof stage === 'string') {
            stages.push(stage);
          }
        },
        warn: NOOP_LOGGER.warn.bind(NOOP_LOGGER),
        error: NOOP_LOGGER.error.bind(NOOP_LOGGER),
        child: NOOP_LOGGER.child.bind(NOOP_LOGGER),
      },
    });

    pipeline.ingest(activityEvent());
    await flush();

    expect(stages).toEqual(['pipeline_event_received', 'subscription_evaluated', 'gate_evaluated']);
  });

  it('fires the daily-session monitor exactly when the activity stream reaches the threshold', async () => {
    const { run } = stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    for (let i = 0; i < THRESHOLD - 1; i += 1) {
      pipeline.ingest(activityEvent());
    }
    await flush();
    expect(run).not.toHaveBeenCalled();
    expect(pipeline.queuedSignalCount()).toBe(THRESHOLD - 1);

    pipeline.ingest(activityEvent());
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    const [declaration, batch] = run.mock.calls[0]!;
    expect(declaration.route).toBe(LocalPromptType.DailySession);
    expect(batch).toHaveLength(THRESHOLD);
    // The gate drained on fire.
    expect(pipeline.queuedSignalCount()).toBe(0);
  });

  it('keeps report emissions on the observer path rather than firing a declaration', async () => {
    const { run } = stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    const event = reportEmissionEvent('report-1');
    pipeline.ingest(event);
    await flush();

    expect(run).not.toHaveBeenCalled();
    // A report emission is origin 'self', so the daily-session gate never advanced.
    expect(pipeline.queuedSignalCount()).toBe(0);
  });

  it('applies the pre-subscribe filter only to platform events', async () => {
    const { run } = stubRunner();
    const accept = vi.spyOn(MonitorPreSubscribeFilter.prototype, 'accept').mockReturnValue(false);
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    // Platform event is dropped by the filter — it never reaches the gate.
    pipeline.ingest(activityEvent());
    await flush();
    expect(pipeline.queuedSignalCount()).toBe(0);

    // Report emission (origin 'self') bypasses the filter and stays observer-only.
    pipeline.ingest(reportEmissionEvent('report-1'));
    await flush();
    expect(run).not.toHaveBeenCalled();
    expect(accept).toHaveBeenCalledOnce();
    accept.mockRestore();
  });

  it('does not apply Daily Session quiet-hours filtering to exclusive settled-Turn supervision', async () => {
    const { run } = stubRunner();
    const accept = vi.spyOn(MonitorPreSubscribeFilter.prototype, 'accept').mockReturnValue(false);
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });
    const lifecycleEvent = managedCompletionEvent();

    pipeline.ingest(lifecycleEvent);
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].route).toBe(LocalPromptType.SessionMonitor);
    expect(accept).not.toHaveBeenCalled();
    accept.mockRestore();
  });

  it('fires Session Monitor from settled-Turn liveness', async () => {
    const { run } = stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    pipeline.ingest(managedCompletionEvent());
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].route).toBe(LocalPromptType.SessionMonitor);
  });

  it('keeps report emission off the exclusive Session Monitor declaration path', async () => {
    const { run } = stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    pipeline.ingest(reportEmissionEvent('report-1'));
    await flush();

    expect(run).not.toHaveBeenCalled();
    // The every-event gate carries no pending state regardless, but the
    // daily-session gate must also stay untouched: a 'self'-origin event is
    // never subscribed by daily-session.
    expect(pipeline.queuedSignalCount()).toBe(0);
  });

  it('keeps daily-session firing on the activity threshold independent of session-monitor opt-in', async () => {
    const { run } = stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    for (let i = 0; i < THRESHOLD; i += 1) {
      pipeline.ingest(activityEvent());
    }
    await flush();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].route).toBe(LocalPromptType.DailySession);
  });

  it('surfaces gate and threshold state in the debug snapshot', async () => {
    stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });

    pipeline.ingest(activityEvent());
    await flush();
    const debug = pipeline.getDebug();

    expect(debug.eventThreshold).toBe(THRESHOLD);
    expect(debug.queuedSignalCount).toBe(1);
    expect(debug.signalsUntilThreshold).toBe(THRESHOLD - 1);
    expect(debug.willTriggerOnNextSignal).toBe(THRESHOLD <= 2);
    expect(debug.monitors).toEqual([
      {
        id: 'daily-session',
        route: LocalPromptType.DailySession,
        pending: 1,
        threshold: THRESHOLD,
      },
      { id: 'session-monitor', route: LocalPromptType.SessionMonitor, pending: 0, threshold: null },
    ]);
  });

  it('reconfigures the existing Daily Session declaration without creating a second path', async () => {
    stubRunner();
    const pipeline = createPipeline({
      monitors: buildDeclarations(),
      triggerConfig,
      logger: NOOP_LOGGER,
    });
    pipeline.ingest(activityEvent());
    await flush();
    expect(pipeline.queuedSignalCount()).toBe(1);

    pipeline.applyDailySessionSettings({
      enabled: true,
      countThreshold: 1,
      eventTypes: ['task.created'],
      ...DEFAULT_DAILY_SESSION_LAUNCH,
    });

    expect(pipeline.queuedSignalCount()).toBe(0);
    expect(pipeline.watchesDailySessionEventType(ACTIVITY_EVENT_TYPE)).toBe(false);
    expect(pipeline.watchesDailySessionEventType('task.created')).toBe(true);
    const debug = pipeline.getDebug();
    expect(debug.monitors.find((monitor) => monitor.id === 'daily-session')).toEqual(
      expect.objectContaining({ pending: 0, threshold: 1 }),
    );
  });
});
