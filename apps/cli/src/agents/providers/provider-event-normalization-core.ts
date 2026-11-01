import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TokenUsage } from '../../session/types';

import {
  toDurableJsonValue,
  type DurableCommandLifecycle,
  type DurableDiffFacts,
  type DurableDiffFile,
  type DurablePermissionRequest,
  type DurablePermissionDecision,
  type DurableRoutingFacts,
  type DurableToolResult,
  type DurableToolUseBlock,
} from '../../run-store/durable-events';

const DEFAULT_MAX_DIFF_BLOB_BYTES = 32_768;
const MIN_MAX_DIFF_BLOB_BYTES = 1_024;

export type ProviderEventValidationMode = 'permissive' | 'strict';

export interface ProviderEventNormalizationConfig {
  validationMode: ProviderEventValidationMode;
  maxDiffBlobBytes: number;
  trackTools: boolean;
}

export type NormalizedCanonicalEventType = 'permission_request' | 'diff' | 'status' | 'unknown';

interface ProviderEventNormalizationDiagnostics {
  validationMode: ProviderEventValidationMode;
  canonicalEventType: NormalizedCanonicalEventType;
  success: boolean;
  schemaMismatch: boolean;
  errors: string[];
  latencyMs: number;
}

export interface NormalizeProviderEventInput {
  provider: 'codex' | 'claude' | 'opencode';
  runId: string;
  eventType: string;
  timestamp: string;
  sessionId: string | null;
  agentId: string | null;
  rawEvent: Record<string, unknown>;
  config?: ProviderEventNormalizationConfig;
}

export interface NormalizeProviderEventResult {
  /** Authoritative provider result usage, normalized at the event boundary. */
  tokenUsage?: TokenUsage;
  payload: Record<string, unknown>;
  diagnostics: ProviderEventNormalizationDiagnostics;
  /** Typed projections consumed by admission and live normalization. */
  facts?: NormalizedProviderFacts;
  /**
   * CLI eventType the runner should emit. The opencode branch always
   * resolves this so the runner does not duplicate the canonical→eventType
   * mapping. Claude/Codex callers fall back to `input.eventType` plus the
   * canonical_event_type shim until they migrate.
   */
  resolvedEventType?: string;
  /** Hint for the runner that this event terminates the run. */
  isTerminal?: boolean;
  /** opencode `session.status` retry: the provider is waiting to re-attempt the model request. */
  retry?: ProviderRetryState;
  /** opencode `session.error`: the provider gave up on the turn; the runner must fail it. */
  providerFailure?: ProviderFailure;
  /**
   * For opencode `message.part.updated` text/reasoning parts, the buffered
   * assistant text the runner should accumulate. Other event types omit it.
   */
  assistantText?: { kind: 'text' | 'reasoning'; text: string; isFinal: boolean } | null;
  /**
   * For opencode `message.part.delta` text parts, the incremental chunk the
   * runner should append to the buffered assistant text.
   */
  assistantTextDelta?: string;
}

export interface ProviderRetryState {
  attempt: number;
  message: string;
  /** ISO timestamp of the next attempt. */
  nextAttemptAt: string;
  action: {
    provider: string;
    title: string;
    message: string;
    label: string;
    link: string | null;
  } | null;
}

export interface ProviderFailure {
  /** Provider error class, e.g. `APIError` or `ProviderAuthError`. */
  name: string | null;
  message: string;
}

export interface NormalizedProviderFacts {
  provider: NormalizeProviderEventInput['provider'];
  sessionId: string | null;
  agentId: string | null;
  providerSessionId: string | null;
  providerConversationId: string | null;
  providerSessionAgentId: string | null;
  routing: DurableRoutingFacts;
  identity: {
    providerSessionId: string;
    providerConversationId: string | null;
    providerSessionAgentId: string | null;
    providerThreadId: string | null;
    providerTurnId: string | null;
  } | null;
  commandLifecycle: DurableCommandLifecycle | null;
  toolUses: DurableToolUseBlock[];
  toolResults: DurableToolResult[];
  permissionRequest: DurablePermissionRequest | null;
  permissionDecision: DurablePermissionDecision | null;
  diff: DurableDiffFacts | null;
  canonicalArtifactRef: string | null;
  /** Observed provider activity only; never interpreted as repository coverage. */
  researchActivity: {
    observedTools: string[];
    repositoryRelativePaths: string[];
    delegationObserved: boolean;
  } | null;
  /**
   * The provider's full set of live background tasks (e.g. Claude subagents
   * run in the background through the built-in `Agent` tool), present only on
   * events that report it. Replace semantics: each report is the whole set.
   */
  backgroundTasks: { liveTaskIds: string[] } | null;
  /**
   * Visible assistant narration carried by this event. Reasoning is never
   * projected. `delta` appends to the open narration; `message` replaces it
   * with the provider's full text so far and closes it when `isFinal`.
   */
  narration: ProviderNarrationFact | null;
  /** One streamed chunk of command output, keyed by the provider command id. */
  commandOutput: ProviderCommandOutputFact | null;
  /** An in-flight tool call the provider reports before its result. */
  toolProgress: ProviderToolProgressFact | null;
  /**
   * Provider-native id of the tool call that spawned the subagent producing
   * this event (Claude `parent_tool_use_id`); null for root-agent events.
   */
  parentToolUseId: string | null;
}

export interface ProviderNarrationFact {
  delivery: 'delta' | 'message';
  text: string;
  isFinal: boolean;
}

export interface ProviderCommandOutputFact {
  commandId: string;
  stream: string | null;
  chunk: string;
}

export interface ProviderToolProgressFact {
  toolUseId: string;
  toolName: string;
  input: DurableToolUseBlock['input'];
}

/** Provider-specific activity facts a mapper resolves alongside its payload. */
export interface ProviderActivityFacts {
  narration?: ProviderNarrationFact | null;
  commandOutput?: ProviderCommandOutputFact | null;
  toolProgress?: ProviderToolProgressFact | null;
}

/** Narration resolved from a mapper's assistant text; reasoning is excluded. */
export const narrationFromMapping = (mapping: {
  assistantText?: { kind: 'text' | 'reasoning'; text: string; isFinal: boolean } | null;
  assistantTextDelta?: string;
}): ProviderNarrationFact | null => {
  if (mapping.assistantTextDelta) {
    return { delivery: 'delta', text: mapping.assistantTextDelta, isFinal: false };
  }
  const text = mapping.assistantText;
  if (text?.kind === 'text') {
    return { delivery: 'message', text: text.text, isFinal: text.isFinal };
  }
  return null;
};

/**
 * Claude Code `system/background_tasks_changed`: a level signal carrying every
 * live background task after a membership change. Ambient tasks (live-update
 * watchers, skip_transcript tasks) are not activity and are excluded.
 */
const claudeBackgroundTasksChangedSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('background_tasks_changed'),
  tasks: z.array(
    z.object({
      task_id: z.string().min(1),
      ambient: z.boolean().optional(),
    }),
  ),
});

const normalizedBackgroundTasks = (
  input: NormalizeProviderEventInput,
): NormalizedProviderFacts['backgroundTasks'] => {
  if (input.provider !== 'claude') return null;
  if (input.rawEvent['subtype'] !== 'background_tasks_changed') return null;
  // Drift yields null; the runner reports a background_tasks_changed event
  // without this fact as an error rather than throwing out of the stream reader.
  const parsed = claudeBackgroundTasksChangedSchema.safeParse(input.rawEvent);
  if (!parsed.success) return null;
  return {
    liveTaskIds: parsed.data.tasks
      .filter((task) => task.ambient !== true)
      .map((task) => task.task_id),
  };
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const readTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const readFirstString = (
  record: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = readTrimmedString(record[key]);
    if (value) {
      return value;
    }
  }
  return null;
};

export const readFirstRecord = (
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null => {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) {
      return value;
    }
  }
  return null;
};

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

export const permissionFingerprint = (value: unknown): string =>
  `sha256:${createHash('sha256').update(stableJsonValue(value)).digest('hex')}`;

export const readFirstBoolean = (
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (
        normalized === 'true' ||
        normalized === '1' ||
        normalized === 'yes' ||
        normalized === 'on'
      ) {
        return true;
      }
      if (
        normalized === 'false' ||
        normalized === '0' ||
        normalized === 'no' ||
        normalized === 'off'
      ) {
        return false;
      }
    }
  }
  return null;
};

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
};

const readValidationMode = (value: string | undefined): ProviderEventValidationMode => {
  if (!value) {
    // Default to permissive to keep provider streams resilient to schema drift.
    return 'permissive';
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'strict' ? 'strict' : 'permissive';
};

const clampMaxDiffBlobBytes = (value: number): number =>
  value < MIN_MAX_DIFF_BLOB_BYTES ? MIN_MAX_DIFF_BLOB_BYTES : value;

const pickDefinedFields = (input: Record<string, unknown>): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) {
      output[key] = value;
    }
  }
  return output;
};

export const omitKeys = (
  value: Record<string, unknown>,
  keysToOmit: ReadonlySet<string>,
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!keysToOmit.has(key)) {
      output[key] = entry;
    }
  }
  return output;
};

export const extractDiffFiles = (record: Record<string, unknown>): string[] => {
  const files = record['files'];
  if (Array.isArray(files)) {
    return files
      .map((entry) => {
        if (typeof entry === 'string') {
          return readTrimmedString(entry);
        }
        if (isRecord(entry)) {
          return readFirstString(entry, ['path', 'file', 'filename']);
        }
        return null;
      })
      .filter((entry): entry is string => entry !== null);
  }

  const filePath = readFirstString(record, ['file', 'file_path', 'filepath', 'path']);
  if (filePath) {
    return [filePath];
  }

  return [];
};

export const truncateUtf8ToBytes = (value: string, maxBytes: number): string => {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString('utf8');
};

export const hasAnyKey = (record: Record<string, unknown>, keys: readonly string[]): boolean => {
  for (const key of keys) {
    if (key in record) {
      return true;
    }
  }
  return false;
};

export const WRITE_TOOL_NAMES = new Set(['Write', 'write', 'write_file', 'NotebookEdit']);
export const EDIT_TOOL_NAMES = new Set(['Edit', 'edit', 'edit_file', 'MultiEdit']);
export const SINGLE_EDIT_TOOL_NAMES = new Set(['Edit', 'edit', 'edit_file']);

const readRoutingFact = (
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | null => {
  const routing = readFirstRecord(payload, ['routing']) ?? {};
  const canonical = readFirstRecord(payload, ['canonical_event']);
  const canonicalRouting = canonical ? (readFirstRecord(canonical, ['routing']) ?? {}) : {};
  return readFirstString(routing, keys) ?? readFirstString(canonicalRouting, keys);
};

const readCanonicalRecord = (
  payload: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null => {
  const canonical = readFirstRecord(payload, ['canonical_event']);
  return canonical ? readFirstRecord(canonical, [key]) : null;
};

const normalizedToolUses = (
  payload: Record<string, unknown>,
  observedAt: string,
): DurableToolUseBlock[] => {
  const canonicalDiff = readCanonicalRecord(payload, 'diff');
  const source = Array.isArray(payload['all_tool_use_blocks'])
    ? payload['all_tool_use_blocks']
    : canonicalDiff && Array.isArray(canonicalDiff['tool_use_blocks'])
      ? canonicalDiff['tool_use_blocks']
      : [];
  const blocks: DurableToolUseBlock[] = [];
  for (const candidate of source) {
    if (!isRecord(candidate)) continue;
    const toolUseId = readFirstString(candidate, ['id', 'toolUseId', 'tool_use_id']);
    const toolName = readFirstString(candidate, ['tool_name', 'toolName', 'name']);
    if (!toolUseId || !toolName) continue;
    blocks.push({
      toolUseId,
      toolName,
      input: toDurableJsonValue(candidate['input']) ?? {},
      observedAt: readFirstString(candidate, ['observedAt', 'observed_at']) ?? observedAt,
    });
  }
  return blocks;
};

const normalizedToolResults = (
  payload: Record<string, unknown>,
  observedAt: string,
): DurableToolResult[] => {
  const source = Array.isArray(payload['all_tool_result_blocks'])
    ? payload['all_tool_result_blocks']
    : [];
  const results: DurableToolResult[] = [];
  for (const candidate of source) {
    if (!isRecord(candidate)) continue;
    const toolUseId = readFirstString(candidate, ['tool_use_id', 'toolUseId']);
    if (!toolUseId) continue;
    results.push({
      toolUseId,
      isError: candidate['is_error'] === true || candidate['isError'] === true,
      content: readFirstString(candidate, ['content_text', 'contentText', 'content']) ?? null,
      observedAt: readFirstString(candidate, ['observedAt', 'observed_at']) ?? observedAt,
    });
  }
  return results;
};

const normalizedResearchActivity = (
  toolUses: readonly DurableToolUseBlock[],
): NormalizedProviderFacts['researchActivity'] => {
  const researchTools = toolUses.filter((use) =>
    /^(read|glob|grep|list|agent|task|spawn_agent)$/iu.test(use.toolName),
  );
  if (researchTools.length === 0) return null;
  const paths: string[] = [];
  for (const use of researchTools) {
    const toolInput: unknown = use.input;
    if (!isRecord(toolInput)) continue;
    for (const key of ['path', 'file_path', 'directory']) {
      const value = toolInput[key];
      if (typeof value === 'string' && value.length > 0 && !value.startsWith('/'))
        paths.push(value);
    }
  }
  return {
    observedTools: researchTools.map((use) => use.toolName),
    repositoryRelativePaths: [...new Set(paths)],
    delegationObserved: researchTools.some((use) =>
      /^(agent|task|spawn_agent)$/iu.test(use.toolName),
    ),
  };
};

const normalizedPermissionRequest = (
  payload: Record<string, unknown>,
  observedAt: string,
): DurablePermissionRequest | null => {
  const request =
    readCanonicalRecord(payload, 'permission_request') ??
    readFirstRecord(payload, ['permission_request', 'permissionRequest']);
  if (!request) return null;
  const requestId = readFirstString(request, ['id', 'requestId', 'request_id']);
  const permissionType = readFirstString(request, ['permission_type', 'permissionType', 'type']);
  const action = readFirstString(request, ['action']);
  const target = readFirstString(request, ['target']);
  const fingerprint = readFirstString(request, ['fingerprint']);
  if (!requestId || !permissionType || !action || !target || !fingerprint) return null;
  const enrichment = readFirstRecord(payload, ['enrichment_metadata', 'enrichment']);
  const referencedFiles = enrichment
    ? Array.isArray(enrichment['referenced_files'])
      ? enrichment['referenced_files'].filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        )
      : []
    : [];
  return {
    requestId,
    permissionType,
    exactAction: {
      action,
      target,
      fingerprint,
      createdAt: readFirstString(request, ['created_at', 'createdAt']) ?? null,
      expiresAt: readFirstString(request, ['expires_at', 'expiresAt']) ?? null,
    },
    referencedFiles: [...new Set(referencedFiles)],
    reason: enrichment ? readFirstString(enrichment, ['reason']) : null,
    agentIntent: enrichment ? readFirstString(enrichment, ['agent_intent', 'agentIntent']) : null,
    requestedAt:
      readFirstString(request, ['requestedAt', 'requested_at', 'timestamp']) ?? observedAt,
  };
};

const normalizedDiff = (
  input: NormalizeProviderEventInput,
  payload: Record<string, unknown>,
): DurableDiffFacts | null => {
  const diff = readCanonicalRecord(payload, 'diff');
  if (!diff) return null;
  const files: DurableDiffFile[] = [];
  const rawFiles = diff['files'];
  if (Array.isArray(rawFiles)) {
    for (const candidate of rawFiles) {
      if (typeof candidate === 'string' && candidate.trim()) {
        files.push({
          path: candidate.trim(),
          status: 'modified',
          additions: null,
          deletions: null,
        });
      } else if (isRecord(candidate)) {
        const filePath = readFirstString(candidate, ['path', 'file', 'filename']);
        if (!filePath) continue;
        const status = readFirstString(candidate, ['status']);
        files.push({
          path: filePath,
          status:
            status === 'added' ||
            status === 'modified' ||
            status === 'deleted' ||
            status === 'renamed'
              ? status
              : 'modified',
          additions:
            typeof candidate['additions'] === 'number' && Number.isFinite(candidate['additions'])
              ? candidate['additions']
              : null,
          deletions:
            typeof candidate['deletions'] === 'number' && Number.isFinite(candidate['deletions'])
              ? candidate['deletions']
              : null,
        });
      }
    }
  }
  const patches: Array<{ path: string; patch: string }> = [];
  if (Array.isArray(diff['patches'])) {
    for (const candidate of diff['patches']) {
      if (!isRecord(candidate)) continue;
      const filePath = readFirstString(candidate, ['path', 'file']);
      const patch = readFirstString(candidate, ['patch', 'diff']);
      if (filePath && patch) patches.push({ path: filePath, patch });
    }
  }
  const canonicalArtifactRef = readFirstString(diff, [
    'canonicalArtifactRef',
    'canonical_artifact_ref',
    'blob_ref',
    'blobRef',
  ]);
  if (files.length === 0 && patches.length === 0 && !canonicalArtifactRef) return null;
  const authorityValue = readFirstString(diff, ['attribution_authority', 'authority']);
  const eventAuthority =
    authorityValue === 'confirmed' ||
    authorityValue === 'provisional' ||
    authorityValue === 'diagnostic'
      ? authorityValue
      : input.provider === 'codex' && input.eventType === 'item/completed'
        ? 'confirmed'
        : 'provisional';
  return {
    provider: input.provider,
    providerSessionId: input.sessionId,
    providerThreadId: readRoutingFact(payload, ['thread_id', 'threadId', 'providerThreadId']),
    providerTurnId: readRoutingFact(payload, ['turn_id', 'turnId', 'providerTurnId']),
    itemId: readRoutingFact(payload, ['item_id', 'itemId']),
    authority: eventAuthority,
    files,
    patches,
    canonicalArtifactRef,
    observedAt: input.timestamp,
  };
};

const normalizedCommandLifecycle = (
  input: NormalizeProviderEventInput,
  payload: Record<string, unknown>,
): DurableCommandLifecycle | null => {
  if (input.provider !== 'codex') return null;
  const item = readFirstRecord(input.rawEvent, ['item']);
  if (readFirstString(item ?? {}, ['type']) !== 'commandExecution') return null;
  const commandId = readRoutingFact(payload, ['item_id', 'itemId']);
  if (!commandId) return null;
  const status = readCanonicalRecord(payload, 'status');
  const state = status ? readFirstString(status, ['state']) : null;
  if (input.eventType === 'item/started' || state === 'in_progress') {
    return { commandId, status: 'started', exitCode: null };
  }
  if (input.eventType === 'item/completed' || state === 'completed' || state === 'failed') {
    const code = status ? readFirstString(status, ['code']) : null;
    const exitCode = code !== null && /^-?\d+$/u.test(code) ? Number.parseInt(code, 10) : null;
    return { commandId, status: state === 'failed' ? 'failed' : 'completed', exitCode };
  }
  return null;
};

/** Build the typed provider facts that live consumers and admission share. */
export const buildNormalizedProviderFacts = (input: {
  normalizeInput: NormalizeProviderEventInput;
  payload: Record<string, unknown>;
  activity?: ProviderActivityFacts;
}): NormalizedProviderFacts => {
  const { normalizeInput, payload, activity } = input;
  const providerConversationId = readFirstString(payload, [
    'provider_conversation_id',
    'providerConversationId',
    'conversation_id',
    'conversationId',
  ]);
  const routing: DurableRoutingFacts = {
    providerThreadId: readRoutingFact(payload, [
      'provider_thread_id',
      'providerThreadId',
      'thread_id',
      'threadId',
    ]),
    providerTurnId: readRoutingFact(payload, [
      'provider_turn_id',
      'providerTurnId',
      'turn_id',
      'turnId',
    ]),
    itemId: readRoutingFact(payload, ['item_id', 'itemId']),
  };
  const identity =
    normalizeInput.sessionId &&
    (normalizeInput.eventType === 'thread/started' ||
      normalizeInput.eventType === 'session_started' ||
      normalizeInput.eventType === 'system/init')
      ? {
          providerSessionId: normalizeInput.sessionId,
          providerConversationId,
          providerSessionAgentId: normalizeInput.agentId,
          providerThreadId: routing.providerThreadId,
          providerTurnId: routing.providerTurnId,
        }
      : null;
  const diff = normalizedDiff(normalizeInput, payload);
  const toolUses = normalizedToolUses(payload, normalizeInput.timestamp);
  const facts: NormalizedProviderFacts = {
    provider: normalizeInput.provider,
    sessionId: normalizeInput.sessionId,
    agentId: normalizeInput.agentId,
    providerSessionId: normalizeInput.sessionId,
    providerConversationId,
    providerSessionAgentId: normalizeInput.agentId,
    routing,
    identity,
    commandLifecycle: normalizedCommandLifecycle(normalizeInput, payload),
    toolUses,
    toolResults: normalizedToolResults(payload, normalizeInput.timestamp),
    permissionRequest: normalizedPermissionRequest(payload, normalizeInput.timestamp),
    permissionDecision: null,
    diff,
    canonicalArtifactRef: diff?.canonicalArtifactRef ?? null,
    researchActivity: normalizedResearchActivity(toolUses),
    backgroundTasks: normalizedBackgroundTasks(normalizeInput),
    narration: activity?.narration ?? null,
    commandOutput: activity?.commandOutput ?? null,
    toolProgress: activity?.toolProgress ?? null,
    parentToolUseId:
      normalizeInput.provider === 'claude'
        ? readTrimmedString(normalizeInput.rawEvent['parent_tool_use_id'])
        : null,
  };
  return facts;
};
export const buildRoutingIdentifiers = (
  input: NormalizeProviderEventInput,
): Record<string, unknown> => {
  const routingFromRaw = {
    run_id: input.runId,
    session_id: input.sessionId,
    provider_session_id: readFirstString(input.rawEvent, [
      'provider_session_id',
      'providerSessionId',
      'session_id',
      'sessionId',
    ]),
    provider_conversation_id: readFirstString(input.rawEvent, [
      'provider_conversation_id',
      'providerConversationId',
      'conversation_id',
      'conversationId',
    ]),
    thread_id: readFirstString(input.rawEvent, [
      'provider_thread_id',
      'providerThreadId',
      'thread_id',
      'threadId',
    ]),
    request_id: readFirstString(input.rawEvent, ['request_id', 'requestId']),
    correlation_id: readFirstString(input.rawEvent, ['correlation_id', 'correlationId']),
    trace_id: readFirstString(input.rawEvent, ['trace_id', 'traceId']),
    message_id: readFirstString(input.rawEvent, ['message_id', 'messageId']),
  };

  return pickDefinedFields(routingFromRaw);
};

export const validateCanonical = (input: {
  eventType: NormalizedCanonicalEventType;
  validationMode: ProviderEventValidationMode;
  permissionRequest: Record<string, unknown> | null;
  diff: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  diffErrors: string[];
}): { success: boolean; schemaMismatch: boolean; errors: string[] } => {
  const errors = [...input.diffErrors];

  if (input.eventType === 'permission_request' && input.permissionRequest) {
    if (!readTrimmedString(input.permissionRequest['id'])) {
      errors.push('permission_request.id is required');
    }
    if (!readTrimmedString(input.permissionRequest['permission_type'])) {
      errors.push('permission_request.permission_type is required');
    }
  }

  if (input.eventType === 'status' && input.status) {
    const hasStatusSignal =
      Boolean(readTrimmedString(input.status['state'])) ||
      Boolean(readTrimmedString(input.status['message'])) ||
      Boolean(readTrimmedString(input.status['code']));
    if (!hasStatusSignal) {
      errors.push('status event must provide at least one of state, message, or code');
    }
  }

  if (input.eventType === 'unknown') {
    errors.push('event could not be mapped to canonical schema');
  }

  const schemaMismatch = errors.length > 0;
  // Strict mode is currently diagnostics-first in this layer: callers receive
  // success/failure flags and can decide whether to hard-fail execution.
  const success = input.validationMode === 'strict' ? !schemaMismatch : true;

  return {
    success,
    schemaMismatch,
    errors,
  };
};

export const loadProviderEventNormalizationConfig = (): ProviderEventNormalizationConfig => {
  const maxDiffFromEnv = parsePositiveInteger(
    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'],
  );

  return {
    validationMode: readValidationMode(
      process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'],
    ),
    maxDiffBlobBytes: clampMaxDiffBlobBytes(maxDiffFromEnv ?? DEFAULT_MAX_DIFF_BLOB_BYTES),
    trackTools: process.env['HEYHEY_TRACK_TOOLS'] !== '0',
  };
};
