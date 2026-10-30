import { z } from 'zod';
import type { TokenUsage } from '../../../session/types';
import {
  EDIT_TOOL_NAMES,
  SINGLE_EDIT_TOOL_NAMES,
  WRITE_TOOL_NAMES,
  buildNormalizedProviderFacts,
  buildRoutingIdentifiers,
  extractDiffFiles,
  hasAnyKey,
  isRecord,
  loadProviderEventNormalizationConfig,
  omitKeys,
  readFirstBoolean,
  readFirstRecord,
  readFirstString,
  readTrimmedString,
  truncateUtf8ToBytes,
  validateCanonical,
  type NormalizedCanonicalEventType,
  type NormalizeProviderEventInput,
  type NormalizeProviderEventResult,
  type ProviderNarrationFact,
} from '../provider-event-normalization-core';
import { normalizeOpencodeEvent } from '../opencode/opencode-event-normalization';

const tokenCount = z.number().int().nonnegative().nullable().catch(null);
const resultUsageSchema = z.object({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  cache_read_input_tokens: tokenCount,
  cache_creation_input_tokens: tokenCount,
});

function claudeResultUsage(raw: unknown): TokenUsage {
  const parsed = resultUsageSchema.safeParse(raw);
  const usage = parsed.success ? parsed.data : resultUsageSchema.parse({});
  const cacheReadInputTokens = usage.cache_read_input_tokens;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheAvailability:
      cacheReadInputTokens !== null && cacheCreationInputTokens !== null
        ? 'reported'
        : cacheReadInputTokens !== null || cacheCreationInputTokens !== null
          ? 'partial'
          : 'unsupported',
  };
}

const FILE_MODIFYING_TOOL_NAMES = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'write',
  'edit',
  'write_file',
  'edit_file',
]);

interface ToolUseBlock {
  id: string | null;
  tool_name: string;
  input: Record<string, unknown>;
}

interface FullToolUseBlock extends ToolUseBlock {
  id: string;
}

const extractFileModifyingToolUseBlocks = (rawEvent: Record<string, unknown>): ToolUseBlock[] => {
  const message = rawEvent['message'];
  if (!isRecord(message)) {
    return [];
  }
  const content = message['content'];
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: ToolUseBlock[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block['type'] === 'tool_use' &&
      typeof block['name'] === 'string' &&
      FILE_MODIFYING_TOOL_NAMES.has(block['name']) &&
      isRecord(block['input'])
    ) {
      blocks.push({
        id: typeof block['id'] === 'string' ? block['id'] : null,
        tool_name: block['name'],
        input: block['input'],
      });
    }
  }
  return blocks;
};

const extractAllToolUseBlocks = (rawEvent: Record<string, unknown>): FullToolUseBlock[] => {
  const message = rawEvent['message'];
  if (!isRecord(message)) {
    return [];
  }
  const content = message['content'];
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: FullToolUseBlock[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block['type'] === 'tool_use' &&
      typeof block['name'] === 'string' &&
      typeof block['id'] === 'string'
    ) {
      blocks.push({
        id: block['id'],
        tool_name: block['name'],
        input: isRecord(block['input']) ? block['input'] : {},
      });
    }
  }
  return blocks;
};

interface ToolResultBlock {
  tool_use_id: string;
  is_error: boolean;
  content_text: string | null;
  content_raw: unknown;
}

const extractToolResultText = (content: unknown): string | null => {
  if (typeof content === 'string') {
    return readTrimmedString(content);
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts: string[] = [];
  for (const entry of content) {
    if (typeof entry === 'string') {
      parts.push(entry);
      continue;
    }
    if (isRecord(entry) && typeof entry['text'] === 'string') {
      parts.push(entry['text']);
    }
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : null;
};

const extractAllToolResultBlocks = (rawEvent: Record<string, unknown>): ToolResultBlock[] => {
  const message = rawEvent['message'];
  if (!isRecord(message)) {
    return [];
  }
  const content = message['content'];
  if (!Array.isArray(content)) {
    return [];
  }
  const blocks: ToolResultBlock[] = [];
  for (const block of content) {
    if (
      isRecord(block) &&
      block['type'] === 'tool_result' &&
      typeof block['tool_use_id'] === 'string'
    ) {
      blocks.push({
        tool_use_id: block['tool_use_id'],
        is_error: block['is_error'] === true,
        content_text: extractToolResultText(block['content']),
        content_raw: block['content'] ?? null,
      });
    }
  }
  return blocks;
};
const STATUS_EVENT_TYPES = new Set([
  'status',
  'status_update',
  'assistant',
  'agent_message',
  'agent_reasoning',
  'exec_command_begin',
  'exec_command_end',
  'result',
  'task_complete',
  'turn_aborted',
]);

const determineCanonicalEventType = (
  eventType: string,
  rawEvent: Record<string, unknown>,
): NormalizedCanonicalEventType => {
  if (
    eventType === 'permission_request' ||
    hasAnyKey(rawEvent, [
      'permission_request',
      'permissionRequest',
      'permission_type',
      'permissionType',
    ])
  ) {
    return 'permission_request';
  }

  if (
    eventType.includes('diff') ||
    hasAnyKey(rawEvent, [
      'diff',
      'diff_blob',
      'diffBlob',
      'patch',
      'files',
      'diff_blob_ref',
      'diffBlobRef',
      'blob_ref',
    ])
  ) {
    return 'diff';
  }

  if (extractFileModifyingToolUseBlocks(rawEvent).length > 0) {
    return 'diff';
  }

  if (
    STATUS_EVENT_TYPES.has(eventType) ||
    hasAnyKey(rawEvent, ['status', 'state', 'phase', 'message', 'text', 'summary'])
  ) {
    return 'status';
  }

  return 'unknown';
};

const mapPermissionRequest = (
  rawEvent: Record<string, unknown>,
): {
  value: Record<string, unknown>;
  consumedTopLevelKeys: Set<string>;
} => {
  const requestRecord = readFirstRecord(rawEvent, ['permission_request', 'permissionRequest']);
  const permissionMetadata = readFirstRecord(rawEvent, ['metadata']) ?? {};
  const permissionRequestMetadata =
    (requestRecord ? readFirstRecord(requestRecord, ['metadata']) : null) ?? {};

  const id =
    (requestRecord ? readFirstString(requestRecord, ['id', 'request_id', 'requestId']) : null) ??
    readFirstString(rawEvent, ['permission_request_id', 'permissionRequestId', 'id']);
  const permissionType =
    readFirstString(rawEvent, ['permission_type', 'permissionType']) ??
    (requestRecord
      ? readFirstString(requestRecord, ['permission_type', 'permissionType', 'type'])
      : null);
  const action =
    (requestRecord ? readFirstString(requestRecord, ['action']) : null) ??
    readFirstString(rawEvent, ['action']);
  const target =
    (requestRecord ? readFirstString(requestRecord, ['target']) : null) ??
    readFirstString(rawEvent, ['target']);
  const fingerprint =
    (requestRecord ? readFirstString(requestRecord, ['fingerprint']) : null) ??
    readFirstString(rawEvent, ['fingerprint']);
  const createdAt =
    (requestRecord ? readFirstString(requestRecord, ['created_at', 'createdAt']) : null) ??
    readFirstString(rawEvent, ['created_at', 'createdAt']);
  const expiresAt =
    (requestRecord ? readFirstString(requestRecord, ['expires_at', 'expiresAt']) : null) ??
    readFirstString(rawEvent, ['expires_at', 'expiresAt']);

  const consumedTopLevelKeys = new Set<string>([
    'permission_request',
    'permissionRequest',
    'permission_request_id',
    'permissionRequestId',
    'permission_type',
    'permissionType',
    'action',
    'target',
    'fingerprint',
    'created_at',
    'createdAt',
    'expires_at',
    'expiresAt',
    'metadata',
    'id',
  ]);

  const requestExtraFields = requestRecord
    ? omitKeys(
        requestRecord,
        new Set([
          'id',
          'request_id',
          'requestId',
          'permission_type',
          'permissionType',
          'type',
          'metadata',
          'action',
          'target',
          'fingerprint',
          'created_at',
          'createdAt',
          'expires_at',
          'expiresAt',
        ]),
      )
    : {};

  return {
    value: {
      id,
      permission_type: permissionType,
      ...(action ? { action } : {}),
      ...(target ? { target } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      ...(createdAt ? { created_at: createdAt } : {}),
      ...(expiresAt ? { expires_at: expiresAt } : {}),
      metadata: {
        ...permissionRequestMetadata,
        ...permissionMetadata,
      },
      ...(Object.keys(requestExtraFields).length > 0
        ? { request_extra_fields: requestExtraFields }
        : {}),
    },
    consumedTopLevelKeys,
  };
};

const mapDiffEvent = (
  eventType: string,
  rawEvent: Record<string, unknown>,
  maxDiffBlobBytes: number,
): {
  value: Record<string, unknown>;
  consumedTopLevelKeys: Set<string>;
  errors: string[];
} => {
  const files = extractDiffFiles(rawEvent);
  const diffBlob = readFirstString(rawEvent, ['diff_blob', 'diffBlob', 'diff', 'patch', 'content']);
  const blobRef = readFirstString(rawEvent, [
    'diff_blob_ref',
    'diffBlobRef',
    'blob_ref',
    'blobRef',
    'artifact_id',
    'artifactId',
  ]);

  const incrementalFlag = readFirstBoolean(rawEvent, [
    'incremental',
    'is_incremental',
    'isIncremental',
    'delta',
    'is_delta',
    'isDelta',
  ]);
  const batchFlag = readFirstBoolean(rawEvent, ['batch', 'is_batch', 'isBatch']);

  let deliveryMode: 'incremental' | 'batch' | 'unknown' = 'unknown';
  if (
    incrementalFlag === true ||
    eventType.includes('delta') ||
    eventType.includes('incremental')
  ) {
    deliveryMode = 'incremental';
  } else if (batchFlag === true || files.length > 1 || eventType === 'diff') {
    deliveryMode = 'batch';
  }

  let emittedDiffBlob: string | null = diffBlob;
  let originalSizeBytes: number | null = null;
  let emittedSizeBytes: number | null = null;
  let truncated = false;
  let overflow = false;

  if (diffBlob) {
    originalSizeBytes = Buffer.byteLength(diffBlob, 'utf8');
    if (originalSizeBytes > maxDiffBlobBytes) {
      emittedDiffBlob = truncateUtf8ToBytes(diffBlob, maxDiffBlobBytes);
      emittedSizeBytes = Buffer.byteLength(emittedDiffBlob, 'utf8');
      truncated = true;
      overflow = true;
    } else {
      emittedSizeBytes = originalSizeBytes;
    }
  }

  const consumedTopLevelKeys = new Set<string>([
    'diff_blob',
    'diffBlob',
    'diff',
    'patch',
    'content',
    'files',
    'file',
    'file_path',
    'filepath',
    'path',
    'diff_blob_ref',
    'diffBlobRef',
    'blob_ref',
    'blobRef',
    'artifact_id',
    'artifactId',
    'incremental',
    'is_incremental',
    'isIncremental',
    'delta',
    'is_delta',
    'isDelta',
    'batch',
    'is_batch',
    'isBatch',
  ]);

  const errors: string[] = [];
  if (files.length === 0 && !emittedDiffBlob && !blobRef) {
    errors.push('diff event must include files, diff_blob, or blob reference metadata');
  }
  if (deliveryMode === 'unknown') {
    errors.push('diff event delivery mode could not be resolved to incremental or batch');
  }

  return {
    value: {
      files,
      diff_blob: emittedDiffBlob,
      delivery_mode: deliveryMode,
      delivery_mode_flags: {
        is_incremental: deliveryMode === 'incremental',
        is_batch: deliveryMode === 'batch',
      },
      truncation: {
        truncated,
        overflow,
        original_size_bytes: originalSizeBytes,
        emitted_size_bytes: emittedSizeBytes,
        max_size_bytes: maxDiffBlobBytes,
      },
      ...(blobRef ? { blob_ref: blobRef } : {}),
    },
    consumedTopLevelKeys,
    errors,
  };
};

const mapToolUseDiffEvent = (
  rawEvent: Record<string, unknown>,
  maxDiffBlobBytes: number,
): {
  value: Record<string, unknown>;
  consumedTopLevelKeys: Set<string>;
  errors: string[];
} => {
  const blocks = extractFileModifyingToolUseBlocks(rawEvent);

  const files: string[] = [];
  const blobParts: string[] = [];

  for (const block of blocks) {
    const filePath = readTrimmedString(block.input['file_path']);
    if (filePath) {
      files.push(filePath);
    }

    if (WRITE_TOOL_NAMES.has(block.tool_name)) {
      const content = readTrimmedString(block.input['content']);
      if (content) {
        blobParts.push(filePath ? `--- ${filePath}\n${content}` : content);
      }
    } else if (EDIT_TOOL_NAMES.has(block.tool_name)) {
      const rawOld = block.input['old_string'];
      const oldString = typeof rawOld === 'string' ? rawOld : null;
      const rawNew = block.input['new_string'];
      const newString = typeof rawNew === 'string' ? rawNew : null;
      if (oldString !== null || newString !== null) {
        const header = filePath ? `--- ${filePath}\n` : '';
        const before = oldString ? `- ${oldString}` : '';
        const after = newString !== null ? `+ ${newString}` : '';
        blobParts.push(`${header}${before}\n${after}`);
      }
    }
  }

  const rawDiffBlob = blobParts.length > 0 ? blobParts.join('\n\n') : null;
  const deliveryMode: 'incremental' | 'batch' = files.length > 1 ? 'batch' : 'incremental';

  let emittedDiffBlob: string | null = rawDiffBlob;
  let originalSizeBytes: number | null = null;
  let emittedSizeBytes: number | null = null;
  let truncated = false;
  let overflow = false;

  if (rawDiffBlob) {
    originalSizeBytes = Buffer.byteLength(rawDiffBlob, 'utf8');
    if (originalSizeBytes > maxDiffBlobBytes) {
      emittedDiffBlob = truncateUtf8ToBytes(rawDiffBlob, maxDiffBlobBytes);
      emittedSizeBytes = Buffer.byteLength(emittedDiffBlob, 'utf8');
      truncated = true;
      overflow = true;
    } else {
      emittedSizeBytes = originalSizeBytes;
    }
  }

  const toolUseBlocksOutput = blocks.map((b) => ({
    ...(b.id ? { id: b.id } : {}),
    tool_name: b.tool_name,
    input: b.input,
  }));

  // Preserve a single Edit tool's structured input alongside its normalized
  // diff metadata for downstream consumers that need the original fields.
  const firstBlock = blocks[0];
  const singleEditBlock =
    blocks.length === 1 && firstBlock && SINGLE_EDIT_TOOL_NAMES.has(firstBlock.tool_name)
      ? firstBlock
      : null;

  const consumedTopLevelKeys = new Set<string>(['message']);

  const errors: string[] = [];
  if (files.length === 0 && !emittedDiffBlob) {
    errors.push('tool_use diff event must include file_path or content');
  }

  return {
    value: {
      files,
      diff_blob: emittedDiffBlob,
      delivery_mode: deliveryMode,
      delivery_mode_flags: {
        is_incremental: deliveryMode === 'incremental',
        is_batch: deliveryMode === 'batch',
      },
      truncation: {
        truncated,
        overflow,
        original_size_bytes: originalSizeBytes,
        emitted_size_bytes: emittedSizeBytes,
        max_size_bytes: maxDiffBlobBytes,
      },
      tool_use_blocks: toolUseBlocksOutput,
      attribution_authority: 'provisional',
      ...(singleEditBlock ? { toolInput: singleEditBlock.input } : {}),
    },
    consumedTopLevelKeys,
    errors,
  };
};

const mapStatusEvent = (
  eventType: string,
  rawEvent: Record<string, unknown>,
): {
  value: Record<string, unknown>;
  consumedTopLevelKeys: Set<string>;
} => {
  const stateFromType: Record<string, string> = {
    task_complete: 'complete',
    turn_aborted: 'aborted',
    result: 'result',
    assistant: 'assistant',
    agent_message: 'assistant',
    status_update: 'status_update',
  };

  const state = readFirstString(rawEvent, ['state', 'status']) ?? stateFromType[eventType] ?? null;
  const phase = readFirstString(rawEvent, ['phase', 'stage']);
  const code = readFirstString(rawEvent, ['code', 'status_code', 'statusCode']);
  const message = readFirstString(rawEvent, ['message', 'text', 'summary', 'error', 'output']);

  return {
    value: {
      state,
      phase,
      code,
      message,
    },
    consumedTopLevelKeys: new Set([
      'state',
      'status',
      'phase',
      'stage',
      'code',
      'status_code',
      'statusCode',
      'message',
      'text',
      'summary',
      'error',
      'output',
    ]),
  };
};

/** Claude delivers each assistant message whole; thinking blocks are excluded. */
const claudeNarration = (input: NormalizeProviderEventInput): ProviderNarrationFact | null => {
  if (input.provider !== 'claude' || input.rawEvent['type'] !== 'assistant') return null;
  const message = input.rawEvent['message'];
  if (!isRecord(message) || !Array.isArray(message['content'])) return null;
  const text = message['content']
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string',
    )
    .map((block) => block.text)
    .join('');
  return text.length > 0 ? { delivery: 'message', text, isFinal: true } : null;
};

export const normalizeProviderEventPayload = (
  input: NormalizeProviderEventInput,
): NormalizeProviderEventResult => {
  if (input.provider === 'opencode') {
    return normalizeOpencodeEvent(input);
  }

  const startedAt = Date.now();
  const config = input.config ?? loadProviderEventNormalizationConfig();

  const canonicalEventType = determineCanonicalEventType(input.eventType, input.rawEvent);
  let permissionRequest: Record<string, unknown> | null = null;
  let diff: Record<string, unknown> | null = null;
  let status: Record<string, unknown> | null = null;
  let consumedTopLevelKeys = new Set<string>([
    'type',
    'timestamp',
    'ts',
    'session_id',
    'sessionId',
    'agent_id',
    'agentId',
    'conversation_id',
    'conversationId',
    'thread_id',
    'threadId',
  ]);
  let diffErrors: string[] = [];

  if (canonicalEventType === 'permission_request') {
    const mapped = mapPermissionRequest(input.rawEvent);
    permissionRequest = mapped.value;
    consumedTopLevelKeys = new Set([...consumedTopLevelKeys, ...mapped.consumedTopLevelKeys]);
  } else if (canonicalEventType === 'diff') {
    const hasExplicitDiffKeys = hasAnyKey(input.rawEvent, [
      'diff',
      'diff_blob',
      'diffBlob',
      'patch',
      'files',
      'diff_blob_ref',
      'diffBlobRef',
      'blob_ref',
    ]);
    const toolUseBlocks = extractFileModifyingToolUseBlocks(input.rawEvent);
    if (toolUseBlocks.length > 0 && !hasExplicitDiffKeys) {
      const mapped = mapToolUseDiffEvent(input.rawEvent, config.maxDiffBlobBytes);
      diff = mapped.value;
      diffErrors = mapped.errors;
      consumedTopLevelKeys = new Set([...consumedTopLevelKeys, ...mapped.consumedTopLevelKeys]);
    } else {
      const mapped = mapDiffEvent(input.eventType, input.rawEvent, config.maxDiffBlobBytes);
      diff = mapped.value;
      diffErrors = mapped.errors;
      consumedTopLevelKeys = new Set([...consumedTopLevelKeys, ...mapped.consumedTopLevelKeys]);
    }
  } else if (canonicalEventType === 'status') {
    const mapped = mapStatusEvent(input.eventType, input.rawEvent);
    status = mapped.value;
    consumedTopLevelKeys = new Set([...consumedTopLevelKeys, ...mapped.consumedTopLevelKeys]);
  }

  const validation = validateCanonical({
    eventType: canonicalEventType,
    validationMode: config.validationMode,
    permissionRequest,
    diff,
    status,
    diffErrors,
  });

  const allToolUseBlocks = config.trackTools ? extractAllToolUseBlocks(input.rawEvent) : [];
  const allToolResultBlocks = extractAllToolResultBlocks(input.rawEvent);

  const routing = buildRoutingIdentifiers(input);
  const providerExtraFields = omitKeys(input.rawEvent, consumedTopLevelKeys);
  const latencyMs = Date.now() - startedAt;

  const canonicalEvent: Record<string, unknown> = {
    schema_version: 1,
    canonical_event_type: canonicalEventType,
    provider: input.provider,
    event_type: input.eventType,
    timestamp: input.timestamp,
    session_id: input.sessionId,
    agent_id: input.agentId,
    routing,
    ...(permissionRequest ? { permission_request: permissionRequest } : {}),
    ...(diff ? { diff } : {}),
    ...(status ? { status } : {}),
  };

  const payload: Record<string, unknown> = {
    messageType: 'provider_event',
    provider: input.provider,
    eventType: input.eventType,
    timestamp: input.timestamp,
    session_id: input.sessionId,
    agent_id: input.agentId,
    routing,
    canonical_event_type: canonicalEventType,
    canonical_event: canonicalEvent,
    provider_metadata: {
      extra_fields: providerExtraFields,
    },
    raw_event: input.rawEvent,
    ...(allToolUseBlocks.length > 0 ? { all_tool_use_blocks: allToolUseBlocks } : {}),
    ...(allToolResultBlocks.length > 0 ? { all_tool_result_blocks: allToolResultBlocks } : {}),
    normalization: {
      validation_mode: config.validationMode,
      success: validation.success,
      schema_mismatch: validation.schemaMismatch,
      errors: validation.errors,
      latency_ms: latencyMs,
    },
  };
  const facts = buildNormalizedProviderFacts({
    normalizeInput: input,
    payload,
    activity: { narration: claudeNarration(input) },
  });
  payload['normalized_facts'] = facts;

  return {
    payload,
    facts,
    ...(input.eventType === 'result'
      ? { tokenUsage: claudeResultUsage(input.rawEvent['usage']) }
      : {}),
    diagnostics: {
      validationMode: config.validationMode,
      canonicalEventType,
      success: validation.success,
      schemaMismatch: validation.schemaMismatch,
      errors: validation.errors,
      latencyMs,
    },
  };
};
