import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import {
  LocalPromptType,
  PhaseBreakdownPlan,
  PhaseBreakdownStep,
  PhaseBreakdownStepType,
  PlanShapingStepReviewPromptPayload,
} from 'src/generated/local';
import {
  ExternalAgentActionSchemas,
  ExternalAgentNodeBase,
  ExternalAgentTriggerMessage,
  FlowUserMessage,
  PlanFromDesignDocFlowContext,
} from 'src/types/flow-internal.types';
import { MutableContextHandle } from 'src/utils/mutable-context';
import { PLAN_SHAPING_NODES } from '../../constants/node-ids';
import { PhaseBreakdownMaterializationService } from '../../../services/plan/phase-breakdown-materialization.service';
import { PlanFromDesignDocSeedService } from '../../../services/plan/plan-from-design-doc-seed.service';
import { PlanSubmissionAdmissionService } from '../../../services/plan/plan-submission-admission.service';
import {
  AccumulatedPhases,
  buildStageJourneys,
  countAccumulatedPhases,
} from './phase-breakdown.node';
import {
  PLAN_SHAPING_ACTIONS,
  planShapingStepReviewActions,
  type StageIdxMismatchPayload,
} from './schemas';

/**
 * Flatten one stage's accumulated phases into a single ordered run of
 * drafted steps, walking phaseIdx ascending and preserving each step's
 * durable `stageId` / `sequenceOrder`. The flattened list is what the
 * step-review prompt renders for the agent — the agent never sees the
 * per-phase split that produced the steps because the tightening pass
 * is per-stage, not per-phase.
 */
export const flattenStageDraftedSteps = (
  stageBucket: Record<number, PhaseBreakdownPlan> | undefined,
): PhaseBreakdownStep[] => {
  if (stageBucket === undefined) {
    return [];
  }
  const phaseIndices = Object.keys(stageBucket)
    .map((k) => Number(k))
    .sort((a, b) => a - b);
  const flat: PhaseBreakdownStep[] = [];
  for (const phaseIdx of phaseIndices) {
    const phase = stageBucket[phaseIdx];
    if (phase === undefined) {
      continue;
    }
    for (const step of phase.steps) {
      flat.push(step);
    }
  }
  return flat;
};

/**
 * Resolve the step-review loop position from `reviewedStages` against
 * the per-stage journeys. `expected` is the first stage index in
 * `0..totalStages` not present in `reviewedStages` — `undefined` once
 * every stage has been reviewed. `mostRecent` is the stage index
 * immediately before `expected` (or the final stage once the loop is
 * exhausted), i.e. the stage that the idempotent-overwrite retry is
 * allowed to re-emit.
 */
export const resolveStageCursor = (
  reviewedStages: Record<number, true> | undefined,
  totalStages: number,
): {
  expected: number | undefined;
  mostRecent: number | undefined;
} => {
  for (let stageIdx = 0; stageIdx < totalStages; stageIdx += 1) {
    if (reviewedStages?.[stageIdx] !== true) {
      return {
        expected: stageIdx,
        mostRecent: stageIdx > 0 ? stageIdx - 1 : undefined,
      };
    }
  }
  return { expected: undefined, mostRecent: totalStages - 1 };
};

/**
 * Wire shape of the ERROR-class completion the step-review node
 * synthesizes when the agent's echoed `stageIdx` diverges from the
 * stage the API expected. Returned by
 * `synthesizeStageIdxMismatchCompletion` and stamped onto
 * `userMessage.data` so the engine sees a structured failure rather
 * than advancing on a corrupt cursor.
 *
 * `action` is `PLAN_SHAPING_ACTIONS.ERROR`, registered in
 * `planShapingStepReviewActions` — that registration is load-bearing:
 * `resolveExternalAgentRouting` re-runs
 * `validateExternalAgentCompletion` against this rewritten message, so
 * an unregistered action would be rejected as `unknown_action` before
 * routing ever ran. With `ERROR` registered, the flow template's
 * `ERROR → STEP_REVIEW` transition re-triggers the stage for a clean
 * retry — and `accumulatedPhases` / `reviewedStages` are both left
 * unchanged so the re-derived cursor is the same one that mismatched.
 */
export interface StageIdxMismatchErrorCompletion {
  action: typeof PLAN_SHAPING_ACTIONS.ERROR;
  payload: StageIdxMismatchPayload;
}

/**
 * Construct an ERROR-class completion describing a stage-cursor
 * mismatch. Exported so tests can assert the synthesized shape
 * verbatim.
 */
export const synthesizeStageIdxMismatchCompletion = (params: {
  expected: number;
  provided: number;
}): StageIdxMismatchErrorCompletion => ({
  action: PLAN_SHAPING_ACTIONS.ERROR,
  payload: {
    reason: 'stage_idx_mismatch',
    expected: { stageIdx: params.expected },
    provided: { stageIdx: params.provided },
  },
});

/**
 * `step-review` EXTERNAL_AGENT node — entered from `phase-breakdown`
 * after every phase has accumulated and before any step is saved.
 * Self-loops once per durable stage, running a holistic tightening
 * pass over that stage's drafted steps before materialization.
 *
 * Stage identity is the per-stage cursor on
 * `PlanFromDesignDocFlowContext.reviewedStages` — the direct analog of
 * `accumulatedPhases` driving the phase-breakdown cursor. The node
 * groups `journeySteps` by `stageId` into one ordered journey per
 * durable stage (reusing `buildStageJourneys` from phase-breakdown),
 * uses the journey count as `totalStages`, and takes the next expected
 * cursor as the first stage with no review recorded yet.
 *
 * On entry the node derives that cursor, reads the stage's drafted
 * steps from `accumulatedPhases[stageIdx]` (flattened across phases in
 * phaseIdx order — preserving each step's durable `stageId` and
 * `sequenceOrder`), and stamps the steps, `stageIdx`, `totalStages`,
 * plan id, and design-doc id onto a
 * `PlanShapingStepReviewPromptPayload`. The CLI agent runs the review
 * against the design doc (the handler injects the body at `prepare()`)
 * and emits `{ stageIdx, plan: { steps } }` via `submit_step_review`
 * — replace-the-stage-set semantics, agent MUST echo back the same
 * `stageIdx` it received on the trigger.
 *
 * `processUserResponse` compares the agent's emitted cursor against
 * the expected value: an exact match (or the idempotent retry of the
 * most-recently-reviewed stage) overwrites
 * `accumulatedPhases[stageIdx] = { 0: { steps } }` (a single synthetic
 * phase — `PhaseBreakdownMaterializationService` walks
 * `[stageIdx][phaseIdx]` and groups by each step's `stageId`, so the
 * single-phase write-back produces identical-shape output without a
 * materialization-service change) and marks `reviewedStages[stageIdx]`.
 * Any other divergence rewrites the completion's `action`/`payload` to
 * an `ERROR` mismatch payload and leaves both buckets unchanged — the
 * flow template routes `ERROR` back to STEP_REVIEW for a retry.
 *
 * The per-action routing hook recomputes the next expected cursor from
 * `reviewedStages`: while a stage remains the workflow loops back to
 * STEP_REVIEW; once every stage is reviewed the hook materializes the
 * accumulated steps (now tightened where review succeeded,
 * un-tightened where it fell through on a genuine ERROR) as
 * auto-approved PLAN_STEP proposals in one transaction, then lets the
 * engine fall through to the static
 * `STEP_REVIEW_DONE → EXECUTION_GUIDANCE_TRIGGER` transition so the
 * user observes the plan landing as a single atomic change.
 */
@Injectable()
export class PlanShapingStepReviewNode extends ExternalAgentNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.STEP_REVIEW;
  readonly title = 'Plan Shaping — Step Review';

  readonly promptType = LocalPromptType.plan_shaping_step_review;

  readonly actions: ExternalAgentActionSchemas = planShapingStepReviewActions;

  private readonly logger = new Logger(PlanShapingStepReviewNode.name);

  constructor(
    private readonly materializationService: PhaseBreakdownMaterializationService,
    private readonly seedService: PlanFromDesignDocSeedService,
    private readonly admissionService: PlanSubmissionAdmissionService,
  ) {
    super();
  }

  async buildTriggerMessage(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
  ): Promise<ExternalAgentTriggerMessage> {
    const context = tracker.getContext();
    const journeySteps = context.journeySteps ?? [];
    const stageJourneys = buildStageJourneys(journeySteps);
    const totalStages = stageJourneys.length;
    const { expected } = resolveStageCursor(
      context.reviewedStages,
      totalStages,
    );

    if (totalStages === 0 || expected === undefined) {
      // Defensive guard — the engine wires phase-breakdown's DONE →
      // STEP_REVIEW transition only after every phase has accumulated,
      // and the routing hook only re-enters STEP_REVIEW while an
      // unreviewed stage remains. If the node is entered with no
      // pending stage, surface it as a hard error rather than spin
      // emitting empty triggers.
      throw new Error(
        `[step-review] cannot execute: no pending stage ` +
          `(totalStages=${totalStages}, ` +
          `reviewed=${Object.keys(context.reviewedStages ?? {}).length})`,
      );
    }

    const stageBucket = context.accumulatedPhases?.[expected];
    const draftedSteps = flattenStageDraftedSteps(stageBucket);

    this.logger.debug('Plan-shaping step-review node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      stageIdx: expected,
      totalStages,
      draftedStepCount: draftedSteps.length,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Plan Shaping — Step Review',
        required: false,
        influences: [],
      },
    ];

    const approvedVisuals = context.visualPreviewApprovedVisuals;
    if (!approvedVisuals) {
      throw new Error(
        '[step-review] cannot execute: the approved visual set has not been resolved',
      );
    }

    const seed = await this.seedService.resolve(context.core.conversationId);

    const triggerPayload: PlanShapingStepReviewPromptPayload = {
      steps: draftedSteps,
      stageIdx: expected,
      totalStages,
      designDocId: seed.designDocId,
      planId: seed.planId,
      approvedVisuals,
    };

    return {
      response: `Reviewing stage ${expected + 1} of ${totalStages}…`,
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'plan_shaping_step_review_started',
        intentConfidence: 1,
        reasoning:
          "External agent reviewing one stage's drafted steps for coherence with the design doc before materialization.",
        ragEnabled: false,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<PlanFromDesignDocFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const data = (userMessage.data ?? {}) as {
      action?: string;
      payload?: {
        stageIdx?: number;
        plan?: PhaseBreakdownPlan;
      };
    };
    if (data.action !== PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE) {
      return;
    }

    const stageIdx = data.payload?.stageIdx;
    const plan = data.payload?.plan;
    if (typeof stageIdx !== 'number' || !plan) {
      // Engine-level zod validation already rejects malformed
      // payloads; this guard exists so the TypeScript narrowing makes
      // the mutate closure read cleanly.
      return;
    }

    const ctxBefore = tracker.getContext();
    const stageJourneys = buildStageJourneys(ctxBefore.journeySteps ?? []);
    const totalStages = stageJourneys.length;
    const { expected, mostRecent } = resolveStageCursor(
      ctxBefore.reviewedStages,
      totalStages,
    );

    // Match (the expected new stage) or the idempotent-overwrite retry
    // (agent re-emits the most-recently-reviewed stage) both write the
    // bucket. Any other divergence synthesizes an ERROR-class
    // completion onto userMessage.data so the engine sees a structured
    // failure instead of advancing on a corrupt cursor.
    const isExpected = expected !== undefined && stageIdx === expected;
    const isIdempotentRetry =
      mostRecent !== undefined && stageIdx === mostRecent;

    if (!isExpected && !isIdempotentRetry) {
      const errorCompletion = synthesizeStageIdxMismatchCompletion({
        expected: expected ?? mostRecent ?? 0,
        provided: stageIdx,
      });
      const mutableData = (userMessage.data ??= {}) as Record<string, unknown>;
      mutableData['action'] = errorCompletion.action;
      mutableData['payload'] = errorCompletion.payload;
      this.logger.warn(
        'Step-review: stage cursor mismatch — synthesized ERROR completion',
        {
          conversationId: ctxBefore.core.conversationId,
          expected: errorCompletion.payload.expected,
          provided: stageIdx,
        },
      );
      return;
    }

    const seed = await this.seedService.resolve(ctxBefore.core.conversationId);
    const admission = await this.admissionService.prepare({
      organizationId: ctxBefore.core.organizationId,
      projectId: ctxBefore.core.projectId,
      planId: seed.planId,
      kind: 'step_review',
      submission: { stageIdx, plan },
      accumulatedPhases: ctxBefore.accumulatedPhases ?? {},
      expectedStageId: stageJourneys[stageIdx]?.stageId,
      expectedStageIdx: stageIdx,
    });
    if ('findings' in admission) {
      const mutableData = (userMessage.data ??= {}) as Record<string, unknown>;
      mutableData['action'] = PLAN_SHAPING_ACTIONS.ERROR;
      mutableData['payload'] = {
        reason: 'agent_submission_error',
        message: JSON.stringify(admission.findings),
      };
      return;
    }

    const acceptedPlan: PhaseBreakdownPlan = {
      steps: admission.submission.plan.steps.map((step) => ({
        ...step,
        type: PhaseBreakdownStepType.TASK,
      })),
    };
    tracker.mutate((draft) => {
      const accumulated = (draft.accumulatedPhases ?? {}) as AccumulatedPhases;
      // Single synthetic phase: the materialization service walks
      // `[stageIdx][phaseIdx]` and re-numbers `sequenceOrder` per
      // stage, so `{ 0: { steps } }` produces identical-shape output
      // without any service change. Required: every step keeps the
      // durable `stageId` it came in with (the service hard-fails on
      // unknown stage ids), and `sequenceOrder` is set in intended
      // final order (the service sorts by it within a phase before
      // re-numbering).
      accumulated[stageIdx] = { 0: acceptedPlan };
      draft.accumulatedPhases = accumulated;
      const reviewed = draft.reviewedStages ?? {};
      reviewed[stageIdx] = true;
      draft.reviewedStages = reviewed;
    });

    const ctxAfter = tracker.getContext();
    this.logger.debug('Step-review: stage reviewed', {
      conversationId: ctxAfter.core.conversationId,
      stageIdx,
      stepCount: plan.steps.length,
      reviewedStageCount: Object.keys(ctxAfter.reviewedStages ?? {}).length,
      idempotentRetry: isIdempotentRetry,
    });
  }

  async determineRoutingFromAgentCompletion(
    context: PlanFromDesignDocFlowContext,
    action: string,
  ): Promise<string | undefined> {
    // Only `STEP_REVIEW_DONE` drives the loop/materialize decision.
    // The synthesized `ERROR` completion (cursor mismatch) is left to
    // the static transition map, which routes `ERROR → STEP_REVIEW`
    // for a retry. Returning `undefined` here keeps materialization
    // strictly on the `STEP_REVIEW_DONE` loop-exit branch.
    this.logger.debug('Step-review routing decision', {
      conversationId: context.core.conversationId,
      action,
    });
    if (action !== PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE) {
      return undefined;
    }

    const stageJourneys = buildStageJourneys(context.journeySteps ?? []);
    const totalStages = stageJourneys.length;
    const { expected } = resolveStageCursor(
      context.reviewedStages,
      totalStages,
    );
    this.logger.debug('Step-review remaining cursor resolved', {
      conversationId: context.core.conversationId,
      totalStages,
      expectedStageIndex: expected,
      reviewComplete: expected === undefined,
    });
    if (expected !== undefined) {
      return PLAN_SHAPING_NODES.STEP_REVIEW;
    }

    // Loop has finished. Materialize the accumulated steps (tightened
    // where review succeeded, un-tightened where a stage fell through
    // on a genuine ERROR) as auto-approved PLAN_STEP proposals — bound
    // to their pre-existing durable stages — in one transaction so the
    // user observes the plan landing as a single atomic change.
    await this.materializeAccumulatedPhases(context);
    this.logger.log(
      'Step-review materialization complete; returning to configured transition',
      { conversationId: context.core.conversationId },
    );
    return undefined;
  }

  private async materializeAccumulatedPhases(
    context: PlanFromDesignDocFlowContext,
  ): Promise<void> {
    const accumulated = context.accumulatedPhases ?? {};
    const phaseCount = countAccumulatedPhases(accumulated);
    if (phaseCount === 0) {
      this.logger.warn(
        'Step-review: reached loop exit with no accumulated phases',
        { conversationId: context.core.conversationId },
      );
      return;
    }

    const seed = await this.seedService.resolve(context.core.conversationId);

    this.logger.log(
      'Step-review: materializing accumulated phases before execution-guidance trigger',
      {
        conversationId: context.core.conversationId,
        planId: seed.planId,
        phaseCount,
      },
    );

    await this.materializationService.materializeAccumulatedPhases({
      accumulatedPhases: accumulated,
      planId: seed.planId,
      designDocId: seed.designDocId,
      conversationId: context.core.conversationId,
      organizationId: context.core.organizationId,
      projectId: context.core.projectId,
      userId: context.core.user.id,
    });
  }
}
