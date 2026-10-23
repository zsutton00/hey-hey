import { describe, expect, it } from 'vitest';
import {
  type CliReadResponseDto,
  type ContextData,
} from '../shared/agent-bridge-contract/generated/api';
import { guardCliReadResponse, MAX_CLI_READ_ACK_BYTES } from './cli-read-response-size-guard';
import { projectLatestTurnToolCalls } from './latest-turn-tool-calls';

const requestId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const agentSessionId = '33333333-3333-4333-8333-333333333333';
const conversationId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-08-29T00:00:00.000Z';

const makeInventoryResponse = (filePath: string): CliReadResponseDto =>
  ({
    requestId,
    operation: 'run.changed_files.inventory',
    status: 'success',
    result: {
      runId,
      entries: [
        {
          serviceId: 'service-id',
          repoPath: '/tmp/repository',
          filePath,
          status: 'modify',
        },
      ],
    },
  }) satisfies CliReadResponseDto;

const makeContextData = (model: string): ContextData =>
  ({
    categories: [],
    totalTokens: 0,
    maxTokens: 0,
    rawMaxTokens: 0,
    percentage: 0,
    gridRows: [],
    model,
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: false,
    apiUsage: null,
  }) satisfies ContextData;

const makeOversizedResponses = (content: string): readonly CliReadResponseDto[] => [
  {
    requestId,
    operation: 'project.session_costs.list',
    status: 'success',
    result: {
      items: [
        {
          agentSessionId,
          conversationId,
          context: {
            entityType: 'TASK',
            entityId: 'task-id',
            entityTitle: content,
            promptType: 'prompt',
          },
          providerSessions: [],
          knownCostUsd: null,
          completeness: 'complete',
          latestActivityAt: timestamp,
          costReadAt: timestamp,
        },
      ],
      nextCursor: null,
      sourceAvailability: 'available',
      costReadAt: timestamp,
    },
  } satisfies CliReadResponseDto,
  {
    requestId,
    operation: 'run.changed_files.count',
    status: 'success',
    result: { runId: content, changedFilesCount: 1 },
  } satisfies CliReadResponseDto,
  {
    requestId,
    operation: 'run.changed_files.detail',
    status: 'success',
    result: {
      runId,
      file: {
        serviceId: 'service-id',
        repoPath: '/tmp/repository',
        filePath: 'src/example.ts',
        status: 'modify',
        diff: content,
        preContent: null,
        postContent: null,
      },
    },
  } satisfies CliReadResponseDto,
  makeInventoryResponse(content),
  {
    requestId,
    operation: 'run.context_usage.get',
    status: 'success',
    result: {
      runId,
      providerSessionId: 'provider-session-id',
      contextData: makeContextData(content),
      cost: { state: 'unavailable', reason: 'cost_source_unavailable' },
    },
  } satisfies CliReadResponseDto,
];

describe('guardCliReadResponse', () => {
  it('never replaces the largest tool-call response the projection can produce', () => {
    const heavy = '"\\\n'.repeat(5_400);
    const entries = Array.from({ length: 400 }, (_, index) => ({
      kind: 'tool' as const,
      entryId: `1:${String(index)}`,
      seq: index,
      lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
      turnId: 'turn-1',
      providerTurnId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      toolUseId: `tool-${String(index)}`,
      toolName: 'Bash',
      input: { text: heavy, truncatedBytes: 0 },
      status: 'completed' as const,
      output: { text: heavy, truncatedBytes: 0 },
      result: { text: heavy, truncatedBytes: 0 },
      exitCode: null,
    }));
    const response = {
      requestId,
      operation: 'run.tool_calls.latest_turn',
      status: 'success',
      result: projectLatestTurnToolCalls({
        runId,
        activeTurnId: null,
        activity: { runId, runInstanceId: 1, entries, gap: { evictedCount: 0, throughSeq: null } },
      }),
    } satisfies CliReadResponseDto;

    const guarded = guardCliReadResponse(response);

    expect(guarded.replaced).toBe(false);
    expect(guarded.response).toBe(response);
  });

  it('accepts a response whose complete serialized envelope is exactly in budget', () => {
    const baseResponse = makeInventoryResponse('');
    const baseBytes = Buffer.byteLength(JSON.stringify(baseResponse), 'utf8');
    const response = makeInventoryResponse('x'.repeat(MAX_CLI_READ_ACK_BYTES - baseBytes));

    expect(Buffer.byteLength(JSON.stringify(response), 'utf8')).toBe(MAX_CLI_READ_ACK_BYTES);
    expect(guardCliReadResponse(response)).toEqual({
      response,
      serializedBytes: MAX_CLI_READ_ACK_BYTES,
      replaced: false,
    });
  });

  it('replaces a response one serialized byte above the budget', () => {
    const baseResponse = makeInventoryResponse('');
    const baseBytes = Buffer.byteLength(JSON.stringify(baseResponse), 'utf8');
    const response = makeInventoryResponse('x'.repeat(MAX_CLI_READ_ACK_BYTES - baseBytes + 1));

    const guarded = guardCliReadResponse(response);

    expect(guarded.serializedBytes).toBe(MAX_CLI_READ_ACK_BYTES + 1);
    expect(guarded.replaced).toBe(true);
    expect(guarded.response).toEqual({
      requestId,
      operation: 'run.changed_files.inventory',
      status: 'error',
      error: {
        code: 'RESULT_TOO_LARGE',
        message: 'The CLI read response exceeds the WebSocket acknowledgement size limit.',
      },
    });
  });

  it('measures multibyte UTF-8 content as encoded bytes', () => {
    const response = makeInventoryResponse('é'.repeat(Math.ceil(MAX_CLI_READ_ACK_BYTES / 2)));
    const jsonStringLength = JSON.stringify(response).length;
    const guarded = guardCliReadResponse(response);

    expect(guarded.serializedBytes).toBe(Buffer.byteLength(JSON.stringify(response), 'utf8'));
    expect(guarded.serializedBytes).toBeGreaterThan(jsonStringLength);
    expect(jsonStringLength).toBeLessThan(MAX_CLI_READ_ACK_BYTES);
    expect(guarded.replaced).toBe(true);
  });

  it.each(makeOversizedResponses('x'.repeat(MAX_CLI_READ_ACK_BYTES)))(
    'returns an operation-matched typed RESULT_TOO_LARGE response for %s',
    (response) => {
      const guarded = guardCliReadResponse(response);

      expect(guarded.replaced).toBe(true);
      expect(guarded.response).toEqual({
        requestId,
        operation: response.operation,
        status: 'error',
        error: {
          code: 'RESULT_TOO_LARGE',
          message: 'The CLI read response exceeds the WebSocket acknowledgement size limit.',
        },
      });
      expect(guarded.response).not.toHaveProperty('result');
      expect(Buffer.byteLength(JSON.stringify(guarded.response), 'utf8')).toBeLessThanOrEqual(
        MAX_CLI_READ_ACK_BYTES,
      );
    },
  );
});
