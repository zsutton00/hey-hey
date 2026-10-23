import { toDurableJsonValue } from '../../../run-store/durable-events';

import {
  buildNormalizedProviderFacts,
  buildRoutingIdentifiers,
  isRecord,
  loadProviderEventNormalizationConfig,
  narrationFromMapping,
  permissionFingerprint,
  readTrimmedString,
  truncateUtf8ToBytes,
  validateCanonical,
  type NormalizeProviderEventInput,
  type NormalizeProviderEventResult,
  type NormalizedCanonicalEventType,
  type ProviderCommandOutputFact,
  type ProviderFailure,
  type ProviderRetryState,
  type ProviderToolProgressFact,
} from '../provider-event-normalization-core';

export interface ProviderMappingResult {
  canonicalEventType: NormalizedCanonicalEventType;
  resolvedEventType: string;
  payloadExtras?: Record<string, unknown>;
  permissionRequest?: Record<string, unknown>;
  diff?: Record<string, unknown>;
  status?: Record<string, unknown>;
  errors?: string[];
  isTerminal?: boolean;
  retry?: ProviderRetryState;
  providerFailure?: ProviderFailure;
  assistantText?: { kind: 'text' | 'reasoning'; text: string; isFinal: boolean };
  assistantTextDelta?: string;
  commandOutput?: ProviderCommandOutputFact;
  toolProgress?: ProviderToolProgressFact;
}

const mapOpencodeMessagePart = (
  rawEvent: Record<string, unknown>,
  eventTimestamp: string,
): ProviderMappingResult => {
  const part = isRecord(rawEvent['part']) ? rawEvent['part'] : null;
  if (!part) {
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'message.part.updated',
      status: { state: 'unknown', phase: null, code: null, message: null },
      errors: ['message.part.updated missing part'],
    };
  }

  const partType = readTrimmedString(part['type']);

  if (partType === 'text') {
    const text = readTrimmedString(part['text']) ?? '';
    const time = isRecord(part['time']) ? part['time'] : null;
    const isFinal = typeof time?.['end'] === 'number';
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'agent_output_delta',
      status: { state: 'assistant', phase: null, code: null, message: text },
      ...(text.length > 0 ? { assistantText: { kind: 'text', text, isFinal } } : {}),
    };
  }

  if (partType === 'reasoning') {
    const text = readTrimmedString(part['text']) ?? '';
    const time = isRecord(part['time']) ? part['time'] : null;
    const isFinal = typeof time?.['end'] === 'number';
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'agent_output_delta',
      status: { state: 'reasoning', phase: null, code: null, message: text },
      ...(text.length > 0 && isFinal
        ? { assistantText: { kind: 'reasoning', text, isFinal: true } }
        : {}),
    };
  }

  if (partType === 'tool') {
    const toolName = readTrimmedString(part['tool']) ?? 'unknown_tool';
    const callId = readTrimmedString(part['callID']) ?? `opencode_tool_${eventTimestamp}`;
    const state = isRecord(part['state']) ? part['state'] : null;
    const status = readTrimmedString(state?.['status']) ?? 'pending';
    const input = isRecord(state?.['input']) ? state['input'] : {};

    if (status === 'completed' || status === 'error') {
      const output = readTrimmedString(state?.['output']);
      const errorText = readTrimmedString(state?.['error']);
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'tool_use',
        payloadExtras: {
          all_tool_use_blocks: [{ id: callId, tool_name: toolName, input }],
          all_tool_result_blocks: [
            {
              tool_use_id: callId,
              is_error: status === 'error',
              content_text:
                status === 'error' ? (errorText ?? 'Tool execution failed') : (output ?? ''),
              content_raw: state?.['output'] ?? state?.['error'] ?? null,
            },
          ],
        },
        status: { state: status, phase: 'completed', code: null, message: toolName },
      };
    }

    const progressCallId = readTrimmedString(part['callID']);
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'processing_status',
      payloadExtras: {
        kind: 'tool.progress',
        loadingText: `Using tool: ${toolName}`,
        toolName,
        toolPhase: status,
      },
      status: { state: status, phase: 'progress', code: null, message: toolName },
      ...(progressCallId
        ? {
            toolProgress: {
              toolUseId: progressCallId,
              toolName,
              input: toDurableJsonValue(input) ?? {},
            },
          }
        : {}),
    };
  }

  return {
    canonicalEventType: 'status',
    resolvedEventType: 'message.part.updated',
    status: { state: partType ?? 'unknown', phase: null, code: null, message: null },
  };
};

const mapOpencodeMessagePartDelta = (rawEvent: Record<string, unknown>): ProviderMappingResult => {
  const field = readTrimmedString(rawEvent['field']);
  const delta = readTrimmedString(rawEvent['delta']) ?? '';

  if (field === 'text' && delta.length > 0) {
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'agent_output_delta',
      status: { state: 'assistant', phase: null, code: null, message: delta },
      assistantTextDelta: delta,
    };
  }

  return {
    canonicalEventType: 'status',
    resolvedEventType: 'agent_output_delta',
    status: { state: field ?? 'unknown', phase: null, code: null, message: delta },
  };
};

const mapOpencodePermissionAsked = (
  rawEvent: Record<string, unknown>,
  eventTimestamp: string,
  eventSessionId: string | null,
): ProviderMappingResult => {
  const requestId = readTrimmedString(rawEvent['id']);
  const permissionType = readTrimmedString(rawEvent['permission']);
  const patterns = Array.isArray(rawEvent['patterns'])
    ? rawEvent['patterns'].filter((p): p is string => typeof p === 'string')
    : [];
  const metadata = isRecord(rawEvent['metadata']) ? rawEvent['metadata'] : {};
  const tool = isRecord(rawEvent['tool'])
    ? {
        messageID: rawEvent['tool']['messageID'],
        callID: rawEvent['tool']['callID'],
      }
    : null;

  const errors: string[] = [];
  if (!requestId) errors.push('permission.asked missing id');
  if (!permissionType) errors.push('permission.asked missing permission');

  const reason = `${permissionType ?? 'permission'}: ${patterns.join(', ')}`;
  const rawForCallback = {
    type: 'permission_asked',
    requestId,
    permission: permissionType,
    patterns,
    metadata,
    tool,
  };
  const exactAction =
    requestId && permissionType
      ? {
          action: permissionType,
          target: patterns.join('\n') || permissionType,
          fingerprint: permissionFingerprint({
            provider: 'opencode',
            providerActionId: requestId,
            permissionType,
            patterns,
            tool,
          }),
          created_at: eventTimestamp,
          expires_at: null,
        }
      : null;

  return {
    canonicalEventType: 'permission_request',
    resolvedEventType: 'permission_request_detected',
    permissionRequest: {
      id: requestId,
      permission_type: permissionType,
      ...(exactAction ?? {}),
      metadata,
    },
    payloadExtras: {
      enrichment_metadata: {
        reason,
        agent_intent: null,
        referenced_files: [],
        referenced_diffs: [],
      },
      permission_request: {
        id: requestId,
        permission_type: permissionType ?? 'command_execution',
        session_id: eventSessionId,
        agent_id: 'opencode',
        agent_type: 'opencode',
        timestamp: eventTimestamp,
        idempotency_token: requestId,
        ...(exactAction ?? {}),
        raw_event: rawForCallback,
      },
      tool_name: permissionType,
      tool_input: metadata,
      raw_event: rawForCallback,
    },
    ...(errors.length > 0 ? { errors } : {}),
  };
};

const parseOpencodeRetryStatus = (
  status: Record<string, unknown>,
): { retry: ProviderRetryState } | { error: string } => {
  const attempt = status['attempt'];
  const next = status['next'];
  const message = readTrimmedString(status['message']);
  if (typeof attempt !== 'number' || typeof next !== 'number' || !Number.isFinite(next)) {
    return { error: 'session.status retry must include numeric attempt and next' };
  }
  if (!message) return { error: 'session.status retry must include a message' };

  const rawAction = isRecord(status['action']) ? status['action'] : null;
  const action = rawAction
    ? {
        provider: readTrimmedString(rawAction['provider']) ?? '',
        title: readTrimmedString(rawAction['title']) ?? '',
        message: readTrimmedString(rawAction['message']) ?? '',
        label: readTrimmedString(rawAction['label']) ?? '',
        link: readTrimmedString(rawAction['link']),
      }
    : null;
  return { retry: { attempt, message, nextAttemptAt: new Date(next).toISOString(), action } };
};

const mapOpencodeSessionStatus = (rawEvent: Record<string, unknown>): ProviderMappingResult => {
  const status = isRecord(rawEvent['status']) ? rawEvent['status'] : null;
  const statusType = readTrimmedString(status?.['type']);

  if (statusType === 'idle') {
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'session_status',
      status: { state: 'idle', phase: null, code: null, message: null },
      isTerminal: true,
    };
  }

  if (statusType === 'retry' && status) {
    const parsed = parseOpencodeRetryStatus(status);
    if ('error' in parsed) {
      return {
        canonicalEventType: 'status',
        resolvedEventType: 'processing_status',
        payloadExtras: { kind: 'run.status', status: 'retry' },
        status: { state: 'retry', phase: null, code: null, message: null },
        errors: [parsed.error],
      };
    }
    const { retry } = parsed;
    return {
      canonicalEventType: 'status',
      resolvedEventType: 'processing_status',
      payloadExtras: {
        kind: 'run.status',
        status: 'retry',
        retry: {
          attempt: retry.attempt,
          message: retry.message,
          next_attempt_at: retry.nextAttemptAt,
          action: retry.action,
        },
      },
      status: { state: 'retry', phase: null, code: null, message: retry.message },
      retry,
    };
  }

  return {
    canonicalEventType: 'status',
    resolvedEventType: 'processing_status',
    payloadExtras: {
      kind: 'run.status',
      status: statusType ?? 'unknown',
    },
    status: { state: statusType ?? 'unknown', phase: null, code: null, message: null },
  };
};

const mapOpencodeSessionError = (rawEvent: Record<string, unknown>): ProviderMappingResult => {
  // OpenCode named errors are `{ name, data: { message } }`.
  const error = isRecord(rawEvent['error']) ? rawEvent['error'] : null;
  const data = isRecord(error?.['data']) ? error['data'] : null;
  const name = readTrimmedString(error?.['name']);
  const message = readTrimmedString(data?.['message']) ?? name ?? 'Unknown OpenCode session error';
  return {
    canonicalEventType: 'status',
    resolvedEventType: 'error',
    status: { state: 'error', phase: null, code: name, message },
    providerFailure: { name, message },
  };
};

const mapOpencodeSessionDiff = (
  rawEvent: Record<string, unknown>,
  maxDiffBlobBytes: number,
): ProviderMappingResult => {
  const list = Array.isArray(rawEvent['diff']) ? rawEvent['diff'] : [];
  const files: string[] = [];
  const patches: string[] = [];
  for (const entry of list) {
    if (isRecord(entry)) {
      const file = readTrimmedString(entry['file']);
      if (file) files.push(file);
      const patch = readTrimmedString(entry['patch']);
      if (patch) patches.push(file ? `--- ${file}\n${patch}` : patch);
    }
  }

  const rawBlob = patches.length > 0 ? patches.join('\n\n') : null;
  let emittedBlob: string | null = rawBlob;
  let originalBytes: number | null = null;
  let emittedBytes: number | null = null;
  let truncated = false;
  let overflow = false;
  if (rawBlob) {
    originalBytes = Buffer.byteLength(rawBlob, 'utf8');
    if (originalBytes > maxDiffBlobBytes) {
      emittedBlob = truncateUtf8ToBytes(rawBlob, maxDiffBlobBytes);
      emittedBytes = Buffer.byteLength(emittedBlob, 'utf8');
      truncated = true;
      overflow = true;
    } else {
      emittedBytes = originalBytes;
    }
  }

  const errors: string[] = [];
  if (files.length === 0 && !emittedBlob) {
    errors.push('session.diff event must include files or patch');
  }

  const deliveryMode: 'incremental' | 'batch' = files.length > 1 ? 'batch' : 'incremental';

  return {
    canonicalEventType: 'diff',
    resolvedEventType: 'file_diff_detected',
    diff: {
      files,
      diff_blob: emittedBlob,
      patches: list.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const file = readTrimmedString(entry['file']);
        const patch = readTrimmedString(entry['patch']);
        return file && patch ? [{ path: file, diff: patch }] : [];
      }),
      attribution_authority: 'diagnostic',
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
    },
    // Surface files/diff_blob at the payload top level for
    // src/run/normalize.ts (extractFilesFromFlatDiff).
    payloadExtras: {
      files,
      diff_blob: emittedBlob,
    },
    ...(errors.length > 0 ? { errors } : {}),
  };
};

export const normalizeOpencodeEvent = (
  input: NormalizeProviderEventInput,
): NormalizeProviderEventResult => {
  const startedAt = Date.now();
  const config = input.config ?? loadProviderEventNormalizationConfig();
  const eventType = input.eventType;
  const props = input.rawEvent;

  let mapping: ProviderMappingResult;
  switch (eventType) {
    case 'server.connected':
    case 'server.heartbeat': {
      mapping = {
        canonicalEventType: 'status',
        resolvedEventType: 'processing_status',
        payloadExtras: { kind: 'run.status', status: eventType },
        status: { state: eventType, phase: null, code: null, message: null },
      };
      break;
    }
    case 'message.part.updated': {
      mapping = mapOpencodeMessagePart(props, input.timestamp);
      break;
    }
    case 'message.part.delta': {
      mapping = mapOpencodeMessagePartDelta(props);
      break;
    }
    case 'permission.asked': {
      mapping = mapOpencodePermissionAsked(props, input.timestamp, input.sessionId);
      break;
    }
    case 'session.status': {
      mapping = mapOpencodeSessionStatus(props);
      break;
    }
    case 'session.error': {
      mapping = mapOpencodeSessionError(props);
      break;
    }
    case 'session.diff': {
      mapping = mapOpencodeSessionDiff(props, config.maxDiffBlobBytes);
      break;
    }
    default: {
      mapping = {
        canonicalEventType: 'unknown',
        resolvedEventType: eventType,
        errors: [`unrecognized opencode event type: ${eventType}`],
      };
    }
  }

  const validation = validateCanonical({
    eventType: mapping.canonicalEventType,
    validationMode: config.validationMode,
    permissionRequest: mapping.permissionRequest ?? null,
    diff: mapping.diff ?? null,
    status: mapping.status ?? null,
    diffErrors: mapping.errors ?? [],
  });

  const routing = buildRoutingIdentifiers(input);
  const latencyMs = Date.now() - startedAt;

  const canonicalEvent: Record<string, unknown> = {
    schema_version: 1,
    canonical_event_type: mapping.canonicalEventType,
    provider: 'opencode',
    event_type: eventType,
    timestamp: input.timestamp,
    session_id: input.sessionId,
    agent_id: input.agentId,
    routing,
    ...(mapping.permissionRequest ? { permission_request: mapping.permissionRequest } : {}),
    ...(mapping.diff ? { diff: mapping.diff } : {}),
    ...(mapping.status ? { status: mapping.status } : {}),
  };

  const payload: Record<string, unknown> = {
    messageType: 'provider_event',
    provider: 'opencode',
    eventType,
    timestamp: input.timestamp,
    session_id: input.sessionId,
    agent_id: input.agentId,
    routing,
    canonical_event_type: mapping.canonicalEventType,
    canonical_event: canonicalEvent,
    provider_metadata: { extra_fields: {} },
    raw_event: props,
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
    normalizeInput: input,
    payload,
    activity: {
      narration: narrationFromMapping(mapping),
      toolProgress: mapping.toolProgress ?? null,
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
    ...(mapping.retry ? { retry: mapping.retry } : {}),
    ...(mapping.providerFailure ? { providerFailure: mapping.providerFailure } : {}),
    ...(mapping.assistantText ? { assistantText: mapping.assistantText } : {}),
    ...(mapping.assistantTextDelta ? { assistantTextDelta: mapping.assistantTextDelta } : {}),
  };
};
