/**
 * FROZEN: the input queue's stored record format, schemaVersion 10.
 *
 * Every schema here was snapshotted once from the wire definitions the CLI admitted when v10
 * shipped, and must never change. Saved records are decoded with these schemas only, never
 * with the wire schemas in `trigger-verification/` or `conversation-dispatch/`, so a wire
 * change can no longer make saved inputs unreadable. A change to anything in this file needs
 * a v11 module, a v10 -> v11 migration and a v10 fixture; `input-queue-schema-guard.test.ts`
 * enforces that through the schema fingerprint and an import-boundary check.
 *
 * Only structure is stored. Business rules (non-empty messages, cross-field refinements) were
 * enforced once at admission and are never re-judged here. Sub-objects the CLI forwards
 * without reading (the start_run payload, contextMetadata, config, repository analysis, work
 * tracker requests) are stored as JSON objects typed by their generated contract.
 */
import { z } from 'zod/v4';
import type { JsonValue } from '../../../durable-data';
import type {
  AgentSessionConfig,
  RepositoryFeatureEnrichmentRequest,
  RepositoryGroundingSuccess,
  WorkTrackerImportRequest,
} from '../../../shared/agent-bridge-contract/generated/api';
import type { LocalCreateRunPayload } from '../../../shared/agent-bridge-contract/contract';
import type { LocalRunContextMetadata } from '../../../shared/agent-bridge-contract/run-context';

export const INPUT_QUEUE_SCHEMA_VERSION_V10 = 10;

/**
 * Decoded JSON never carries `undefined`, so optional keys are exactly absent. This restates
 * zod's `?: T | undefined` output as `?: T` for `exactOptionalPropertyTypes`.
 */
type Exact<T> = T extends ReadonlySet<unknown> | ReadonlyMap<unknown, unknown>
  ? T
  : T extends readonly (infer U)[]
    ? Exact<U>[]
    : T extends object
      ? { [K in keyof T]: Exact<Exclude<T[K], undefined>> }
      : T;

const uuid = z.uuid();
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/u);
const isJsonObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const jsonObject = <T>() => z.custom<T>(isJsonObject);

const PROMPT_TYPES = [
  'startup_session',
  'plan_execution',
  'final_assessment',
  'verification_plan',
  'child_task_updates',
  'entity_conversation',
  'goal_pm',
  'set_splitting',
  'free_form',
  'debug',
  'research',
  'run_eval',
  'quick',
  'daily_session',
  'rollup_proposal',
  'task_refiner',
  'feature_refiner',
  'design_doc_refiner',
  'proposal_refiner',
  'commit',
  'agent_search',
  'report_update',
  'code_review',
  'feature_sync_analyze',
  'feature_sync_iterate',
  'plan_shaping_feature_sync_analyze',
  'plan_shaping_feature_sync_iterate',
  'plan_shaping_feature_sync_discuss',
  'plan_shaping_proposed_stages',
  'plan_shaping_refine_stage',
  'plan_shaping_visual_preview',
  'plan_shaping_phase_breakdown',
  'plan_shaping_step_review',
  'plan_shaping_finalize',
  'implement',
  'validation_walkthrough',
  'coding_freeform',
  'session_message',
  'workflow-defined',
  'feature_tree_conversation',
  'open_items_triage',
  'verify_feature',
  'work_tracker_connect',
  'work_tracker_import',
  'repository_grounding',
  'repository_feature_enrichment',
  'repository_first_work',
  'repository_placement',
  'session_monitor',
  'task_monitor',
  'html_css_mockup_revision',
  'project_assistant',
  'project_mode',
  'project_report',
  'release_notes',
] as const;
const promptType = z.enum(PROMPT_TYPES);
const PROVIDERS = ['claude', 'codex', 'opencode'] as const;
// v5 widened the stored reasoning efforts to every id the launch contract carries.
const REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
  'default',
] as const;
const WORKFLOW_NAMES = [
  'adr',
  'initiative-refinement',
  'onboarding',
  'repository-import',
  'work-tracker-import',
  'rfc',
  'task-generation',
  'task-refinement',
  'task-prioritization',
  'entity-conversation',
  'project-conversation',
  'brainstorm-refinement',
  'decision-refinement',
  'agent-session',
  'daily-session',
  'session-monitor',
  'task-monitor',
  'agent-task-refining',
  'agent-entity-conversation',
  'goal-pm',
  'open-items-triage',
  'agent-project-conversation',
  'agent-design-doc-refining',
  'agent-search',
  'agent-proposal-refining',
  'feature-sync',
  'plan-from-design-doc',
  'feature-tree-conversation',
] as const;

const skillSelection = z.strictObject({
  provider: z.enum(PROVIDERS),
  name: z.string().min(1).max(200),
  catalogScope: z.enum(['user', 'repo', 'system', 'admin']),
});

const featureSyncDiscrepancy = z.object({
  id: z.string().optional(),
  summary: z.string(),
  rationale: z.string(),
  entityType: z.enum(['FEATURE', 'TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER']).optional(),
  entityId: z.string().optional(),
  proposal: z.string().optional(),
});
const planShapingDecision = z.object({
  itemId: z.string(),
  choice: z.enum(['accept', 'amend', 'dismiss']),
  note: z.string().optional(),
});

const worktree = z.strictObject({ enabled: z.boolean(), branch: z.string().min(1).optional() });

const taskMonitorPromptPayload = z.strictObject({
  coordinatorAttemptId: uuid.optional(),
  correction: z
    .strictObject({
      attempt: z.number().int().min(1).max(2),
      validationFailure: z.strictObject({
        code: z.string(),
        message: z.string(),
        issues: z.array(z.string()),
      }),
    })
    .optional(),
  monitorId: uuid,
  cause: z.enum([
    'START',
    'PAUSE',
    'RESUME',
    'STOP',
    'JUDGMENT_RESOLVED',
    'CONTINUE',
    'COMPLETE',
    'HALT',
  ]),
  correlationId: uuid,
  userMessage: z.string().optional(),
  launchConfig: z
    .strictObject({
      taskId: uuid,
      method: z.enum(['plan', 'open', 'quick']),
      provider: z.enum(PROVIDERS),
      model: z.string().min(1),
      reasoningEffort: z.enum(REASONING_EFFORTS),
      fastMode: z.boolean().optional(),
      worktree: worktree.optional(),
    })
    .optional(),
  judgment: z
    .strictObject({
      requestMessageId: uuid,
      label: z.string().min(1).max(240),
      conclusion: z.string().min(1).max(500),
    })
    .optional(),
  settledTurn: z
    .strictObject({
      turnId: uuid,
      promptType: z.string().min(1),
      terminalOutcome: z.enum(['COMPLETED', 'FAILED', 'ABORTED']),
      completedAssistantMessage: z
        .strictObject({ messageId: uuid, content: z.string().min(1) })
        .nullable(),
      reports: z.array(z.strictObject({ reportId: uuid, reportType: z.string().min(1) })),
    })
    .optional(),
});

const admittedServiceScope = z.strictObject({
  serviceIds: z.array(uuid),
  launchServiceId: uuid.nullable(),
});
const inputExecution = z.strictObject({
  operationId: uuid,
  operationFingerprint: sha256Hex,
  messageId: uuid,
});

const userMessagePayload = z.object({
  handlerPromptType: promptType,
  userMessage: z.string(),
  attachments: z.array(z.strictObject({ attachmentId: uuid, fileName: z.string().min(1) })),
  skillSelection: skillSelection.optional(),
  taskMonitorPayload: taskMonitorPromptPayload.optional(),
  featureSyncContext: z
    .union([
      z.strictObject({ discrepancies: z.array(featureSyncDiscrepancy) }),
      z.strictObject({
        discrepancies: z.array(featureSyncDiscrepancy),
        decisions: z.array(planShapingDecision),
        planId: z.string().min(1),
        designDocId: z.string().min(1),
      }),
    ])
    .optional(),
  runtime: z
    .strictObject({
      provider: z.enum(PROVIDERS),
      model: z.string().min(1),
      reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
      fastMode: z.boolean().optional(),
    })
    .optional(),
});

const startRunCommon = z.object({
  runId: uuid.optional(),
  attachments: z
    .array(z.strictObject({ attachmentId: uuid, fileName: z.string().min(1) }))
    .optional(),
  stagedBrowserTab: z.strictObject({ stagedTabId: uuid }).nullable().optional(),
  triggersAgent: z.boolean().optional(),
  handlerPromptType: promptType.optional(),
  payload: jsonObject<LocalCreateRunPayload>().optional(),
  workflowName: z.enum(WORKFLOW_NAMES).optional(),
  model: z.string().min(1),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  config: z
    .custom<AgentSessionConfig | null>((value) => value === null || isJsonObject(value))
    .optional(),
  provider: z.enum(PROVIDERS),
  fastMode: z.boolean().optional(),
  skillSelection: skillSelection.optional(),
  contextMetadata: jsonObject<LocalRunContextMetadata>(),
  serviceIds: z.array(z.string().min(1)).optional(),
  launchServiceId: z.string().min(1).optional(),
  worktree: worktree.optional(),
  agentSessionId: z.string().min(1),
});

const startRunPayload = z.union([
  startRunCommon.extend({ handlerPromptType: promptType }),
  startRunCommon.extend({
    handlerPromptType: z.never().optional(),
    workflowName: z.enum(WORKFLOW_NAMES),
  }),
]);

const userMessageField = z.string().optional();
const journeyStep = z.object({
  id: z.string().min(1),
  stageId: uuid,
  title: z.string().min(1),
  description: z.string().min(1),
  isUserInteractive: z.boolean(),
  implementationNotes: z.array(
    z.object({
      text: z.string().min(1),
      serviceId: uuid.nullable(),
      serviceName: z.string().nullable(),
    }),
  ),
});
// v8 stores the approved visuals (and phase count) plan-shaping prompts render.
const approvedVisual = z.object({
  proposalId: uuid,
  entityId: uuid,
  entityType: z.enum(['MOCKUP', 'DIAGRAM']),
  title: z.string(),
  summary: z.string(),
});
const phaseBreakdownStep = z.object({
  id: uuid,
  stageId: uuid,
  title: z.string().min(1),
  description: z.string().min(1),
  implementation: z.string().min(1),
  type: z.enum(['TASK']),
  acceptanceCriteria: z.string().min(1),
  sequenceOrder: z.number().int().nonnegative(),
  dependsOnStepIds: z.array(uuid).optional(),
  serviceIds: z.array(uuid).optional(),
  designDocMotivation: z.string().min(1),
});
const repositoryRequestFields = {
  projectId: uuid,
  conversationId: uuid,
  workflowId: uuid,
  workflowNodeId: z.string().min(1),
  serviceId: uuid,
  machineId: uuid,
  provider: z.enum(PROVIDERS),
  resolvedFrontierModel: z.string().min(1),
  reasoningEffort: z.enum(REASONING_EFFORTS),
  fastMode: z.boolean().optional(),
};
const followUpAnswer = z.strictObject({ question: z.string().min(1), answer: z.string().min(1) });
const placementTag = z.enum(['product', 'frontend', 'backend', 'infra', 'design', 'AI']);
const opaquePayload = z.json().optional();

/** One payload schema per direct promptType the queue admits; no others are storable. */
const directPayloads = {
  feature_sync_analyze: opaquePayload,
  feature_sync_iterate: z.object({
    discrepancies: z.array(featureSyncDiscrepancy),
    userMessage: userMessageField,
  }),
  feature_tree_conversation: z.object({ projectId: uuid, userMessage: userMessageField }),
  implement: z
    .strictObject({
      // Snapshot of OpenAPI ImplementPromptPayload: the approved version is execution input.
      approvedVersion: z
        .strictObject({
          responseType: z.literal('coding_plan_version_v1'),
          markdown: z.string(),
          requiredServiceIds: z.array(uuid),
        })
        .optional(),
      versionMessageId: uuid.optional(),
      planningDiscussion: z.string().optional(),
      approvalFeedback: z.string().optional(),
      userMessage: userMessageField,
      runtime: z
        .strictObject({
          provider: z.enum(PROVIDERS),
          model: z.string().min(1),
          reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
          fastMode: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
  plan_shaping_feature_sync_analyze: opaquePayload,
  plan_shaping_feature_sync_iterate: z.object({
    planId: z.string().min(1),
    designDocId: z.string().min(1),
    discrepancies: z.array(featureSyncDiscrepancy),
    decisions: z.array(planShapingDecision),
    userMessage: userMessageField,
  }),
  plan_shaping_finalize: opaquePayload,
  plan_shaping_phase_breakdown: z.object({
    journeyStep,
    stageIdx: z.number().int().min(0),
    phaseIdx: z.number().int().min(0),
    phasesInStage: z.number().int().min(1),
    totalPhases: z.number().int().min(1),
    designDocId: uuid,
    planId: uuid,
    priorPhases: z
      .array(
        z.object({
          stageIdx: z.number().int().nonnegative(),
          phaseIdx: z.number().int().nonnegative(),
          journeyStep,
          plan: z.object({ steps: z.array(phaseBreakdownStep) }),
        }),
      )
      .optional(),
    approvedVisuals: z.array(approvedVisual),
    userMessage: userMessageField,
  }),
  plan_shaping_proposed_stages: z.object({
    designDocId: uuid,
    planId: uuid,
    userMessage: userMessageField,
  }),
  plan_shaping_refine_stage: z.object({
    planId: uuid,
    stageId: uuid,
    validation: z.enum(['on', 'off']),
    userMessage: userMessageField,
  }),
  plan_shaping_step_review: z.object({
    steps: z.array(phaseBreakdownStep),
    stageIdx: z.number().int().min(0),
    totalStages: z.number().int().min(1),
    designDocId: uuid,
    planId: uuid,
    approvedVisuals: z.array(approvedVisual),
    userMessage: userMessageField,
  }),
  plan_shaping_visual_preview: opaquePayload,
  repository_feature_enrichment: z.strictObject({
    promptType: z.literal('repository_feature_enrichment').optional(),
    ...repositoryRequestFields,
    analysis: jsonObject<RepositoryGroundingSuccess>(),
    reviewedCandidates: jsonObject<RepositoryFeatureEnrichmentRequest['reviewedCandidates']>(),
    completedRounds: z.number().int().min(0).max(2),
    answerBatches: z
      .array(
        z.strictObject({
          round: z.number().int().min(1).max(2),
          answers: z.array(followUpAnswer).min(1).max(3),
        }),
      )
      .max(2),
  }),
  repository_first_work: z.strictObject({
    promptType: z.literal('repository_first_work').optional(),
    ...repositoryRequestFields,
    analysis: jsonObject<RepositoryGroundingSuccess>(),
    materializedFeatureIds: z.array(uuid).min(1),
    workRequest: z.string().min(1),
    followUpRoundCount: z.number().int().min(0).max(1),
    followUpAnswers: z.array(followUpAnswer).max(3),
  }),
  repository_grounding: z.strictObject({
    promptType: z.literal('repository_grounding').optional(),
    ...repositoryRequestFields,
    entryMode: z.enum(['new_project', 'existing_project']),
    confirmedServiceBrief: z.string().min(1),
    scope: z.discriminatedUnion('scope', [
      z.strictObject({ scope: z.literal('focused'), focus: z.string().min(1) }),
      z.strictObject({ scope: z.literal('comprehensive') }),
    ]),
    bounds: z.strictObject({
      maxFiles: z.number().int().min(1),
      maxTotalBytes: z.number().int().min(1),
      maxFileBytes: z.number().int().min(1),
      maxDepth: z.number().int().min(0),
      maxGeneratedFiles: z.number().int().min(0),
      maxIgnoredFiles: z.number().int().min(0),
      maxUnsupportedFiles: z.number().int().min(0),
      maxBinaryFiles: z.number().int().min(0),
    }),
  }),
  repository_placement: z.strictObject({
    promptType: z.literal('repository_placement').optional(),
    ...repositoryRequestFields,
    candidates: z.array(
      z.strictObject({
        rootKey: uuid,
        name: z.string(),
        description: z.string(),
        tag: placementTag,
        children: z.array(
          z.strictObject({
            childKey: uuid,
            name: z.string(),
            description: z.string(),
            tag: placementTag,
          }),
        ),
      }),
    ),
    instructions: z.array(z.strictObject({ rootKey: uuid, instruction: z.string().min(1) })),
  }),
  startup_session: opaquePayload,
  work_tracker_connect: jsonObject<WorkTrackerImportRequest>(),
  work_tracker_import: jsonObject<WorkTrackerImportRequest>(),
} as const;
export type StoredDirectPromptTypeV10 = keyof typeof directPayloads;

const directEvent = <P extends StoredDirectPromptTypeV10>(type: P) =>
  z.strictObject({
    promptType: z.literal(type),
    inputExecution: inputExecution.optional(),
    nodeId: z.string().min(1).optional(),
    triggerMessageId: z.string().min(1),
    payload: directPayloads[type],
  });

const storedEvent = z.discriminatedUnion('promptType', [
  z.strictObject({
    promptType: z.literal('start_run'),
    sourceUserMessageId: uuid.optional(),
    operationId: uuid,
    operationFingerprint: sha256Hex,
    inputExecution: inputExecution.optional(),
    nodeId: z.string().min(1).optional(),
    triggerMessageId: z.string().min(1),
    admittedServiceScope: admittedServiceScope.optional(),
    payload: startRunPayload,
  }),
  z.strictObject({
    promptType: z.literal('user_message'),
    operationId: uuid,
    operationFingerprint: sha256Hex,
    inputExecution: inputExecution.optional(),
    nodeId: z.string().min(1).optional(),
    triggerMessageId: z.string().min(1),
    sourceUserMessageId: z.string().min(1),
    admittedServiceScope: admittedServiceScope.optional(),
    payload: userMessagePayload,
  }),
  directEvent('feature_sync_analyze'),
  directEvent('feature_sync_iterate'),
  directEvent('feature_tree_conversation'),
  directEvent('implement'),
  directEvent('plan_shaping_feature_sync_analyze'),
  directEvent('plan_shaping_feature_sync_iterate'),
  directEvent('plan_shaping_finalize'),
  directEvent('plan_shaping_phase_breakdown'),
  directEvent('plan_shaping_proposed_stages'),
  directEvent('plan_shaping_refine_stage'),
  directEvent('plan_shaping_step_review'),
  directEvent('plan_shaping_visual_preview'),
  directEvent('repository_feature_enrichment'),
  directEvent('repository_first_work'),
  directEvent('repository_grounding'),
  directEvent('repository_placement'),
  directEvent('startup_session'),
  directEvent('work_tracker_connect'),
  directEvent('work_tracker_import'),
]);

/** A signed conversation trigger as admitted: its validated event and the exact signed bytes. */
export const storedTriggerFrameV10Schema = z.strictObject({
  conversationId: uuid.nullable(),
  /** The signed event as received, kept only for byte-for-byte replay matching. Never decoded. */
  signedEvent: z.json(),
  event: storedEvent,
});

const storedCollaborationPayloadV10Schema = z.object({
  kind: z.literal('session_message'),
  generation: z.number().int().positive(),
  platformAdmissionId: uuid,
  input: z.object({
    sourceSessionId: uuid,
    interactionId: uuid,
    attemptId: uuid,
    authorKind: z.literal('AGENT'),
    authority: z.object({
      kind: z.literal('MACHINE_SESSION'),
      machineId: uuid,
      sourceSessionId: uuid,
      targetSessionId: uuid,
      subagentCapability: z.literal('RESEARCH').optional(),
      expiresAt: z.string().optional(),
    }),
    objective: z.string().optional(),
    answerReference: uuid.optional(),
    answerText: z.string().optional(),
  }),
});

const storedRunFollowUpPayloadV10Schema = z.discriminatedUnion('origin', [
  z.object({
    kind: z.literal('run_follow_up'),
    origin: z.literal('permission_recovery'),
    requestId: z.string().min(1),
    agentInput: z.object({
      promptType: z.literal('coding_freeform'),
      userMessage: z.string().min(1),
    }),
  }),
  z.object({
    kind: z.literal('run_follow_up'),
    origin: z.literal('review_service_recovery'),
    replacesTurnId: z.string().min(1),
    requestId: z.string().min(1),
    agentInput: z.object({
      promptType: z.literal('code_review'),
      userMessage: z.string().optional(),
    }),
  }),
]);

const storedInputKindV10Schema = z.enum(['trigger_frame', 'session_message', 'run_follow_up']);
export type StoredInputKindV10 = z.infer<typeof storedInputKindV10Schema>;
export const storedPayloadV10Schemas = {
  trigger_frame: storedTriggerFrameV10Schema,
  session_message: storedCollaborationPayloadV10Schema,
  run_follow_up: storedRunFollowUpPayloadV10Schema,
} as const;
export type StoredPayloadV10 = {
  [K in StoredInputKindV10]: Exact<z.infer<(typeof storedPayloadV10Schemas)[K]>>;
};
export type StoredTriggerFrameV10 = StoredPayloadV10['trigger_frame'];
type StoredTriggerEventV10 = StoredTriggerFrameV10['event'];

const retry = z.strictObject({
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number(),
});
const LIFECYCLE_STATES = ['queued', 'picked', 'started', 'cancelled', 'failed', 'settled'] as const;

/** Everything but the payload, decoded strictly for every record whatever its state. */
const inputRecordEnvelopeV10Schema = z.strictObject({
  key: uuid,
  fingerprint: z.string(),
  agentSessionId: uuid,
  runId: uuid,
  organizationId: uuid,
  projectId: uuid,
  machineId: uuid,
  userId: uuid,
  messageId: uuid.nullable(),
  admissionId: uuid,
  sequence: z.number().int().nonnegative(),
  /** Null only for a cancellation that arrived before its input (a tombstone). */
  kind: storedInputKindV10Schema.nullable(),
  keyKind: z.enum(['operation', 'trigger_message']),
  payload: z.json().nullable(),
  state: z.enum(LIFECYCLE_STATES),
  admissionDisposition: z.enum(['immediate', 'queued']),
  turnId: uuid.nullable(),
  revision: z.number().int().positive(),
  projectedRevision: z.number().int().nonnegative(),
  projectionRetry: retry.optional(),
  settlement: z.json().nullable(),
  settlementDelivered: z.boolean(),
  /** Persisted settlement-delivery backoff; absent until the first delivery attempt. */
  settlementRetry: retry.optional(),
});

type EnvelopeV10 = Exact<z.infer<typeof inputRecordEnvelopeV10Schema>>;
type RecordFieldsV10 = Omit<EnvelopeV10, 'kind' | 'payload' | 'state'>;
const OPEN_STATES = ['queued', 'picked', 'started'] as const;
type OpenInputStateV10 = (typeof OPEN_STATES)[number];
type FinishedInputStateV10 = Exclude<EnvelopeV10['state'], OpenInputStateV10>;

/** An open record carries its typed payload, so delivery reads it without consulting the wire. */
export type OpenInputRecordV10 = {
  [K in StoredInputKindV10]: RecordFieldsV10 & {
    state: OpenInputStateV10;
    kind: K;
    payload: StoredPayloadV10[K];
  };
}[StoredInputKindV10];
/** Finished history replays from identity, state and outcome; its payload is never re-judged. */
export type FinishedInputRecordV10 = RecordFieldsV10 & {
  state: FinishedInputStateV10;
  kind: StoredInputKindV10 | null;
  payload: JsonValue | null;
};
export type ReadableInputRecordV10 = OpenInputRecordV10 | FinishedInputRecordV10;

export type RecordDecodeV10 =
  | { status: 'readable'; record: ReadableInputRecordV10 }
  | { status: 'quarantined'; key: string | null; reason: string };

const keyOf = (value: JsonValue): string | null =>
  isJsonObject(value) && typeof (value as { key?: unknown }).key === 'string'
    ? (value as { key: string }).key
    : null;
const isOpenState = (state: EnvelopeV10['state']): state is OpenInputStateV10 =>
  (OPEN_STATES as readonly string[]).includes(state);

export function decodeStoredRecordV10(value: JsonValue): RecordDecodeV10 {
  const envelope = inputRecordEnvelopeV10Schema.safeParse(value);
  if (!envelope.success)
    return { status: 'quarantined', key: keyOf(value), reason: z.prettifyError(envelope.error) };
  // JSON input has no explicit `undefined`, so the exact-optional view is sound.
  const record = envelope.data as EnvelopeV10;
  const quarantine = (reason: string): RecordDecodeV10 => ({
    status: 'quarantined',
    key: record.key,
    reason,
  });
  if (['picked', 'started', 'settled'].includes(record.state) && !record.turnId)
    return quarantine('Picked input must retain its selected execution identity.');
  if ((record.payload === null) !== (record.kind === null))
    return quarantine('Only a tombstone omits both its kind and its payload.');
  if (record.payload === null && record.state !== 'cancelled')
    return quarantine('Only a cancellation tombstone may omit executable input.');
  const { kind, payload, state, ...fields } = record;
  if (!isOpenState(state))
    return { status: 'readable', record: { ...fields, state, kind, payload } };
  if (kind === null) return quarantine('Open input has no stored kind.');
  const decoded = storedPayloadV10Schemas[kind].safeParse(payload);
  if (!decoded.success) return quarantine(z.prettifyError(decoded.error));
  return {
    status: 'readable',
    record: { ...fields, state, kind, payload: decoded.data } as OpenInputRecordV10,
  };
}

/** What settlement delivery reads from a settled collaboration input's otherwise opaque payload. */
const storedSettlementCorrelationV10Schema = z.object({
  generation: z.number().int().positive(),
  input: z.object({ interactionId: uuid, attemptId: uuid }),
});

/** Whether a stored trigger frame enters the shared Review handler, read from any state. */
export const storedReviewEntryV10Schema = z.object({
  event: z.object({
    promptType: z.literal('user_message'),
    payload: z.object({ handlerPromptType: z.literal('code_review') }),
  }),
});

/** Every schema that reads v10 data; the shipped-version registry fingerprints exactly these. */
export const inputQueueV10Schemas = {
  envelope: inputRecordEnvelopeV10Schema,
  ...storedPayloadV10Schemas,
  settlementCorrelation: storedSettlementCorrelationV10Schema,
  reviewEntry: storedReviewEntryV10Schema,
};
