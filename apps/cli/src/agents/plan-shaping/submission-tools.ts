/**
 * Submission tools for the plan-from-design-doc plan-shaping
 * EXTERNAL_AGENT nodes.
 *
 * Action keys mirror the server-side contract in
 * `api/src/flows/nodes/plan-shaping/schemas.ts`:
 *
 *   PROPOSED_STAGES                  → READY
 *   FINALIZE (terminal)              → DONE
 *   PHASE_BREAKDOWN                  → DONE (carries the steps-only plan)
 *   STEP_REVIEW                      → STEP_REVIEW_DONE (carries the tightened step set)
 *
 * Proposed-stages READY carries the advisory decided stage total. Other
 * READY/DONE tools carry no payload — plan state is authored as platform
 * proposals by the agent's tool calls earlier in the turn, and the completion
 * message only signals that the node is ready to advance.
 */

import type {
  ActionSubmissionToolDeclaration,
  SubmissionToolCorrectableFinding,
  SubmissionToolDeclaration,
  SubmissionToolInputSchema,
} from '../submission-tools/types';
import { SubmissionToolCorrectableError } from '../submission-tools/types';
import type { PlanShapingProposedStagesCompletionPayload } from '../../shared/agent-bridge-contract/generated/api';
import type {
  PhaseBreakdownCompletionPayload as ApiPhaseBreakdownCompletionPayload,
  StepReviewCompletionPayload as ApiStepReviewCompletionPayload,
} from '../../shared/api/generated/api';
import {
  PHASE_STEP_CEILING,
  STAGE_REVIEW_STEP_CEILING,
  phaseBreakdownCompletionPayloadSchema,
  stepReviewCompletionPayloadSchema,
} from './journey-map.schemas';
import type { PlanSubmissionAdmissionClient } from './plan-submission-admission.client';

export const PLAN_SHAPING_ACTIONS = {
  READY: 'READY',
  DONE: 'DONE',
  /**
   * Step-review terminal discriminator. Distinct from `DONE` (the
   * phase-breakdown terminal) so the engine validator rejects a step-review
   * completion that lands on a node still expecting a phase-breakdown
   * completion — or vice versa — as `unknown_action` rather than silently
   * accepting it under the wrong schema. Must match the server-side
   * `STEP_REVIEW_DONE` action registered in `planShapingStepReviewActions`
   * (`api/src/flows/nodes/plan-shaping/schemas.ts`).
   */
  STEP_REVIEW_DONE: 'STEP_REVIEW_DONE',
} as const;

const emptyInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

interface SchemaIssue {
  code: string;
  message: string;
  path: ReadonlyArray<PropertyKey>;
}

const schemaIssueFindings = (
  issues: ReadonlyArray<SchemaIssue>,
): ReadonlyArray<SubmissionToolCorrectableFinding> =>
  issues.map((issue) => {
    const field = `/${issue.path.map(String).join('/')}`;
    return {
      field,
      code: issue.code,
      reason: issue.message,
      correction: `Correct ${field} and retry the same submission tool.`,
    };
  });

const invalidPayloadError = (
  toolName: string,
  payloadName: string,
  issues: ReadonlyArray<SchemaIssue>,
): SubmissionToolCorrectableError =>
  new SubmissionToolCorrectableError({
    reason: `${toolName} received an invalid ${payloadName}.`,
    findings: schemaIssueFindings(issues),
  });

const apiPlan = (plan: {
  steps: Array<{
    id: string;
    stageId: string;
    title: string;
    description: string;
    implementation: string;
    type: 'TASK';
    acceptanceCriteria: string;
    sequenceOrder: number;
    dependsOnStepIds?: string[] | undefined;
    serviceIds?: string[] | undefined;
    designDocMotivation: string;
  }>;
}) => ({
  steps: plan.steps.map((step) => ({
    id: step.id,
    stageId: step.stageId,
    title: step.title,
    description: step.description,
    implementation: step.implementation,
    type: step.type,
    acceptanceCriteria: step.acceptanceCriteria,
    sequenceOrder: step.sequenceOrder,
    ...(step.dependsOnStepIds !== undefined ? { dependsOnStepIds: step.dependsOnStepIds } : {}),
    ...(step.serviceIds !== undefined ? { serviceIds: step.serviceIds } : {}),
    designDocMotivation: step.designDocMotivation,
  })),
});

export const submitReadyTool: SubmissionToolDeclaration = {
  name: 'submit_ready',
  description:
    'Call this when you are done with the current plan-shaping step and the conversation is ready to advance to the next one. Emits the READY action that the workflow engine routes on.',
  inputSchema: emptyInputSchema,
  execute: () => ({ action: PLAN_SHAPING_ACTIONS.READY }),
  hidden: true,
};

const proposedStagesReadyInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['expectedStageCount'],
  additionalProperties: false,
  properties: {
    expectedStageCount: { type: 'integer', minimum: 0 },
  },
};

export const submitProposedStagesReadyTool: SubmissionToolDeclaration = {
  name: 'submit_proposed_stages_ready',
  description:
    'Call this on every initial and refinement completion with the decided total number of stages, including unchanged totals and completions with no new stage writes. The count is not the number of proposal writes.',
  inputSchema: proposedStagesReadyInputSchema,
  execute: ({ args }) => {
    if (Object.keys(args).some((key) => key !== 'expectedStageCount')) {
      throw new Error('submit_proposed_stages_ready accepts only expectedStageCount');
    }
    const value = args['expectedStageCount'];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(
        'submit_proposed_stages_ready expectedStageCount must be a non-negative integer',
      );
    }
    const expectedStageCount = value;
    return {
      action: PLAN_SHAPING_ACTIONS.READY,
      payload: {
        expectedStageCount,
      } satisfies PlanShapingProposedStagesCompletionPayload,
    };
  },
  hidden: true,
};

export const submitDoneTool: SubmissionToolDeclaration = {
  name: 'submit_done',
  description:
    'Call this once the plan has landed and no further action is required. Emits the terminal DONE action that keeps the conversation parked on the finalize node.',
  inputSchema: emptyInputSchema,
  execute: () => ({ action: PLAN_SHAPING_ACTIONS.DONE }),
  hidden: true,
};

export const proposedStagesSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  submitProposedStagesReadyTool,
];

export const refineStageSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [
  submitReadyTool,
];

export const finalizeSubmissionTools: ReadonlyArray<SubmissionToolDeclaration> = [submitDoneTool];

const phaseBreakdownStepJsonSchema = {
  type: 'object',
  required: [
    'id',
    'stageId',
    'title',
    'description',
    'implementation',
    'type',
    'acceptanceCriteria',
    'sequenceOrder',
    'designDocMotivation',
  ],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
    stageId: { type: 'string', format: 'uuid' },
    title: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    implementation: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['TASK'] },
    acceptanceCriteria: {
      type: 'string',
      minLength: 1,
      description:
        'A single Markdown string containing newline-delimited bullet points (for example, "- First condition\\n- Second condition"). Do not pass a JSON array.',
    },
    sequenceOrder: { type: 'integer', minimum: 0 },
    dependsOnStepIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
    serviceIds: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
      description:
        'Optional complete known project Service assignment array. Missing, empty, invalid, unresolved, or incomplete coverage is advisory: omit inactive or out-of-project IDs and still submit otherwise valid work. Coherent multi-Service scope is accepted. Repeated valid IDs are preserved through admission and persistence, then assigned once per unique ID.',
    },
    designDocMotivation: { type: 'string', minLength: 1 },
  },
} as const;

const phaseBreakdownInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['stageIdx', 'phaseIdx', 'plan'],
  additionalProperties: false,
  properties: {
    stageIdx: { type: 'integer', minimum: 0 },
    phaseIdx: { type: 'integer', minimum: 0 },
    plan: {
      type: 'object',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        steps: {
          type: 'array',
          maxItems: PHASE_STEP_CEILING,
          items: phaseBreakdownStepJsonSchema,
        },
      },
    },
  },
};

/**
 * Submission tool for the plan-shaping phase-breakdown EXTERNAL_AGENT
 * node. The agent calls `submit_phase_breakdown` exactly once per
 * phase-breakdown turn with the steps-only `{ stageIdx, phaseIdx, plan }`
 * payload describing the steps the platform should materialize under
 * the current journey step's existing durable stage. The platform
 * accumulates these payloads on FlowContext and materializes every
 * accumulated phase's steps in one transaction immediately before the
 * FINALIZE transition fires — the agent does NOT author PLAN_STEP
 * proposals during the turn, and it never authors stages.
 *
 * Precondition. Before emitting DONE the tool requires that the agent has
 * already posted a PHASE_GROUNDING entry on this turn's report chain (read
 * via `ctx.run.readReportChain()`) with a non-empty `touchPoints` list. The
 * check surfaces its failure as a correctable MCP result. It records no
 * completion, so the caller can add or repair the report and retry.
 */
export const createSubmitPhaseBreakdownTool = (
  admissionClient: PlanSubmissionAdmissionClient,
): ActionSubmissionToolDeclaration => ({
  name: 'submit_phase_breakdown',
  description:
    "Before calling this tool, post a PHASE_GROUNDING entry via `create_phase_grounding` whose `touchPoints` enumerate the files this phase will touch; this tool rejects if no PHASE_GROUNDING entry is present on the turn's chain or its touchPoints list is empty. A correctable_rejection records no completion: fix every finding and retry this tool in the same active turn.\n\nCall this when the current phase's investigation is complete and the steps-only plan for the phase is ready. Provide `stageIdx` and `phaseIdx` (the 2-D cursor this turn was triggered on, echoed back verbatim) and `plan` (the steps the platform should materialize, each bound by `stageId` to the journey step's existing durable stage). The platform accumulates these payloads across the loop and materializes every phase's steps in one transaction before the plan lands; do not author stage or step proposals during the turn, and never author stages. Emits the DONE action only after the payload is accepted.",
  inputSchema: phaseBreakdownInputSchema,
  async execute({ args, run }) {
    const parsed = phaseBreakdownCompletionPayloadSchema.safeParse({
      stageIdx: args['stageIdx'],
      phaseIdx: args['phaseIdx'],
      plan: args['plan'],
    });
    if (!parsed.success) {
      throw invalidPayloadError('submit_phase_breakdown', 'payload', parsed.error.issues);
    }

    if (!run) {
      throw new Error(
        'submit_phase_breakdown requires an active Run for cross-validation (ctx.run was not resolved)',
      );
    }

    const chain = run.readReportChain();
    const groundingEntries = chain.filter((entry) => entry.reportType === 'PHASE_GROUNDING');
    const grounding = groundingEntries[groundingEntries.length - 1];
    if (!grounding) {
      throw new SubmissionToolCorrectableError({
        reason:
          'submit_phase_breakdown requires a PHASE_GROUNDING entry before admission; none was found.',
        findings: [
          {
            identity: 'PHASE_GROUNDING',
            code: 'missing_prerequisite',
            reason: 'No PHASE_GROUNDING entry was found on the current report chain.',
            correction:
              'Emit one via create_phase_grounding with touchPoints for this phase, then retry submit_phase_breakdown.',
          },
        ],
      });
    }
    const touchPoints = grounding.touchPoints ?? [];
    if (touchPoints.length === 0) {
      throw new SubmissionToolCorrectableError({
        reason:
          'submit_phase_breakdown requires usable phase grounding; the paired entry has no touchPoints.',
        findings: [
          {
            identity: 'PHASE_GROUNDING.touchPoints',
            code: 'empty_prerequisite',
            reason: 'The paired PHASE_GROUNDING entry has no touchPoints.',
            correction:
              'Create a replacement PHASE_GROUNDING entry that names at least one file for this phase, then retry submit_phase_breakdown.',
          },
        ],
      });
    }

    const apiSubmission = {
      stageIdx: parsed.data.stageIdx,
      phaseIdx: parsed.data.phaseIdx,
      plan: apiPlan(parsed.data.plan),
    } satisfies ApiPhaseBreakdownCompletionPayload;
    const admission = await admissionClient.admit(run, {
      kind: 'phase_breakdown',
      submission: apiSubmission,
    });
    if (admission.status !== 'accepted') {
      throw new SubmissionToolCorrectableError({
        reason:
          admission.status === 'conflict'
            ? 'The Plan changed while this submission was being admitted.'
            : 'The Plan submission contains correctable input findings.',
        findings: admission.findings.map((item) => ({
          field: item.field,
          code: item.code,
          reason: item.reason,
          correction: item.correction ?? 'Correct this field and retry the same submission.',
        })),
      });
    }
    return {
      action: PLAN_SHAPING_ACTIONS.DONE,
      payload: { ...admission.submission },
    };
  },
  hidden: true,
});

const stepReviewInputSchema: SubmissionToolInputSchema = {
  type: 'object',
  required: ['stageIdx', 'plan'],
  additionalProperties: false,
  properties: {
    stageIdx: { type: 'integer', minimum: 0 },
    plan: {
      type: 'object',
      required: ['steps'],
      additionalProperties: false,
      properties: {
        steps: {
          type: 'array',
          maxItems: STAGE_REVIEW_STEP_CEILING,
          items: phaseBreakdownStepJsonSchema,
        },
      },
    },
  },
};

/**
 * Submission tool for the plan-shaping step-review EXTERNAL_AGENT node. The
 * agent calls `submit_step_review` exactly once per stage with the tightened
 * `{ stageIdx, plan: { steps } }` payload — the full reviewed step set for the
 * stage under replace-the-stage-set semantics. `stageIdx` echoes back the
 * cursor the turn was triggered on so admission can report divergence for a
 * same-turn correction; the API overwrites
 * `accumulatedPhases[stageIdx]` with the returned steps as a single synthetic
 * phase. Unlike `submit_phase_breakdown` there is no PHASE_GROUNDING
 * precondition: the review turn reasons over the already-drafted steps against
 * the design doc rather than grounding fresh touch points in the code, so it
 * needs no report-chain entry to validate against.
 */
export const createSubmitStepReviewTool = (
  admissionClient: PlanSubmissionAdmissionClient,
): ActionSubmissionToolDeclaration => ({
  name: 'submit_step_review',
  description:
    "Call this once you have reviewed the stage's drafted steps against the design doc and the tightened step set is ready. Provide `stageIdx` (the stage cursor this turn was triggered on, echoed back verbatim) and `plan` (the full tightened step set for the stage — drop a step by omitting it, merge two by returning one in their place, add one with a fresh UUID, and keep a step's `id` and `stageId` when rewriting it). If the tool returns correctable_rejection, fix every identified field and retry this tool in the same active turn. The platform overwrites the stage's drafted steps with this set and materializes the plan once the review loop completes; do not author stage or step proposals during the turn. Emits STEP_REVIEW_DONE only after the payload is accepted.",
  inputSchema: stepReviewInputSchema,
  async execute({ args, run }) {
    const parsed = stepReviewCompletionPayloadSchema.safeParse({
      stageIdx: args['stageIdx'],
      plan: args['plan'],
    });
    if (!parsed.success) {
      throw invalidPayloadError('submit_step_review', 'payload', parsed.error.issues);
    }

    if (!run) {
      throw new Error('submit_step_review requires an active Run for admission.');
    }
    const apiSubmission = {
      stageIdx: parsed.data.stageIdx,
      plan: apiPlan(parsed.data.plan),
    } satisfies ApiStepReviewCompletionPayload;
    const admission = await admissionClient.admit(run, {
      kind: 'step_review',
      submission: apiSubmission,
    });
    if (admission.status !== 'accepted') {
      throw new SubmissionToolCorrectableError({
        reason:
          admission.status === 'conflict'
            ? 'The Plan changed while this submission was being admitted.'
            : 'The Plan submission contains correctable input findings.',
        findings: admission.findings.map((item) => ({
          field: item.field,
          code: item.code,
          reason: item.reason,
          correction: item.correction ?? 'Correct this field and retry the same submission.',
        })),
      });
    }
    return {
      action: PLAN_SHAPING_ACTIONS.STEP_REVIEW_DONE,
      payload: { ...admission.submission },
    };
  },
  hidden: true,
});

/** Test-only compatibility fixture; production handlers receive the API client explicitly. */
export const passthroughPlanSubmissionAdmissionClient = {
  admit: async (_run: unknown, request: { submission: Record<string, unknown> }) => ({
    status: 'accepted' as const,
    submission: request.submission,
    advisories: [],
  }),
} as unknown as PlanSubmissionAdmissionClient;

export const submitPhaseBreakdownTool = createSubmitPhaseBreakdownTool(
  passthroughPlanSubmissionAdmissionClient,
);
export const submitStepReviewTool = createSubmitStepReviewTool(
  passthroughPlanSubmissionAdmissionClient,
);
