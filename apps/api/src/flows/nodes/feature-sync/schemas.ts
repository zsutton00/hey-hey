import { z } from 'zod';
import { WorkflowReviewAction } from 'src/generated';
import type { ImplementationReadinessDisposition } from 'src/generated';
import {
  CodingPlanApprovalPayloadSchema,
  CodingPlanReviewAnswerPayloadSchema,
} from 'src/generated/workflow-review.schemas';
import { ExternalAgentActionSchemas } from 'src/types/flow-internal.types';

/**
 * The discrepancy contract (schema, types, parse helper) lives in the
 * flow-agnostic shared module so both feature-sync flows reuse one source
 * of truth. Re-exported here so this flow's existing importers (the flow
 * template, the drift test, the analyze/iterate nodes) keep resolving the
 * names from `feature-sync/schemas` unchanged.
 */
export {
  featureSyncDiscrepancySchema,
  discrepancyListPayloadSchema,
  parseDiscrepancyPayload,
  type FeatureSyncDiscrepancy,
  type FeatureSyncDiscrepancyListPayload,
} from '../shared/feature-sync-discrepancy';
import { discrepancyListPayloadSchema } from '../shared/feature-sync-discrepancy';

/**
 * Completion-message actions emitted by the CLI for the feature-sync
 * analyze + iterate EXTERNAL_AGENT nodes. These string literals are used
 * both as transition keys in the flow template and as discriminators on
 * the `action` field of the agent-authored completion message.
 */
export const FEATURE_SYNC_ACTIONS = {
  NO_DISCREPANCY: 'NO_DISCREPANCY',
  DISCREPANCY: 'DISCREPANCY',
  RESOLVED: 'RESOLVED',
  REVISED: 'REVISED',
  DONE: 'DONE',
  READINESS_CLEAR: 'READINESS_CLEAR',
  READINESS_REVIEW_REQUIRED: 'READINESS_REVIEW_REQUIRED',
} as const;

const implementationReadinessEvidenceSchema = z
  .object({
    category: z.enum([
      'behavior',
      'ownership',
      'data_lifecycle',
      'authority',
      'security',
      'isolation',
      'integration',
    ]),
    statement: z.string().min(1),
    sourceRef: z.string().min(1).optional(),
  })
  .strict();

const implementationReadinessDispositionSchema = z
  .object({
    state: z.enum(['CLEAR', 'REVIEW_REQUIRED', 'DISMISSED']),
    sourceSnapshot: z
      .object({
        runId: z.string().min(1),
        focalEntityId: z.string().min(1),
        focalEntityType: z.enum(['TASK', 'FEATURE', 'DESIGN_DOC', 'PLAN']),
        sourceRevision: z.string().min(1),
        capturedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    finding: z
      .object({
        affectedSourceContext: z.string().min(1),
        unresolvedDecision: z.string().min(1),
        consequentialInventionRisk: z.string().min(1),
        boundedEvidence: z
          .array(implementationReadinessEvidenceSchema)
          .min(1)
          .max(8),
        answerKind: z.string().min(1),
      })
      .strict()
      .nullable(),
    resolution: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('NONE') }).strict(),
      z
        .object({
          kind: z.literal('DISMISSED'),
          runId: z.string().min(1),
          sourceRevision: z.string().min(1),
          resolvedAt: z.string().datetime({ offset: true }),
        })
        .strict(),
    ]),
  })
  .strict();

const implementationReadinessOutcomePayloadSchema = z
  .object({ disposition: implementationReadinessDispositionSchema })
  .strict();

export const parseImplementationReadinessPayload = (
  payload: unknown,
): ImplementationReadinessDisposition | null => {
  const parsed = implementationReadinessOutcomePayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data.disposition : null;
};

export const implementationReadinessReviewActionPayloadSchema = z
  .object({
    runId: z.string().min(1),
    sourceRevision: z.string().min(1),
    confirmed: z.literal(true).optional(),
  })
  .strict();

export const IMPLEMENTATION_READINESS_REVIEW_ACTIONS = {
  DISMISS: 'implementation_readiness_dismiss',
} as const;

export const featureSyncReadinessReviewActions = {
  [IMPLEMENTATION_READINESS_REVIEW_ACTIONS.DISMISS]: {
    schema: implementationReadinessReviewActionPayloadSchema.extend({
      confirmed: z.literal(true),
    }),
  },
};

export const parseImplementationReadinessReviewActionPayload = (
  payload: unknown,
): z.infer<typeof implementationReadinessReviewActionPayloadSchema> =>
  implementationReadinessReviewActionPayloadSchema.parse(payload);

/**
 * Zod schemas for each action the `analyze` EXTERNAL_AGENT node accepts.
 *
 * - NO_DISCREPANCY: payload is optional/empty; fast-path out of the flow
 *   (terminal/advancing → `waitForUser: false`).
 * - DISCREPANCY: payload carries the discrepancies to surface for review;
 *   the flow hands back to the user for acknowledgement before the next
 *   node runs (`waitForUser: true`).
 */
export const featureSyncAnalyzeActions: ExternalAgentActionSchemas = {
  [FEATURE_SYNC_ACTIONS.NO_DISCREPANCY]: {
    schema: z.object({}).optional(),
    waitForUser: false,
  },
  [FEATURE_SYNC_ACTIONS.DISCREPANCY]: {
    schema: discrepancyListPayloadSchema,
    waitForUser: true,
  },
  [FEATURE_SYNC_ACTIONS.READINESS_CLEAR]: {
    schema: implementationReadinessOutcomePayloadSchema,
    waitForUser: false,
  },
  [FEATURE_SYNC_ACTIONS.READINESS_REVIEW_REQUIRED]: {
    schema: implementationReadinessOutcomePayloadSchema,
    waitForUser: false,
  },
};

/**
 * Zod schemas for each action the `iterate` EXTERNAL_AGENT node accepts.
 *
 * - RESOLVED: payload is optional/empty; discrepancies have been addressed
 *   and the flow parks on session startup (terminal/advancing →
 *   `waitForUser: false`).
 * - REVISED: payload carries a fresh set of discrepancies; the flow
 *   self-loops through iterate for another pass, parking on user input
 *   first (`waitForUser: true`).
 */
export const featureSyncIterateActions: ExternalAgentActionSchemas = {
  [FEATURE_SYNC_ACTIONS.RESOLVED]: {
    schema: z.object({}).optional(),
    waitForUser: false,
  },
  [FEATURE_SYNC_ACTIONS.REVISED]: {
    schema: discrepancyListPayloadSchema,
    waitForUser: true,
  },
};

/**
 * Zod schemas for each action the `coding_plan` EXTERNAL_AGENT node
 * accepts. The plan itself lives in conversation history, not on the flow
 * context. The engine validates the discriminant and preserves the submitted
 * payload on the conversation message for the next local-agent turn.
 *
 * - REFINE: the user requested another planning turn with review feedback.
 *   The flow self-loops without parking, so the node emits a fresh
 *   `startup_session` trigger and the planner can consume the answer from
 *   conversation history (`waitForUser: false`).
 * - APPROVED: the user has accepted the plan
 *   currently in the conversation tail. Routes to the terminal `implement`
 *   EXTERNAL_AGENT node, which keeps `currentNodeId` non-null while the CLI
 *   takes over execution (terminal/advancing → `waitForUser: false`).
 */
export const featureSyncCodingPlanActions: ExternalAgentActionSchemas = {
  [WorkflowReviewAction.Refine]: {
    schema: CodingPlanReviewAnswerPayloadSchema,
    waitForUser: false,
  },
  [WorkflowReviewAction.Approved]: {
    schema: CodingPlanApprovalPayloadSchema,
    waitForUser: false,
  },
};

/**
 * Zod schemas for the terminal `implement` EXTERNAL_AGENT node.
 *
 * The implement node has no routing consequences — `DONE` self-loops on
 * the node. The schema exists only to satisfy the EXTERNAL_AGENT
 * turn-termination invariant: every turn ends with a submission-tool
 * call, and the engine validates that completion against this map.
 *
 * `DONE` is terminal/advancing → `waitForUser: false`.
 */
export const featureSyncImplementActions: ExternalAgentActionSchemas = {
  [FEATURE_SYNC_ACTIONS.DONE]: {
    schema: z.object({}).optional(),
    waitForUser: false,
  },
};
