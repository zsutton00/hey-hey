import { z } from 'zod/v4';
import type {
  ChangedFileReportFinding,
  ChangedFileReportResult,
} from '../shared/agent-bridge-contract/generated/api';

/** The version of the canonical Run event representation on disk. */
export const DURABLE_RUN_EVENT_SCHEMA_VERSION = 1 as const;

type DurableJsonPrimitive = string | number | boolean | null;
export type DurableJsonValue =
  | DurableJsonPrimitive
  | readonly DurableJsonValue[]
  | { readonly [key: string]: DurableJsonValue };

type DurableEventKind =
  | 'run_started'
  | 'run_completed'
  | 'provider_identity_observed'
  | 'tool_use'
  | 'tool_result'
  | 'permission_requested'
  | 'permission_decision_recorded'
  | 'diff'
  | 'committed_outcome'
  | 'task_monitor_turn_settled'
  | 'input_turn_settled'
  | 'changed_file_reporting';

export type DurableProvider = 'claude' | 'codex' | 'opencode' | (string & {});

interface DurableRunEventEnvelope {
  schema_version: typeof DURABLE_RUN_EVENT_SCHEMA_VERSION;
  seq: number;
  ts: string;
  app_session_id: string;
  run_id: string;
  actor: 'app' | 'agent' | 'system';
  state_version: number;
  event_type: 'run_started' | 'prompt_sent' | 'agent_output' | 'run_completed' | 'post_processed';
}

export interface DurableRoutingFacts {
  providerThreadId: string | null;
  providerTurnId: string | null;
  itemId: string | null;
}

export interface DurableToolUseBlock {
  toolUseId: string;
  toolName: string;
  input: DurableJsonValue;
  observedAt: string;
}

export interface DurableToolResult {
  toolUseId: string;
  isError: boolean;
  content: string | null;
  observedAt: string;
}

export interface DurableCommandLifecycle {
  commandId: string;
  status: 'started' | 'completed' | 'failed';
  exitCode: number | null;
}

export interface DurablePermissionRequest {
  requestId: string;
  permissionType: string;
  exactAction: {
    action: string;
    target: string;
    fingerprint: string;
    createdAt: string | null;
    expiresAt: string | null;
  };
  referencedFiles: readonly string[];
  reason: string | null;
  agentIntent: string | null;
  requestedAt: string;
}

export interface DurablePermissionDecision {
  requestId: string;
  decision: 'allow' | 'deny' | 'allow_always';
  decidedAt: string;
  userId: string | null;
}

export interface DurableDiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number | null;
  deletions: number | null;
}

interface DurableDiffPatch {
  path: string;
  patch: string;
}

export interface DurableDiffFacts {
  provider: DurableProvider;
  providerSessionId: string | null;
  providerThreadId: string | null;
  providerTurnId: string | null;
  itemId: string | null;
  authority: 'confirmed' | 'provisional' | 'diagnostic';
  files: readonly DurableDiffFile[];
  patches: readonly DurableDiffPatch[];
  canonicalArtifactRef: string | null;
  observedAt: string;
}

type DurableRunEventPayload =
  | {
      kind: 'changed_file_reporting';
      turnId: string;
      providerSessionId: string | null;
      state: ChangedFileReportResult['state'];
      editRevision: number;
      validatedRevision: number | null;
      findings: ChangedFileReportFinding[];
      attempts: number;
      incomplete: boolean;
      retainedResponse: string | null;
    }
  | {
      kind: 'run_started';
      mode: 'prompt' | 'resume';
      prompt: string;
      adapterId: string;
      repositoryPath: string;
      provider: DurableProvider;
      providerSessionId: string | null;
      providerConversationId: string | null;
      providerSessionAgentId: string | null;
      observedAt: string;
    }
  | {
      kind: 'run_completed';
      mode: 'prompt' | 'resume';
      provider: DurableProvider;
      providerSessionId: string | null;
      providerConversationId: string | null;
      providerSessionAgentId: string | null;
      outcome: 'succeeded' | 'failed' | 'cancelled';
      errorCode: string | null;
      errorCount: number;
      observedAt: string;
    }
  | {
      kind: 'provider_identity_observed';
      provider: DurableProvider;
      providerSessionId: string;
      providerConversationId: string | null;
      providerSessionAgentId: string | null;
      providerThreadId: string | null;
      providerTurnId: string | null;
      observedAt: string;
    }
  | {
      kind: 'tool_use';
      provider: DurableProvider;
      providerSessionId: string | null;
      routing: DurableRoutingFacts;
      blocks: readonly DurableToolUseBlock[];
      commandLifecycle: DurableCommandLifecycle | null;
    }
  | {
      kind: 'tool_result';
      provider: DurableProvider;
      providerSessionId: string | null;
      routing: DurableRoutingFacts;
      results: readonly DurableToolResult[];
      commandLifecycle: DurableCommandLifecycle | null;
    }
  | {
      kind: 'permission_requested';
      provider: DurableProvider;
      providerSessionId: string | null;
      routing: DurableRoutingFacts;
      request: DurablePermissionRequest;
    }
  | {
      kind: 'permission_decision_recorded';
      requestId: string;
      decision: 'allow' | 'deny' | 'allow_always';
      decidedAt: string;
      userId: string | null;
    }
  | {
      kind: 'diff';
      diff: DurableDiffFacts;
    }
  | {
      kind: 'committed_outcome';
      effectId: string;
      idempotencyKey: string;
      outcomeType: string;
      status: 'committed' | 'applied' | 'settled';
      recoveryState: 'unsettled' | 'settled';
      canonicalArtifactRefs: readonly string[];
      committedAt: string;
      settledAt: string | null;
    }
  | {
      kind: 'input_turn_settled';
      turnId: string;
      terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
      completedAssistantMessageId: string | null;
      reports: readonly string[];
      settledAt: string;
    }
  | {
      kind: 'task_monitor_turn_settled';
      sourceMessageId: string;
      turnId: string;
      terminalOutcome: 'succeeded' | 'failed' | 'cancelled';
      completedAssistantMessageId: string | null;
      reportIds: readonly string[];
    };

export interface DurableRunEvent extends DurableRunEventEnvelope {
  payload: DurableRunEventPayload;
}

export type DurableRunEventInput = Omit<
  DurableRunEvent,
  'schema_version' | 'seq' | 'ts' | 'app_session_id'
>;

const MAX_STRING_BYTES = 128 * 1024;
const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_ARRAY_ITEMS = 2_000;
const MAX_ARTIFACT_REFS = 100;

/**
 * Read a string for canonical storage only when it fits the durable budget.
 * Oversized provider output stays transient; callers retain the surrounding
 * identity and outcome facts instead of making the complete result durable.
 */
export const toBoundedDurableString = (
  value: unknown,
  maxBytes = MAX_STRING_BYTES,
): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || Buffer.byteLength(trimmed, 'utf8') > maxBytes) return null;
  return trimmed;
};

/**
 * Convert transient provider JSON into the bounded value subset permitted in
 * canonical records. Unsupported values are omitted instead of stringified.
 */
export const toDurableJsonValue = (value: unknown): DurableJsonValue | null => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const result: DurableJsonValue[] = [];
    for (const entry of value) {
      const converted = toDurableJsonValue(entry);
      if (converted === null && entry !== null) return null;
      result.push(converted);
    }
    return result;
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, DurableJsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const converted = toDurableJsonValue(entry);
      if (converted === null && entry !== null) return null;
      result[key] = converted;
    }
    return result;
  }
  return null;
};

const boundedString = (maxBytes = MAX_STRING_BYTES) =>
  z
    .string()
    .min(1)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= maxBytes,
      'String exceeds durable limit.',
    );

const nullableBoundedString = (maxBytes = MAX_STRING_BYTES) =>
  z
    .string()
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= maxBytes,
      'String exceeds durable limit.',
    )
    .nullable();

const timestampSchema = boundedString(128).refine(
  (value) => Number.isFinite(Date.parse(value)),
  'Timestamp must be parseable.',
);

const nonNegativeInteger = z.number().int().nonnegative();
const boundedJsonValueSchema: z.ZodType<DurableJsonValue> = z.lazy(() =>
  z.union([
    z
      .string()
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= MAX_JSON_BYTES,
        'JSON string exceeds durable limit.',
      ),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(boundedJsonValueSchema).max(MAX_ARRAY_ITEMS),
    z.record(z.string(), boundedJsonValueSchema),
  ]),
);

const providerSchema = boundedString(128);
const providerSessionIdSchema = nullableBoundedString(512);
const routingSchema = z
  .object({
    providerThreadId: nullableBoundedString(512),
    providerTurnId: nullableBoundedString(512),
    itemId: nullableBoundedString(512),
  })
  .strict();

const commandLifecycleSchema = z
  .object({
    commandId: boundedString(512),
    status: z.enum(['started', 'completed', 'failed']),
    exitCode: z.number().int().nullable(),
  })
  .strict();

const toolUseSchema = z
  .object({
    toolUseId: boundedString(512),
    toolName: boundedString(512),
    input: boundedJsonValueSchema,
    observedAt: timestampSchema,
  })
  .strict();

const toolResultSchema = z
  .object({
    toolUseId: boundedString(512),
    isError: z.boolean(),
    content: nullableBoundedString(MAX_JSON_BYTES),
    observedAt: timestampSchema,
  })
  .strict();

const permissionRequestSchema = z
  .object({
    requestId: boundedString(512),
    permissionType: boundedString(512),
    exactAction: z
      .object({
        action: boundedString(512),
        target: boundedString(MAX_JSON_BYTES),
        fingerprint: boundedString(1024),
        createdAt: timestampSchema.nullable(),
        expiresAt: timestampSchema.nullable(),
      })
      .strict(),
    referencedFiles: z.array(boundedString(4096)).max(MAX_ARRAY_ITEMS),
    reason: nullableBoundedString(MAX_JSON_BYTES),
    agentIntent: nullableBoundedString(MAX_JSON_BYTES),
    requestedAt: timestampSchema,
  })
  .strict();

const permissionDecisionSchema = z
  .object({
    requestId: boundedString(512),
    decision: z.enum(['allow', 'deny', 'allow_always']),
    decidedAt: timestampSchema,
    userId: nullableBoundedString(512),
  })
  .strict();

const diffFileSchema = z
  .object({
    path: boundedString(4096),
    status: z.enum(['added', 'modified', 'deleted', 'renamed']),
    additions: z.number().int().nonnegative().nullable(),
    deletions: z.number().int().nonnegative().nullable(),
  })
  .strict();

const diffPatchSchema = z
  .object({
    path: boundedString(4096),
    patch: boundedString(MAX_JSON_BYTES),
  })
  .strict();

const diffFactsSchema = z
  .object({
    provider: providerSchema,
    providerSessionId: providerSessionIdSchema,
    providerThreadId: nullableBoundedString(512),
    providerTurnId: nullableBoundedString(512),
    itemId: nullableBoundedString(512),
    authority: z.enum(['confirmed', 'provisional', 'diagnostic']),
    files: z.array(diffFileSchema).max(MAX_ARRAY_ITEMS),
    patches: z.array(diffPatchSchema).max(MAX_ARRAY_ITEMS),
    canonicalArtifactRef: nullableBoundedString(2048),
    observedAt: timestampSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.files.length > 0 || value.patches.length > 0 || value.canonicalArtifactRef !== null,
    'A durable diff must retain files, patches, or an artifact reference.',
  );

const payloadSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('run_started'),
      mode: z.enum(['prompt', 'resume']),
      prompt: z
        .string()
        .refine(
          (value) => Buffer.byteLength(value, 'utf8') <= MAX_PROMPT_BYTES,
          'Prompt exceeds durable limit.',
        ),
      adapterId: boundedString(512),
      repositoryPath: boundedString(4096),
      provider: providerSchema,
      providerSessionId: providerSessionIdSchema,
      providerConversationId: nullableBoundedString(512),
      providerSessionAgentId: nullableBoundedString(512),
      observedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('run_completed'),
      mode: z.enum(['prompt', 'resume']),
      provider: providerSchema,
      providerSessionId: providerSessionIdSchema,
      providerConversationId: nullableBoundedString(512),
      providerSessionAgentId: nullableBoundedString(512),
      outcome: z.enum(['succeeded', 'failed', 'cancelled']),
      errorCode: nullableBoundedString(512),
      errorCount: nonNegativeInteger,
      observedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('provider_identity_observed'),
      provider: providerSchema,
      providerSessionId: boundedString(512),
      providerConversationId: nullableBoundedString(512),
      providerSessionAgentId: nullableBoundedString(512),
      providerThreadId: nullableBoundedString(512),
      providerTurnId: nullableBoundedString(512),
      observedAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool_use'),
      provider: providerSchema,
      providerSessionId: providerSessionIdSchema,
      routing: routingSchema,
      blocks: z.array(toolUseSchema).min(1).max(MAX_ARRAY_ITEMS),
      commandLifecycle: commandLifecycleSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool_result'),
      provider: providerSchema,
      providerSessionId: providerSessionIdSchema,
      routing: routingSchema,
      results: z.array(toolResultSchema).min(1).max(MAX_ARRAY_ITEMS),
      commandLifecycle: commandLifecycleSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('permission_requested'),
      provider: providerSchema,
      providerSessionId: providerSessionIdSchema,
      routing: routingSchema,
      request: permissionRequestSchema,
    })
    .strict(),
  permissionDecisionSchema.extend({ kind: z.literal('permission_decision_recorded') }).strict(),
  z.object({ kind: z.literal('diff'), diff: diffFactsSchema }).strict(),
  z
    .object({
      kind: z.literal('committed_outcome'),
      effectId: boundedString(512),
      idempotencyKey: boundedString(1024),
      outcomeType: boundedString(512),
      status: z.enum(['committed', 'applied', 'settled']),
      recoveryState: z.enum(['unsettled', 'settled']),
      canonicalArtifactRefs: z.array(boundedString(2048)).max(MAX_ARTIFACT_REFS),
      committedAt: timestampSchema,
      settledAt: timestampSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('input_turn_settled'),
      turnId: boundedString(512),
      terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
      completedAssistantMessageId: nullableBoundedString(512),
      reports: z.array(boundedString(512)).max(MAX_ARTIFACT_REFS),
      settledAt: timestampSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('changed_file_reporting'),
      turnId: boundedString(512),
      providerSessionId: nullableBoundedString(512),
      state: z.enum(['not_reported', 'needs_correction', 'validated']),
      editRevision: z.number().int().nonnegative(),
      validatedRevision: z.number().int().nonnegative().nullable(),
      attempts: z.number().int().nonnegative(),
      incomplete: z.boolean(),
      retainedResponse: z.string().nullable(),
      findings: z.array(
        z
          .object({
            index: z.number().int().nonnegative(),
            status: z.enum(['accepted', 'corrected', 'rejected']),
            reason: z.string(),
            claim: z.object({ serviceId: z.string(), path: z.string() }).strict().optional(),
            suggestion: z.object({ serviceId: z.string(), path: z.string() }).strict().optional(),
          })
          .strict()
          .transform((item) => ({
            index: item.index,
            status: item.status,
            reason: item.reason,
            ...(item.claim ? { claim: item.claim } : {}),
            ...(item.suggestion ? { suggestion: item.suggestion } : {}),
          })),
      ),
    })
    .strict(),
  z
    .object({
      kind: z.literal('task_monitor_turn_settled'),
      sourceMessageId: boundedString(512),
      turnId: boundedString(512),
      terminalOutcome: z.enum(['succeeded', 'failed', 'cancelled']),
      completedAssistantMessageId: nullableBoundedString(512),
      reportIds: z.array(boundedString(512)).max(MAX_ARTIFACT_REFS),
    })
    .strict(),
]);

const eventSchema = z
  .object({
    schema_version: z.literal(DURABLE_RUN_EVENT_SCHEMA_VERSION),
    seq: z.number().int().positive(),
    ts: timestampSchema,
    app_session_id: boundedString(512),
    run_id: boundedString(512),
    actor: z.enum(['app', 'agent', 'system']),
    state_version: nonNegativeInteger,
    event_type: z.enum([
      'run_started',
      'prompt_sent',
      'agent_output',
      'run_completed',
      'post_processed',
    ]),
    payload: payloadSchema,
  })
  .strict();

const FORBIDDEN_PROVIDER_KEYS = new Set([
  'raw_event',
  'provider_metadata',
  'all_tool_use_blocks',
  'all_tool_result_blocks',
  'normalization',
  'canonical_event',
  'canonical_event_type',
]);

const assertNoForbiddenProviderKeys = (value: unknown, location = 'event'): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenProviderKeys(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PROVIDER_KEYS.has(key)) {
      throw new Error(`Durable Run event contains forbidden provider field ${location}.${key}.`);
    }
    assertNoForbiddenProviderKeys(entry, `${location}.${key}`);
  }
};

/** Parse and validate one complete durable event using the production codec. */
export const parseDurableRunEvent = (value: unknown): DurableRunEvent => {
  const parsed = eventSchema.parse(value);
  assertNoForbiddenProviderKeys(parsed);
  return parsed;
};

/** Assertion form used by boundary adapters that already hold unknown input. */
const assertDurableRunEvent = (value: unknown): asserts value is DurableRunEvent => {
  parseDurableRunEvent(value);
};

const durableRunEventSchema = eventSchema;
