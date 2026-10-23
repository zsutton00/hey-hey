import { describe, expect, it, vi } from 'vitest';
import type { AgentEventEnvelope } from '../../../agents/agent-event-stream';
import { createTestRunRegistryWiring } from '../../__tests__/helpers/test-run-registry';
import { AgentSource } from './agent-source';
import { SETTLED_TURN_EVENT_KIND, REPORT_EMISSION_KIND } from './types';
import type { RawAgentInboundEvent } from './types';

const envelope: AgentEventEnvelope = {
  source: 'local',
  eventType: 'message',
  timestamp: '2026-06-22T10:00:00.000Z',
  sessionId: 'sess-1',
  agentId: 'agent-1',
  payload: {},
};

const agentOutput = (runId: string): RawAgentInboundEvent => ({
  kind: 'agent_output',
  envelope,
  runId,
});

const reportEmission = (runId: string, reportId: string): RawAgentInboundEvent => ({
  kind: REPORT_EMISSION_KIND,
  runId,
  reportId,
  targetSessionId: runId,
  timestamp: '2026-06-22T10:00:00.000Z',
});

const managedCompletion = (): RawAgentInboundEvent => ({
  kind: SETTLED_TURN_EVENT_KIND,
  agentSessionId: 'session-1',
  turnId: 'turn-1',
  promptType: 'coding_freeform',
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: 'message-1',
  reports: [],
  settledAt: '2026-06-22T10:00:00.000Z',
});

const sourceFor = (resolveConversationId: (runId: string) => string | undefined): AgentSource => {
  const { runRegistry } = createTestRunRegistryWiring();
  vi.spyOn(runRegistry, 'get').mockImplementation((runId) => {
    const conversationId = resolveConversationId(runId);
    return conversationId ? ({ conversationId } as never) : null;
  });
  return new AgentSource(runRegistry);
};

describe('AgentSource', () => {
  it('produces no canonical event for a generic agent output', () => {
    const source = sourceFor(() => 'conv-1');

    expect(source.ingest(agentOutput('run-1'))).toBeUndefined();
  });

  it('produces a report-emission canonical event whose carriers match the run inputs', () => {
    const source = sourceFor(() => 'conv-1');

    const canonical = source.ingest(reportEmission('run-1', 'report-1'));

    expect(canonical).toEqual({
      kind: REPORT_EMISSION_KIND,
      eventType: REPORT_EMISSION_KIND,
      timestamp: '2026-06-22T10:00:00.000Z',
      origin: 'self',
      conversationId: 'conv-1',
      targetSessionId: 'run-1',
      targetConversationId: 'conv-1',
      reportId: 'report-1',
    });
  });

  it('drops a report emission whose emitting run has no registered conversation', () => {
    const source = sourceFor(() => undefined);

    const canonical = source.ingest(reportEmission('run-orphan', 'report-1'));

    expect(canonical).toBeUndefined();
  });

  it('normalizes managed completion without requiring a registered conversation', () => {
    const source = sourceFor(() => undefined);

    expect(source.ingest(managedCompletion())).toMatchObject({
      kind: SETTLED_TURN_EVENT_KIND,
      eventType: SETTLED_TURN_EVENT_KIND,
      origin: 'self',
      entityId: 'session-1',
      turnId: 'turn-1',
    });
  });

  it('keeps platform events on the platform lane regardless of conversation identity', () => {
    const source = sourceFor(() => undefined);
    expect(
      source.normalizePlatformEvent({
        eventType: 'task.updated',
        conversationId: 'conv-target',
        timestamp: '2026-06-22T10:00:00.000Z',
      }).origin,
    ).toBe('platform');
  });
});
