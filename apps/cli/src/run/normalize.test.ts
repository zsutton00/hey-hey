import { describe, expect, it } from 'vitest';
import { normalizeEvent } from './normalize';
import type { LocalAgentOutputEvent, DiffEvent, PermissionEvent } from './types';

// ---------------------------------------------------------------------------
// Helpers — build events shaped like what the session runner actually emits
// ---------------------------------------------------------------------------

/**
 * Simulate a provider diff event that went through normalizeProviderEventPayload.
 * The session runner sets eventType to 'file_diff_detected' and nests the file
 * paths inside canonical_event.diff.files.
 */
const makeProviderDiffEvent = (files: string[]): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'file_diff_detected',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    messageType: 'provider_event',
    provider: 'claude',
    eventType: 'assistant',
    canonical_event_type: 'diff',
    canonical_event: {
      schema_version: 1,
      canonical_event_type: 'diff',
      routing: {
        item_id: 'item-diff-1',
      },
      diff: {
        files,
        diff_blob: '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new',
        delivery_mode: 'incremental',
        tool_use_blocks: [
          {
            id: 'tool-write-1',
            tool_name: 'Write',
            input: { file_path: files[0], content: 'new content' },
          },
        ],
      },
    },
    raw_event: {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tool-write-1',
            name: 'Write',
            input: { file_path: files[0], content: 'new content' },
          },
        ],
      },
    },
  },
});

/**
 * Simulate a provider diff event with tool_use_blocks (produced by
 * mapToolUseDiffEvent in provider-event-normalization).
 */
const makeProviderToolUseDiffEvent = (filePath: string): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'file_diff_detected',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    messageType: 'provider_event',
    provider: 'claude',
    eventType: 'assistant',
    canonical_event_type: 'diff',
    canonical_event: {
      schema_version: 1,
      canonical_event_type: 'diff',
      diff: {
        files: [filePath],
        diff_blob: `--- ${filePath}\nnew content`,
        delivery_mode: 'incremental',
        tool_use_blocks: [
          {
            id: 'tool-write-1',
            tool_name: 'Write',
            input: { file_path: filePath, content: 'new content' },
          },
        ],
      },
    },
    raw_event: { type: 'assistant' },
  },
});

const makeCodexBatchDiffEvent = (files: string[], diffBlob: string): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'file_diff_detected',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'codex',
  payload: {
    messageType: 'provider_event',
    provider: 'codex',
    eventType: 'turn/diff/updated',
    canonical_event_type: 'diff',
    canonical_event: {
      schema_version: 1,
      canonical_event_type: 'diff',
      diff: {
        files,
        diff_blob: diffBlob,
        delivery_mode: 'batch',
      },
    },
    raw_event: { type: 'turn/diff/updated', unified_diff: diffBlob },
  },
});

/**
 * Simulate a flat/local diff event (legacy path).
 */
const makeFlatDiffEvent = (files: Array<{ path: string }>): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'local',
  eventType: 'file_diff_message',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: null,
  agentId: null,
  payload: { files },
});

/**
 * Simulate a provider permission event with canonical structure.
 */
const makeProviderPermissionEvent = (filePath: string): LocalAgentOutputEvent => ({
  runId: 'run-1',
  source: 'provider',
  eventType: 'permission_request_detected',
  timestamp: '2025-01-01T00:00:00.000Z',
  sessionId: 'session-1',
  agentId: 'claude',
  payload: {
    messageType: 'provider_event',
    provider: 'claude',
    canonical_event_type: 'permission_request',
    routing: {
      item_id: 'item-perm-1',
    },
    canonical_event: {
      permission_request: {
        id: 'perm-1',
        permission_type: 'file_write',
        raw_event: {
          toolInput: { file_path: filePath },
        },
      },
    },
    raw_event: { type: 'user' },
  },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeEvent', () => {
  describe('provider diff events (canonical payload)', () => {
    it('extracts files from canonical_event.diff.files', () => {
      const event = normalizeEvent(
        makeProviderDiffEvent(['/src/auth.ts', '/src/utils.ts']),
        'claude',
      );

      expect(event.kind).toBe('diff');
      const diff = event as DiffEvent;
      expect(diff.files).toEqual(['/src/auth.ts', '/src/utils.ts']);
      expect(diff.awaitingPermission).toBe(true);
      expect(diff.itemId).toBe('item-diff-1');
      expect(diff.authority).toBe('provisional');
    });

    it('extracts files from tool_use_blocks when present', () => {
      const event = normalizeEvent(makeProviderToolUseDiffEvent('/src/new-file.ts'), 'claude');

      expect(event.kind).toBe('diff');
      const diff = event as DiffEvent;
      expect(diff.files).toContain('/src/new-file.ts');
    });

    it('sets awaitingPermission=false for codex', () => {
      const event = normalizeEvent(makeProviderDiffEvent(['/src/auth.ts']), 'codex');

      expect((event as DiffEvent).awaitingPermission).toBe(false);
    });

    it('does not treat Codex batch diff snapshots as touched files', () => {
      const diffBlob = 'diff --git a/src/unrelated.ts b/src/unrelated.ts\n';
      const event = normalizeEvent(
        makeCodexBatchDiffEvent(['src/unrelated.ts'], diffBlob),
        'codex',
      );

      expect(event.kind).toBe('diff');
      const diff = event as DiffEvent;
      expect(diff.files).toEqual([]);
      expect(diff.authority).toBe('diagnostic');
      expect(diff.diffBlob).toBe(diffBlob.trim());
      expect(diff.awaitingPermission).toBe(false);
    });
  });

  describe('flat diff events (local/legacy)', () => {
    it('extracts files from payload.files[].path', () => {
      const event = normalizeEvent(
        makeFlatDiffEvent([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
        'codex',
      );

      expect(event.kind).toBe('diff');
      expect((event as DiffEvent).files).toEqual(['src/a.ts', 'src/b.ts']);
    });
  });

  describe('provider permission events', () => {
    it('extracts files from canonical_event.permission_request', () => {
      const event = normalizeEvent(makeProviderPermissionEvent('/src/auth.ts'), 'claude');

      expect(event.kind).toBe('permission');
      const permission = event as PermissionEvent;
      expect(permission.files).toContain('/src/auth.ts');
      expect(permission.itemId).toBe('item-perm-1');
    });
  });

  describe('lifecycle events', () => {
    it('normalizes run_started', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'local',
          eventType: 'run_started',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: { prompt: 'Fix the bug' },
        },
        'claude',
      );

      expect(event.kind).toBe('run_started');
    });

    it('normalizes run_completed', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'local',
          eventType: 'run_completed',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: { status: 'complete' },
        },
        'claude',
      );

      expect(event.kind).toBe('run_completed');
    });
  });

  describe('agent_output events', () => {
    it('normalizes assistant delta', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'provider',
          eventType: 'agent_output',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: { messageType: 'assistant', summary: 'Working...', taskComplete: false },
        },
        'claude',
      );

      expect(event.kind).toBe('assistant_delta');
    });

    it('normalizes assistant complete', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'provider',
          eventType: 'agent_output',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: { messageType: 'assistant', summary: 'Done.', taskComplete: true },
        },
        'claude',
      );

      expect(event.kind).toBe('assistant_complete');
    });

    it('routes a structured responseType block without taskComplete as a delta', () => {
      // Regression: previously the normalizer promoted any responseType-bearing
      // summary to assistant_complete, which caused a later true-taskComplete
      // event in the same turn to clobber the processing message. Deltas go
      // through the delta handler's own dispatchResponseType path instead.
      const planJson = JSON.stringify({
        responseType: 'startup_plan_v1',
        sessionTitle: 't',
        requiredServiceIds: ['service-tools'],
        primaryImplementations: [
          {
            title: 'Primary implementation',
            content: 'Concrete implementation body.',
            rationale: 'Defines the primary delivered behavior.',
          },
        ],
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      });
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'provider',
          eventType: 'agent_output',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: { messageType: 'assistant', summary: planJson },
        },
        'claude',
      );

      expect(event.kind).toBe('assistant_delta');
    });

    it('normalizes permission_decision_ui events', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'local',
          eventType: 'permission_decision_ui',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: {
            requestId: 'req-1',
            decision: 'approve',
            decidedAt: '2025-01-01T00:00:00.000Z',
          },
        },
        'claude',
      );

      expect(event.kind).toBe('permission_decision_recorded');
    });

    it('detects permission-in-summary and merges payload', () => {
      const permissionJson = JSON.stringify({
        responseType: 'agent_request_permission_v1',
        permission_request: {
          id: 'perm-1',
          permission_type: 'file_write',
          raw_event: { toolInput: { file_path: '/src/auth.ts' } },
        },
      });

      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'provider',
          eventType: 'agent_output',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: { messageType: 'system', summary: permissionJson },
        },
        'claude',
      );

      expect(event.kind).toBe('permission');
      const perm = event as PermissionEvent;
      expect(perm.files).toContain('/src/auth.ts');
      // Payload should have merged permission fields for handler access
      expect(perm.payload['responseType']).toBe('agent_request_permission_v1');
    });
  });

  describe('agent questions', () => {
    const questionPayload = {
      responseType: 'agent_question_v1',
      requestId: 'claude_question_1',
      sessionId: 'session-1',
      agentType: 'claude',
      idempotencyToken: 'claude_question_1',
      questions: [
        {
          question: 'Which colour?',
          header: 'Colour',
          multiSelect: false,
          options: [{ label: 'Teal', description: 'Cool' }],
        },
      ],
      answers: null,
    };
    const makeQuestionEvent = (summary: string): LocalAgentOutputEvent => ({
      runId: 'run-1',
      source: 'provider',
      eventType: 'agent_output',
      timestamp: '2025-01-01T00:00:00.000Z',
      sessionId: 'session-1',
      agentId: null,
      payload: { messageType: 'system', summary },
    });

    it('maps an agent_question_v1 summary to a typed agent_question event, not a permission', () => {
      const event = normalizeEvent(makeQuestionEvent(JSON.stringify(questionPayload)), 'claude');

      expect(event.kind).toBe('agent_question');
      if (event.kind !== 'agent_question') return;
      expect(event.requestId).toBe('claude_question_1');
      expect(event.question.questions).toHaveLength(1);
      expect(event.question.answers).toBeNull();
    });

    it('does not treat a malformed question payload as a question', () => {
      const event = normalizeEvent(
        makeQuestionEvent(JSON.stringify({ ...questionPayload, questions: 'nope' })),
        'claude',
      );

      expect(event.kind).not.toBe('agent_question');
      expect(event.kind).not.toBe('permission');
    });

    it('maps question_answer_ui to a typed question_answered event', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'local',
          eventType: 'question_answer_ui',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: 'session-1',
          agentId: null,
          payload: {
            requestId: 'claude_question_1',
            answers: { 'Which colour?': 'Teal' },
            answeredAt: '2025-01-01T00:01:00.000Z',
          },
        },
        'claude',
      );

      expect(event).toMatchObject({
        kind: 'question_answered',
        requestId: 'claude_question_1',
        answers: { 'Which colour?': 'Teal' },
        answeredAt: '2025-01-01T00:01:00.000Z',
      });
    });

    it('ignores a question_answer_ui event whose answers are not strings', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'local',
          eventType: 'question_answer_ui',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: 'session-1',
          agentId: null,
          payload: {
            requestId: 'claude_question_1',
            answers: { 'Which colour?': 1 },
            answeredAt: '2025-01-01T00:01:00.000Z',
          },
        },
        'claude',
      );

      expect(event.kind).toBe('other');
    });
  });

  describe('unknown events', () => {
    it('returns kind=other for unrecognized events', () => {
      const event = normalizeEvent(
        {
          runId: 'run-1',
          source: 'local',
          eventType: 'something_random',
          timestamp: '2025-01-01T00:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: {},
        },
        'claude',
      );

      expect(event.kind).toBe('other');
    });
  });
});
