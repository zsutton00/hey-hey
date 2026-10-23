import { describe, expect, it } from 'vitest';
import { DEFAULT_TRIGGER_CONFIG } from '../trigger-config';
import {
  SETTLED_TURN_EVENT_KIND,
  REPORT_EMISSION_KIND,
  type CanonicalMonitorEvent,
  type CanonicalSettledTurnMonitorEvent,
  type ReportEmissionMonitorEvent,
} from '../normalizer';
import {
  dailySessionSubscribe,
  isDailySessionActivityEventType,
  sessionMonitorSubscribe,
} from './subscribe';

const ACTIVITY_EVENT_TYPES = DEFAULT_TRIGGER_CONFIG.rules.map((rule) => rule.eventType);

const platformEvent = (eventType: string): CanonicalMonitorEvent => ({
  eventType,
  conversationId: 'conv-platform',
  timestamp: '2026-06-23T00:00:00.000Z',
  origin: 'platform',
});

const reportEmissionEvent = (): ReportEmissionMonitorEvent => ({
  eventType: 'report.emitted',
  kind: REPORT_EMISSION_KIND,
  targetSessionId: 'session-1',
  targetConversationId: 'conv-self',
  reportId: 'report-1',
  conversationId: 'conv-self',
  timestamp: '2026-06-23T00:00:00.000Z',
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
  settledAt: '2026-06-23T00:00:00.000Z',
  entityId: 'session-1',
  timestamp: '2026-06-23T00:00:00.000Z',
  origin: 'self',
});

describe('dailySessionSubscribe', () => {
  it('accepts every configured platform activity event type', () => {
    for (const eventType of ACTIVITY_EVENT_TYPES) {
      expect(dailySessionSubscribe(platformEvent(eventType))).toBe(true);
    }
  });

  it('rejects activity events stamped origin "self"', () => {
    for (const eventType of ACTIVITY_EVENT_TYPES) {
      expect(dailySessionSubscribe({ ...platformEvent(eventType), origin: 'self' })).toBe(false);
    }
  });

  it('rejects platform events whose type is not a configured activity type', () => {
    expect(dailySessionSubscribe(platformEvent('conversation.message.created'))).toBe(false);
    expect(dailySessionSubscribe(platformEvent('project.updated'))).toBe(false);
  });

  it('rejects the report-emission variant', () => {
    expect(dailySessionSubscribe(reportEmissionEvent())).toBe(false);
  });
});

describe('isDailySessionActivityEventType', () => {
  it('admits configured activity types at the platform-to-monitor boundary', () => {
    for (const eventType of ACTIVITY_EVENT_TYPES) {
      expect(isDailySessionActivityEventType(eventType)).toBe(true);
    }
  });

  it('rejects conversation and trigger frames before monitor fan-out', () => {
    expect(isDailySessionActivityEventType('conversation.updated')).toBe(false);
    expect(isDailySessionActivityEventType('trigger.conversation')).toBe(false);
  });
});

describe('sessionMonitorSubscribe', () => {
  it('accepts settled managed-Turn liveness', () => {
    expect(sessionMonitorSubscribe(managedCompletionEvent())).toBe(true);
  });

  it('rejects platform activity events', () => {
    for (const eventType of ACTIVITY_EVENT_TYPES) {
      expect(sessionMonitorSubscribe(platformEvent(eventType))).toBe(false);
    }
  });

  it('rejects report emissions and unrelated self-origin events', () => {
    expect(sessionMonitorSubscribe(reportEmissionEvent())).toBe(false);
    expect(
      sessionMonitorSubscribe({
        eventType: 'agent_session.status_changed',
        conversationId: 'conv-self',
        timestamp: '2026-06-23T00:00:00.000Z',
        origin: 'self',
      }),
    ).toBe(false);
  });
});
