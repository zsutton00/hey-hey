import { describe, expect, it } from 'vitest';
import { normalizeSettledTurn, normalizePlatformEvent, normalizeReportEmission } from './normalize';
import { SETTLED_TURN_EVENT_KIND, REPORT_EMISSION_KIND } from './types';
import type {
  RawSettledTurnMonitorEvent,
  RawPlatformInboundEvent,
  RawReportEmissionEvent,
} from './types';

const baseEvent: RawPlatformInboundEvent = {
  eventType: 'conversation.message.created',
  conversationId: 'conv-1',
  projectId: 'proj-1',
  userId: 'user-1',
  timestamp: '2026-06-22T10:00:00.000Z',
};

describe('normalizePlatformEvent', () => {
  it('keeps platform events on the platform lane', () => {
    expect(normalizePlatformEvent(baseEvent)).toEqual({
      eventType: 'conversation.message.created',
      conversationId: 'conv-1',
      projectId: 'proj-1',
      userId: 'user-1',
      timestamp: '2026-06-22T10:00:00.000Z',
      origin: 'platform',
    });
  });

  it('stamps origin "platform" when conversationId is not self-owned', () => {
    expect(normalizePlatformEvent({ ...baseEvent, conversationId: 'conv-unknown' })).toEqual({
      eventType: 'conversation.message.created',
      conversationId: 'conv-unknown',
      projectId: 'proj-1',
      userId: 'user-1',
      timestamp: '2026-06-22T10:00:00.000Z',
      origin: 'platform',
    });
  });

  it('stamps origin "platform" when the event carries no conversationId', () => {
    const result = normalizePlatformEvent({
      eventType: 'project.updated',
      timestamp: '2026-06-22T10:00:00.000Z',
    });

    expect(result.origin).toBe('platform');
    expect(result).not.toHaveProperty('conversationId');
  });
});

describe('normalizeReportEmission', () => {
  const raw: RawReportEmissionEvent = {
    kind: REPORT_EMISSION_KIND,
    runId: 'run-1',
    reportId: 'report-1',
    targetSessionId: 'run-1',
    timestamp: '2026-06-22T10:00:00.000Z',
  };

  it('maps a raw report emission onto the canonical variant, origin "self"', () => {
    expect(normalizeReportEmission(raw, 'conv-target')).toEqual({
      kind: REPORT_EMISSION_KIND,
      eventType: REPORT_EMISSION_KIND,
      timestamp: '2026-06-22T10:00:00.000Z',
      origin: 'self',
      conversationId: 'conv-target',
      targetSessionId: 'run-1',
      targetConversationId: 'conv-target',
      reportId: 'report-1',
    });
  });

  it('forwards the report carriers verbatim', () => {
    const canonical = normalizeReportEmission(
      {
        ...raw,
        reportId: 'report-99',
        targetSessionId: 'session-under-review',
      },
      'conv-under-review',
    );

    expect(canonical.reportId).toBe('report-99');
    expect(canonical.targetSessionId).toBe('session-under-review');
    expect(canonical.targetConversationId).toBe('conv-under-review');
    expect(canonical).not.toHaveProperty('reportGuidance');
  });
});

describe('normalizeSettledTurn', () => {
  it('preserves the exact completion carriers on the self-origin lane', () => {
    const raw: RawSettledTurnMonitorEvent = {
      kind: SETTLED_TURN_EVENT_KIND,
      agentSessionId: 'session-1',
      turnId: 'turn-1',
      promptType: 'coding_freeform',
      terminalOutcome: 'FAILED',
      completedAssistantMessageId: null,
      reports: [{ reportId: 'report-1', reportType: 'IMPLEMENT' }],
      settledAt: '2026-06-22T10:00:00.000Z',
    };

    expect(normalizeSettledTurn(raw)).toEqual({
      ...raw,
      eventType: SETTLED_TURN_EVENT_KIND,
      timestamp: raw.settledAt,
      origin: 'self',
      entityId: raw.agentSessionId,
    });
  });
});
