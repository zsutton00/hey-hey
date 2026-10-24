import { ImplementPromptPayloadSchema } from '../../generated/coding-plan.schemas';
/**
 * Zod schemas mirroring the `triggersAgent.payload` wire shapes the platform
 * sends per `promptType`. Validated at the trigger-dispatch and message-service
 * boundaries so that load-bearing fields the
 * downstream handlers depend on are checked before the payload is forwarded
 * to `localAgentService.sendMessage`. A failed parse throws — the dispatcher
 * surfaces the error so a malformed trigger fails the run cleanly instead
 * of producing a context-blind agent turn.
 *
 * `triggerPayloadSchemas` is the per-promptType lookup the dispatcher uses,
 * keyed on the routing discriminator (`body.promptType` for direct
 * `trigger.conversation` variants, or the `start_run` / `user_message`
 * sentinels for the two envelope variants). Each registered schema validates
 * only what the type system cannot express at the producer: UUID/format of
 * load-bearing ids, enum membership of routing keys, and cross-field
 * invariants (the start-run arm XOR, `handlerPromptType === payload.promptType`).
 *
 * The full shape of `payload` on the start-run envelope is NOT re-validated
 * here — it `$ref`s the shared `RunCreatePayload` schema in
 * openapi/specs/schemas, so producer and consumer are generated from one
 * source of truth and a malformed-shape payload cannot be constructed by the
 * UI's TypeScript. `contextMetadata` is the deliberate exception: its shape is
 * shared too, but completeness is NOT a guarantee the producer actually honors
 * (the platform has shipped start-run frames whose `contextMetadata` carried
 * only `agentSessionId`, and an empty `organizationId`/`projectId` 404s the
 * downstream message POST). So its load-bearing fields are runtime-checked via
 * `isRunContextMetadata` — a malformed frame drops cleanly here instead of
 * materializing a run that cannot post.
 */

import { z } from 'zod';
import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import {
  AgentSkillCatalogScope,
  AgentSkillProvider,
  FeatureSyncDiscrepancyEntityTypeEnum,
  LocalPromptType,
  PlanShapingFeatureSyncItemDecisionChoiceEnum,
  RepositoryGroundingRequestProviderEnum,
  RepositoryGroundingRequestReasoningEffortEnum,
  RepositoryFeatureEnrichmentRequestProviderEnum,
  RepositoryFeatureEnrichmentRequestReasoningEffortEnum,
  RepositoryFirstWorkRequestProviderEnum,
  RepositoryFirstWorkRequestReasoningEffortEnum,
  RepositoryPlacementRequestProviderEnum,
  RepositoryPlacementRequestReasoningEffortEnum,
  PlanShapingValidationMode,
  SessionMonitorCompletedAssistantMessage,
  SessionMonitorSettledTurnEvidence,
  SessionMonitorSettledTurnEvidenceTerminalOutcomeEnum,
  SessionMonitorSettledTurnReport,
  TaskMonitorLifecycleCause,
  TaskMonitorLaunchMethod,
  TaskMonitorLaunchProvider,
  TaskMonitorReasoningEffort,
  type RepositoryGroundingRequest,
  type RepositoryFeatureEnrichmentRequest,
  type RepositoryFirstWorkRequest,
  type RepositoryPlacementRequest,
  type RunCreatePayloadProjectReport,
  type RunCreatePayloadReleaseNotes,
  type TaskMonitorJudgmentResponse,
  type TaskMonitorLaunchConfig,
  type TaskMonitorPromptPayload,
  type AgentSkillSelection,
  type FeatureSyncDiscrepancy,
  type PlanShapingFeatureSyncItemDecision,
  type StartRunWorktree,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import { runEntityReferenceSchema } from '../../run/run-entity';
import type { LocalCreateRunPayload } from '../../shared/agent-bridge-contract/contract';
import {
  isRunContextMetadata,
  type LocalRunContextMetadata,
} from '../../shared/agent-bridge-contract/run-context';
import {
  AgentSessionConfig,
  StartRunPromptPayload,
  UserMessagePromptPayload,
  WorkflowName,
} from '../../shared/api/generated/api';
import { isAgentSessionConfig } from '../../shared/agent-bridge-contract/config-validation';
import {
  journeyStepSchema,
  phaseBreakdownPriorPhaseSchema,
  phaseBreakdownStepSchema,
} from '../../agents/plan-shaping/journey-map.schemas';
import { repositoryGroundingSuccessSchema } from '../../agents/repository-analysis/schemas';
import { workTrackerRequestSchema } from '../../agents/work-tracker-import/schemas';
import { createAgentBridgeRuntimeValidator } from '../../shared/agent-bridge-contract/runtime-schema-validator';

const agentSkillSelectionSchema = z
  .object({
    provider: z.nativeEnum(AgentSkillProvider),
    name: z.string().min(1).max(200),
    catalogScope: z.nativeEnum(AgentSkillCatalogScope),
  })
  .strict() satisfies z.ZodType<AgentSkillSelection>;

const featureSyncDiscrepancyShape = {
  id: z.string().optional(),
  summary: z.string(),
  rationale: z.string(),
  entityType: z.nativeEnum(FeatureSyncDiscrepancyEntityTypeEnum).optional(),
  entityId: z.string().optional(),
  proposal: z.string().optional(),
} satisfies Record<keyof FeatureSyncDiscrepancy, z.ZodTypeAny>;

const featureSyncDiscrepancySchema = z.object(featureSyncDiscrepancyShape);

const planShapingFeatureSyncItemDecisionShape = {
  itemId: z.string(),
  choice: z.nativeEnum(PlanShapingFeatureSyncItemDecisionChoiceEnum),
  note: z.string().optional(),
} satisfies Record<keyof PlanShapingFeatureSyncItemDecision, z.ZodTypeAny>;

const planShapingFeatureSyncItemDecisionSchema = z.object(planShapingFeatureSyncItemDecisionShape);

const featureSyncIteratePayloadFields = {
  discrepancies: z.array(featureSyncDiscrepancySchema),
  userMessage: z.string().optional(),
};

const featureSyncIteratePayloadSchema = z.object(featureSyncIteratePayloadFields);
const featureSyncIterateUserMessageContextSchema = z
  .object({ discrepancies: z.array(featureSyncDiscrepancySchema) })
  .strict();

const planShapingFeatureSyncIteratePayloadFields = {
  discrepancies: z.array(featureSyncDiscrepancySchema),
  decisions: z.array(planShapingFeatureSyncItemDecisionSchema),
  userMessage: z.string().optional(),
};

const planShapingFeatureSyncIteratePayloadSchema = z.object(
  planShapingFeatureSyncIteratePayloadFields,
);
const planShapingFeatureSyncIterateUserMessageContextSchema = z
  .object({
    discrepancies: z.array(featureSyncDiscrepancySchema),
    decisions: z.array(planShapingFeatureSyncItemDecisionSchema),
  })
  .strict();

const featureSyncUserMessageContextSchema = z.union([
  featureSyncIterateUserMessageContextSchema,
  planShapingFeatureSyncIterateUserMessageContextSchema,
]);

// Mirror of the plan-shaping proposed-stages wire payload — the agent's
// first prompt embeds `@[design_doc:<designDocId>|...]` and
// `@[plan:<planId>|...]` mentions, so a missing or non-UUID id renders a
// broken mention and the agent loses its grounding silently. Validating
// here turns that into a loud `TriggerPayloadValidationError` at the
// dispatcher boundary instead.
const planShapingProposedStagesPayloadSchema = z.object({
  designDocId: z.string().uuid({ message: 'designDocId must be a UUID' }),
  planId: z.string().uuid({ message: 'planId must be a UUID' }),
  userMessage: z.string().optional(),
});

const isStartRunWorktreePayload = (
  value: unknown,
): value is NonNullable<StartRunPromptPayload['worktree']> => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { enabled?: unknown; branch?: unknown };
  return (
    typeof record.enabled === 'boolean' &&
    (record.branch === undefined || (typeof record.branch === 'string' && record.branch.length > 0))
  );
};

// Mirror of the plan-shaping refine-stage wire payload. The agent is
// anchored on a single stage of an existing plan and expands its theme
// rows into concrete step proposals — so the load-bearing identifiers
// are `planId` and `stageId`, not the design doc. The only flag carried
// on the wire is `validation`. Validating here turns
// a missing or malformed payload into a loud `TriggerPayloadValidationError`
// at the dispatcher boundary instead of a context-blind agent turn.
const planShapingRefineStagePayloadSchema = z.object({
  planId: z.string().uuid({ message: 'planId must be a UUID' }),
  stageId: z.string().uuid({ message: 'stageId must be a UUID' }),
  validation: z.enum([PlanShapingValidationMode.On, PlanShapingValidationMode.Off], {
    errorMap: () => ({
      message: `validation must be one of ${PlanShapingValidationMode.On} | ${PlanShapingValidationMode.Off}`,
    }),
  }),
  userMessage: z.string().optional(),
});

// Mirror of the feature-tree-conversation wire payload. The handler's
// `prepare()` fetches the project's feature skeleton from `projectId` and
// injects the result into the system prompt, so a missing or malformed
// `projectId` produces a context-blind agent turn. Validating here turns
// that into a loud `TriggerPayloadValidationError` at the dispatcher
// boundary instead.
const featureTreeConversationPayloadSchema = z.object({
  projectId: z.string().uuid({ message: 'projectId must be a UUID' }),
  userMessage: z.string().optional(),
});

const codeReviewPromptPayloadSchema = z.object({ userMessage: z.string().optional() }).strict();

const runtimeSelectionSchema = z
  .object({
    provider: z.nativeEnum(LocalRunProvider),
    model: z.string().min(1),
    reasoningEffort: z.nativeEnum(LocalReasoningEffort).optional(),
    fastMode: z.boolean().optional(),
  })
  .strict();

const implementPromptPayloadSchema = ImplementPromptPayloadSchema.optional();

const repositoryGroundingBoundsSchema = z
  .object({
    maxFiles: z.number().int().min(1),
    maxTotalBytes: z.number().int().min(1),
    maxFileBytes: z.number().int().min(1),
    maxDepth: z.number().int().min(0),
    maxGeneratedFiles: z.number().int().min(0),
    maxIgnoredFiles: z.number().int().min(0),
    maxUnsupportedFiles: z.number().int().min(0),
    maxBinaryFiles: z.number().int().min(0),
  })
  .strict();

const repositoryGroundingScopeSchema = z.discriminatedUnion('scope', [
  z
    .object({
      scope: z.literal('focused'),
      focus: z.string().min(1),
    })
    .strict(),
  z
    .object({
      scope: z.literal('comprehensive'),
    })
    .strict(),
]);

const repositoryGroundingPayloadShape = {
  promptType: z.literal(LocalPromptType.RepositoryGrounding).optional(),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowNodeId: z.string().min(1),
  entryMode: z.enum(['new_project', 'existing_project']),
  serviceId: z.string().uuid(),
  confirmedServiceBrief: z.string().min(1),
  machineId: z.string().uuid(),
  scope: repositoryGroundingScopeSchema,
  provider: z.nativeEnum(RepositoryGroundingRequestProviderEnum),
  resolvedFrontierModel: z.string().min(1),
  reasoningEffort: z.nativeEnum(RepositoryGroundingRequestReasoningEffortEnum),
  fastMode: z.boolean().optional(),
  bounds: repositoryGroundingBoundsSchema,
} satisfies Record<keyof RepositoryGroundingRequest, z.ZodTypeAny>;

const repositoryGroundingPayloadSchema = z.object(repositoryGroundingPayloadShape).strict();

const repositoryFeatureEnrichmentAnswerBatchSchema = z
  .object({
    round: z.number().int().min(1).max(2),
    answers: z
      .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }).strict())
      .min(1)
      .max(3),
  })
  .strict();

const reviewedCandidatesValidator = createAgentBridgeRuntimeValidator<
  RepositoryFeatureEnrichmentRequest['reviewedCandidates']
>('RepositoryGroundingSuccess/properties/hierarchy');

const repositoryFeatureEnrichmentPayloadShape = {
  promptType: z.literal(LocalPromptType.RepositoryFeatureEnrichment).optional(),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowNodeId: z.string().min(1),
  serviceId: z.string().uuid(),
  machineId: z.string().uuid(),
  provider: z.nativeEnum(RepositoryFeatureEnrichmentRequestProviderEnum),
  resolvedFrontierModel: z.string().min(1),
  reasoningEffort: z.nativeEnum(RepositoryFeatureEnrichmentRequestReasoningEffortEnum),
  fastMode: z.boolean().optional(),
  analysis: repositoryGroundingSuccessSchema,
  reviewedCandidates: z.custom<RepositoryFeatureEnrichmentRequest['reviewedCandidates']>(
    (value) => reviewedCandidatesValidator(value),
    { message: 'Reviewed candidates must satisfy the repository hierarchy contract.' },
  ),
  completedRounds: z.number().int().min(0).max(2),
  answerBatches: z.array(repositoryFeatureEnrichmentAnswerBatchSchema).max(2),
} satisfies Record<keyof RepositoryFeatureEnrichmentRequest, z.ZodTypeAny>;

const repositoryFeatureEnrichmentPayloadSchema = z
  .object(repositoryFeatureEnrichmentPayloadShape)
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.completedRounds !== value.answerBatches.length ||
      value.answerBatches.some((batch, index) => batch.round !== index + 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answerBatches'],
        message: 'answer batches must be ordered and match completedRounds',
      });
    }
    if (
      value.analysis.serviceId !== value.serviceId ||
      value.analysis.provider !== value.provider ||
      value.analysis.resolvedFrontierModel !== value.resolvedFrontierModel
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['analysis'],
        message: 'analysis identity must match the accepted request',
      });
    }
  });

const repositoryFirstWorkPayloadShape = {
  promptType: z.literal(LocalPromptType.RepositoryFirstWork).optional(),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowNodeId: z.string().min(1),
  serviceId: z.string().uuid(),
  machineId: z.string().uuid(),
  provider: z.nativeEnum(RepositoryFirstWorkRequestProviderEnum),
  resolvedFrontierModel: z.string().min(1),
  reasoningEffort: z.nativeEnum(RepositoryFirstWorkRequestReasoningEffortEnum),
  fastMode: z.boolean().optional(),
  analysis: repositoryGroundingSuccessSchema,
  materializedFeatureIds: z.array(z.string().uuid()).min(1),
  workRequest: z.string().min(1),
  followUpRoundCount: z.number().int().min(0).max(1),
  followUpAnswers: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }).strict())
    .max(3),
} satisfies Record<keyof RepositoryFirstWorkRequest, z.ZodTypeAny>;

const repositoryFirstWorkPayloadSchema = z
  .object(repositoryFirstWorkPayloadShape)
  .strict()
  .superRefine((value, ctx) => {
    if ((value.followUpRoundCount === 0) !== (value.followUpAnswers.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['followUpAnswers'],
        message: 'follow-up answers must be present exactly when a follow-up round was used',
      });
    }
  });

const repositoryPlacementCandidateChildSchema = z
  .object({
    childKey: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    tag: z.enum(['product', 'frontend', 'backend', 'infra', 'design', 'AI']),
  })
  .strict();

const repositoryPlacementCandidateRootSchema = z
  .object({
    rootKey: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    tag: z.enum(['product', 'frontend', 'backend', 'infra', 'design', 'AI']),
    children: z.array(repositoryPlacementCandidateChildSchema),
  })
  .strict();

const repositoryPlacementPayloadShape = {
  promptType: z.literal(LocalPromptType.RepositoryPlacement).optional(),
  projectId: z.string().uuid(),
  conversationId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowNodeId: z.string().min(1),
  serviceId: z.string().uuid(),
  machineId: z.string().uuid(),
  provider: z.nativeEnum(RepositoryPlacementRequestProviderEnum),
  resolvedFrontierModel: z.string().min(1),
  reasoningEffort: z.nativeEnum(RepositoryPlacementRequestReasoningEffortEnum),
  fastMode: z.boolean().optional(),
  candidates: z.array(repositoryPlacementCandidateRootSchema),
  instructions: z.array(
    z.object({ rootKey: z.string().uuid(), instruction: z.string().min(1) }).strict(),
  ),
} satisfies Record<keyof RepositoryPlacementRequest, z.ZodTypeAny>;

const repositoryPlacementPayloadSchema = z
  .object(repositoryPlacementPayloadShape)
  .strict()
  .superRefine((value, ctx) => {
    const roots = new Set(value.candidates.map((candidate) => candidate.rootKey));
    const instructionRoots = new Set<string>();
    for (const instruction of value.instructions) {
      if (!roots.has(instruction.rootKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['instructions'],
          message: 'instruction rootKey is unknown',
        });
      }
      if (instructionRoots.has(instruction.rootKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['instructions'],
          message: 'instruction rootKey is duplicated',
        });
      }
      instructionRoots.add(instruction.rootKey);
    }
    if (instructionRoots.size !== roots.size) {
      ctx.addIssue({
        code: 'custom',
        path: ['instructions'],
        message: 'every root requires one instruction',
      });
    }
  });

// The JourneyStep / ServiceNote shapes embedded in the phase-breakdown
// wire payload are defined in `agents/plan-shaping/journey-map.schemas.ts`.
// Phase-breakdown turns render
// the journey step's title/description/implementationNotes directly, so a
// malformed step produces a context-blind turn.

// The approved Mockups and Diagrams phase-breakdown and step-review prompts render as binding.
const planShapingApprovedVisualSchema = z.object({
  proposalId: z.string().uuid(),
  entityId: z.string().uuid(),
  entityType: z.enum(['MOCKUP', 'DIAGRAM']),
  title: z.string().min(1),
  summary: z.string(),
});

// Mirror of the plan-shaping phase-breakdown wire payload. Each turn
// fires once per journey step; phase identity is the 2-D
// `(stageIdx, phaseIdx)` cursor owned by `accumulatedPhases` on the
// API-side FlowContext, and the API stamps the derived cursor onto the
// trigger. `stageIdx`, `phaseIdx`, and `totalPhases` are load-bearing —
// the prompt renders the "phase N of M" header and the agent must echo
// the `(stageIdx, phaseIdx)` cursor back on its submission so the API
// can detect mismatch. `designDocId` and `planId` anchor the same reads
// the other plan-shaping nodes perform. `priorPhases` carries every
// earlier phase's steps-only plan output — the prompt renders it as the
// inter-phase handoff, so it must be listed here or `z.object` strips
// it before the handler ever sees it. Validating here turns a malformed
// payload into a loud `TriggerPayloadValidationError` at the dispatcher
// boundary instead of a context-blind agent turn.
const planShapingPhaseBreakdownPayloadSchema = z.object({
  journeyStep: journeyStepSchema,
  stageIdx: z
    .number()
    .int({ message: 'stageIdx must be an integer' })
    .min(0, { message: 'stageIdx must be >= 0' }),
  phaseIdx: z
    .number()
    .int({ message: 'phaseIdx must be an integer' })
    .min(0, { message: 'phaseIdx must be >= 0' }),
  phasesInStage: z
    .number()
    .int({ message: 'phasesInStage must be an integer' })
    .min(1, { message: 'phasesInStage must be >= 1' }),
  totalPhases: z
    .number()
    .int({ message: 'totalPhases must be an integer' })
    .min(1, { message: 'totalPhases must be >= 1' }),
  designDocId: z.string().uuid({ message: 'designDocId must be a UUID' }),
  planId: z.string().uuid({ message: 'planId must be a UUID' }),
  priorPhases: z.array(phaseBreakdownPriorPhaseSchema).optional(),
  approvedVisuals: z.array(planShapingApprovedVisualSchema),
  userMessage: z.string().optional(),
});

// Mirror of the plan-shaping step-review wire payload. Each turn fires once
// per stage after phase-breakdown finishes; the API derives the stage cursor
// from the stages already reviewed and stamps `stageIdx` onto the trigger.
// `steps` carries the stage's drafted steps (flattened across its phases) the
// prompt renders inline for the tightening pass, so a malformed step produces
// a context-blind turn; `stageIdx` and `totalStages` back the position header
// and the agent must echo `stageIdx` back so the API can detect mismatch.
// `designDocId` anchors the design-doc body the handler injects at prepare().
// Validating here turns a malformed payload into a loud
// `TriggerPayloadValidationError` at the dispatcher boundary instead of a
// context-blind agent turn.
const planShapingStepReviewPayloadSchema = z.object({
  steps: z.array(phaseBreakdownStepSchema),
  stageIdx: z
    .number()
    .int({ message: 'stageIdx must be an integer' })
    .min(0, { message: 'stageIdx must be >= 0' }),
  totalStages: z
    .number()
    .int({ message: 'totalStages must be an integer' })
    .min(1, { message: 'totalStages must be >= 1' }),
  designDocId: z.string().uuid({ message: 'designDocId must be a UUID' }),
  planId: z.string().uuid({ message: 'planId must be a UUID' }),
  approvedVisuals: z.array(planShapingApprovedVisualSchema),
  userMessage: z.string().optional(),
});

// ──────────────────────────────────────────────────────────────────────────
// Compile-time drift helpers
//
// `Equal` / `KeysMatch` / `Expect` back the envelope drift assertions further
// down (zod envelope shape vs. the API-generated `StartRunPromptPayload` /
// `UserMessagePromptPayload` producer types). The per-variant payload mirrors
// that used to live here are gone: `payload` / `contextMetadata` now `$ref`
// the shared `RunCreatePayload` / `RunContextMetadata` schemas, so the
// producer and consumer are generated from one source and there is no second
// definition to assert sameness against.
// ──────────────────────────────────────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type KeysMatch<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

type Expect<T extends true> = T;

// Sentinel `promptType` for the user-message follow-up trigger variant. The
// CLI dispatcher branches on this literal before any LocalPromptType cast;
// the real handler routing key the run dispatches against lives on
// `payload.handlerPromptType`, not on the top-level discriminator.
export const USER_MESSAGE_TRIGGER_SENTINEL = 'user_message' as const;

// Sentinel `promptType` for the start-run envelope variant. The CLI dispatcher
// branches on this literal to materialize a fresh local Run from the embedded
// `StartRunPromptPayload`; the real handler routing key lives on
// `payload.handlerPromptType`, mirroring the user-message sentinel pattern.
export const START_RUN_TRIGGER_SENTINEL = 'start_run' as const;

const taskMonitorWorktreeShape = {
  enabled: z.boolean(),
  branch: z.string().min(1).optional(),
} satisfies Record<keyof StartRunWorktree, z.ZodTypeAny>;

const taskMonitorLaunchConfigShape = {
  taskId: z.string().uuid(),
  method: z.nativeEnum(TaskMonitorLaunchMethod),
  provider: z.nativeEnum(TaskMonitorLaunchProvider),
  model: z.string().min(1),
  reasoningEffort: z.nativeEnum(TaskMonitorReasoningEffort),
  fastMode: z.boolean().optional(),
  worktree: z.object(taskMonitorWorktreeShape).strict().optional(),
} satisfies Record<keyof TaskMonitorLaunchConfig, z.ZodTypeAny>;

const taskMonitorLaunchConfigSchema = z.object(taskMonitorLaunchConfigShape).strict();

const taskMonitorJudgmentResponseShape = {
  requestMessageId: z.string().uuid(),
  label: z.string().min(1).max(240),
  conclusion: z.string().min(1).max(500),
} satisfies Record<keyof TaskMonitorJudgmentResponse, z.ZodTypeAny>;

const taskMonitorJudgmentResponseSchema = z.object(taskMonitorJudgmentResponseShape).strict();

const taskMonitorCompletedAssistantMessageShape = {
  messageId: z.string().uuid(),
  content: z.string().min(1),
} satisfies Record<keyof SessionMonitorCompletedAssistantMessage, z.ZodTypeAny>;

const taskMonitorCompletedAssistantMessageSchema = z
  .object(taskMonitorCompletedAssistantMessageShape)
  .strict();

const taskMonitorSettledTurnReportShape = {
  reportId: z.string().uuid(),
  reportType: z.string().min(1),
} satisfies Record<keyof SessionMonitorSettledTurnReport, z.ZodTypeAny>;

const taskMonitorSettledTurnReportSchema = z.object(taskMonitorSettledTurnReportShape).strict();

const taskMonitorSettledTurnEvidenceShape = {
  turnId: z.string().uuid(),
  promptType: z.string().min(1),
  terminalOutcome: z.nativeEnum(SessionMonitorSettledTurnEvidenceTerminalOutcomeEnum),
  completedAssistantMessage: taskMonitorCompletedAssistantMessageSchema.nullable(),
  reports: z.array(taskMonitorSettledTurnReportSchema),
} satisfies Record<keyof SessionMonitorSettledTurnEvidence, z.ZodTypeAny>;

const taskMonitorSettledTurnEvidenceSchema = z.object(taskMonitorSettledTurnEvidenceShape).strict();

const taskMonitorPromptPayloadShape = {
  coordinatorAttemptId: z.string().uuid().optional(),
  correction: z
    .object({
      attempt: z.number().int().min(1).max(2),
      validationFailure: z
        .object({ code: z.string(), message: z.string(), issues: z.array(z.string()) })
        .strict(),
    })
    .strict()
    .optional(),
  monitorId: z.string().uuid(),
  cause: z.nativeEnum(TaskMonitorLifecycleCause),
  correlationId: z.string().uuid(),
  userMessage: z.string().optional(),
  launchConfig: taskMonitorLaunchConfigSchema.optional(),
  judgment: taskMonitorJudgmentResponseSchema.optional(),
  settledTurn: taskMonitorSettledTurnEvidenceSchema.optional(),
} satisfies Record<keyof TaskMonitorPromptPayload, z.ZodTypeAny>;

const taskMonitorPromptPayloadSchema = z.object(taskMonitorPromptPayloadShape).strict();

// Mirror of the user-message follow-up wire payload. `handlerPromptType` may
// be any known LocalPromptType — a follow-up turn re-enters whatever handler
// the run is currently paused on, so it is not narrowed to the follow-up-only
// union. `contextMetadata` is the sole start-only field, so its absence (not
// the handler type) is what distinguishes a `user_message` from a `start_run`.
// `userMessage` is the user's text body; both fields are load-bearing — missing
// `handlerPromptType` produces a context-blind dispatch, and for every handler
// that does not declare `allowsEmptyUserMessage` an empty `userMessage`
// produces a context-blind, empty-bodied turn, so it is gated non-empty there.
const createUserMessagePayloadSchema = (promptTypeRegistry: PromptTypeRegistry) =>
  z
    .object({
      handlerPromptType: z.nativeEnum(LocalPromptType, {
        errorMap: () => ({
          message: 'handlerPromptType must be a known LocalPromptType',
        }),
      }),
      userMessage: z.string(),
      attachments: z.array(
        z.object({ attachmentId: z.string().uuid(), fileName: z.string().min(1) }).strict(),
      ),
      skillSelection: agentSkillSelectionSchema.optional(),
      taskMonitorPayload: taskMonitorPromptPayloadSchema.optional(),
      featureSyncContext: featureSyncUserMessageContextSchema.optional(),
      runtime: runtimeSelectionSchema.optional(),
    })
    .superRefine((data, ctx) => {
      if (
        data.userMessage.length === 0 &&
        promptTypeRegistry.get(data.handlerPromptType)?.allowsEmptyUserMessage !== true
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['userMessage'],
          message: 'userMessage must be a non-empty string',
        });
      }
      if (
        data.handlerPromptType === LocalPromptType.TaskMonitor &&
        data.taskMonitorPayload === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskMonitorPayload'],
          message: 'taskMonitorPayload is required for task_monitor follow-ups',
        });
      }
      if (
        data.handlerPromptType !== LocalPromptType.TaskMonitor &&
        data.taskMonitorPayload !== undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskMonitorPayload'],
          message: 'taskMonitorPayload is only valid for task_monitor follow-ups',
        });
      }
      const isFeatureSyncIterate = data.handlerPromptType === LocalPromptType.FeatureSyncIterate;
      const isPlanShapingFeatureSyncIterate =
        data.handlerPromptType === LocalPromptType.PlanShapingFeatureSyncIterate;
      const requiresFeatureSyncContext = isFeatureSyncIterate || isPlanShapingFeatureSyncIterate;
      if (requiresFeatureSyncContext && data.featureSyncContext === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['featureSyncContext'],
          message: 'featureSyncContext is required for feature-sync iterate follow-ups',
        });
      }
      if (!requiresFeatureSyncContext && data.featureSyncContext !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['featureSyncContext'],
          message: 'featureSyncContext is only valid for feature-sync iterate follow-ups',
        });
      }
      if (
        isFeatureSyncIterate &&
        data.featureSyncContext !== undefined &&
        'decisions' in data.featureSyncContext
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['featureSyncContext', 'decisions'],
          message: 'decisions are only valid for plan-shaping feature-sync iterate follow-ups',
        });
      }
      if (
        isPlanShapingFeatureSyncIterate &&
        data.featureSyncContext !== undefined &&
        !('decisions' in data.featureSyncContext)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['featureSyncContext', 'decisions'],
          message: 'decisions are required for plan-shaping feature-sync iterate follow-ups',
        });
      }
      if (
        data.runtime !== undefined &&
        data.handlerPromptType !== LocalPromptType.Commit &&
        data.handlerPromptType !== LocalPromptType.CodeReview
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['runtime'],
          message: 'runtime is only valid for commit and code_review follow-ups',
        });
      }
    });

const workflowKickoffPayloadSchema = z
  .object({
    promptType: z.literal('workflow_kickoff'),
    entity: runEntityReferenceSchema.optional(),
    userMessage: z.string(),
  })
  .strict();

// `payload` and `contextMetadata` are typed directly from the shared
// generated producer types (`RunCreatePayload` / `RunContextMetadata`) via
// `z.custom` — no shape re-validation, since both sides are generated from
// one OpenAPI source. The outer object still refines that
// `handlerPromptType === payload.promptType`: the envelope's routing key (the
// value the dispatcher uses to materialize the run) must match the payload's
// own discriminator. A `start_run` carrying a `coding_freeform` payload is a
// shape the producer's TypeScript cannot construct (`RunCreatePayload` has no
// such member), so it is caught at compile time rather than re-checked here.
const startRunPayloadSchema = z
  .object({
    runId: z.string().uuid().optional(),
    // `handlerPromptType` + `payload` are the turn-firing arm; `workflowName`
    // is the materialize-only arm and may optionally carry a
    // `workflow_kickoff` payload. Exactly one arm is present per envelope
    // (enforced by the arm-XOR refine below), so all three are optional at the
    // field level. The materialization context fields
    // (model/provider/contextMetadata/serviceIds/agentSessionId) are required on
    // both arms — the CLI needs them to create the Run either way. `reasoningEffort`
    // is optional: providers like OpenCode do not support reasoning-effort controls
    // and omit the field entirely.
    attachments: z
      .array(z.object({ attachmentId: z.string().uuid(), fileName: z.string().min(1) }).strict())
      .optional(),
    stagedBrowserTab: z.object({ stagedTabId: z.string().uuid() }).strict().nullable().optional(),
    triggersAgent: z.boolean().optional(),
    handlerPromptType: z
      .nativeEnum(LocalPromptType, {
        errorMap: () => ({
          message: 'handlerPromptType must be a known LocalPromptType',
        }),
      })
      .optional(),
    payload: z.custom<LocalCreateRunPayload>().optional(),
    workflowName: z
      .nativeEnum(WorkflowName, {
        errorMap: () => ({ message: 'workflowName must be a known WorkflowName' }),
      })
      .optional(),
    model: z.string().min(1, { message: 'model must be a non-empty string' }),
    // Optional: providers like OpenCode do not support reasoning effort controls
    reasoningEffort: z
      .nativeEnum(LocalReasoningEffort, {
        errorMap: () => ({
          message: 'reasoningEffort must be a known LocalReasoningEffort',
        }),
      })
      .optional(),
    config: z
      .custom<AgentSessionConfig | null>((val) => isAgentSessionConfig(val), {
        message: 'config must be a valid AgentSession config object or null',
      })
      .optional(),
    provider: z.nativeEnum(LocalRunProvider, {
      errorMap: () => ({ message: 'provider must be a known LocalRunProvider' }),
    }),
    fastMode: z.boolean().optional(),
    skillSelection: agentSkillSelectionSchema.optional(),
    // Shape is the shared `RunContextMetadata` generated type, so the field is
    // typed via `z.custom` rather than re-mirrored. But completeness is NOT a
    // guarantee the producer actually honors — the platform has shipped
    // `start_run` frames whose `contextMetadata` carried only `agentSessionId`,
    // and an empty `organizationId`/`projectId` 404s the message POST
    // downstream (`/organizations//projects/.../messages`). So we runtime-check
    // the load-bearing fields with the SAME predicate the daily-session route
    // uses (`isRunContextMetadata`): a malformed frame drops cleanly at the
    // dispatcher boundary instead of materializing a poisoned run.
    contextMetadata: z.custom<LocalRunContextMetadata>((val) => isRunContextMetadata(val), {
      message:
        'contextMetadata is missing required fields (organizationId, projectId, capturedAt, agentSessionId, userComments, fileReferences)',
    }),
    // Multi-service: the producer (`StartRunPromptPayload`) carries the full
    // service set plus the launch service. Mirror both — a stale scalar
    // `serviceId` here would be stripped at validation, leaving the Run with no
    // services and a 422 from the diff endpoint. Field-level optionality matches
    // the generated type; the `launchServiceId ∈ serviceIds` membership invariant
    // is enforced downstream in `parsePendingRunContext`.
    serviceIds: z
      .array(z.string().min(1, { message: 'serviceIds entries must be non-empty strings' }))
      .optional(),
    launchServiceId: z
      .string()
      .min(1, { message: 'launchServiceId must be a non-empty string' })
      .optional(),
    worktree: z
      .custom<NonNullable<StartRunPromptPayload['worktree']>>(isStartRunWorktreePayload, {
        message: 'worktree must include enabled:boolean and optional non-empty branch',
      })
      .optional(),
    agentSessionId: z.string().min(1, { message: 'agentSessionId must be a non-empty string' }),
  })
  .superRefine((data, ctx) => {
    if (data.fastMode !== undefined && data.provider === LocalRunProvider.Opencode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'fastMode is supported only when provider is codex or claude',
        path: ['fastMode'],
      });
    }

    const reportPromptType = data.handlerPromptType;
    if (
      reportPromptType !== LocalPromptType.ProjectReport &&
      reportPromptType !== LocalPromptType.ReleaseNotes
    ) {
      return;
    }

    const projectReportPayloadSchema = z
      .object({
        promptType: z.literal(reportPromptType),
        request: z
          .object({
            requestId: z.string().uuid(),
            attemptId: z.string().uuid(),
            projectId: z.string().uuid(),
          })
          .strict(),
      })
      .strict() satisfies z.ZodType<RunCreatePayloadProjectReport | RunCreatePayloadReleaseNotes>;
    const projectReportPayload = projectReportPayloadSchema.safeParse(data.payload);
    if (!projectReportPayload.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} payload must carry valid request, attempt, and project UUIDs`,
        path: ['payload'],
      });
      return;
    }

    const reportConfig = data.config;
    if (reportConfig?.type !== 'PROJECT_REPORT' || reportConfig.version !== 'v1') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} requires a PROJECT_REPORT v1 AgentSession config`,
        path: ['config'],
      });
      return;
    }

    if (reportConfig.requestId !== projectReportPayload.data.request.requestId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} config requestId must match payload.request.requestId`,
        path: ['config', 'requestId'],
      });
    }
    if (reportConfig.attemptId !== projectReportPayload.data.request.attemptId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} config attemptId must match payload.request.attemptId`,
        path: ['config', 'attemptId'],
      });
    }
    if (projectReportPayload.data.request.projectId !== data.contextMetadata.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} request projectId must match contextMetadata.projectId`,
        path: ['payload', 'request', 'projectId'],
      });
    }
    if (reportPromptType === LocalPromptType.ProjectReport) {
      if (data.serviceIds !== undefined && data.serviceIds.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'project_report cannot carry Service repository scope',
          path: ['serviceIds'],
        });
      }
      if (data.launchServiceId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'project_report cannot carry a launch Service',
          path: ['launchServiceId'],
        });
      }
    } else if (data.serviceIds === undefined || data.serviceIds.length === 0) {
      // release_notes reads every project Service repository's default branch.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'release_notes requires the project Service repository scope',
        path: ['serviceIds'],
      });
    } else if (data.launchServiceId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'release_notes requires a launch Service',
        path: ['launchServiceId'],
      });
    }
    if (data.worktree !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} cannot carry a worktree`,
        path: ['worktree'],
      });
    }
    if (reportConfig.model !== data.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} config model must match the signed launch model`,
        path: ['config', 'model'],
      });
    }
    if (reportConfig.effort !== undefined && reportConfig.effort !== data.reasoningEffort) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} config effort must match the signed launch reasoningEffort`,
        path: ['config', 'effort'],
      });
    }
    if (reportConfig.fastMode !== undefined && reportConfig.fastMode !== data.fastMode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${reportPromptType} config fastMode must match the signed launch fastMode`,
        path: ['config', 'fastMode'],
      });
    }
  })
  // Exactly one arm. The workflow arm carries `workflowName`, no
  // `handlerPromptType`, and either no payload (bind-only) or a typed
  // `workflow_kickoff` payload. The turn-firing arm carries both
  // `handlerPromptType` and `payload` and no `workflowName`. A partial
  // turn-firing arm (handler without payload, or vice versa) is rejected here
  // too — both must be present together.
  .refine(
    (data) => {
      const materializeOnly = data.workflowName != null;
      const turnFiring = data.handlerPromptType != null && data.payload != null;
      return materializeOnly
        ? data.handlerPromptType == null &&
            (data.payload == null || workflowKickoffPayloadSchema.safeParse(data.payload).success)
        : turnFiring;
    },
    {
      message:
        'start_run must carry either workflowName with an optional valid workflow_kickoff payload (materialize-only) or both handlerPromptType and payload (turn-firing), never both and never a partial arm',
      path: ['workflowName'],
    },
  )
  // On the turn-firing arm the envelope routing key must match the payload's
  // own discriminator. The materialize-only arm has no handler routing key;
  // its optional payload was validated as `workflow_kickoff` above.
  .refine(
    (data) => data.workflowName != null || data.handlerPromptType === data.payload?.promptType,
    {
      message: 'handlerPromptType must equal payload.promptType',
      path: ['handlerPromptType'],
    },
  );

export type StartRunTriggerPayload = z.infer<typeof startRunPayloadSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Compile-time drift assertions: envelope zod vs. API-generated producer types
//
// The producer contract is the API-side `StartRunPromptPayload` and
// `UserMessagePromptPayload`. These bind each hand-written envelope schema's
// inferred shape to its generated counterpart so adding, dropping, or renaming
// an envelope field on the API side fails `pnpm typecheck` rather than silently
// dropping triggers at runtime as `payload_validation_failed`.
//
// `handlerPromptType` is asserted by field-set membership only (a plain string
// the CLI narrows to `LocalPromptType`). `payload` / `contextMetadata` carry
// the shared generated types verbatim (`z.custom<RunCreatePayload>` /
// `z.custom<RunContextMetadata>`), so they need no separate drift assertion —
// the type IS the producer type.
// ──────────────────────────────────────────────────────────────────────────

type UserMessagePayloadSchema = ReturnType<typeof createUserMessagePayloadSchema>;

/* eslint-disable @typescript-eslint/no-unused-vars */
// Full field set — catches add/drop/rename of any top-level envelope field.
type _StartRunEnvelopeKeys = Expect<
  KeysMatch<z.infer<typeof startRunPayloadSchema>, StartRunPromptPayload>
>;
type _UserMessageEnvelopeKeys = Expect<
  KeysMatch<z.infer<UserMessagePayloadSchema>, UserMessagePromptPayload>
>;

// Concretely-typed envelope fields — bound by type equality, so a type or
// optionality the CLI does not share with the API fails typecheck.
type _StartRunModelType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['model'], StartRunPromptPayload['model']>
>;
type _StartRunReasoningEffortType = Expect<
  Equal<
    z.infer<typeof startRunPayloadSchema>['reasoningEffort'],
    StartRunPromptPayload['reasoningEffort']
  >
>;
type _StartRunAttachmentsType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['attachments'], StartRunPromptPayload['attachments']>
>;
type _StartRunStagedBrowserTabType = Expect<
  Equal<
    z.infer<typeof startRunPayloadSchema>['stagedBrowserTab'],
    StartRunPromptPayload['stagedBrowserTab']
  >
>;
type _UserMessageAttachmentsType = Expect<
  Equal<z.infer<UserMessagePayloadSchema>['attachments'], UserMessagePromptPayload['attachments']>
>;
type _StartRunProviderType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['provider'], StartRunPromptPayload['provider']>
>;
type _StartRunFastModeType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['fastMode'], StartRunPromptPayload['fastMode']>
>;
type _StartRunConfigType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['config'], StartRunPromptPayload['config']>
>;
type _StartRunServiceIdsType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['serviceIds'], StartRunPromptPayload['serviceIds']>
>;
type _StartRunLaunchServiceIdType = Expect<
  Equal<
    z.infer<typeof startRunPayloadSchema>['launchServiceId'],
    StartRunPromptPayload['launchServiceId']
  >
>;
type _StartRunWorktreeType = Expect<
  Equal<z.infer<typeof startRunPayloadSchema>['worktree'], StartRunPromptPayload['worktree']>
>;
type _StartRunAgentSessionIdType = Expect<
  Equal<
    z.infer<typeof startRunPayloadSchema>['agentSessionId'],
    StartRunPromptPayload['agentSessionId']
  >
>;
type _UserMessageUserMessageType = Expect<
  Equal<z.infer<UserMessagePayloadSchema>['userMessage'], UserMessagePromptPayload['userMessage']>
>;
type _UserMessageRuntimeType = Expect<
  Equal<z.infer<UserMessagePayloadSchema>['runtime'], UserMessagePromptPayload['runtime']>
>;
/* eslint-enable @typescript-eslint/no-unused-vars */

export type TriggerPayloadKey =
  | LocalPromptType
  | typeof USER_MESSAGE_TRIGGER_SENTINEL
  | typeof START_RUN_TRIGGER_SENTINEL;

// Keys whose schema does not depend on handler declarations. The user-message
// envelope reads `allowsEmptyUserMessage` from the registry, so it is
// validated by `validateUserMessageTriggerPayload`.
type StaticTriggerPayloadKey = Exclude<TriggerPayloadKey, typeof USER_MESSAGE_TRIGGER_SENTINEL>;

// Per-promptType lookup the dispatcher uses. The six direct
// `trigger.conversation` variants (where `body.promptType` is the routing key)
// register their UUID/format-guarding schemas; the start-run sentinel registers
// its envelope schema, and the user-message envelope is built per registry. The other LocalPromptType variants (daily_session,
// design_doc_refiner, etc.) are intentionally absent — those only ever arrive
// embedded in a `start_run` envelope's `payload`, never as a direct
// conversation trigger, and their shape is guaranteed by the shared
// `RunCreatePayload` type rather than a runtime mirror.
const triggerPayloadSchemas: Partial<Record<StaticTriggerPayloadKey, z.ZodType<unknown>>> = {
  [LocalPromptType.FeatureSyncIterate]: featureSyncIteratePayloadSchema,
  [LocalPromptType.PlanShapingFeatureSyncIterate]: planShapingFeatureSyncIteratePayloadSchema,
  [LocalPromptType.PlanShapingProposedStages]: planShapingProposedStagesPayloadSchema,
  [LocalPromptType.PlanShapingRefineStage]: planShapingRefineStagePayloadSchema,
  [LocalPromptType.PlanShapingPhaseBreakdown]: planShapingPhaseBreakdownPayloadSchema,
  [LocalPromptType.PlanShapingStepReview]: planShapingStepReviewPayloadSchema,
  [LocalPromptType.FeatureTreeConversation]: featureTreeConversationPayloadSchema,
  [LocalPromptType.CodeReview]: codeReviewPromptPayloadSchema,
  [LocalPromptType.Implement]: implementPromptPayloadSchema,
  [LocalPromptType.WorkTrackerConnect]: workTrackerRequestSchema,
  [LocalPromptType.WorkTrackerImport]: workTrackerRequestSchema,
  [LocalPromptType.RepositoryGrounding]: repositoryGroundingPayloadSchema,
  [LocalPromptType.RepositoryFeatureEnrichment]: repositoryFeatureEnrichmentPayloadSchema,
  [LocalPromptType.RepositoryFirstWork]: repositoryFirstWorkPayloadSchema,
  [LocalPromptType.RepositoryPlacement]: repositoryPlacementPayloadSchema,
  [START_RUN_TRIGGER_SENTINEL]: startRunPayloadSchema,
};

export class TriggerPayloadValidationError extends Error {
  constructor(
    public readonly promptType: TriggerPayloadKey,
    public readonly issues: z.ZodIssue[],
  ) {
    super(
      `Trigger payload for promptType=${promptType} failed validation: ${issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'TriggerPayloadValidationError';
  }
}

const parseTriggerPayload = (
  promptType: TriggerPayloadKey,
  schema: z.ZodType<unknown>,
  payload: unknown,
): unknown => {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new TriggerPayloadValidationError(promptType, parsed.error.issues);
  }
  return parsed.data;
};

/**
 * Validate a `triggersAgent.payload` against the schema registered for the
 * given `promptType`. Returns the payload unchanged when no schema is
 * registered (the permissive default). Throws `TriggerPayloadValidationError`
 * when a schema is registered and the payload does not match.
 */
export const validateTriggerPayload = (
  promptType: StaticTriggerPayloadKey,
  payload: unknown,
): unknown => {
  const schema = triggerPayloadSchemas[promptType];
  if (!schema) {
    return payload;
  }
  return parseTriggerPayload(promptType, schema, payload);
};

/**
 * Validate a user-message follow-up payload. An empty `userMessage` is valid
 * only for a handler that declares `allowsEmptyUserMessage`.
 */
export const validateUserMessageTriggerPayload = (
  payload: unknown,
  promptTypeRegistry: PromptTypeRegistry,
): unknown =>
  parseTriggerPayload(
    USER_MESSAGE_TRIGGER_SENTINEL,
    createUserMessagePayloadSchema(promptTypeRegistry),
    payload,
  );
