/**
 * Shared zod schemas for the plan-shaping phase-breakdown and step-review
 * wire shapes.
 *
 * The `JourneyStep` / `ServiceNote` definitions are validated by the
 * trigger-payload validator on the phase-breakdown wire payload
 * (`trigger-payload-schemas.ts`), where the platform sends the journey step
 * the agent is about to expand.
 *
 * `submit_phase_breakdown` zod-parses the `{ stageIdx, phaseIdx, plan }`
 * payload the agent emits before posting DONE. `plan` is steps-only: a phase emits `PLAN_STEP`s bound to an existing
 * durable `stageId`; it never authors stages.
 */

import { z } from 'zod';

/**
 * Hard cap on the number of journey steps a single stage's journey may
 * carry. The cap is per stage, not per map, so the whole map's budget
 * scales with the number of durable stages. Each journey step becomes its
 * own phase-breakdown turn that emits the soft 3–5 steps below, so this
 * cap holds a stage's materialized step count to roughly 15 — the point at
 * which a single stage stops reading as a coherent rollout cut.
 */
const JOURNEY_STEPS_PER_STAGE_CAP = 3;

/**
 * Hard ceiling on the number of steps a single phase-breakdown plan may
 * emit for one journey step. Sits above the prompt's soft 3–5 target so a
 * justified phase can exceed the target without tripping the schema, while
 * still rejecting a runaway plan.
 */
export const PHASE_STEP_CEILING = 8;

const serviceNoteSchema = z.object({
  text: z.string().min(1, { message: 'text must not be empty' }),
  serviceId: z.string().uuid({ message: 'serviceId must be a UUID' }).nullable(),
  serviceName: z.string().nullable(),
});

export const journeyStepSchema = z.object({
  id: z.string().min(1, { message: 'id must not be empty' }),
  stageId: z.string().uuid({ message: 'stageId must be a UUID' }),
  title: z.string().min(1, { message: 'title must not be empty' }),
  description: z.string().min(1, { message: 'description must not be empty' }),
  isUserInteractive: z.boolean(),
  implementationNotes: z.array(serviceNoteSchema),
});

export const phaseBreakdownStepSchema = z.object({
  id: z.string().uuid({ message: 'step id must be a UUID' }),
  stageId: z.string().uuid({ message: 'stageId must be a UUID' }),
  title: z.string().min(1, { message: 'step title must not be empty' }),
  description: z.string().min(1, { message: 'step description must not be empty' }),
  implementation: z.string().min(1, { message: 'step implementation must not be empty' }),
  type: z.enum(['TASK']),
  acceptanceCriteria: z.string().min(1, { message: 'acceptanceCriteria must not be empty' }),
  sequenceOrder: z.number().int().nonnegative(),
  dependsOnStepIds: z.array(z.string().uuid()).optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  designDocMotivation: z.string().min(1, { message: 'designDocMotivation must not be empty' }),
});

const phaseBreakdownPlanSchema = z.object({
  steps: z.array(phaseBreakdownStepSchema).max(PHASE_STEP_CEILING, {
    message: `a phase plan may emit at most ${PHASE_STEP_CEILING} steps for one journey step — split the work across phases instead of overloading one`,
  }),
});

export const phaseBreakdownCompletionPayloadSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
  phaseIdx: z.number().int().nonnegative(),
  plan: phaseBreakdownPlanSchema,
});

type PhaseBreakdownCompletionPayload = z.infer<typeof phaseBreakdownCompletionPayloadSchema>;

/**
 * Hard ceiling on the number of steps the per-stage step-review turn may emit
 * for a single stage. A stage's journey holds at most
 * `JOURNEY_STEPS_PER_STAGE_CAP` phases and each phase emits at most
 * `PHASE_STEP_CEILING` steps, so the most steps phase-breakdown could have
 * drafted for one stage is their product. The review pass only tightens the
 * drafted set (dropping, merging, occasionally adding a step), so its output
 * should never exceed what the loop could have produced — derived here so the
 * cap tracks its two inputs rather than drifting as a hardcoded number.
 */
export const STAGE_REVIEW_STEP_CEILING = JOURNEY_STEPS_PER_STAGE_CAP * PHASE_STEP_CEILING;

/**
 * The tightened step set the step-review turn emits for one stage. Reuses
 * `phaseBreakdownStepSchema` as the per-step shape so the review boundary
 * validates exactly what phase-breakdown produced, capped at the per-stage
 * ceiling above.
 */
const stepReviewPlanSchema = z.object({
  steps: z.array(phaseBreakdownStepSchema).max(STAGE_REVIEW_STEP_CEILING, {
    message: `a stage's reviewed step set may hold at most ${STAGE_REVIEW_STEP_CEILING} steps — tighten by merging or dropping rather than emitting more`,
  }),
});

export const stepReviewCompletionPayloadSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
  plan: stepReviewPlanSchema,
});

type StepReviewCompletionPayload = z.infer<typeof stepReviewCompletionPayloadSchema>;

/**
 * One entry in the `priorPhases` slice of the phase-breakdown trigger
 * payload — an earlier phase's structured plan output paired with the
 * journey step it expanded. Validated at the dispatcher boundary so the
 * inter-phase handoff the prompt renders is checked before the agent
 * turn runs; `z.object` would otherwise strip the whole field.
 */
export const phaseBreakdownPriorPhaseSchema = z.object({
  stageIdx: z.number().int().nonnegative(),
  phaseIdx: z.number().int().nonnegative(),
  journeyStep: journeyStepSchema,
  plan: phaseBreakdownPlanSchema,
});
