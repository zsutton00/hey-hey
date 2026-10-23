import { describe, expect, it } from 'vitest';
import { normalizeEvent } from '../normalize';
import { handlePermission } from './permission';
import { makePoster, makeDeps, makeTestRun } from './__test-utils';
import type { LocalAgentOutputEvent, PermissionEvent, DiffEvent, PendingDiff } from '../types';

/** Minimal permission payload that lacks fields for structured parsing — hits fallback path. */
const makeRawPermissionMinimal = (files: string[]): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'local',
  eventType: 'permission_request_detected',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    enrichment_metadata: {
      referenced_files: files,
    },
    permission_request: {
      id: 'perm-1',
      permission_type: 'workspace_write',
    },
  },
});

/** Full permission payload with all fields for structured AgentRequestPermission parsing. */
const makeRawPermissionFull = (files: string[]): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'local',
  eventType: 'permission_request_detected',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    enrichment_metadata: {
      referenced_files: files,
      reason: 'Permission requested for tool: workspace_write',
    },
    permission_request: {
      id: 'perm-1',
      permission_type: 'workspace_write',
      session_id: 'session-1',
      agent_id: 'claude',
      agent_type: 'claude',
      timestamp: '2025-01-01T00:00:00.000Z',
      idempotency_token: 'perm-1',
      run_id: 'run-1',
    },
  },
});

/** Full permission payload embedded in an assistant agent_output summary. */
const makeAssistantPermissionSummary = (): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'agent_output',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    messageType: 'assistant',
    summary: JSON.stringify({
      responseType: 'agent_request_permission_v1',
      permission_request: {
        id: 'perm-2',
        permission_type: 'mcp__heyhey-platform__search_features',
        session_id: 'session-1',
        agent_id: 'agent-1',
        agent_type: 'claude',
        timestamp: '2025-01-01T00:00:00.000Z',
        idempotency_token: 'perm-2',
        run_id: 'run-1',
        raw_event: {
          toolName: 'mcp__heyhey-platform__search_features',
          toolInput: { query: '', initiativeId: '044374ca', limit: 20 },
        },
      },
      enrichment_metadata: {
        reason: 'Permission requested for tool: mcp__heyhey-platform__search_features',
        referenced_files: [],
      },
    }),
  },
});

describe('permission end-to-end', () => {
  it('normalizes to PermissionEvent with files', () => {
    const event = normalizeEvent(makeRawPermissionMinimal(['src/auth.ts']), 'claude');
    expect(event.kind).toBe('permission');
    expect((event as PermissionEvent).files).toEqual(['src/auth.ts']);
  });

  it('appends a structured permission message with AgentRequestPermission UI element', async () => {
    const event = normalizeEvent(
      makeRawPermissionFull(['src/auth.ts']),
      'claude',
    ) as PermissionEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    await handlePermission(event, ctx, deps);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(ctx.recordPermissionRequestMessage).toHaveBeenCalledWith(
      'perm-1',
      'oob-msg-1',
      expect.objectContaining({ type: 'QUESTIONS' }),
    );
    expect(poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        stamp: null,
        dto: expect.objectContaining({
          type: 'SYSTEM',
          data: expect.objectContaining({
            type: 'QUESTIONS',
            title: 'Permission Request',
            detectedIntent: 'permission_request',
            uiElements: expect.arrayContaining([
              expect.objectContaining({
                type: 'agent-request-permission',
                label: 'Permission Request',
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it('delegates Task Monitor-owned projection without creating the generic permission UI', async () => {
    const event = normalizeEvent(
      makeRawPermissionFull(['src/auth.ts']),
      'claude',
    ) as PermissionEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun({
      taskMonitorId: '10000000-0000-4000-8000-000000000001',
    });

    await handlePermission(event, ctx, deps);

    expect(poster.createOutOfBand).not.toHaveBeenCalled();
    expect(ctx.pendingDiffs.size).toBe(0);
    expect(deps.logger.info).toHaveBeenCalledWith(
      'local.handler.permission.task_monitor_projection_delegated',
      expect.objectContaining({
        runId: 'run-1',
        taskMonitorId: '10000000-0000-4000-8000-000000000001',
        providerActionId: 'perm-1',
      }),
    );
  });

  it('falls back to plain text when payload lacks required fields', async () => {
    const event = normalizeEvent(
      makeRawPermissionMinimal(['src/auth.ts']),
      'claude',
    ) as PermissionEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    await handlePermission(event, ctx, deps);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        stamp: null,
        dto: expect.objectContaining({
          type: 'SYSTEM',
          data: expect.objectContaining({
            type: 'AGENT',
            actionHint: 'permission_requested',
            detectedIntent: 'permission_request',
          }),
        }),
      }),
    );
  });

  it('merges matching pending diff into the message', async () => {
    const event = normalizeEvent(
      makeRawPermissionFull(['src/auth.ts']),
      'claude',
    ) as PermissionEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);

    const pendingDiff: DiffEvent = {
      runId: 'run-1',
      source: 'provider',
      eventType: 'file_diff_message',
      timestamp: '2025-01-01T00:00:00.000Z',
      sessionId: null,
      agentId: null,
      payload: { diffContent: '--- a/src/auth.ts\n+++ b/src/auth.ts' },
      kind: 'diff',
      files: ['src/auth.ts'],
      awaitingPermission: true,
      diffBlob: '--- a/src/auth.ts\n+++ b/src/auth.ts',
      authority: 'provisional',
      providerThreadId: null,
      providerTurnId: null,
      toolUses: [],
      patches: [],
    };
    const pendingDiffs = new Map<string, PendingDiff>([
      ['src/auth.ts', { event: pendingDiff, files: ['src/auth.ts'] }],
    ]);
    const ctx = makeTestRun({ pendingDiffs });

    await handlePermission(event, ctx, deps);

    expect(ctx.pendingDiffs.size).toBe(0);
    const call = (poster.createOutOfBand as ReturnType<typeof import('vitest').vi.fn>).mock
      .calls[0]![0];
    const response = call.dto.data.response as string;
    // Diff should NOT be in the response text
    expect(response).not.toContain('Diff:');
    // Diff should be in the UI element payload
    const uiPayload = call.dto.data.uiElements[0].payload as Record<string, unknown>;
    expect(uiPayload).toHaveProperty('diffBlob', '--- a/src/auth.ts\n+++ b/src/auth.ts');
  });

  it('merges a Codex fileChange diff by itemId when the approval payload has no files', async () => {
    const event = {
      ...(normalizeEvent(makeRawPermissionFull([]), 'claude') as PermissionEvent),
      itemId: 'item-1',
    };
    const poster = makePoster();
    const deps = makeDeps(poster);

    const pendingDiff: DiffEvent = {
      runId: 'run-1',
      source: 'provider',
      eventType: 'file_diff_message',
      timestamp: '2025-01-01T00:00:00.000Z',
      sessionId: null,
      agentId: null,
      payload: { diffContent: '--- a/src/auth.ts\n+++ b/src/auth.ts' },
      kind: 'diff',
      files: ['src/auth.ts'],
      itemId: 'item-1',
      awaitingPermission: false,
      diffBlob: '--- a/src/auth.ts\n+++ b/src/auth.ts',
      authority: 'diagnostic',
      providerThreadId: null,
      providerTurnId: null,
      toolUses: [],
      patches: [],
    };
    const pendingDiffs = new Map<string, PendingDiff>([
      ['item:item-1', { event: pendingDiff, files: ['src/auth.ts'], itemId: 'item-1' }],
    ]);
    const ctx = makeTestRun({ pendingDiffs });

    await handlePermission(event, ctx, deps);

    expect(ctx.pendingDiffs.size).toBe(0);
    const call = (poster.createOutOfBand as ReturnType<typeof import('vitest').vi.fn>).mock
      .calls[0]![0];
    const response = call.dto.data.response as string;
    expect(response).toContain('Referenced files: src/auth.ts');
    const uiPayload = call.dto.data.uiElements[0].payload as Record<string, unknown>;
    expect(uiPayload).toHaveProperty('diffBlob', '--- a/src/auth.ts\n+++ b/src/auth.ts');
    expect((uiPayload['permissionRequest'] as Record<string, unknown>)['referencedFiles']).toEqual([
      'src/auth.ts',
    ]);
  });

  it('normalizes assistant agent_output with permission summary as PermissionEvent', () => {
    const raw = makeAssistantPermissionSummary();
    const event = normalizeEvent(raw, 'claude');
    expect(event.kind).toBe('permission');
    expect(event.payload).toHaveProperty('permission_request');
    expect((event.payload as Record<string, unknown>)['permission_request']).toMatchObject({
      id: 'perm-2',
      permission_type: 'mcp__heyhey-platform__search_features',
    });
  });

  it('handles permission from assistant summary with structured UI element', async () => {
    const raw = makeAssistantPermissionSummary();
    const event = normalizeEvent(raw, 'claude') as PermissionEvent;
    const poster = makePoster();
    const deps = makeDeps(poster);
    const ctx = makeTestRun();

    await handlePermission(event, ctx, deps);

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(poster.createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        stamp: null,
        dto: expect.objectContaining({
          data: expect.objectContaining({
            type: 'QUESTIONS',
            title: 'Permission Request',
            detectedIntent: 'permission_request',
            uiElements: expect.arrayContaining([
              expect.objectContaining({
                type: 'agent-request-permission',
                payload: expect.objectContaining({
                  responseType: 'agent_request_permission_v1',
                  permissionRequest: expect.objectContaining({
                    id: 'perm-2',
                    permissionType: 'mcp__heyhey-platform__search_features',
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
