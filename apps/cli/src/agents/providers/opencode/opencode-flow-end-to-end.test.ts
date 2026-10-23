import { describe, expect, it } from 'vitest';
import { parseOpencodeSseLine } from './opencode-schemas';
import { normalizeProviderEventPayload } from '../provider-event-normalization';
import { normalizeEvent } from '../../../run/normalize';
import { handlePermission } from '../../../run/handlers/permission';
import { makeDeps, makePoster, makeTestRun } from '../../../run/handlers/__test-utils';
import type { LocalAgentOutputEvent } from '../../../run/types';

const buildSseLine = (event: { type: string; properties: Record<string, unknown> }): string =>
  `data: ${JSON.stringify({ id: 'evt-1', ...event })}`;

describe('opencode end-to-end flow', () => {
  it('streams text parts and produces assistant_complete on session.status idle', () => {
    const config = {
      validationMode: 'permissive' as const,
      maxDiffBlobBytes: 4096,
      trackTools: false,
    };
    const runId = 'run-1';
    const sessionId = 'oc-session-1';

    const lines = [
      buildSseLine({
        type: 'message.part.updated',
        properties: {
          sessionID: sessionId,
          part: {
            type: 'text',
            text: 'Hello',
            sessionID: sessionId,
            time: { start: 1 },
          },
        },
      }),
      buildSseLine({
        type: 'message.part.updated',
        properties: {
          sessionID: sessionId,
          part: {
            type: 'text',
            text: 'Hello world',
            sessionID: sessionId,
            time: { start: 1, end: 2 },
          },
        },
      }),
      buildSseLine({
        type: 'session.status',
        properties: {
          sessionID: sessionId,
          status: { type: 'idle' },
        },
      }),
    ];

    const emitted: LocalAgentOutputEvent[] = [];
    let bufferedText = '';

    for (const line of lines) {
      const parsed = parseOpencodeSseLine(line);
      expect(parsed.ok).toBe(true);
      if (!parsed.event) continue;

      const normalized = normalizeProviderEventPayload({
        provider: 'opencode',
        runId,
        eventType: parsed.event.type,
        timestamp: '2026-05-04T00:00:00.000Z',
        sessionId,
        agentId: 'opencode',
        rawEvent: parsed.event.properties,
        config,
      });

      if (normalized.assistantText && normalized.assistantText.kind === 'text') {
        if (
          normalized.assistantText.isFinal ||
          normalized.assistantText.text.length > bufferedText.length
        ) {
          bufferedText = normalized.assistantText.text;
        }
      }

      emitted.push({
        runId,
        source: 'provider',
        eventType: normalized.resolvedEventType ?? parsed.event.type,
        timestamp: '2026-05-04T00:00:00.000Z',
        sessionId,
        agentId: 'opencode',
        payload: normalized.payload,
      });

      if (normalized.isTerminal && bufferedText.length > 0) {
        emitted.push({
          runId,
          source: 'provider',
          eventType: 'agent_output',
          timestamp: '2026-05-04T00:00:00.000Z',
          sessionId,
          agentId: 'opencode',
          payload: {
            messageType: 'assistant',
            summary: bufferedText,
            taskComplete: true,
          },
        });
      }
    }

    let finalAssistant: LocalAgentOutputEvent | undefined;
    for (let i = emitted.length - 1; i >= 0; i -= 1) {
      const candidate = emitted[i];
      if (candidate && candidate.eventType === 'agent_output') {
        finalAssistant = candidate;
        break;
      }
    }
    expect(finalAssistant).toBeDefined();
    const finalNormalized = normalizeEvent(finalAssistant!, 'opencode');
    expect(finalNormalized.kind).toBe('assistant_complete');
    if (finalNormalized.kind === 'assistant_complete') {
      expect(finalNormalized.summary).toBe('Hello world');
    }
  });

  it('routes session.diff to a file_diff_detected event and a diff kind downstream', () => {
    const line = buildSseLine({
      type: 'session.diff',
      properties: {
        sessionID: 'oc-session-2',
        diff: [{ file: 'src/x.ts', patch: '@@\n+added', additions: 1, deletions: 0 }],
      },
    });

    const parsed = parseOpencodeSseLine(line);
    expect(parsed.ok).toBe(true);
    if (!parsed.event) throw new Error('expected parsed event');

    const normalized = normalizeProviderEventPayload({
      provider: 'opencode',
      runId: 'run-2',
      eventType: parsed.event.type,
      timestamp: '2026-05-04T00:00:00.000Z',
      sessionId: 'oc-session-2',
      agentId: 'opencode',
      rawEvent: parsed.event.properties,
      config: {
        validationMode: 'permissive',
        maxDiffBlobBytes: 4096,
        trackTools: false,
      },
    });

    expect(normalized.resolvedEventType).toBe('file_diff_detected');

    const event: LocalAgentOutputEvent = {
      runId: 'run-2',
      source: 'provider',
      eventType: normalized.resolvedEventType ?? 'unknown',
      timestamp: '2026-05-04T00:00:00.000Z',
      sessionId: 'oc-session-2',
      agentId: 'opencode',
      payload: normalized.payload,
    };
    const dispatched = normalizeEvent(event, 'opencode');
    expect(dispatched.kind).toBe('diff');
    if (dispatched.kind === 'diff') {
      expect(dispatched.files).toEqual(['src/x.ts']);
      expect(dispatched.awaitingPermission).toBe(false);
      expect(dispatched.authority).toBe('diagnostic');
      expect(dispatched.patches).toEqual([{ path: 'src/x.ts', diff: '@@\n+added' }]);
    }
  });

  it('routes permission.asked to a structured permission message downstream', async () => {
    const line = buildSseLine({
      type: 'permission.asked',
      properties: {
        id: 'perm-9',
        permission: 'bash',
        patterns: ['ls *'],
        metadata: {},
      },
    });

    const parsed = parseOpencodeSseLine(line);
    expect(parsed.ok).toBe(true);
    if (!parsed.event) throw new Error('expected parsed event');

    const normalized = normalizeProviderEventPayload({
      provider: 'opencode',
      runId: 'run-3',
      eventType: parsed.event.type,
      timestamp: '2026-05-04T00:00:00.000Z',
      sessionId: 'oc-session-3',
      agentId: 'opencode',
      rawEvent: parsed.event.properties,
      config: {
        validationMode: 'permissive',
        maxDiffBlobBytes: 4096,
        trackTools: false,
      },
    });

    expect(normalized.resolvedEventType).toBe('permission_request_detected');

    const event: LocalAgentOutputEvent = {
      runId: 'run-3',
      source: 'provider',
      eventType: normalized.resolvedEventType ?? 'unknown',
      timestamp: '2026-05-04T00:00:00.000Z',
      sessionId: 'oc-session-3',
      agentId: 'opencode',
      payload: normalized.payload,
    };
    const dispatched = normalizeEvent(event, 'opencode');
    expect(dispatched.kind).toBe('permission');
    if (dispatched.kind !== 'permission') throw new Error('expected permission event');

    const poster = makePoster();
    await handlePermission(dispatched, makeTestRun({ provider: 'opencode' }), makeDeps(poster));

    expect(poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        dto: expect.objectContaining({
          data: expect.objectContaining({
            type: 'QUESTIONS',
            uiElements: expect.arrayContaining([
              expect.objectContaining({
                type: 'agent-request-permission',
                payload: expect.objectContaining({
                  responseType: 'agent_request_permission_v1',
                  permissionRequest: expect.objectContaining({
                    id: 'perm-9',
                    agentType: 'opencode',
                  }),
                }),
              }),
            ]),
          }),
        }),
      }),
    );
  });
});
