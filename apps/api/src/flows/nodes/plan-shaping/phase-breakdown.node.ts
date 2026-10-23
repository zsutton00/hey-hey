import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { ExtendedUIFieldType, UIElement } from 'src/generated';
import {
  JourneyStep,
  LocalPromptType,
  PhaseBreakdownPlan,
  PhaseBreakdownStepType,
  PhaseBreakdownPriorPhase,
  PlanShapingPhaseBreakdownPromptPayload,
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
import { PlanFromDesignDocSeedService } from '../../../services/plan/plan-from-design-doc-seed.service';
import { PlanSubmissionAdmissionService } from '../../../services/plan/plan-submission-admission.service';
import {
  PLAN_SHAPING_ACTIONS,
  planShapingPhaseBreakdownActions,
  type PhaseIdxMismatchPayload,
} from './schemas';

/** 2-D `(stageIdx, phaseIdx)` cursor locating one phase slot. */
export interface PhaseCursor {
  stageIdx: number;
  phaseIdx: number;
}

/** One durable stage's ordered journey: the run of journey steps that
 *  share that stage's `stageId`, in journey order. */
export interface StageJourney {
  stageId: string;
  phases: JourneyStep[];
}

/** 2-D accumulation map: `accumulatedPhases[stageIdx][phaseIdx]`. */
export type AccumulatedPhases = Record<
  number,
  Record<number, PhaseBreakdownPlan>
>;

const sameCursor = (a: PhaseCursor, b: PhaseCursor): boolean =>
  a.stageIdx === b.stageIdx && a.phaseIdx === b.phaseIdx;

const cursorBefore = (a: PhaseCursor, b: PhaseCursor): boolean =>
  a.stageIdx < b.stageIdx ||
  (a.stageIdx === b.stageIdx && a.phaseIdx < b.phaseIdx);

/**
 * Group a flat `journeySteps` array into one ordered journey per
 * durable stage. The visual-preview node seeds one journey per existing
 * stage, so every step names its parent stage via `stageId`; this
 * walk collects the run of steps for each stage, preserving
 * first-appearance order of stages and within-stage order of phases.
 * The resulting `stageIdx` is the position of a stage in this list and
 * the first half of the 2-D `(stageIdx, phaseIdx)` cursor.
 */
export const buildStageJourneys = (
  journeySteps: ReadonlyArray<JourneyStep>,
): StageJourney[] => {
  const journeys: StageJourney[] = [];
  const byStageId = new Map<string, StageJourney>();
  for (const step of journeySteps) {
    let journey = byStageId.get(step.stageId);
    if (journey === undefined) {
      journey = { stageId: step.stageId, phases: [] };
      byStageId.set(step.stageId, journey);
      journeys.push(journey);
    }
    journey.phases.push(step);
  }
  return journeys;
};

/**
 * Flatten the per-stage journeys into the total order the loop walks:
 * every `(stageIdx, phaseIdx)` cursor, ascending by stage then phase.
 */
const flattenCursors = (
  stageJourneys: ReadonlyArray<StageJourney>,
): PhaseCursor[] => {
  const cursors: PhaseCursor[] = [];
  stageJourneys.forEach((journey, stageIdx) => {
    journey.phases.forEach((_phase, phaseIdx) => {
      cursors.push({ stageIdx, phaseIdx });
    });
  });
  return cursors;
};

/** Count of `(stageIdx, phaseIdx)` slots already written to the map. */
export const countAccumulatedPhases = (
  accumulatedPhases: AccumulatedPhases | undefined,
): number =>
  Object.values(accumulatedPhases ?? {}).reduce(
    (sum, stageBucket) => sum + Object.keys(stageBucket).length,
    0,
  );

/**
 * Resolve the loop position from `accumulatedPhases` against the
 * per-stage journeys. `expected` is the first `(stageIdx, phaseIdx)`
 * slot in flattened journey order that has no accumulated plan yet —
 * `undefined` once every phase is accumulated. `mostRecent` is the
 * flattened cursor immediately before `expected` (or the final cursor
 * once the loop is exhausted), i.e. the slot that the
 * idempotent-overwrite retry is allowed to re-emit.
 */
export const resolveCursors = (
  accumulatedPhases: AccumulatedPhases | undefined,
  stageJourneys: ReadonlyArray<StageJourney>,
): {
  flat: PhaseCursor[];
  expected: PhaseCursor | undefined;
  mostRecent: PhaseCursor | undefined;
} => {
  const flat = flattenCursors(stageJourneys);
  const expectedIdx = flat.findIndex(
    (c) => accumulatedPhases?.[c.stageIdx]?.[c.phaseIdx] === undefined,
  );
  if (expectedIdx === -1) {
    return { flat, expected: undefined, mostRecent: flat[flat.length - 1] };
  }
  return {
    flat,
    expected: flat[expectedIdx],
    mostRecent: expectedIdx > 0 ? flat[expectedIdx - 1] : undefined,
  };
};

/**
 * Derive the next expected `(stageIdx, phaseIdx)` cursor — the first
 * unfilled slot in flattened journey order, or `undefined` when every
 * phase has accumulated. The cursor is owned by `accumulatedPhases`;
 * there is no separate counter field.
 */
export const nextExpectedCursor = (
  accumulatedPhases: AccumulatedPhases | undefined,
  stageJourneys: ReadonlyArray<StageJourney>,
): PhaseCursor | undefined =>
  resolveCursors(accumulatedPhases, stageJourneys).expected;

/**
 * Build the `priorPhases` trigger-payload slice: the steps-only
 * structured output of every phase whose `(stageIdx, phaseIdx)` cursor
 * is strictly before the phase about to run, paired with the journey
 * step that phase expanded and its 2-D cursor, in flattened journey
 * order. This is the inter-phase handoff — the current phase's agent
 * reads it to stay consistent with what earlier phases already
 * authored. The strict `< current` filter is what keeps a re-triggered
 * phase from seeing its own prior attempt; on the very first phase the
 * result is an empty array.
 */
export const buildPriorPhases = (
  accumulatedPhases: AccumulatedPhases | undefined,
  stageJourneys: ReadonlyArray<StageJourney>,
  current: PhaseCursor,
): PhaseBreakdownPriorPhase[] => {
  const priors: PhaseBreakdownPriorPhase[] = [];
  for (const cursor of flattenCursors(stageJourneys)) {
    if (!cursorBefore(cursor, current)) {
      break;
    }
    const plan = accumulatedPhases?.[cursor.stageIdx]?.[cursor.phaseIdx];
    const journeyStep = stageJourneys[cursor.stageIdx]?.phases[cursor.phaseIdx];
    if (plan !== undefined && journeyStep !== undefined) {
      priors.push({
        stageIdx: cursor.stageIdx,
        phaseIdx: cursor.phaseIdx,
        journeyStep,
        plan,
      });
    }
  }
  return priors;
};

/**
 * Wire shape of the ERROR-class completion the phase-breakdown node
 * synthesizes when the agent's emitted `(stageIdx, phaseIdx)` cursor
 * diverges from the expected slot. Returned by
 * `synthesizePhaseIdxMismatchCompletion` and stamped onto
 * `userMessage.data` so the engine sees a structured failure rather
 * than advancing on a corrupt cursor.
 *
 * `action` is `PLAN_SHAPING_ACTIONS.ERROR`, which is a registered key
 * in `planShapingPhaseBreakdownActions` — that registration is
 * load-bearing: `resolveExternalAgentRouting` re-runs
 * `validateExternalAgentCompletion` against this rewritten message, so
 * an unregistered action would be rejected as `unknown_action` before
 * routing ever ran. With `ERROR` registered, the flow template's
 * `ERROR → PHASE_BREAKDOWN` transition re-triggers the phase for a
 * clean retry.
 */
export interface PhaseIdxMismatchErrorCompletion {
  action: typeof PLAN_SHAPING_ACTIONS.ERROR;
  payload: PhaseIdxMismatchPayload;
}

/**
 * Construct an ERROR-class completion describing a phase-cursor
 * mismatch. Exported so tests can assert the synthesized shape
 * verbatim.
 */
export const synthesizePhaseIdxMismatchCompletion = (params: {
  expected: PhaseCursor;
  provided: PhaseCursor;
}): PhaseIdxMismatchErrorCompletion => ({
  action: PLAN_SHAPING_ACTIONS.ERROR,
  payload: {
    reason: 'phase_idx_mismatch',
    expected: params.expected,
    provided: params.provided,
  },
});

/**
 * `phase-breakdown` EXTERNAL_AGENT node — entered from the
 * `visual-preview-feedback` gate on `approve_all` and self-looping once per
 * journey step.
 *
 * Phase identity is a 2-D `(stageIdx, phaseIdx)` cursor derived from
 * `accumulatedPhases`, not a counter. The node groups `journeySteps`
 * by `stageId` into one ordered journey per durable stage, flattens
 * those journeys into a total order, and takes the next expected
 * cursor as the first slot with no accumulated plan. The visual-preview
 * node seeds `journeySteps` only; there is no counter field on
 * FlowContext.
 *
 * On entry the node derives that cursor, reads the journey step it
 * points at, and stamps `journeyStep`, `stageIdx`, `phaseIdx`, the
 * total phases, plan id, design-doc id, and `priorPhases` onto a
 * `PlanShapingPhaseBreakdownPromptPayload`. `priorPhases` carries the
 * steps-only output of every earlier phase so this phase's agent stays
 * consistent with the accumulating plan. The CLI agent investigates
 * the journey step against the real code and emits a steps-only
 * `{ stageIdx, phaseIdx, plan: { steps } }` payload via
 * `submit_phase_breakdown` — the agent authors no PLAN_STAGE or
 * PLAN_STEP proposals during the turn, and never authors stages at all
 * (the durable stage backbone already exists from proposed-stages) —
 * and the agent MUST echo back the same `(stageIdx, phaseIdx)` cursor
 * it received on the trigger.
 *
 * `processUserResponse` compares the agent's emitted cursor against
 * the expected value: an exact match writes the slot, a re-emission of
 * the most recently written slot (idempotent retry) is accepted as an
 * overwrite, and any other divergence rewrites the completion's
 * `action`/`payload` to a `PLAN_SHAPING_ACTIONS.ERROR` mismatch
 * completion and leaves `accumulatedPhases` unchanged. The flow
 * template routes that `ERROR` action back to PHASE_BREAKDOWN, which
 * re-derives the (unchanged) expected cursor and re-triggers the
 * agent — a corrupt cursor can never advance the plan or land partial
 * work.
 *
 * The per-action routing hook recomputes the next expected cursor from
 * `accumulatedPhases`: while a slot remains the workflow loops back to
 * PHASE_BREAKDOWN; once every phase has accumulated the hook returns
 * `undefined` and the engine falls through to the static
 * `DONE → STEP_REVIEW` transition. Materialization happens one node
 * later — on the step-review node's loop-exit — so the per-stage
 * tightening pass can rewrite each stage's accumulated steps before
 * they land. Phase-breakdown's loop-exit is therefore a pure transition,
 * not a materialization boundary.
 */
@Injectable()
export class PlanShapingPhaseBreakdownNode extends ExternalAgentNodeBase<PlanFromDesignDocFlowContext> {
  readonly id = PLAN_SHAPING_NODES.PHASE_BREAKDOWN;
  readonly title = 'Plan Shaping — Phase Breakdown';

  readonly promptType = LocalPromptType.plan_shaping_phase_breakdown;

  readonly actions: ExternalAgentActionSchemas =
    planShapingPhaseBreakdownActions;

  private readonly logger = new Logger(PlanShapingPhaseBreakdownNode.name);

  constructor(
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
    const { flat, expected } = resolveCursors(
      context.accumulatedPhases,
      stageJourneys,
    );

    if (journeySteps.length === 0 || expected === undefined) {
      // Defensive guard — visual-preview seeds journeySteps before this
      // node ever runs, and the routing hook only
      // re-enters PHASE_BREAKDOWN while a cursor remains. If the node
      // is somehow entered with no pending phase, surface it as a hard
      // error so the workflow does not silently spin emitting empty
      // triggers.
      throw new Error(
        `[phase-breakdown] cannot execute: no pending phase ` +
          `(journeySteps=${journeySteps.length}, ` +
          `accumulated=${countAccumulatedPhases(context.accumulatedPhases)})`,
      );
    }

    const journeyStep =
      stageJourneys[expected.stageIdx]!.phases[expected.phaseIdx]!;
    const flatIndex = flat.findIndex((c) => sameCursor(c, expected));

    this.logger.debug('Plan-shaping phase-breakdown node entered', {
      conversationId: context.core.conversationId,
      projectId: context.core.projectId,
      stageIdx: expected.stageIdx,
      phaseIdx: expected.phaseIdx,
      totalPhases: journeySteps.length,
      stepId: journeyStep.id,
    });

    const uiElements: UIElement[] = [
      {
        id: uuidv4(),
        type: ExtendedUIFieldType.AgentHidden,
        label: 'Plan Shaping — Phase Breakdown',
        required: false,
        influences: [],
      },
    ];

    // Inter-phase handoff: every earlier phase's steps-only structured
    // output, so the agent can keep this phase consistent with what is
    // already accumulating.
    const priorPhases = buildPriorPhases(
      context.accumulatedPhases,
      stageJourneys,
      expected,
    );

    const seed = await this.seedService.resolve(context.core.conversationId);

    const approvedVisuals = context.visualPreviewApprovedVisuals;
    if (!approvedVisuals) {
      throw new Error(
        '[phase-breakdown] cannot execute: the approved visual set has not been resolved',
      );
    }

    const triggerPayload: PlanShapingPhaseBreakdownPromptPayload = {
      journeyStep,
      stageIdx: expected.stageIdx,
      phaseIdx: expected.phaseIdx,
      phasesInStage: stageJourneys[expected.stageIdx]!.phases.length,
      totalPhases: journeySteps.length,
      designDocId: seed.designDocId,
      planId: seed.planId,
      priorPhases,
      approvedVisuals,
    };

    return {
      response: `Expanding journey step ${flatIndex + 1} of ${journeySteps.length}…`,
      uiElements,
      triggersAgent: {
        promptType: this.promptType,
        nodeId: this.id,
        payload: triggerPayload,
      },
      data: {
        detectedIntent: 'plan_shaping_phase_breakdown_started',
        intentConfidence: 1,
        reasoning:
          'External agent expanding one journey step into plan-step proposals under its durable stage.',
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
        phaseIdx?: number;
        plan?: PhaseBreakdownPlan;
      };
    };
    if (data.action !== PLAN_SHAPING_ACTIONS.DONE) {
      return;
    }

    const stageIdx = data.payload?.stageIdx;
    const phaseIdx = data.payload?.phaseIdx;
    const plan = data.payload?.plan;
    if (typeof stageIdx !== 'number' || typeof phaseIdx !== 'number' || !plan) {
      // Engine-level zod validation already rejects malformed payloads;
      // this guard exists so the TypeScript narrowing makes the mutate
      // closure read cleanly.
      return;
    }

    const ctxBefore = tracker.getContext();
    const stageJourneys = buildStageJourneys(ctxBefore.journeySteps ?? []);
    const { expected, mostRecent } = resolveCursors(
      ctxBefore.accumulatedPhases,
      stageJourneys,
    );
    const provided: PhaseCursor = { stageIdx, phaseIdx };

    // Match (the expected new slot) or the idempotent-overwrite retry
    // (agent re-emits the most recently written cursor) both write the
    // slot. Any other divergence synthesizes an ERROR-class completion
    // onto userMessage.data so the engine sees a structured failure
    // instead of advancing on a corrupt cursor.
    const isExpected = expected !== undefined && sameCursor(provided, expected);
    const isIdempotentRetry =
      mostRecent !== undefined && sameCursor(provided, mostRecent);

    if (!isExpected && !isIdempotentRetry) {
      const errorCompletion = synthesizePhaseIdxMismatchCompletion({
        expected: expected ?? mostRecent ?? { stageIdx: 0, phaseIdx: 0 },
        provided,
      });
      const mutableData = (userMessage.data ??= {}) as Record<string, unknown>;
      mutableData['action'] = errorCompletion.action;
      mutableData['payload'] = errorCompletion.payload;
      this.logger.warn(
        'Phase-breakdown: cursor mismatch — synthesized ERROR completion',
        {
          conversationId: ctxBefore.core.conversationId,
          expected: errorCompletion.payload.expected,
          provided,
        },
      );
      return;
    }

    const seed = await this.seedService.resolve(ctxBefore.core.conversationId);
    const admission = await this.admissionService.prepare({
      organizationId: ctxBefore.core.organizationId,
      projectId: ctxBefore.core.projectId,
      planId: seed.planId,
      kind: 'phase_breakdown',
      submission: { stageIdx, phaseIdx, plan },
      accumulatedPhases: ctxBefore.accumulatedPhases ?? {},
      expectedStageId: stageJourneys[stageIdx]?.stageId,
      expectedStageIdx: stageIdx,
      expectedPhaseIdx: phaseIdx,
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
      const accumulated = draft.accumulatedPhases ?? {};
      const stageBucket = accumulated[stageIdx] ?? {};
      stageBucket[phaseIdx] = acceptedPlan;
      accumulated[stageIdx] = stageBucket;
      draft.accumulatedPhases = accumulated;
    });

    const ctxAfter = tracker.getContext();
    this.logger.debug('Phase-breakdown: accumulated phase plan', {
      conversationId: ctxAfter.core.conversationId,
      stageIdx,
      phaseIdx,
      stepCount: plan.steps.length,
      accumulatedPhaseCount: countAccumulatedPhases(ctxAfter.accumulatedPhases),
      idempotentRetry: isIdempotentRetry,
    });
  }

  async determineRoutingFromAgentCompletion(
    context: PlanFromDesignDocFlowContext,
    action: string,
  ): Promise<string | undefined> {
    // Only `DONE` drives the loop/materialize decision here. A
    // synthesized `ERROR` completion (cursor mismatch) is left to the
    // static transition map, which routes `ERROR → PHASE_BREAKDOWN` for
    // a retry — returning `undefined` here keeps materialization
    // strictly on the `DONE` loop-exit branch so a mismatch can never
    // land partial work.
    if (action !== PLAN_SHAPING_ACTIONS.DONE) {
      return undefined;
    }

    const stageJourneys = buildStageJourneys(context.journeySteps ?? []);
    const { expected } = resolveCursors(
      context.accumulatedPhases,
      stageJourneys,
    );
    // `expected` is the next unfilled cursor. If a slot still remains,
    // another phase has work — loop back.
    if (expected !== undefined) {
      return PLAN_SHAPING_NODES.PHASE_BREAKDOWN;
    }

    // Loop has finished. Materialization is owned by the step-review
    // node now — returning undefined lets the engine take the static
    // `DONE → STEP_REVIEW` transition so the per-stage tightening
    // sweep runs against the accumulated steps before they land.
    this.logger.log(
      'Phase-breakdown: every phase accumulated; advancing to step-review',
      {
        conversationId: context.core.conversationId,
        phaseCount: countAccumulatedPhases(context.accumulatedPhases),
      },
    );
    return undefined;
  }
}
