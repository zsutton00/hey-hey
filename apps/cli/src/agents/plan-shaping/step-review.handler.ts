/**
 * `plan_shaping_step_review` prompt-type handler.
 *
 * Fires once per stage after phase-breakdown has expanded every phase and
 * before any step is saved. The agent reads the stage's full set of drafted
 * steps together with the design doc and returns the tightened step set for
 * the stage via `submit_step_review` — dropping steps the design doc does not
 * motivate, merging duplicates two phases each produced, and resolving
 * contradictions. The completion is a `{ stageIdx, plan: { steps } }` payload
 * the agent echoes the stage cursor back on; the platform overwrites
 * `accumulatedPhases[stageIdx]` with the returned steps and materializes the
 * plan once every stage has been reviewed.
 *
 * This is the read-only sibling of phase-breakdown minus the PHASE_GROUNDING
 * wrapper: the review reasons over already-drafted steps against the design
 * doc rather than grounding fresh touch points in the code, so it needs no
 * `create_phase_grounding` proxy and no report-chain precondition. It runs
 * under the read-only `plan_shaping` MCP use case (the platform mutation tools
 * are absent) and the local `Glob`/`Grep`/`Read` sandbox the agent uses to
 * spot-check a step's grounding.
 *
 * `prepare()` fetches the design-doc body up-front and stashes it on the
 * prepared payload under `_designDocBody` so `buildPrompt` can inject the body
 * inline — the agent reviews against the design doc from the prompt rather
 * than spending a `get_full_entity` tool call.
 *
 * The handler declares `providerSessionLifetime: 'turn'`: each stage's review
 * runs from a clean SDK session and the session is discarded at Turn end, so
 * nothing carries between stages — the trigger payload supplies the stage's
 * drafted steps explicitly on every iteration.
 */

import type { AgenticSession } from '../../session/types';
import {
  LocalPromptType,
  PlanCombinationAggressiveness,
  type PlanShapingStepReviewPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  turnUserMessageBlock,
  type PrepareResult,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildStepReviewPrompt } from './prompts';
import { fetchDesignDocBody } from './fetch-design-doc';
import {
  createSubmitStepReviewTool,
  passthroughPlanSubmissionAdmissionClient,
} from './submission-tools';
import type { PlanSubmissionAdmissionClient } from './plan-submission-admission.client';
import { taskIdFromHandlerContext, taskIdFromSession } from '../run-entity';

type StepReviewPreparedPayload = PlanShapingStepReviewPromptPayload & {
  _designDocBody: string;
  _planCombinationAggressiveness: PlanCombinationAggressiveness;
};

const resolvePlanCombinationAggressiveness = (
  run: AgenticSession,
): PlanCombinationAggressiveness => {
  const value =
    run.config?.type === 'CODING_SESSION' ? run.config.planCombinationAggressiveness : undefined;

  if (value === undefined) {
    return PlanCombinationAggressiveness.Medium;
  }
  if (
    value === PlanCombinationAggressiveness.Low ||
    value === PlanCombinationAggressiveness.Medium ||
    value === PlanCombinationAggressiveness.High
  ) {
    return value;
  }

  throw new Error(
    'plan_shaping_step_review.prepare: run.config.planCombinationAggressiveness must be low, medium, or high',
  );
};

const prepareStepReviewPayload = async (
  run: AgenticSession,
  payload: PlanShapingStepReviewPromptPayload,
  deps: PromptTypeHandlerDeps,
): Promise<PrepareResult<PlanShapingStepReviewPromptPayload>> => {
  const taskId = taskIdFromSession(run);
  const userMessage = payload.userMessage?.trim() ?? '';
  const turnKind = userMessage.length > 0 ? 'follow_up' : 'initial';
  const organizationId = run.contextMetadata.organizationId;
  const planCombinationAggressiveness = resolvePlanCombinationAggressiveness(run);

  deps.logger.info('plan_shaping_step_review.prepare.turn_starting', {
    runId: run.agentic_session_id,
    agenticSessionId: run.agentic_session_id,
    conversationId: run.conversationId,
    providerSessionId: run.provider_session_id ?? null,
    taskId: taskId ?? null,
    turnKind,
    userMessageLength: userMessage.length,
    stageIdx: payload.stageIdx,
    totalStages: payload.totalStages,
    draftedStepCount: payload.steps.length,
    planCombinationAggressiveness,
  });

  if (!organizationId) {
    throw new Error(
      'plan_shaping_step_review.prepare: run.contextMetadata.organizationId is required',
    );
  }

  const accessToken = await deps.auth.getAccessToken();
  const designDocBody = await fetchDesignDocBody({
    organizationId,
    designDocId: payload.designDocId,
    fetchImpl: deps.fetchImpl,
    accessToken,
    apiBaseUrl: deps.apiBaseUrl,
    logger: deps.logger,
  });

  const enriched: StepReviewPreparedPayload = {
    ...payload,
    _designDocBody: designDocBody,
    _planCombinationAggressiveness: planCombinationAggressiveness,
  };

  return { payload: enriched };
};

const renderStepReviewPrompt = (
  payload: PlanShapingStepReviewPromptPayload,
  context?: PromptTypeHandlerContext,
): string => {
  const enriched = payload as StepReviewPreparedPayload;
  return buildStepReviewPrompt({
    taskId: taskIdFromHandlerContext(context),
    userMessage: payload.userMessage ?? null,
    steps: payload.steps,
    stageIdx: payload.stageIdx,
    totalStages: payload.totalStages,
    designDocId: payload.designDocId,
    planId: payload.planId,
    approvedVisuals: payload.approvedVisuals,
    designDocBody: enriched._designDocBody ?? '',
    planCombinationAggressiveness:
      enriched._planCombinationAggressiveness ?? PlanCombinationAggressiveness.Medium,
  });
};

export const createPlanShapingStepReviewHandler = (
  admissionClient: PlanSubmissionAdmissionClient,
): UserLaunchablePromptTypeHandler<PlanShapingStepReviewPromptPayload> => ({
  id: 'plan_shaping_step_review',
  promptType: LocalPromptType.PlanShapingStepReview,
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  providerSessionStart: 'fresh',
  providerSessionLifetime: 'turn',
  reports: [],

  submissionTools: [createSubmitStepReviewTool(admissionClient)],

  mcpToolUseCase: 'plan_shaping',

  addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

  prepare: prepareStepReviewPayload,

  buildPrompt: renderStepReviewPrompt,

  buildStartingMessage(): string | null {
    return 'Reviewing the drafted steps for this stage…';
  },
});

/** Test compatibility; production registration uses the injected factory above. */
export const planShapingStepReviewHandler = createPlanShapingStepReviewHandler(
  passthroughPlanSubmissionAdmissionClient,
);
