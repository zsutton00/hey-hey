import { describe, expect, it } from 'vitest';
import {
  loadProviderEventNormalizationConfig,
  normalizeProviderEventPayload,
} from './provider-event-normalization';

describe('provider-event-normalization', () => {
  it('records observed research and delegation activity without claiming coverage', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'research-run',
      eventType: 'assistant',
      timestamp: '2026-09-14T00:00:00.000Z',
      sessionId: 'research-session',
      agentId: 'lead',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'src/a.ts' } },
            { type: 'tool_use', id: 'agent-1', name: 'Agent', input: { description: 'Review' } },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: true },
    });

    expect(normalized.facts?.researchActivity).toEqual({
      observedTools: ['Read', 'Agent'],
      repositoryRelativePaths: ['src/a.ts'],
      delegationObserved: true,
    });
    expect(normalized.facts?.researchActivity).not.toHaveProperty('filesRead');
    expect(normalized.facts?.researchActivity).not.toHaveProperty('coverage');
  });

  it('reports the live non-ambient Claude background tasks', () => {
    const normalize = (rawEvent: Record<string, unknown>) =>
      normalizeProviderEventPayload({
        provider: 'claude',
        runId: 'bg-run',
        eventType: 'system',
        timestamp: '2026-10-03T00:00:00.000Z',
        sessionId: 'provider-session-1',
        agentId: 'claude',
        rawEvent,
        config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: true },
      }).facts?.backgroundTasks;

    expect(
      normalize({
        type: 'system',
        subtype: 'background_tasks_changed',
        tasks: [
          { task_id: 'task-bg-1', task_type: 'local_agent', description: 'Map the API' },
          { task_id: 'watch-1', task_type: 'monitor', description: 'Watch', ambient: true },
        ],
        session_id: 'provider-session-1',
      }),
    ).toEqual({ liveTaskIds: ['task-bg-1'] });
    expect(normalize({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })).toEqual({
      liveTaskIds: [],
    });
    expect(
      normalize({
        type: 'system',
        subtype: 'task_started',
        task_id: 'task-bg-1',
        description: 'Map the API',
        task_type: 'local_agent',
        is_backgrounded: true,
      }),
    ).toBeNull();
    expect(normalize({ type: 'system', subtype: 'background_tasks_changed' })).toBeNull();
  });

  it('maps permission requests into canonical fields and preserves raw payload', () => {
    const rawEvent = {
      type: 'permission_request',
      session_id: 'provider-session-1',
      agent_id: 'agent-1',
      permission_type: 'workspace_write',
      permission_request: {
        id: 'perm-1',
      },
      metadata: {
        reason: 'Need access',
      },
      provider_specific_hint: 'keep-me',
    } as Record<string, unknown>;

    const normalized = normalizeProviderEventPayload({
      provider: 'codex',
      runId: 'run-1',
      eventType: 'permission_request',
      timestamp: '2026-02-20T00:00:01.000Z',
      sessionId: 'provider-session-1',
      agentId: 'agent-1',
      rawEvent,
      config: {
        validationMode: 'strict',
        maxDiffBlobBytes: 4096,
        trackTools: false,
      },
    });

    expect(normalized.diagnostics.success).toBe(true);
    expect(normalized.payload).toMatchObject({
      messageType: 'provider_event',
      canonical_event_type: 'permission_request',
      raw_event: rawEvent,
      canonical_event: {
        permission_request: {
          id: 'perm-1',
          permission_type: 'workspace_write',
          metadata: {
            reason: 'Need access',
          },
        },
      },
      provider_metadata: {
        extra_fields: {
          provider_specific_hint: 'keep-me',
        },
      },
    });
  });

  it('preserves normalized exact-action facts for Task Monitor admission', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'codex',
      runId: 'run-exact-action',
      eventType: 'permission_request',
      timestamp: '2026-08-08T12:00:00.000Z',
      sessionId: 'provider-session',
      agentId: 'codex',
      rawEvent: {
        type: 'permission_request',
        permission_request: {
          id: 'provider-action-1',
          permission_type: 'command_execution',
          action: 'exec',
          target: 'pnpm deploy',
          fingerprint: 'sha256:exact-action',
          created_at: '2026-08-08T12:00:00.000Z',
          expires_at: '2026-08-08T12:05:00.000Z',
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.payload).toMatchObject({
      canonical_event: {
        permission_request: {
          id: 'provider-action-1',
          action: 'exec',
          target: 'pnpm deploy',
          fingerprint: 'sha256:exact-action',
          created_at: '2026-08-08T12:00:00.000Z',
          expires_at: '2026-08-08T12:05:00.000Z',
        },
      },
    });
  });

  it('maps diff events with explicit delivery mode and truncates large blobs', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-2',
      eventType: 'diff',
      timestamp: '2026-02-20T00:00:02.000Z',
      sessionId: 'provider-session-2',
      agentId: 'agent-2',
      rawEvent: {
        type: 'diff',
        files: ['src/a.ts', 'src/b.ts'],
        diff_blob: '0123456789abcdef',
      },
      config: {
        validationMode: 'strict',
        maxDiffBlobBytes: 8,
        trackTools: false,
      },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    expect(normalized.diagnostics.success).toBe(true);
    expect(normalized.payload).toMatchObject({
      canonical_event_type: 'diff',
      canonical_event: {
        diff: {
          files: ['src/a.ts', 'src/b.ts'],
          delivery_mode: 'batch',
          delivery_mode_flags: {
            is_incremental: false,
            is_batch: true,
          },
          truncation: {
            truncated: true,
            overflow: true,
            max_size_bytes: 8,
          },
        },
      },
    });

    const canonicalEvent = normalized.payload['canonical_event'] as Record<string, unknown>;
    const diff = canonicalEvent['diff'] as Record<string, unknown>;
    expect(typeof diff['diff_blob']).toBe('string');
    expect((diff['diff_blob'] as string).length).toBeGreaterThan(0);
  });

  it('keeps permissive mode best-effort with schema mismatch diagnostics', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'codex',
      runId: 'run-3',
      eventType: 'permission_request',
      timestamp: '2026-02-20T00:00:03.000Z',
      sessionId: 'provider-session-3',
      agentId: 'agent-3',
      rawEvent: {
        type: 'permission_request',
      },
      config: {
        validationMode: 'permissive',
        maxDiffBlobBytes: 4096,
        trackTools: false,
      },
    });

    expect(normalized.diagnostics.success).toBe(true);
    expect(normalized.diagnostics.schemaMismatch).toBe(true);
    expect(normalized.diagnostics.errors).toContain('permission_request.id is required');
    expect(normalized.payload).toMatchObject({
      raw_event: {
        type: 'permission_request',
      },
      normalization: {
        validation_mode: 'permissive',
        success: true,
        schema_mismatch: true,
      },
    });
  });

  it('fails strict validation when required permission fields are missing', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-4',
      eventType: 'permission_request',
      timestamp: '2026-02-20T00:00:04.000Z',
      sessionId: null,
      agentId: null,
      rawEvent: {
        type: 'permission_request',
      },
      config: {
        validationMode: 'strict',
        maxDiffBlobBytes: 4096,
        trackTools: false,
      },
    });

    expect(normalized.diagnostics.schemaMismatch).toBe(true);
    expect(normalized.diagnostics.schemaMismatch).toBe(true);
    expect(normalized.payload).toMatchObject({
      normalization: {
        validation_mode: 'strict',
        success: false,
        schema_mismatch: true,
      },
    });
  });

  it('classifies Write tool_use in assistant event as diff', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-1',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:01.000Z',
      sessionId: 'session-tu-1',
      agentId: 'agent-tu-1',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: {
                file_path: 'src/hello.ts',
                content: 'console.log("hello");',
              },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    expect(normalized.diagnostics.success).toBe(true);
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/hello.ts']);
    expect(diff['diff_blob']).toContain('console.log("hello")');
    expect(diff['delivery_mode']).toBe('incremental');
    expect(diff['tool_use_blocks']).toHaveLength(1);
  });

  it('classifies Edit tool_use in assistant event as diff with old/new strings', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-2',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:02.000Z',
      sessionId: 'session-tu-2',
      agentId: 'agent-tu-2',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: 'src/module.ts',
                old_string: 'const x = 1;',
                new_string: 'const x = 2;',
              },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/module.ts']);
    expect(diff['diff_blob']).toContain('const x = 1;');
    expect(diff['diff_blob']).toContain('const x = 2;');
    expect(diff['delivery_mode']).toBe('incremental');
    expect(diff['toolInput']).toEqual({
      file_path: 'src/module.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 2;',
    });
  });

  it('classifies multiple tool_use blocks (Write + Edit + Read) as batch diff, ignoring Read', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-3',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:03.000Z',
      sessionId: 'session-tu-3',
      agentId: 'agent-tu-3',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: 'src/a.ts', content: 'aaa' },
            },
            {
              type: 'tool_use',
              name: 'Edit',
              input: { file_path: 'src/b.ts', old_string: 'old', new_string: 'new' },
            },
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'src/c.ts' },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/a.ts', 'src/b.ts']);
    expect(diff['delivery_mode']).toBe('batch');
    expect(diff['tool_use_blocks']).toHaveLength(2);
  });

  it('keeps assistant event without tool_use as status', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-4',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:04.000Z',
      sessionId: 'session-tu-4',
      agentId: 'agent-tu-4',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Here is the result...' }],
        },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('status');
  });

  it('keeps non-file-modifying tool_use (Bash) as status', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-5',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:05.000Z',
      sessionId: 'session-tu-5',
      agentId: 'agent-tu-5',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Bash',
              input: { command: 'ls -la' },
            },
          ],
        },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('status');
  });

  it('classifies Codex agent_message with tool_use as diff', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'codex',
      runId: 'run-tu-6',
      eventType: 'agent_message',
      timestamp: '2026-03-08T00:00:06.000Z',
      sessionId: 'session-tu-6',
      agentId: 'agent-tu-6',
      rawEvent: {
        type: 'agent_message',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'write_file',
              input: { file_path: 'index.js', content: 'module.exports = {}' },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    expect(diff['files']).toEqual(['index.js']);
  });

  it('truncates large Write content exceeding maxDiffBlobBytes', () => {
    const largeContent = 'x'.repeat(10_000);
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-7',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:07.000Z',
      sessionId: 'session-tu-7',
      agentId: 'agent-tu-7',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: 'big.ts', content: largeContent },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 2048, trackTools: false },
    });

    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    const truncation = diff['truncation'] as Record<string, unknown>;
    expect(truncation['truncated']).toBe(true);
    expect(truncation['overflow']).toBe(true);
    expect((diff['diff_blob'] as string).length).toBeLessThan(largeContent.length);
  });

  it('uses existing mapDiffEvent when explicit diff keys are present alongside tool_use', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-8',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:08.000Z',
      sessionId: 'session-tu-8',
      agentId: 'agent-tu-8',
      rawEvent: {
        type: 'assistant',
        diff_blob: 'explicit diff content',
        files: ['src/explicit.ts'],
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { file_path: 'src/tool.ts', content: 'tool content' },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    // Explicit diff keys take precedence — should use mapDiffEvent, not mapToolUseDiffEvent
    expect(diff['diff_blob']).toBe('explicit diff content');
    expect(diff['files']).toEqual(['src/explicit.ts']);
    expect(diff['tool_use_blocks']).toBeUndefined();
  });

  it('handles Edit tool_use with empty new_string (deletion)', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-9',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:09.000Z',
      sessionId: 'session-tu-9',
      agentId: 'agent-tu-9',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Edit',
              input: {
                file_path: 'src/cleanup.ts',
                old_string: 'const unused = true;',
                new_string: '',
              },
            },
          ],
        },
      },
      config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    expect(diff['files']).toEqual(['src/cleanup.ts']);
    expect(diff['diff_blob']).toContain('- const unused = true;');
    expect(diff['diff_blob']).toContain('+ ');
  });

  it('handles Write tool_use with missing file_path', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tu-10',
      eventType: 'assistant',
      timestamp: '2026-03-08T00:00:10.000Z',
      sessionId: 'session-tu-10',
      agentId: 'agent-tu-10',
      rawEvent: {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: {
                content: 'orphan content',
              },
            },
          ],
        },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.diagnostics.canonicalEventType).toBe('diff');
    const diff = (normalized.payload['canonical_event'] as Record<string, unknown>)[
      'diff'
    ] as Record<string, unknown>;
    expect(diff['files']).toEqual([]);
    expect(diff['diff_blob']).toBe('orphan content');
  });

  it('extracts tool_result error blocks from user events (is_error=true)', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tr-1',
      eventType: 'user',
      timestamp: '2026-04-17T00:00:00.000Z',
      sessionId: 'session-tr-1',
      agentId: 'claude',
      rawEvent: {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_edit_1',
              is_error: true,
              content: [{ type: 'text', text: 'Authentication required' }],
            },
          ],
        },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.payload['all_tool_result_blocks']).toEqual([
      {
        tool_use_id: 'toolu_edit_1',
        is_error: true,
        content_text: 'Authentication required',
        content_raw: [{ type: 'text', text: 'Authentication required' }],
      },
    ]);
  });

  it('extracts tool_result blocks with string content', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tr-2',
      eventType: 'user',
      timestamp: '2026-04-17T00:00:01.000Z',
      sessionId: 'session-tr-2',
      agentId: 'claude',
      rawEvent: {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_bash_1',
              is_error: true,
              content: 'command not found: foo',
            },
          ],
        },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    const blocks = normalized.payload['all_tool_result_blocks'] as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      tool_use_id: 'toolu_bash_1',
      is_error: true,
      content_text: 'command not found: foo',
      content_raw: 'command not found: foo',
    });
  });

  it('preserves oversized tool output for live typed facts', () => {
    const oversizedContent = 'x'.repeat(128 * 1024 + 1);
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tr-oversized',
      eventType: 'user',
      timestamp: '2026-04-17T00:00:03.000Z',
      sessionId: 'session-tr-oversized',
      agentId: 'claude',
      rawEvent: {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu-large-output',
              is_error: false,
              content: oversizedContent,
            },
          ],
        },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.facts?.toolResults).toEqual([
      expect.objectContaining({
        toolUseId: 'toolu-large-output',
        isError: false,
        content: oversizedContent,
      }),
    ]);
    const transientBlocks = normalized.payload['all_tool_result_blocks'] as Array<
      Record<string, unknown>
    >;
    expect(transientBlocks[0]?.['content_text']).toBe(oversizedContent);
  });

  it('omits all_tool_result_blocks when no tool_result blocks are present', () => {
    const normalized = normalizeProviderEventPayload({
      provider: 'claude',
      runId: 'run-tr-3',
      eventType: 'assistant',
      timestamp: '2026-04-17T00:00:02.000Z',
      sessionId: 'session-tr-3',
      agentId: 'claude',
      rawEvent: {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
      },
      config: { validationMode: 'permissive', maxDiffBlobBytes: 4096, trackTools: false },
    });

    expect(normalized.payload['all_tool_result_blocks']).toBeUndefined();
  });

  it('loads strict mode and diff size from feature flags', () => {
    const previousMode = process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'];
    const previousMax = process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'];

    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'] = 'strict';
    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'] = '8192';

    try {
      const loaded = loadProviderEventNormalizationConfig();
      expect(loaded).toEqual({
        validationMode: 'strict',
        maxDiffBlobBytes: 8192,
        trackTools: true,
      });
    } finally {
      if (previousMode === undefined) {
        delete process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'];
      } else {
        process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'] = previousMode;
      }

      if (previousMax === undefined) {
        delete process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'];
      } else {
        process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'] = previousMax;
      }
    }
  });

  describe('opencode', () => {
    const baseInput = {
      provider: 'opencode' as const,
      runId: 'run-oc',
      timestamp: '2026-05-04T00:00:00.000Z',
      sessionId: 'oc-session-1',
      agentId: 'opencode',
      config: {
        validationMode: 'permissive' as const,
        maxDiffBlobBytes: 4096,
        trackTools: false,
      },
    };

    it('maps message.part.updated text into assistant status with buffered text', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'message.part.updated',
        rawEvent: {
          sessionID: 'oc-session-1',
          part: {
            type: 'text',
            text: 'Hello world',
            sessionID: 'oc-session-1',
            time: { start: 1, end: 2 },
          },
        },
      });

      expect(normalized.diagnostics.canonicalEventType).toBe('status');
      expect(normalized.resolvedEventType).toBe('agent_output_delta');
      expect(normalized.assistantText).toEqual({
        kind: 'text',
        text: 'Hello world',
        isFinal: true,
      });
    });

    it('maps message.part.delta text into assistant status with delta chunk', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'message.part.delta',
        rawEvent: {
          sessionID: 'oc-session-1',
          messageID: 'msg-1',
          partID: 'prt-1',
          field: 'text',
          delta: 'Hello',
        },
      });

      expect(normalized.diagnostics.canonicalEventType).toBe('status');
      expect(normalized.resolvedEventType).toBe('agent_output_delta');
      expect(normalized.assistantTextDelta).toBe('Hello');
      expect(normalized.diagnostics.schemaMismatch).toBe(false);
      expect(normalized.diagnostics.errors).toEqual([]);
    });

    it('maps message.part.delta with empty delta to agent_output_delta without assistantTextDelta', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'message.part.delta',
        rawEvent: {
          sessionID: 'oc-session-1',
          messageID: 'msg-1',
          partID: 'prt-1',
          field: 'text',
          delta: '',
        },
      });

      expect(normalized.resolvedEventType).toBe('agent_output_delta');
      expect(normalized.assistantTextDelta).toBeUndefined();
    });

    it('maps message.part.delta with non-text field to agent_output_delta', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'message.part.delta',
        rawEvent: {
          sessionID: 'oc-session-1',
          messageID: 'msg-1',
          partID: 'prt-1',
          field: 'ignored',
          delta: 'true',
        },
      });

      expect(normalized.resolvedEventType).toBe('agent_output_delta');
      expect(normalized.assistantTextDelta).toBeUndefined();
    });

    it('maps message.part.updated tool (running) to processing_status', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'message.part.updated',
        rawEvent: {
          sessionID: 'oc-session-1',
          part: {
            type: 'tool',
            tool: 'bash',
            callID: 'call-1',
            sessionID: 'oc-session-1',
            state: { status: 'running', input: { command: 'ls' }, time: { start: 1 } },
          },
        },
      });

      expect(normalized.resolvedEventType).toBe('processing_status');
      expect(normalized.payload['kind']).toBe('tool.progress');
      expect(normalized.payload['toolName']).toBe('bash');
    });

    it('maps message.part.updated tool (completed) to tool_use blocks', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'message.part.updated',
        rawEvent: {
          sessionID: 'oc-session-1',
          part: {
            type: 'tool',
            tool: 'bash',
            callID: 'call-2',
            sessionID: 'oc-session-1',
            state: {
              status: 'completed',
              input: { command: 'ls' },
              output: 'a.txt\nb.txt',
              time: { start: 1, end: 2 },
            },
          },
        },
      });

      expect(normalized.resolvedEventType).toBe('tool_use');
      const tools = normalized.payload['all_tool_use_blocks'] as Array<Record<string, unknown>>;
      expect(tools[0]?.['tool_name']).toBe('bash');
      const results = normalized.payload['all_tool_result_blocks'] as Array<
        Record<string, unknown>
      >;
      expect(results[0]?.['is_error']).toBe(false);
      expect(results[0]?.['content_text']).toBe('a.txt\nb.txt');
    });

    it('maps permission.asked into permission_request canonical event', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'permission.asked',
        rawEvent: {
          id: 'perm-1',
          permission: 'bash',
          patterns: ['ls *'],
          metadata: { reason: 'directory listing' },
        },
      });

      expect(normalized.diagnostics.canonicalEventType).toBe('permission_request');
      expect(normalized.resolvedEventType).toBe('permission_request_detected');
      const canonical = normalized.payload['canonical_event'] as Record<string, unknown>;
      expect(canonical['permission_request']).toMatchObject({
        id: 'perm-1',
        permission_type: 'bash',
      });
      expect(normalized.payload['tool_name']).toBe('bash');
    });

    it('marks session.status idle as terminal', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.status',
        rawEvent: {
          sessionID: 'oc-session-1',
          status: { type: 'idle' },
        },
      });

      expect(normalized.isTerminal).toBe(true);
      expect(normalized.resolvedEventType).toBe('session_status');
    });

    it('carries the retry reason, attempt and next-attempt time through session.status retry', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.status',
        rawEvent: {
          sessionID: 'oc-session-1',
          status: {
            type: 'retry',
            attempt: 2,
            message: 'Usage limit reached',
            next: 1_760_000_000_000,
            action: {
              reason: 'usage_limit',
              provider: 'anthropic',
              title: 'Limit reached',
              message: 'Resets at 5pm',
              label: 'Upgrade',
              link: 'https://example.test/upgrade',
            },
          },
        },
      });

      expect(normalized.isTerminal).toBeUndefined();
      expect(normalized.resolvedEventType).toBe('processing_status');
      expect(normalized.retry).toEqual({
        attempt: 2,
        message: 'Usage limit reached',
        nextAttemptAt: '2025-10-09T08:53:20.000Z',
        action: {
          provider: 'anthropic',
          title: 'Limit reached',
          message: 'Resets at 5pm',
          label: 'Upgrade',
          link: 'https://example.test/upgrade',
        },
      });
      expect(normalized.payload['status']).toBe('retry');
      expect(normalized.diagnostics.errors).toEqual([]);
    });

    it('reports a malformed session.status retry instead of inventing retry details', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.status',
        rawEvent: { sessionID: 'oc-session-1', status: { type: 'retry', attempt: 1 } },
      });

      expect(normalized.retry).toBeUndefined();
      expect(normalized.diagnostics.schemaMismatch).toBe(true);
    });

    it('maps session.error to a provider failure carrying the provider message', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.error',
        rawEvent: {
          sessionID: 'oc-session-1',
          error: { name: 'APIError', data: { message: 'rate limited', statusCode: 429 } },
        },
      });

      expect(normalized.resolvedEventType).toBe('error');
      expect(normalized.providerFailure).toEqual({ name: 'APIError', message: 'rate limited' });
    });

    it('names the error class when session.error carries no message', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.error',
        rawEvent: {
          sessionID: 'oc-session-1',
          error: { name: 'MessageOutputLengthError', data: {} },
        },
      });

      expect(normalized.providerFailure).toEqual({
        name: 'MessageOutputLengthError',
        message: 'MessageOutputLengthError',
      });
    });

    it('maps session.diff into diff canonical event', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.diff',
        rawEvent: {
          sessionID: 'oc-session-1',
          diff: [
            { file: 'src/a.ts', patch: '@@\n-old\n+new', additions: 1, deletions: 1 },
            { file: 'src/b.ts', patch: '@@\n+added', additions: 1, deletions: 0 },
          ],
        },
      });

      expect(normalized.diagnostics.canonicalEventType).toBe('diff');
      expect(normalized.resolvedEventType).toBe('file_diff_detected');
      const canonical = normalized.payload['canonical_event'] as Record<string, unknown>;
      const diff = canonical['diff'] as Record<string, unknown>;
      expect(diff['files']).toEqual(['src/a.ts', 'src/b.ts']);
      expect(diff['delivery_mode']).toBe('batch');
    });

    it('maps session.error to status with error message', () => {
      const normalized = normalizeProviderEventPayload({
        ...baseInput,
        eventType: 'session.error',
        rawEvent: {
          sessionID: 'oc-session-1',
          error: { name: 'BoomError', data: { message: 'something broke' } },
        },
      });

      expect(normalized.resolvedEventType).toBe('error');
      const canonical = normalized.payload['canonical_event'] as Record<string, unknown>;
      const status = canonical['status'] as Record<string, unknown>;
      expect(status['state']).toBe('error');
      expect(status['message']).toBe('something broke');
    });
  });
});
