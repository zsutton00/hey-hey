import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_EVENT_THRESHOLD, DEFAULT_TRIGGER_CONFIG } from '../trigger-config';
import {
  SETTLED_TURN_EVENT_KIND,
  REPORT_EMISSION_KIND,
  type CanonicalMonitorEvent,
  type CanonicalSettledTurnMonitorEvent,
  type ReportEmissionMonitorEvent,
} from '../normalizer';
import { DailySessionMonitor } from './daily-session';
import { DEFAULT_DAILY_SESSION_LAUNCH } from '../daily-session-settings';
import { ReportType } from '../../../shared/api/generated/api';
import {
  SESSION_MONITOR_REPORT_TYPE_SUBSCRIPTION,
  SESSION_MONITOR_RUN_CONFIG,
  SessionMonitor,
} from './session-monitor';
import type { Monitor } from './types';

const ACTIVITY_EVENT_TYPE = DEFAULT_TRIGGER_CONFIG.rules[0]!.eventType;

/** Drive one event through a declaration's subscribe-then-gate pipeline. */
const feed = async (declaration: Monitor, event: CanonicalMonitorEvent): Promise<boolean> =>
  declaration.subscribes(event) && (await declaration.admits(event))
    ? declaration.gate.accept(event).fired
    : false;

const activityEvent = (): CanonicalMonitorEvent => ({
  eventType: ACTIVITY_EVENT_TYPE,
  conversationId: 'conv-platform',
  timestamp: '2026-06-23T00:00:00.000Z',
  origin: 'platform',
});

const reportEmissionEvent = (reportId: string): ReportEmissionMonitorEvent => ({
  eventType: 'report.emitted',
  kind: REPORT_EMISSION_KIND,
  targetSessionId: 'session-1',
  targetConversationId: 'conv-self',
  reportId,
  conversationId: 'conv-self',
  timestamp: '2026-06-23T00:00:00.000Z',
  origin: 'self',
});

const managedCompletionEvent = (turnId: string): CanonicalSettledTurnMonitorEvent => ({
  kind: SETTLED_TURN_EVENT_KIND,
  eventType: SETTLED_TURN_EVENT_KIND,
  agentSessionId: 'session-1',
  turnId,
  promptType: 'coding_freeform',
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: 'message-1',
  reports: [],
  settledAt: '2026-06-23T00:00:00.000Z',
  entityId: 'session-1',
  timestamp: '2026-06-23T00:00:00.000Z',
  origin: 'self',
});

describe('DailySessionMonitor', () => {
  it('fires exactly when the configured activity threshold is reached', async () => {
    const dailySessionMonitor = new DailySessionMonitor();
    const threshold = DEFAULT_TRIGGER_CONFIG.eventThreshold ?? DEFAULT_EVENT_THRESHOLD;
    const fires: boolean[] = [];
    for (let i = 0; i < threshold; i += 1) {
      fires.push(await feed(dailySessionMonitor, activityEvent()));
    }
    expect(fires.slice(0, threshold - 1).every((f) => f === false)).toBe(true);
    expect(fires[threshold - 1]).toBe(true);
  });

  it('does not advance the gate for events it does not subscribe to', async () => {
    const dailySessionMonitor = new DailySessionMonitor();
    const selfActivity: CanonicalMonitorEvent = { ...activityEvent(), origin: 'self' };
    const threshold = DEFAULT_TRIGGER_CONFIG.eventThreshold ?? DEFAULT_EVENT_THRESHOLD;
    // A full threshold of dropped self events must never fire the gate.
    for (let i = 0; i < threshold; i += 1) {
      await expect(feed(dailySessionMonitor, selfActivity)).resolves.toBe(false);
    }
  });

  it('uses configured event types and threshold for the single stateful gate', async () => {
    const dailySessionMonitor = new DailySessionMonitor({
      enabled: true,
      countThreshold: 2,
      eventTypes: ['task.created'],
      ...DEFAULT_DAILY_SESSION_LAUNCH,
    });
    await expect(feed(dailySessionMonitor, activityEvent())).resolves.toBe(false);
    const configuredEvent = { ...activityEvent(), eventType: 'task.created' };
    await expect(feed(dailySessionMonitor, configuredEvent)).resolves.toBe(false);
    await expect(feed(dailySessionMonitor, configuredEvent)).resolves.toBe(true);
  });

  it('does not admit configured activity when automatic firing is disabled', async () => {
    const dailySessionMonitor = new DailySessionMonitor({
      enabled: false,
      countThreshold: 1,
      eventTypes: [ACTIVITY_EVENT_TYPE],
      ...DEFAULT_DAILY_SESSION_LAUNCH,
    });
    await expect(feed(dailySessionMonitor, activityEvent())).resolves.toBe(false);
    expect(dailySessionMonitor.gate.inspect().pending).toBe(0);
  });

  it('applies accepted settings in place and resets pending threshold state', async () => {
    const dailySessionMonitor = new DailySessionMonitor({
      enabled: true,
      countThreshold: 3,
      eventTypes: [ACTIVITY_EVENT_TYPE],
      ...DEFAULT_DAILY_SESSION_LAUNCH,
    });
    await expect(feed(dailySessionMonitor, activityEvent())).resolves.toBe(false);
    dailySessionMonitor.applySettings({
      enabled: false,
      countThreshold: 1,
      eventTypes: ['task.created'],
      ...DEFAULT_DAILY_SESSION_LAUNCH,
    });

    expect(dailySessionMonitor.settings.enabled).toBe(false);
    expect(dailySessionMonitor.watchesEventType(ACTIVITY_EVENT_TYPE)).toBe(false);
    expect(dailySessionMonitor.watchesEventType('task.created')).toBe(true);
    expect(dailySessionMonitor.gate.inspect()).toEqual({ pending: 0, threshold: 1 });
  });
});

describe('SessionMonitor', () => {
  it('declares the immutable canonical Report subscription', () => {
    const declaration = new SessionMonitor();
    expect(declaration.reportTypeSubscription).toBe(SESSION_MONITOR_REPORT_TYPE_SUBSCRIPTION);
    expect(declaration.reportTypeSubscription).toEqual([
      ReportType.Plan,
      ReportType.FeatureSyncDecision,
      ReportType.FeatureSyncHandoff,
      ReportType.DecisionNeeded,
    ]);
    expect(Object.isFrozen(declaration.reportTypeSubscription)).toBe(true);
  });

  it('owns an immutable workspace-free launch configuration', () => {
    const declaration = new SessionMonitor();
    expect(declaration.runConfig).toBe(SESSION_MONITOR_RUN_CONFIG);
    expect(Object.isFrozen(declaration.runConfig)).toBe(true);
    expect(declaration.runConfig).not.toHaveProperty('serviceIds');
    expect(declaration.runConfig).not.toHaveProperty('launchServiceId');
    expect(declaration.runConfig).not.toHaveProperty('scope');
    expect(declaration.runConfig).not.toHaveProperty('worktree');
  });

  it('fires on every non-monitor settled Turn', async () => {
    const declaration = new SessionMonitor();
    await expect(feed(declaration, managedCompletionEvent('turn-1'))).resolves.toBe(true);
    await expect(feed(declaration, managedCompletionEvent('turn-2'))).resolves.toBe(true);
  });

  it('ignores report emissions and platform activity', async () => {
    const declaration = new SessionMonitor();
    await expect(feed(declaration, reportEmissionEvent('report-1'))).resolves.toBe(false);
    await expect(feed(declaration, activityEvent())).resolves.toBe(false);
  });
});
