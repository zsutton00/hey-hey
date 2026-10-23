import { describe, expect, it } from 'vitest';
import { mapCodexEvent } from '../agents/providers/codex/codex-event-mapper';
import { normalizeProviderEventPayload } from '../agents/providers/provider-event-normalization';
import { projectAgenticEventToDurableEvents } from './durable-event-admission';

const context = {
  runId: 'run-1',
  provider: 'claude' as const,
  providerSessionId: 'provider-session-1',
  providerConversationId: null,
  providerSessionAgentId: 'coding',
  repositoryPath: '/tmp/repository',
};

describe('durable event admission', () => {
  it('projects normalized provider tool and diff facts without the provider envelope', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: context.runId,
      eventType: 'assistant',
      timestamp: '2026-09-03T00:00:00.000Z',
      sessionId: context.providerSessionId,
      agentId: 'claude',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Write',
              input: { file_path: 'src/example.ts', content: 'export const value = 1;' },
            },
          ],
        },
      },
    });

    const admitted = projectAgenticEventToDurableEvents(
      {
        run_id: context.runId,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: normalized.payload,
      },
      context,
      '2026-09-03T00:00:00.000Z',
    );

    expect(admitted.map((candidate) => candidate.payload.kind)).toEqual([
      'diff',
      'tool_use',
    ]);
    expect(JSON.stringify(admitted)).not.toContain('raw_event');
    expect(JSON.stringify(admitted)).not.toContain('canonical_event');
  });

  it('keeps oversized tool output transient while retaining result identity and status', () => {
    const oversizedContent = 'x'.repeat(128 * 1024 + 1);
    const admitted = projectAgenticEventToDurableEvents(
      {
        run_id: context.runId,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: {
          messageType: 'provider_event',
          provider: 'claude',
          eventType: 'user',
          normalized_facts: {
            toolUses: [],
            toolResults: [
              {
                toolUseId: 'tool-result-1',
                isError: true,
                content: oversizedContent,
                observedAt: '2026-09-03T00:00:00.000Z',
              },
            ],
          },
        },
      },
      context,
      '2026-09-03T00:00:00.000Z',
    );

    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.payload).toMatchObject({
      kind: 'tool_result',
      results: [
        {
          toolUseId: 'tool-result-1',
          isError: true,
          content: null,
        },
      ],
    });
    expect(JSON.stringify(admitted)).not.toContain(oversizedContent);
  });

  it('drops assistant prose because it does not affect canonical Run obligations', () => {
    const admitted = projectAgenticEventToDurableEvents(
      {
        run_id: context.runId,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: { messageType: 'assistant', summary: 'A transient response.' },
      },
      context,
    );

    expect(admitted).toEqual([]);
  });

  it('retains exact permission action facts when the provider supplies them', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: context.runId,
      eventType: 'permission_request',
      timestamp: '2026-09-03T00:00:00.000Z',
      sessionId: context.providerSessionId,
      agentId: 'claude',
      rawEvent: {
        type: 'permission_request',
        permission_request: {
          id: 'permission-1',
          permission_type: 'workspace_write',
          action: 'write',
          target: 'src/example.ts',
          fingerprint: 'sha256:permission-1',
        },
      },
    });

    const admitted = projectAgenticEventToDurableEvents(
      {
        run_id: context.runId,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: normalized.payload,
      },
      context,
      '2026-09-03T00:00:00.000Z',
    );

    expect(admitted[0]?.payload).toMatchObject({
      kind: 'permission_requested',
      request: {
        requestId: 'permission-1',
        exactAction: {
          action: 'write',
          target: 'src/example.ts',
          fingerprint: 'sha256:permission-1',
        },
      },
    });
  });

  it('derives exact permission action facts for OpenCode permission patterns', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'opencode',
      runId: context.runId,
      eventType: 'permission.asked',
      timestamp: '2026-09-03T00:00:00.000Z',
      sessionId: 'opencode-session-1',
      agentId: 'opencode',
      rawEvent: {
        id: 'permission-opencode-1',
        permission: 'bash',
        patterns: ['ls *'],
        metadata: {},
      },
    });

    const admitted = projectAgenticEventToDurableEvents(
      {
        run_id: context.runId,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: normalized.payload,
      },
      {
        ...context,
        provider: 'opencode',
        providerSessionId: 'opencode-session-1',
      },
      '2026-09-03T00:00:00.000Z',
    );

    expect(normalized.facts?.permissionRequest).toMatchObject({
      requestId: 'permission-opencode-1',
      permissionType: 'bash',
      exactAction: {
        action: 'bash',
        target: 'ls *',
        fingerprint: expect.stringMatching(/^sha256:/u),
      },
    });
    expect(admitted[0]?.payload).toMatchObject({
      kind: 'permission_requested',
      provider: 'opencode',
      request: {
        requestId: 'permission-opencode-1',
        exactAction: {
          action: 'bash',
          target: 'ls *',
          fingerprint: expect.stringMatching(/^sha256:/u),
        },
      },
    });
  });

  it('does not classify completed assistant items as shell command lifecycle facts', () => {
    const normalized = mapCodexEvent({
      provider: 'codex',
      runId: context.runId,
      eventType: 'item/completed',
      timestamp: '2026-09-03T00:00:00.000Z',
      sessionId: 'codex-session-1',
      agentId: 'codex',
      rawEvent: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { id: 'assistant-item-1', type: 'agentMessage', text: 'Done.' },
      },
    });

    expect(normalized.facts?.commandLifecycle).toBeNull();
  });

  it('does not reconstruct a command lifecycle when normalized facts explicitly omit one', () => {
    const admitted = projectAgenticEventToDurableEvents(
      {
        run_id: context.runId,
        actor: 'agent',
        event_type: 'agent_output',
        state_version: 1,
        payload: {
          messageType: 'provider_event',
          provider: 'codex',
          eventType: 'item/completed',
          normalized_facts: {
            provider: 'codex',
            sessionId: 'codex-session-1',
            routing: { itemId: 'mcp-item-1' },
            commandLifecycle: null,
            toolUses: [
              {
                toolUseId: 'mcp-item-1',
                toolName: 'server/tool',
                input: {},
                observedAt: '2026-09-03T00:00:00.000Z',
              },
            ],
            toolResults: [],
          },
        },
      },
      {
        ...context,
        provider: 'codex',
        providerSessionId: 'codex-session-1',
      },
      '2026-09-03T00:00:00.000Z',
    );

    expect(admitted).toHaveLength(1);
    expect(admitted[0]?.payload).toMatchObject({
      kind: 'tool_use',
      commandLifecycle: null,
    });
  });
});
