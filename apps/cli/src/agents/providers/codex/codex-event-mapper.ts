import { createHash } from 'node:crypto';

import {
  buildRoutingIdentifiers,
  buildNormalizedProviderFacts,
  loadProviderEventNormalizationConfig,
  narrationFromMapping,
  truncateUtf8ToBytes,
  validateCanonical,
  type NormalizeProviderEventInput,
  type NormalizeProviderEventResult,
  type ProviderMappingResult,
} from '../provider-event-normalization';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// thread/started nests session id at rawEvent.thread.sessionId.
// All other notifications carry threadId/turnId at the top level but no session id.
const readCodexSessionId = (
  eventType: string,
  rawEvent: Record<string, unknown>,
): string | null => {
  if (eventType === 'thread/started') {
    const thread = isRecord(rawEvent['thread']) ? rawEvent['thread'] : null;
    return thread ? readTrimmedString(thread['sessionId']) : null;
  }
  return null;
};

// thread/started nests thread id at rawEvent.thread.id.
// All other notifications expose threadId at the top level.
const readCodexThreadId = (eventType: string, rawEvent: Record<string, unknown>): string | null => {
  if (eventType === 'thread/started') {
    const thread = isRecord(rawEvent['thread']) ? rawEvent['thread'] : null;
    return thread ? readTrimmedString(thread['id']) : null;
  }
  return readTrimmedString(rawEvent['threadId']);
};

// turn/started and turn/completed nest turn id at rawEvent.turn.id.
// All other notifications expose turnId at the top level.
const readCodexTurnId = (rawEvent: Record<string, unknown>): string | null => {
  const direct = readTrimmedString(rawEvent['turnId']);
  if (direct) return direct;
  const turn = isRecord(rawEvent['turn']) ? rawEvent['turn'] : null;
  return turn ? readTrimmedString(turn['id']) : null;
};

// item/started and item/completed nest item id at rawEvent.item.id.
// item/agentMessage/delta exposes itemId at the top level.
const readCodexItemId = (rawEvent: Record<string, unknown>): string | null => {
  const direct = readTrimmedString(rawEvent['itemId']);
  if (direct) return direct;
  const item = isRecord(rawEvent['item']) ? rawEvent['item'] : null;
  return item ? readTrimmedString(item['id']) : null;
};

const readStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
};

const EXACT_ACTION_TTL_MS = 5 * 60 * 1000;

interface CodexExactActionFacts {
  readonly action: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly created_at: string;
  readonly expires_at: string;
}

const stableJsonValue = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJsonValue).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const exactActionFacts = (input: {
  requestId: string | null;
  sessionId: string | null;
  timestamp: string;
  action: string;
  target: string | null;
  params: Record<string, unknown>;
}): CodexExactActionFacts | null => {
  if (!input.requestId || !input.sessionId || !input.target) return null;
  const createdAtMs = Date.parse(input.timestamp);
  if (!Number.isFinite(createdAtMs)) return null;
  const fingerprintPayload = stableJsonValue({
    provider: 'codex',
    providerActionId: input.requestId,
    providerSessionId: input.sessionId,
    action: input.action,
    target: input.target,
    params: input.params,
  });
  return {
    action: input.action,
    target: input.target,
    fingerprint: `sha256:${createHash('sha256').update(fingerprintPayload).digest('hex')}`,
    created_at: input.timestamp,
    expires_at: new Date(createdAtMs + EXACT_ACTION_TTL_MS).toISOString(),
  };
};

const commandTarget = (value: unknown): string | null => {
  const direct = readTrimmedString(value);
  if (direct) return direct;
  const argv = readStringArray(value)
    .map((part) => part.trim())
    .filter(Boolean);
  return argv.length > 0 ? argv.join(' ') : null;
};

const fileChangeTarget = (params: Record<string, unknown>): string | null => {
  const changes = isRecord(params['fileChanges'])
    ? params['fileChanges']
    : isRecord(params['changes'])
      ? params['changes']
      : null;
  const changedPaths = changes ? Object.keys(changes).sort() : [];
  if (changedPaths.length > 0) return changedPaths.join(', ');
  return readTrimmedString(params['itemId']) ?? readTrimmedString(params['grantRoot']);
};

const permissionGrantTarget = (params: Record<string, unknown>): string | null => {
  const cwd = readTrimmedString(params['cwd']);
  const permissions = isRecord(params['permissions']) ? params['permissions'] : null;
  if (cwd && permissions) return `${cwd} ${stableJsonValue(permissions)}`;
  return cwd ?? (permissions ? stableJsonValue(permissions) : null);
};

const MCP_ELICITATION_APPROVAL_KIND_KEY = 'codex_approval_kind';
const MCP_ELICITATION_APPROVAL_KIND_TOOL_CALL = 'mcp_tool_call';
const MCP_ELICITATION_TOOL_NAME_KEY = 'tool_name';
const MCP_ELICITATION_TOOL_PARAMS_KEY = 'tool_params';
const MCP_ELICITATION_TOOL_PARAMS_DISPLAY_KEY = 'tool_params_display';

const readMcpElicitationMeta = (
  params: Record<string, unknown>,
): Record<string, unknown> | null => {
  const requestBody = isRecord(params['request']) ? params['request'] : params;
  if (isRecord(requestBody['_meta'])) {
    return requestBody['_meta'];
  }
  if (isRecord(requestBody['meta'])) {
    return requestBody['meta'];
  }
  if (requestBody !== params && isRecord(params['_meta'])) {
    return params['_meta'];
  }
  if (requestBody !== params && isRecord(params['meta'])) {
    return params['meta'];
  }
  return null;
};

const readMcpElicitationBody = (params: Record<string, unknown>): Record<string, unknown> =>
  isRecord(params['request']) ? params['request'] : params;

const parseMcpElicitationMessage = (
  message: string | null,
): { serverName: string | null; toolName: string | null } => {
  if (!message) {
    return { serverName: null, toolName: null };
  }
  const match = /^Allow the (.+?) MCP server to run tool ["'](.+?)["']\??$/u.exec(message.trim());
  return {
    serverName: match?.[1] ?? null,
    toolName: match?.[2] ?? null,
  };
};

const qualifyMcpToolName = (serverName: string | null, toolName: string | null): string | null => {
  if (!toolName) {
    return null;
  }
  return serverName ? `mcp__${serverName}__${toolName}` : toolName;
};

// Unified-diff file headers: `--- a/path`, `+++ b/path`, or `diff --git a/x b/y`.
// Deduplicate while preserving first-seen order so the files list is stable.
const extractFilesFromUnifiedDiff = (blob: string): string[] => {
  const seen = new Set<string>();
  const files: string[] = [];
  const stripPrefix = (path: string): string =>
    path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path;
  for (const rawLine of blob.split('\n')) {
    const line = rawLine.trimEnd();
    let candidate: string | null = null;
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      const rest = line.slice(4).trim();
      if (rest && rest !== '/dev/null') {
        candidate = stripPrefix(rest.split('\t')[0] ?? rest);
      }
    } else if (line.startsWith('diff --git ')) {
      const parts = line.slice('diff --git '.length).trim().split(/\s+/);
      const target = parts[1] ?? parts[0];
      if (target) {
        candidate = stripPrefix(target);
      }
    }
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate);
      files.push(candidate);
    }
  }
  return files;
};

const shapeCodexDiffValue = (
  files: string[],
  rawBlob: string | null,
  deliveryMode: 'incremental' | 'batch',
  maxDiffBlobBytes: number,
  attributionAuthority: 'confirmed' | 'diagnostic',
): {
  diff: Record<string, unknown>;
  payloadExtras: { files: string[]; diff_blob: string | null };
  errors: string[];
} => {
  let emittedBlob: string | null = rawBlob && rawBlob.length > 0 ? rawBlob : null;
  let originalBytes: number | null = null;
  let emittedBytes: number | null = null;
  let truncated = false;
  let overflow = false;

  if (emittedBlob) {
    originalBytes = Buffer.byteLength(emittedBlob, 'utf8');
    if (originalBytes > maxDiffBlobBytes) {
      emittedBlob = truncateUtf8ToBytes(emittedBlob, maxDiffBlobBytes);
      emittedBytes = Buffer.byteLength(emittedBlob, 'utf8');
      truncated = true;
      overflow = true;
    } else {
      emittedBytes = originalBytes;
    }
  }

  const errors: string[] = [];
  if (files.length === 0 && !emittedBlob) {
    errors.push('codex diff event must include files or unified_diff');
  }

  return {
    diff: {
      files,
      diff_blob: emittedBlob,
      delivery_mode: deliveryMode,
      delivery_mode_flags: {
        is_incremental: deliveryMode === 'incremental',
        is_batch: deliveryMode === 'batch',
      },
      truncation: {
        truncated,
        overflow,
        original_size_bytes: originalBytes,
        emitted_size_bytes: emittedBytes,
        max_size_bytes: maxDiffBlobBytes,
      },
      attribution_authority: attributionAuthority,
    },
    // Mirror files/diff_blob at the payload top level for the flat-payload
    // consumer in src/run/normalize.ts (extractFilesFromFlatDiff).
    payloadExtras: { files, diff_blob: emittedBlob },
    errors,
  };
};

const buildCommandToolUseBlock = (
  item: Record<string, unknown>,
  itemId: string,
): { id: string; tool_name: string; input: Record<string, unknown> } => {
  const command = item['command'];
  const cwd = readTrimmedString(item['cwd']);
  return {
    id: itemId,
    tool_name: 'shell',
    input: {
      ...(typeof command === 'string' ? { command } : Array.isArray(command) ? { command } : {}),
      ...(cwd ? { cwd } : {}),
    },
  };
};

const buildMcpToolUseBlock = (
  item: Record<string, unknown>,
  itemId: string,
): { id: string; tool_name: string; input: Record<string, unknown> } => {
  const server = readTrimmedString(item['server']);
  const tool = readTrimmedString(item['tool']);
  const args = item['arguments'];
  const toolName = server && tool ? `${server}/${tool}` : (tool ?? server ?? 'mcp_tool');
  return {
    id: itemId,
    tool_name: toolName,
    input: typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {},
  };
};

const dispatchCodexEvent = (
  eventType: string,
  rawEvent: Record<string, unknown>,
  maxDiffBlobBytes: number,
  sessionId: string | null,
  timestamp: string,
): ProviderMappingResult => {
  switch (eventType) {
    case 'thread/started': {
      // Identity is already extracted into the envelope via readCodexThreadId /
      // readCodexSessionId; this branch only emits the canonical status frame.
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'thread/started',
        status: { state: 'thread_started', phase: null, code: null, message: null },
      };
    }
    case 'turn/started': {
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'turn/started',
        status: { state: 'turn_started', phase: null, code: null, message: null },
      };
    }
    case 'turn/completed': {
      // app-server folds the turn-aborted notification into turn/completed and
      // distinguishes the variants by Turn.status (verified in
      // codex-rs/app-server/src/bespoke_event_handling.rs).
      const turn = isRecord(rawEvent['turn']) ? rawEvent['turn'] : null;
      const turnStatus = turn ? readTrimmedString(turn['status']) : null;
      const state =
        turnStatus === 'interrupted' ? 'aborted' : turnStatus === 'failed' ? 'failed' : 'complete';
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'turn/completed',
        status: { state, phase: null, code: null, message: null },
        isTerminal: true,
      };
    }
    case 'item/agentMessage/delta': {
      const delta = typeof rawEvent['delta'] === 'string' ? (rawEvent['delta'] as string) : '';
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'agent_output_delta',
        status: { state: 'assistant', phase: null, code: null, message: delta || null },
        ...(delta.length > 0 ? { assistantTextDelta: delta } : {}),
      };
    }
    case 'item/plan/delta': {
      const delta = typeof rawEvent['delta'] === 'string' ? (rawEvent['delta'] as string) : '';
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'agent_output_delta',
        status: { state: 'assistant', phase: null, code: null, message: delta || null },
        ...(delta.length > 0 ? { assistantTextDelta: delta } : {}),
      };
    }
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta': {
      const delta = typeof rawEvent['delta'] === 'string' ? (rawEvent['delta'] as string) : '';
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'agent_output_delta',
        status: { state: 'reasoning', phase: null, code: null, message: delta || null },
      };
    }
    case 'item/completed': {
      // ThreadItem is a flat discriminated union — item.type is the
      // discriminant directly (no nested `details`).
      const item = isRecord(rawEvent['item']) ? rawEvent['item'] : null;
      const itemType = item ? readTrimmedString(item['type']) : null;
      if (itemType === 'agentMessage' && item) {
        const text = typeof item['text'] === 'string' ? (item['text'] as string) : '';
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'agent_message',
          status: { state: 'assistant', phase: null, code: null, message: text || null },
          ...(text.length > 0 ? { assistantText: { kind: 'text', text, isFinal: true } } : {}),
        };
      }
      if (itemType === 'plan' && item) {
        let text = '';
        for (const key of ['text', 'plan', 'content']) {
          const value = item[key];
          if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
              text = value;
              break;
            }
          }
          const joined = readStringArray(value).join('\n').trim();
          if (joined.length > 0) {
            text = joined;
            break;
          }
        }
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'agent_message',
          status: { state: 'assistant', phase: null, code: null, message: text || null },
          ...(text.length > 0 ? { assistantText: { kind: 'text', text, isFinal: true } } : {}),
        };
      }
      if (itemType === 'reasoning' && item) {
        const content = readStringArray(item['content']);
        const summary = readStringArray(item['summary']);
        const text = [...content, ...summary].join('\n').trim();
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'reasoning',
          status: { state: 'reasoning', phase: null, code: null, message: text || null },
          ...(text.length > 0 ? { assistantText: { kind: 'reasoning', text, isFinal: true } } : {}),
        };
      }
      if (itemType === 'commandExecution' && item) {
        const itemId = readTrimmedString(item['id']);
        const itemStatus = readTrimmedString(item['status']);
        const exitCodeRaw = item['exitCode'];
        const exitCode = typeof exitCodeRaw === 'number' ? exitCodeRaw : null;
        const aggregated =
          typeof item['aggregatedOutput'] === 'string'
            ? (item['aggregatedOutput'] as string)
            : null;
        const isError = itemStatus === 'failed' || (exitCode !== null && exitCode !== 0);
        if (!itemId) {
          return { canonicalEventType: 'unknown', resolvedEventType: 'item/completed' };
        }
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'tool_use',
          payloadExtras: {
            all_tool_result_blocks: [
              {
                tool_use_id: itemId,
                is_error: isError,
                content_text: aggregated,
                content_raw: aggregated,
              },
            ],
          },
          status: {
            state: isError ? 'failed' : 'completed',
            phase: 'completed',
            code: exitCode !== null ? String(exitCode) : null,
            message: 'shell',
          },
        };
      }
      if (itemType === 'mcpToolCall' && item) {
        const itemId = readTrimmedString(item['id']);
        const itemStatus = readTrimmedString(item['status']);
        const errorText = readTrimmedString(item['error']);
        const resultRaw = item['result'];
        const resultText =
          typeof resultRaw === 'string'
            ? resultRaw
            : resultRaw !== undefined && resultRaw !== null
              ? JSON.stringify(resultRaw)
              : null;
        const isError = itemStatus === 'failed' || errorText !== null;
        const toolName = ((): string => {
          const server = readTrimmedString(item['server']);
          const tool = readTrimmedString(item['tool']);
          if (server && tool) return `${server}/${tool}`;
          return tool ?? server ?? 'mcp_tool';
        })();
        if (!itemId) {
          return { canonicalEventType: 'unknown', resolvedEventType: 'item/completed' };
        }
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'tool_use',
          payloadExtras: {
            all_tool_result_blocks: [
              {
                tool_use_id: itemId,
                is_error: isError,
                content_text: isError ? (errorText ?? resultText) : resultText,
                content_raw: isError ? (errorText ?? resultRaw ?? null) : (resultRaw ?? null),
              },
            ],
          },
          status: {
            state: isError ? 'failed' : 'completed',
            phase: 'completed',
            code: null,
            message: toolName,
          },
        };
      }
      if (itemType === 'fileChange' && item) {
        const itemStatus = readTrimmedString(item['status']);
        const changes = Array.isArray(item['changes']) ? item['changes'] : [];
        const files: string[] = [];
        for (const change of changes) {
          if (isRecord(change)) {
            const path = readTrimmedString(change['path']);
            if (path) files.push(path);
          }
        }
        const shaped = shapeCodexDiffValue(
          files,
          null,
          'incremental',
          maxDiffBlobBytes,
          itemStatus === 'failed' ? 'diagnostic' : 'confirmed',
        );
        return {
          canonicalEventType: 'diff',
          resolvedEventType: 'file_diff_detected',
          diff: shaped.diff,
          payloadExtras: shaped.payloadExtras,
          ...(shaped.errors.length > 0 ? { errors: shaped.errors } : {}),
        };
      }
      // Non-text, non-tool item completions land on the unknown fallback.
      return {
        canonicalEventType: 'unknown',
        resolvedEventType: 'item/completed',
      };
    }
    case 'item/started': {
      const item = isRecord(rawEvent['item']) ? rawEvent['item'] : null;
      const itemType = item ? readTrimmedString(item['type']) : null;
      const itemId = item ? readTrimmedString(item['id']) : null;
      if (!item || !itemId) {
        return { canonicalEventType: 'unknown', resolvedEventType: 'item/started' };
      }
      if (itemType === 'commandExecution') {
        const block = buildCommandToolUseBlock(item, itemId);
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'tool_use',
          payloadExtras: { all_tool_use_blocks: [block] },
          status: {
            state: 'in_progress',
            phase: 'started',
            code: null,
            message: block.tool_name,
          },
        };
      }
      if (itemType === 'mcpToolCall') {
        const block = buildMcpToolUseBlock(item, itemId);
        return {
          canonicalEventType: 'status',
          resolvedEventType: 'tool_use',
          payloadExtras: { all_tool_use_blocks: [block] },
          status: {
            state: 'in_progress',
            phase: 'started',
            code: null,
            message: block.tool_name,
          },
        };
      }
      return { canonicalEventType: 'unknown', resolvedEventType: 'item/started' };
    }
    case 'item/commandExecution/outputDelta': {
      const chunk =
        typeof rawEvent['chunk'] === 'string'
          ? (rawEvent['chunk'] as string)
          : typeof rawEvent['delta'] === 'string'
            ? (rawEvent['delta'] as string)
            : '';
      const stream = readTrimmedString(rawEvent['stream']);
      const commandId = readCodexItemId(rawEvent);
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'processing_status',
        ...(commandId && chunk ? { commandOutput: { commandId, stream, chunk } } : {}),
        payloadExtras: {
          kind: 'tool.progress',
          loadingText: 'Running shell command',
          toolName: 'shell',
          toolPhase: stream ?? 'output',
        },
        status: {
          state: 'in_progress',
          phase: 'progress',
          code: null,
          message: chunk || null,
        },
      };
    }
    case 'turn/diff/updated': {
      const unifiedDiff =
        typeof rawEvent['unified_diff'] === 'string'
          ? (rawEvent['unified_diff'] as string)
          : typeof rawEvent['unifiedDiff'] === 'string'
            ? (rawEvent['unifiedDiff'] as string)
            : typeof rawEvent['diff'] === 'string'
              ? (rawEvent['diff'] as string)
              : '';
      const files = unifiedDiff ? extractFilesFromUnifiedDiff(unifiedDiff) : [];
      const shaped = shapeCodexDiffValue(
        files,
        unifiedDiff.length > 0 ? unifiedDiff : null,
        'batch',
        maxDiffBlobBytes,
        'diagnostic',
      );
      return {
        canonicalEventType: 'diff',
        resolvedEventType: 'file_diff_detected',
        diff: shaped.diff,
        payloadExtras: shaped.payloadExtras,
        ...(shaped.errors.length > 0 ? { errors: shaped.errors } : {}),
      };
    }
    case 'thread/compacted': {
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'thread/compacted',
        status: { state: 'compact_boundary', phase: null, code: null, message: null },
      };
    }
    case 'item/commandExecution/requestApproval': {
      const rawId = rawEvent['id'];
      const requestId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const idStr = requestId !== null ? String(requestId) : null;
      const params = isRecord(rawEvent['params']) ? rawEvent['params'] : {};
      const command = params['command'];
      const cwd = readTrimmedString(params['cwd']);
      const reason = readTrimmedString(params['reason']) ?? 'command_execution';
      const exactAction = exactActionFacts({
        requestId: idStr,
        sessionId,
        timestamp,
        action: 'exec',
        target: commandTarget(command),
        params,
      });
      return {
        canonicalEventType: 'permission_request',
        resolvedEventType: 'permission_request_detected',
        permissionRequest: {
          id: idStr,
          permission_type: 'command_execution',
          ...(exactAction ?? {}),
          metadata: {},
        },
        payloadExtras: {
          enrichment_metadata: {
            reason,
            agent_intent: null,
            referenced_files: [],
            referenced_diffs: [],
          },
          permission_request: {
            id: idStr,
            permission_type: 'command_execution',
            session_id: sessionId,
            agent_id: 'codex',
            agent_type: 'codex',
            timestamp,
            idempotency_token: idStr,
            requestId,
            raw_event: rawEvent,
          },
          ...(command !== null && command !== undefined ? { command } : {}),
          ...(cwd ? { cwd } : {}),
        },
      };
    }
    case 'item/fileChange/requestApproval': {
      const rawId = rawEvent['id'];
      const requestId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const idStr = requestId !== null ? String(requestId) : null;
      const params = isRecord(rawEvent['params']) ? rawEvent['params'] : {};
      const reason = readTrimmedString(params['reason']) ?? 'file_change';
      const exactAction = exactActionFacts({
        requestId: idStr,
        sessionId,
        timestamp,
        action: 'apply_patch',
        target: fileChangeTarget(params),
        params,
      });
      return {
        canonicalEventType: 'permission_request',
        resolvedEventType: 'permission_request_detected',
        permissionRequest: {
          id: idStr,
          permission_type: 'file_change',
          ...(exactAction ?? {}),
          metadata: {},
        },
        payloadExtras: {
          enrichment_metadata: {
            reason,
            agent_intent: null,
            referenced_files: [],
            referenced_diffs: [],
          },
          permission_request: {
            id: idStr,
            permission_type: 'file_change',
            session_id: sessionId,
            agent_id: 'codex',
            agent_type: 'codex',
            timestamp,
            idempotency_token: idStr,
            requestId,
            raw_event: rawEvent,
          },
        },
      };
    }
    case 'item/permissions/requestApproval': {
      const rawId = rawEvent['id'];
      const requestId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const idStr = requestId !== null ? String(requestId) : null;
      const params = isRecord(rawEvent['params']) ? rawEvent['params'] : {};
      const cwd = readTrimmedString(params['cwd']);
      const reason = readTrimmedString(params['reason']) ?? 'command_execution';
      const exactAction = exactActionFacts({
        requestId: idStr,
        sessionId,
        timestamp,
        action: 'grant_permissions',
        target: permissionGrantTarget(params),
        params,
      });
      return {
        canonicalEventType: 'permission_request',
        resolvedEventType: 'permission_request_detected',
        permissionRequest: {
          id: idStr,
          permission_type: 'command_execution',
          ...(exactAction ?? {}),
          metadata: {},
        },
        payloadExtras: {
          enrichment_metadata: {
            reason,
            agent_intent: null,
            referenced_files: [],
            referenced_diffs: [],
          },
          permission_request: {
            id: idStr,
            permission_type: 'command_execution',
            session_id: sessionId,
            agent_id: 'codex',
            agent_type: 'codex',
            timestamp,
            idempotency_token: idStr,
            requestId,
            raw_event: rawEvent,
          },
          ...(cwd ? { cwd } : {}),
        },
      };
    }
    case 'execCommandApproval': {
      const rawId = rawEvent['id'];
      const requestId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const idStr = requestId !== null ? String(requestId) : null;
      const params = isRecord(rawEvent['params']) ? rawEvent['params'] : {};
      const command = Array.isArray(params['command'])
        ? readStringArray(params['command'])
        : readTrimmedString(params['command']) !== null
          ? [readTrimmedString(params['command']) as string]
          : [];
      const cwd = readTrimmedString(params['cwd']);
      const reason = readTrimmedString(params['reason']) ?? 'command_execution';
      const exactAction = exactActionFacts({
        requestId: idStr,
        sessionId,
        timestamp,
        action: 'exec',
        target: commandTarget(params['command']),
        params,
      });
      return {
        canonicalEventType: 'permission_request',
        resolvedEventType: 'permission_request_detected',
        permissionRequest: {
          id: idStr,
          permission_type: 'command_execution',
          ...(exactAction ?? {}),
          metadata: {},
        },
        payloadExtras: {
          enrichment_metadata: {
            reason,
            agent_intent: null,
            referenced_files: [],
            referenced_diffs: [],
          },
          permission_request: {
            id: idStr,
            permission_type: 'command_execution',
            session_id: sessionId,
            agent_id: 'codex',
            agent_type: 'codex',
            timestamp,
            idempotency_token: idStr,
            requestId,
            raw_event: rawEvent,
          },
          command,
          ...(cwd ? { cwd } : {}),
        },
      };
    }
    case 'applyPatchApproval': {
      const rawId = rawEvent['id'];
      const requestId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const idStr = requestId !== null ? String(requestId) : null;
      const params = isRecord(rawEvent['params']) ? rawEvent['params'] : {};
      const fileChanges = isRecord(params['fileChanges']) ? params['fileChanges'] : {};
      const reason = readTrimmedString(params['reason']) ?? 'file_change';
      const exactAction = exactActionFacts({
        requestId: idStr,
        sessionId,
        timestamp,
        action: 'apply_patch',
        target: fileChangeTarget(params),
        params,
      });
      return {
        canonicalEventType: 'permission_request',
        resolvedEventType: 'permission_request_detected',
        permissionRequest: {
          id: idStr,
          permission_type: 'file_change',
          ...(exactAction ?? {}),
          metadata: {},
        },
        payloadExtras: {
          enrichment_metadata: {
            reason,
            agent_intent: null,
            referenced_files: [],
            referenced_diffs: [],
          },
          permission_request: {
            id: idStr,
            permission_type: 'file_change',
            session_id: sessionId,
            agent_id: 'codex',
            agent_type: 'codex',
            timestamp,
            idempotency_token: idStr,
            requestId,
            raw_event: rawEvent,
          },
          changes: fileChanges,
        },
      };
    }
    case 'mcpServer/elicitation/request': {
      const rawId = rawEvent['id'];
      const requestId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      const idStr = requestId !== null ? String(requestId) : null;
      const params = isRecord(rawEvent['params']) ? rawEvent['params'] : {};
      const body = readMcpElicitationBody(params);
      const meta = readMcpElicitationMeta(params);
      const message = readTrimmedString(body['message']) ?? readTrimmedString(params['message']);
      const parsedMessage = parseMcpElicitationMessage(message);
      const serverName =
        readTrimmedString(params['serverName']) ??
        readTrimmedString(params['server_name']) ??
        parsedMessage.serverName;
      const approvalKind = meta ? readTrimmedString(meta[MCP_ELICITATION_APPROVAL_KIND_KEY]) : null;
      const toolName =
        (meta ? readTrimmedString(meta[MCP_ELICITATION_TOOL_NAME_KEY]) : null) ??
        parsedMessage.toolName;
      const qualifiedToolName = qualifyMcpToolName(serverName, toolName);
      const permissionType =
        (approvalKind === MCP_ELICITATION_APPROVAL_KIND_TOOL_CALL || approvalKind === null) &&
        qualifiedToolName
          ? qualifiedToolName
          : 'mcp_elicitation';
      const toolParams =
        meta && isRecord(meta[MCP_ELICITATION_TOOL_PARAMS_KEY])
          ? meta[MCP_ELICITATION_TOOL_PARAMS_KEY]
          : {};
      const toolParamsDisplay =
        meta && Array.isArray(meta[MCP_ELICITATION_TOOL_PARAMS_DISPLAY_KEY])
          ? meta[MCP_ELICITATION_TOOL_PARAMS_DISPLAY_KEY]
          : [];
      const reason =
        message ??
        (qualifiedToolName
          ? `Permission requested for MCP tool: ${qualifiedToolName}`
          : 'Permission requested for MCP elicitation.');
      const exactAction = exactActionFacts({
        requestId: idStr,
        sessionId,
        timestamp,
        action: 'mcp_tool_call',
        target: qualifiedToolName,
        params,
      });

      return {
        canonicalEventType: 'permission_request',
        resolvedEventType: 'permission_request_detected',
        permissionRequest: {
          id: idStr,
          permission_type: permissionType,
          ...(exactAction ?? {}),
          metadata: {},
        },
        payloadExtras: {
          enrichment_metadata: {
            reason,
            agent_intent: null,
            referenced_files: [],
            referenced_diffs: [],
          },
          permission_request: {
            id: idStr,
            permission_type: permissionType,
            session_id: sessionId,
            agent_id: 'codex',
            agent_type: 'codex',
            timestamp,
            idempotency_token: idStr,
            requestId,
            raw_event: rawEvent,
          },
          server_name: serverName,
          tool_name: qualifiedToolName ?? toolName,
          tool_input: toolParams,
          tool_params_display: toolParamsDisplay,
          raw_event: rawEvent,
        },
      };
    }
    case 'error': {
      const errorRecord = isRecord(rawEvent['error']) ? rawEvent['error'] : null;
      const message = errorRecord ? readTrimmedString(errorRecord['message']) : null;
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'error',
        status: { state: 'error', phase: null, code: null, message },
      };
    }
    case 'warning': {
      const message = readTrimmedString(rawEvent['message']);
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'warning',
        status: { state: 'warning', phase: null, code: null, message },
      };
    }
    case 'guardianWarning': {
      const message = readTrimmedString(rawEvent['message']);
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'guardianWarning',
        status: { state: 'warning', phase: null, code: null, message },
      };
    }
    case 'thread/tokenUsage/updated': {
      // Passthrough — semantic context-usage extraction lands in a later step on CodexSdkClient.getContextUsage.
      return {
        canonicalEventType: 'unknown',
        resolvedEventType: 'thread/tokenUsage/updated',
      };
    }
    default: {
      return {
        canonicalEventType: 'unknown',
        resolvedEventType: eventType,
        errors: [`unrecognized codex event type: ${eventType}`],
      };
    }
  }
};

export const mapCodexEvent = (input: NormalizeProviderEventInput): NormalizeProviderEventResult => {
  const startedAt = Date.now();
  const config = input.config ?? loadProviderEventNormalizationConfig();
  const eventType = input.eventType;
  const rawEvent = input.rawEvent;

  const mapping = dispatchCodexEvent(
    eventType,
    rawEvent,
    config.maxDiffBlobBytes,
    input.sessionId,
    input.timestamp,
  );

  // Session id is native only on thread/started (thread.sessionId); all other
  // notifications fall back to the session id the run carries from context.
  const sessionIdFromRaw = readCodexSessionId(eventType, rawEvent);
  const sessionId = sessionIdFromRaw ?? input.sessionId;

  // thread/started nests thread id at thread.id; inject as threadId so
  // buildRoutingIdentifiers picks it up. For all other notifications threadId
  // is already at the top level of params.
  const threadIdFromRaw = readCodexThreadId(eventType, rawEvent);
  const routingRawEvent =
    eventType === 'thread/started' && threadIdFromRaw
      ? { ...rawEvent, threadId: threadIdFromRaw }
      : rawEvent;

  const turnId = readCodexTurnId(rawEvent);
  const itemId = readCodexItemId(rawEvent);

  const baseRouting = buildRoutingIdentifiers({ ...input, sessionId, rawEvent: routingRawEvent });
  const routing: Record<string, unknown> = {
    ...baseRouting,
    ...(turnId ? { turn_id: turnId } : {}),
    ...(itemId ? { item_id: itemId } : {}),
  };

  const validation = validateCanonical({
    eventType: mapping.canonicalEventType,
    validationMode: config.validationMode,
    permissionRequest: mapping.permissionRequest ?? null,
    diff: mapping.diff ?? null,
    status: mapping.status ?? null,
    diffErrors: mapping.errors ?? [],
  });

  const latencyMs = Date.now() - startedAt;

  const canonicalEvent: Record<string, unknown> = {
    schema_version: 1,
    canonical_event_type: mapping.canonicalEventType,
    provider: 'codex',
    event_type: eventType,
    timestamp: input.timestamp,
    session_id: sessionId,
    agent_id: input.agentId,
    routing,
    ...(mapping.permissionRequest ? { permission_request: mapping.permissionRequest } : {}),
    ...(mapping.diff ? { diff: mapping.diff } : {}),
    ...(mapping.status ? { status: mapping.status } : {}),
  };

  const payload: Record<string, unknown> = {
    messageType: 'provider_event',
    provider: 'codex',
    eventType,
    timestamp: input.timestamp,
    session_id: sessionId,
    agent_id: input.agentId,
    routing,
    canonical_event_type: mapping.canonicalEventType,
    canonical_event: canonicalEvent,
    provider_metadata: { extra_fields: {} },
    raw_event: rawEvent,
    ...(mapping.payloadExtras ?? {}),
    normalization: {
      validation_mode: config.validationMode,
      success: validation.success,
      schema_mismatch: validation.schemaMismatch,
      errors: validation.errors,
      latency_ms: latencyMs,
    },
  };
  const facts = buildNormalizedProviderFacts({
    normalizeInput: { ...input, sessionId },
    payload,
    activity: {
      narration: narrationFromMapping(mapping),
      commandOutput: mapping.commandOutput ?? null,
    },
  });
  payload['normalized_facts'] = facts;

  return {
    payload,
    facts,
    diagnostics: {
      validationMode: config.validationMode,
      canonicalEventType: mapping.canonicalEventType,
      success: validation.success,
      schemaMismatch: validation.schemaMismatch,
      errors: validation.errors,
      latencyMs,
    },
    resolvedEventType: mapping.resolvedEventType,
    ...(mapping.isTerminal ? { isTerminal: true } : {}),
    ...(mapping.assistantText ? { assistantText: mapping.assistantText } : {}),
    ...(mapping.assistantTextDelta ? { assistantTextDelta: mapping.assistantTextDelta } : {}),
  };
};
