import { z } from 'zod';
import {
  PlanShapingProposedStagesCompletionPayload,
  PlanShapingVisualPreviewCompletionPayload,
  WorkflowReviewAction,
} from 'src/generated';
import {
  PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema,
  PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema,
  QuestionsApprovedPayloadSchema,
  QuestionsFeedbackPayloadSchema,
} from 'src/generated/workflow-review.schemas';
import { ExternalAgentActionSchemas } from 'src/types/flow-internal.types';
import { FEATURE_SYNC_ACTIONS } from '../feature-sync/schemas';
import {
  discrepancyListPayloadSchema,
  featureSyncDiscrepancySchema,
} from '../shared/feature-sync-discrepancy';
import { PhaseBreakdownStepType } from 'src/generated/local';
import type { PlanSubmissionAdmissionRequest } from 'src/generated';

/**
 * Completion-message actions emitted by the CLI for the plan-shaping
 * EXTERNAL_AGENT nodes, plus the user-driven QUESTIONS-gate
 * discriminators. These string literals double as transition keys in
 * the flow template and as discriminators on the `action` field of the
 * agent-authored or user-authored completion message.
 *
 * Happy path:
 *   PROPOSED_STAGES → PROPOSED_STAGES_FEEDBACK → VISUAL_PREVIEW
 *     → VISUAL_PREVIEW_FEEDBACK → PHASE_BREAKDOWN* → STEP_REVIEW*
 *     → FINALIZE
 *
 * EXTERNAL_AGENT nodes carry the single `READY` action that advances
 * the flow. The `*_FEEDBACK` review gates are user-driven QUESTIONS
 * surfaces with `CONTINUE_REVISING` and `APPROVE_ALL` actions. The
 * terminal `FINALIZE` node has
 * `DONE`, which self-loops so the conversation parks on a non-null
 * `currentNodeId` after the plan has landed (same invariant the
 * feature-sync `implement` node relies on).
 */
export const PLAN_SHAPING_ACTIONS = {
  READY: 'READY',
  DONE: 'DONE',
  /**
   * Step-review terminal discriminator emitted by the CLI's
   * `submit_step_review` tool when a stage's drafted steps have been
   * tightened. Distinct from `DONE` (the phase-breakdown terminal)
   * so a step-review completion that lands on a node still expecting
   * a phase-breakdown completion — or vice versa — is rejected by
   * the engine validator as `unknown_action` instead of being
   * silently accepted under the wrong schema. The flow template
   * routes `STEP_REVIEW_DONE` from the step-review node onward
   * (advancing to EXECUTION_GUIDANCE_TRIGGER once every stage is
   * reviewed; the node's per-action routing hook loops back into
   * STEP_REVIEW while another stage remains).
   */
  STEP_REVIEW_DONE: 'STEP_REVIEW_DONE',
  /**
   * ERROR-class completion discriminator. Not emitted by any CLI
   * submission tool — it is synthesized API-side when an agent's
   * echoed cursor diverges from the slot the API expected:
   * `phase-breakdown` synthesizes it with a
   * `phaseIdxMismatchPayloadSchema` body when the `(stageIdx,
   * phaseIdx)` cursor mismatches, and `step-review` synthesizes it
   * with a `stageIdxMismatchPayloadSchema` body when the `stageIdx`
   * cursor mismatches. The node rewrites the inbound terminal
   * completion's `action`/`payload` to this discriminator so the
   * engine sees a structured failure instead of advancing on a
   * corrupt cursor. Registered in both
   * `planShapingPhaseBreakdownActions` and
   * `planShapingStepReviewActions` (below) so the engine's
   * re-validation inside `resolveExternalAgentRouting` accepts it;
   * the flow template routes each `ERROR` back to its own node for
   * a clean retry.
   */
  ERROR: 'ERROR',
  REFINE: WorkflowReviewAction.Refine,
  APPROVED: WorkflowReviewAction.Approved,
  /**
   * Feature-sync review gate discriminators. Named after the corresponding
   * `SecondaryActionHandler` values so the wire tokens are unambiguous.
   *
   * Both are dispatched by the one-shot `feature-sync-review` QUESTIONS gate
   * that sits between `feature-sync-analyze` and `feature-sync-iterate`:
   *
   * - `FEATURE_SYNC_REVIEW_DONE` — the gate's "Done with Feature Sync" button (and the
   *   iterate loop's "Done" button). Declares the review finished and advances
   *   to stage proposal WITHOUT approving any proposal — per-proposal cards are
   *   the only path that flips a DRAFT to approved. Empty schema; the gate and
   *   `feature-sync-iterate` both register it so the engine accepts the
   *   completion and routes it to PROPOSED_STAGES.
   * - `FEATURE_SYNC_REVIEW_REQUEST_REVISIONS` — the gate's "Continue with my
   *   choices and feedback" button. Carries the free-text the user typed; the
   *   gate stashes it on `featureSyncPendingUserReply` and routes forward to
   *   `feature-sync-iterate`, whose first trigger surfaces it as `userMessage`.
   *
   * Once on the iterate loop, subsequent free-text replies ride the iterate
   * node's `acceptsUserMessages` self-loop rather than this gate token — the
   * gate is one-shot and is never re-entered.
   */
} as const;

/**
 * Zod schemas for the `proposed-stages` EXTERNAL_AGENT node.
 *
 * `READY` advances to `proposed-stages-feedback` once the agent has
 * produced the plan's stages at theme fidelity, each stage carrying its
 * step themes, as platform proposals. The proposals remain the source of
 * truth for individual decisions; the payload carries the decided total for this completion.
 */
export const planShapingProposedStagesCompletionPayloadSchema = z
  .object({
    expectedStageCount: z.number().int().min(0),
  })
  .strict() satisfies z.ZodType<
  PlanShapingProposedStagesCompletionPayload,
  z.ZodTypeDef,
  unknown
>;

export const planShapingProposedStagesActions: ExternalAgentActionSchemas = {
  [PLAN_SHAPING_ACTIONS.READY]: {
    schema: planShapingProposedStagesCompletionPayloadSchema,
    waitForUser: false,
  },
};

/**
 * Schema for the payload submitted by the user from the
 * `plan_generation_stage_review` UI element rendered by the
 * `proposed-stages-feedback` QUESTIONS gate.
 *
 * Both action discriminators carry the same shape: a free-form
 * `feedback` field (the textarea body, may be empty when the user
 * approves without commentary). The discriminator itself lives in
 * `userMessage.data.action`; the gate's `determineRoutingFromUserMessage`
 * reads the action to choose between looping back into proposed-stages
 * (continue_revising) and advancing to visual-preview (approve_all).
 */
export type PlanShapingProposedStagesFeedbackPayload = z.infer<
  typeof QuestionsFeedbackPayloadSchema
>;

/**
 * Action-schema map for the `proposed-stages-feedback` QUESTIONS gate.
 *
 * The gate is QUESTIONS-style — the user, not the agent, picks the
 * action via the buttons rendered alongside the feedback textarea — so
 * this map is consumed by the gate's own `processUserResponse` rather
 * than by the EXTERNAL_AGENT engine validator. Both `continue_revising`
 * and `approve_all` carry the same `{ feedback }` payload; the
 * discriminator lives in `userMessage.data.action`.
 */
export const planShapingProposedStagesFeedbackActions = {
  [PLAN_SHAPING_ACTIONS.REFINE]: {
    schema: QuestionsFeedbackPayloadSchema,
  },
  [PLAN_SHAPING_ACTIONS.APPROVED]: {
    schema: QuestionsApprovedPayloadSchema,
  },
} as const;

/** `{ feedback }` payload submitted from the visual-preview review gate. */
export type PlanShapingVisualPreviewFeedbackPayload = z.infer<
  typeof QuestionsFeedbackPayloadSchema
>;

const visualPreviewRelationshipSchema = z
  .object({
    kind: z.enum(['depends_on', 'refines']),
    proposalId: z.string().uuid(),
  })
  .strict();

const visualPreviewEntrySchema = z
  .object({
    proposalId: z.string().uuid(),
    artifactFamily: z.enum(['mockup', 'diagram']),
    presentationOrder: z.number().int().nonnegative(),
    relationship: visualPreviewRelationshipSchema.optional(),
  })
  .strict();

const visualPreviewEntriesSchema = z
  .array(visualPreviewEntrySchema)
  .superRefine((entries, refinementContext) => {
    const proposalIds = new Set<string>();
    const presentationOrders = new Set<number>();
    for (const [index, entry] of entries.entries()) {
      if (proposalIds.has(entry.proposalId)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'proposalId'],
          message: 'Each visual proposal may appear only once.',
        });
      }
      proposalIds.add(entry.proposalId);
      if (presentationOrders.has(entry.presentationOrder)) {
        refinementContext.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'presentationOrder'],
          message: 'Presentation order must be unique across the visual set.',
        });
      }
      presentationOrders.add(entry.presentationOrder);
    }

    for (const artifactFamily of ['mockup', 'diagram'] as const) {
      const familyEntries = entries
        .filter((entry) => entry.artifactFamily === artifactFamily)
        .sort(
          (left, right) => left.presentationOrder - right.presentationOrder,
        );
      for (const [familyIndex, entry] of familyEntries.entries()) {
        if (familyIndex === 0) continue;
        if (!entry.relationship) {
          refinementContext.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entries.indexOf(entry), 'relationship'],
            message: `Every ordered ${artifactFamily} sequence after its first entry needs a same-family relationship.`,
          });
          continue;
        }
        const predecessor = familyEntries[familyIndex - 1];
        const target = entries.find(
          (candidate) =>
            candidate.proposalId === entry.relationship?.proposalId,
        );
        if (
          !target ||
          target.artifactFamily !== artifactFamily ||
          target.proposalId === entry.proposalId ||
          target.proposalId !== predecessor?.proposalId
        ) {
          refinementContext.addIssue({
            code: z.ZodIssueCode.custom,
            path: [entries.indexOf(entry), 'relationship', 'proposalId'],
            message: `Relationship must target the immediately preceding ${artifactFamily} proposal in presentation order.`,
          });
        }
      }
    }
  });

export const planShapingVisualPreviewCompletionPayloadSchema = z
  .object({
    refinementRound: z.number().int().nonnegative(),
    entries: visualPreviewEntriesSchema,
  })
  .strict() satisfies z.ZodType<
  PlanShapingVisualPreviewCompletionPayload,
  z.ZodTypeDef,
  unknown
>;

export const planShapingVisualPreviewActions: ExternalAgentActionSchemas = {
  [PLAN_SHAPING_ACTIONS.READY]: {
    schema: planShapingVisualPreviewCompletionPayloadSchema,
    waitForUser: false,
  },
};

export const planShapingVisualPreviewFeedbackActions = {
  [PLAN_SHAPING_ACTIONS.REFINE]: {
    schema: QuestionsFeedbackPayloadSchema,
  },
  [PLAN_SHAPING_ACTIONS.APPROVED]: {
    schema: QuestionsApprovedPayloadSchema,
  },
} as const;

/**
 * Wire-shape mirror of the generated `PhaseBreakdownStep` /
 * `PhaseBreakdownPlan` models. These zod schemas validate the
 * `submit_phase_breakdown` payload at the engine boundary so malformed
 * agent emissions are rejected before `processUserResponse` runs. A
 * phase emits steps only — the durable PLAN_STAGE backbone is already
 * authored by `proposed-stages`, so there is no `PhaseBreakdownStage`
 * mirror and the plan carries no `stages` array; every step instead
 * names the durable stage it materializes under via `stageId`. Kept
 * narrowly typed (no `.passthrough()`) so additions to the generated
 * models surface as test failures and push us back to regenerate.
 */
const phaseBreakdownStepSchema = z.object({
  id: z.string().uuid(),
  stageId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  implementation: z.string().trim().min(1),
  type: z.nativeEnum(PhaseBreakdownStepType),
  acceptanceCriteria: z.string().trim().min(1),
  sequenceOrder: z.number().int().nonnegative(),
  dependsOnStepIds: z.array(z.string().uuid()).optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  designDocMotivation: z.string().trim().min(1),
});

export const phaseBreakdownPlanSchema = z.object({
  steps: z.array(phaseBreakdownStepSchema),
});

export type PhaseBreakdownPlanWire = z.infer<typeof phaseBreakdownPlanSchema>;

export const phaseBreakdownCompletionPayloadSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
  phaseIdx: z.number().int().nonnegative(),
  plan: phaseBreakdownPlanSchema,
});

/**
 * A 2-D `(stageIdx, phaseIdx)` phase cursor — `stageIdx` indexes the
 * plan's durable stages, `phaseIdx` indexes the journey step within
 * that stage's journey. The pair locates one phase slot in
 * `FlowContext.accumulatedPhases`.
 */
const phaseCursorSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
  phaseIdx: z.number().int().nonnegative(),
});

/**
 * Payload of the ERROR-class completion the `phase-breakdown` node
 * synthesizes when the agent's echoed `(stageIdx, phaseIdx)` cursor
 * diverges from the slot the API expected (neither the expected cursor
 * nor the idempotent-overwrite retry of the most recent slot).
 *
 * `processUserResponse` rewrites the inbound `DONE` completion's
 * `action` to `PLAN_SHAPING_ACTIONS.ERROR` and its `payload` to this
 * shape — carrying both the `expected` cursor and the `provided`
 * cursor so the retry has the divergence detail in hand. Registering
 * the schema as a node action (below) is what keeps the wire contract
 * self-consistent: `resolveExternalAgentRouting` re-runs
 * `validateExternalAgentCompletion` against the *rewritten* message,
 * so an unregistered `ERROR` action would otherwise be rejected as
 * `unknown_action` and the synthesized failure detail would never
 * reach the routing layer.
 */
export const phaseIdxMismatchPayloadSchema = z.object({
  reason: z.literal('phase_idx_mismatch'),
  expected: phaseCursorSchema,
  provided: phaseCursorSchema,
});

export type PhaseIdxMismatchPayload = z.infer<
  typeof phaseIdxMismatchPayloadSchema
>;

/**
 * Payload used when the external CLI reports a submission/tool failure before
 * it can produce a valid node-specific DONE payload. The message is the
 * original failure text carried by the stored agent message, normalized by the
 * API signal bridge so workflow validation gets a concrete object rather than
 * an absent payload.
 */
export const agentSubmissionErrorPayloadSchema = z.object({
  reason: z.literal('agent_submission_error'),
  message: z.string().min(1),
});

export type AgentSubmissionErrorPayload = z.infer<
  typeof agentSubmissionErrorPayloadSchema
>;

/**
 * Zod schemas for the `phase-breakdown` EXTERNAL_AGENT node.
 *
 * `DONE` carries the steps-only `{ stageIdx, phaseIdx, plan: { steps } }`
 * payload the CLI agent emits via `submit_phase_breakdown`. The
 * `(stageIdx, phaseIdx)` pair is the 2-D cursor of the phase the agent
 * just expanded; the engine validates this payload here before
 * invoking the node's `processUserResponse`, which writes the plan
 * onto `FlowContext.accumulatedPhases[stageIdx][phaseIdx]`. A phase
 * authors no stages — the durable PLAN_STAGE backbone already exists
 * from `proposed-stages` — so the plan carries steps only. The
 * per-action routing hook on the node walks the 2-D cursor against the
 * per-stage journeys derived from `journeySteps` to decide whether to
 * loop back into PHASE_BREAKDOWN or advance to FINALIZE; on the
 * loop-exit branch the hook also drives the batched materialization
 * step that creates every accumulated phase's steps as auto-approved
 * PLAN_STEP proposals, bound to their pre-existing stages, in one
 * transaction.
 *
 * `ERROR` is the API-synthesized cursor-mismatch completion — never
 * emitted by the CLI, but registered here so the engine accepts the
 * rewritten message on re-validation. The flow template routes `ERROR`
 * back to `phase-breakdown` for a retry; materialization runs only on
 * the `DONE` loop-exit branch, so an `ERROR` completion can never
 * advance the plan or land partial work.
 */
export const planShapingPhaseBreakdownActions: ExternalAgentActionSchemas = {
  [PLAN_SHAPING_ACTIONS.DONE]: {
    schema: phaseBreakdownCompletionPayloadSchema,
    waitForUser: false,
  },
  [PLAN_SHAPING_ACTIONS.ERROR]: {
    schema: z.union([
      phaseIdxMismatchPayloadSchema,
      agentSubmissionErrorPayloadSchema,
    ]),
    waitForUser: false,
  },
};

/**
 * Wire payload of the `submit_step_review` submission tool. Reuses
 * `phaseBreakdownPlanSchema` as the per-step shape — a reviewed step
 * keeps the same fields as a drafted one, just tightened — so the
 * materialization-service contract holds without per-step schema
 * branching. The agent emits the full tightened set for the stage
 * (replace-the-stage-set semantics) and echoes back the `stageIdx`
 * it received on the trigger so the API can detect cursor divergence.
 */
export const stepReviewCompletionPayloadSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
  plan: phaseBreakdownPlanSchema,
});

export const planSubmissionAdmissionRequestSchema = z.discriminatedUnion(
  'kind',
  [
    z
      .object({
        kind: z.literal('phase_breakdown'),
        conversationId: z.string().uuid(),
        triggerMessageId: z.string().uuid(),
        submission: phaseBreakdownCompletionPayloadSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal('step_review'),
        conversationId: z.string().uuid(),
        triggerMessageId: z.string().uuid(),
        submission: stepReviewCompletionPayloadSchema,
      })
      .strict(),
  ],
) satisfies z.ZodType<PlanSubmissionAdmissionRequest>;

/**
 * A 1-D `stageIdx` cursor — the step-review loop walks one stage at
 * a time, so the cursor is a single integer (vs the 2-D
 * `(stageIdx, phaseIdx)` cursor the phase-breakdown loop uses).
 */
const stageCursorSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
});

/**
 * Payload of the ERROR-class completion the `step-review` node
 * synthesizes when the agent's echoed `stageIdx` diverges from the
 * stage the API expected (neither the expected slot nor the
 * idempotent-overwrite retry of the most-recently-reviewed stage).
 *
 * `processUserResponse` rewrites the inbound `STEP_REVIEW_DONE`
 * completion's `action` to `PLAN_SHAPING_ACTIONS.ERROR` and its
 * `payload` to this shape — carrying both the `expected` and
 * `provided` cursors so the retry has the divergence detail in hand.
 * Mirrors `phaseIdxMismatchPayloadSchema` but with a 1-D cursor and
 * a distinct `reason` literal so the two ERROR classes are
 * structurally distinguishable when surfaced in logs or report
 * payloads. Registering the schema as a node action (in
 * `planShapingStepReviewActions` below) is what keeps the wire
 * contract self-consistent: `resolveExternalAgentRouting` re-runs
 * `validateExternalAgentCompletion` against the *rewritten* message,
 * so an unregistered `ERROR` action would otherwise be rejected as
 * `unknown_action` and the synthesized failure detail would never
 * reach the routing layer.
 */
export const stageIdxMismatchPayloadSchema = z.object({
  reason: z.literal('stage_idx_mismatch'),
  expected: stageCursorSchema,
  provided: stageCursorSchema,
});

export type StageIdxMismatchPayload = z.infer<
  typeof stageIdxMismatchPayloadSchema
>;

/**
 * Zod schemas for the `step-review` EXTERNAL_AGENT node — the
 * per-stage tightening sweep that runs once per durable stage after
 * phase-breakdown finishes and before materialization. A phase
 * emits steps only and is bound to its durable `stageId`; this
 * review reads the stage's full set of drafted steps together with
 * the design doc and returns the tightened set.
 *
 * `STEP_REVIEW_DONE` carries `{ stageIdx, plan: { steps } }` the
 * CLI agent emits via `submit_step_review`. The engine validates
 * this payload here before invoking the node's `processUserResponse`,
 * which writes the plan onto
 * `FlowContext.accumulatedPhases[stageIdx] = { 0: { steps } }` —
 * a single synthetic phase so the existing
 * `PhaseBreakdownMaterializationService` (which already walks
 * `[stageIdx][phaseIdx]` and groups by each step's `stageId`)
 * produces identical-shape output without a service-side change.
 * The per-action routing hook on the node walks the per-stage
 * cursor against `reviewedStages` on FlowContext to decide whether
 * to loop back into STEP_REVIEW or call materialization and fall
 * through to EXECUTION_GUIDANCE_TRIGGER.
 *
 * `ERROR` is the API-synthesized cursor-mismatch completion — never
 * emitted by the CLI, but registered here so the engine accepts the
 * rewritten message on re-validation. The flow template routes
 * `ERROR` back to `step-review` for a retry; materialization runs
 * only on the `STEP_REVIEW_DONE` loop-exit branch, so an `ERROR`
 * completion can never land the plan or skip a stage.
 */
export const planShapingStepReviewActions: ExternalAgentActionSchemas = {
  [PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE]: {
    schema: stepReviewCompletionPayloadSchema,
    waitForUser: false,
  },
  [PLAN_SHAPING_ACTIONS.ERROR]: {
    schema: z.union([
      stageIdxMismatchPayloadSchema,
      agentSubmissionErrorPayloadSchema,
    ]),
    waitForUser: false,
  },
};

/**
 * Zod schemas for the plan-shaping `feature-sync-analyze` EXTERNAL_AGENT
 * node — the head of the plan-from-design-doc graph. Mirrors
 * `featureSyncAnalyzeActions` from the task-anchored feature-sync flow,
 * reusing the shared `FEATURE_SYNC_ACTIONS` discriminators and the shared
 * `discrepancyListPayloadSchema` so the two flows speak the same wire
 * contract.
 *
 * - NO_DISCREPANCY: payload is optional/empty; the plan's declared
 *   structure matches the design doc, so the flow advances straight to
 *   `proposed-stages` (terminal/advancing → `waitForUser: false`).
 * - DISCREPANCY: payload carries the discrepancies the analyze turn
 *   surfaced; the flow routes to the one-shot `feature-sync-review`
 *   QUESTIONS gate — the surface that renders the flagged items and parks on
 *   the user. Routing must advance without waiting (`waitForUser: false`) so
 *   analyze presents the flagged items and emits its verdict on the same turn;
 *   the gate (not analyze) is what parks.
 */
export const planShapingFeatureSyncAnalyzeActions: ExternalAgentActionSchemas =
  {
    [FEATURE_SYNC_ACTIONS.NO_DISCREPANCY]: {
      schema: z.object({}).optional(),
      waitForUser: false,
    },
    [FEATURE_SYNC_ACTIONS.DISCREPANCY]: {
      schema: discrepancyListPayloadSchema,
      waitForUser: false,
    },
  };

/**
 * Zod schemas for the plan-shaping `feature-sync-iterate` EXTERNAL_AGENT
 * node — the self-looping review surface that owns the repeat loop. It is
 * entered only from the one-shot `feature-sync-review` gate (after the user
 * reply, which rides in as `userMessage`) or from its own self-loop. It
 * accepts three completion shapes plus free-text:
 *
 * - REVISED (agent): payload carries a fresh discrepancy set, which may be
 *   empty after an explicit user dismissal. Empty does not advance the flow.
 *   The flow
 *   self-loops back onto iterate with `parkOnUserResponse: true` — the CLI
 *   rides the `plan_shaping_feature_sync_review` element on the agent's own
 *   output, so the node parks on the user rather than re-firing the trigger.
 * - FEATURE_SYNC_REVIEW_REQUEST_REVISIONS (user): the "Continue Revising"
 *   button on the review element the iterate output rides — the loop's
 *   equivalent of the gate's "Keep working on this". Carries the free-text the
 *   user typed plus optional per-item choices; the node stashes them on
 *   `featureSyncPendingUserReply` / `featureSyncPendingDecisions` and the
 *   flow self-loops back onto iterate WITHOUT `parkOnUserResponse`, so the
 *   trigger re-fires and the agent produces another revised set. Registered
 *   here so the engine validator accepts the user's completion instead of
 *   rejecting it as `unknown_action` — the bug this action was added to fix.
 * - FEATURE_SYNC_REVIEW_DONE (user): the empty-schema Done token the
 *   ui-common Done button dispatches. Registered here so the engine validator
 *   accepts the user's completion instead of rejecting it as `unknown_action`;
 *   the flow template routes it to PROPOSED_STAGES.
 *
 * A free-text USER reply (no `action`) is handled by the node's
 * `acceptsUserMessages` self-loop, not by this action map. `RESOLVED` remains
 * intentionally absent: the agent has no path to declare discrepancies
 * resolved and skip user review.
 */
/**
 * Payload schema for `request_revisions` ("Keep working on this"), carried by
 * both the one-shot `feature-sync-review` gate's button and the
 * `feature-sync-iterate` loop's "Continue Revising" button. Carries the
 * free-form revision text plus optional per-item `decisions`
 * (accept/amend/dismiss keyed by item id). Decisions are advisory input to the
 * next iterate turn: they never approve proposals or advance the review. Declared above the iterate action map below so it is in scope when
 * that map registers the `FEATURE_SYNC_REVIEW_REQUEST_REVISIONS` action.
 */
export type PlanShapingFeatureSyncReviewRevisionPayload = z.infer<
  typeof PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema
>;

// Unlike ordinary feature-sync, plan shaping can present an empty revised set
// while remaining parked on the user-owned review gate. Empty means there are
// no flagged items left to display; it does not grant the agent authority to
// advance the workflow.
export const planShapingRevisedDiscrepancyListPayloadSchema = z.object({
  discrepancies: z.array(featureSyncDiscrepancySchema),
});

export const planShapingFeatureSyncIterateActions: ExternalAgentActionSchemas =
  {
    [FEATURE_SYNC_ACTIONS.REVISED]: {
      schema: planShapingRevisedDiscrepancyListPayloadSchema,
      waitForUser: false,
    },
    [WorkflowReviewAction.Dismissed]: {
      schema: PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema,
      waitForUser: false,
    },
    [WorkflowReviewAction.Refine]: {
      schema: PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema,
      waitForUser: false,
    },
  };

/**
 * Action-schema map for the one-shot `feature-sync-review` QUESTIONS gate.
 *
 * The user, not the agent, picks the action via the two buttons rendered
 * alongside the review element, so this map is consumed by the gate's own
 * `processUserResponse` rather than by the EXTERNAL_AGENT engine validator.
 * Two discriminators cover the gate's decision surface: `done` ("Ignore")
 * declares the review finished and routes to stage proposal WITHOUT approving
 * anything (the stash is cleared), and `request_revisions` ("Keep working on
 * this") carries free-form feedback the gate stashes for the first iterate
 * trigger and routes forward to `feature-sync-iterate`. Any unrecognised
 * submission self-loops the user back onto the gate.
 */
export const planShapingFeatureSyncReviewActions = {
  [WorkflowReviewAction.Dismissed]: {
    schema: PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema,
  },
  [WorkflowReviewAction.Refine]: {
    schema: PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema,
  },
} as const;
