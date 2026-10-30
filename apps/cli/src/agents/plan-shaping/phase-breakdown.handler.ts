/**
 * `plan_shaping_phase_breakdown` prompt-type handler.
 *
 * Fires once per journey step after the user approves the JourneyMap.
 * Phase identity is the 2-D `(stageIdx, phaseIdx)` cursor — `stageIdx`
 * indexes the plan's durable stages, `phaseIdx` indexes the journey
 * step within that stage's journey — derived API-side from the
 * already-accumulated phases on FlowContext; there is no server-side
 * counter. The agent investigates the current journey step against the
 * real code and emits a steps-only `{ stageIdx, phaseIdx, plan: { steps } }`
 * payload via `submit_phase_breakdown`. Each step binds by `stageId` to
 * the journey step's existing durable stage. The agent does NOT author
 * PLAN_STEP proposals during the turn and never authors stages; the
 * platform accumulates each phase's payload on FlowContext and
 * materializes every phase's steps in one transaction immediately
 * before the FINALIZE transition fires.
 *
 * Because authorship is the platform's job, this handler runs under the
 * read-only `plan_shaping` MCP use case (`PLAN_SHAPING_MCP_TOOLS`) and adds no
 * authoring tools — the platform mutation tools (`create_stage` /
 * `create_steps` / `create_work_item` / `create_design_doc` / `edit_work_item` / edge
 * tools) are absent because they are not in that base. Materialization is
 * owned by the platform's batched step that runs after the loop exits.
 * `plan_shaping` does not expose platform `create_report`, and the only
 * chain-populating tool the agent can reach is the locally-mounted
 * `create_phase_grounding` wrapper — the wrapper is what appends the
 * PHASE_GROUNDING entry the submission gate reads. The only platform tools
 * this turn needs are the read-only context lookups in the base
 * (`get_full_entity`, `get_context`, `get_report_schema`, `list_services`)
 * plus the local `Glob`/`Grep`/`Read` sandbox the agent uses to verify the
 * journey step against the actual code.
 *
 * `prepare()` fetches the design-doc body up-front and stashes it on
 * the prepared payload under `_designDocBody` so `buildPrompt` can
 * inject the body inline. The agent therefore reads the design doc
 * from the prompt rather than spending a `get_full_entity` tool call.
 *
 * The handler declares `providerSessionLifetime: 'turn'`: each
 * phase-breakdown iteration investigates one journey step against the
 * real code from a clean SDK session, and the session is discarded at
 * Turn end so nothing carries into the next iteration. Inter-phase
 * continuity is supplied explicitly by the `priorPhases` slice on the
 * trigger payload — the prompt re-grounds the agent on every iteration
 * rather than leaning on an accumulated SDK transcript.
 */

import type { AgenticSession } from '../../session/types';
import {
  LocalPromptType,
  type PlanShapingPhaseBreakdownPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  turnUserMessageBlock,
  type PrepareResult,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { CreatePhaseGroundingTool } from '../submission-tools/create-phase-grounding-tool';
import type { CreateReportProxy } from '../submission-tools/create-report-proxy';
import type { SubmissionToolDeclaration } from '../submission-tools/types';
import { buildPhaseBreakdownPrompt } from './prompts';
import { fetchDesignDocBody } from './fetch-design-doc';
import {
  createSubmitPhaseBreakdownTool,
  passthroughPlanSubmissionAdmissionClient,
} from './submission-tools';
import type { PlanSubmissionAdmissionClient } from './plan-submission-admission.client';
import { taskIdFromHandlerContext, taskIdFromSession } from '../run-entity';

type PhaseBreakdownPreparedPayload = PlanShapingPhaseBreakdownPromptPayload & {
  _designDocBody: string;
};

const preparePhaseBreakdownPayload = async (
  run: AgenticSession,
  payload: PlanShapingPhaseBreakdownPromptPayload,
  deps: PromptTypeHandlerDeps,
): Promise<PrepareResult<PlanShapingPhaseBreakdownPromptPayload>> => {
  const taskId = taskIdFromSession(run);
  const userMessage = payload.userMessage?.trim() ?? '';
  const turnKind = userMessage.length > 0 ? 'follow_up' : 'initial';
  const organizationId = run.contextMetadata.organizationId;

  deps.logger.info('plan_shaping_phase_breakdown.prepare.turn_starting', {
    runId: run.agentic_session_id,
    agenticSessionId: run.agentic_session_id,
    conversationId: run.conversationId,
    providerSessionId: run.provider_session_id ?? null,
    taskId: taskId ?? null,
    turnKind,
    userMessageLength: userMessage.length,
    stageIdx: payload.stageIdx,
    phaseIdx: payload.phaseIdx,
    phasesInStage: payload.phasesInStage,
    totalPhases: payload.totalPhases,
    priorPhasesCount: payload.priorPhases?.length ?? 0,
  });

  if (!organizationId) {
    throw new Error(
      'plan_shaping_phase_breakdown.prepare: run.contextMetadata.organizationId is required',
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

  const enriched: PhaseBreakdownPreparedPayload = {
    ...payload,
    _designDocBody: designDocBody,
  };

  return { payload: enriched };
};

const renderPhaseBreakdownPrompt = (
  payload: PlanShapingPhaseBreakdownPromptPayload,
  context?: PromptTypeHandlerContext,
): string => {
  const enriched = payload as PhaseBreakdownPreparedPayload;
  return buildPhaseBreakdownPrompt({
    taskId: taskIdFromHandlerContext(context),
    provider: context?.provider,
    userMessage: payload.userMessage ?? null,
    journeyStep: payload.journeyStep,
    stageIdx: payload.stageIdx,
    phaseIdx: payload.phaseIdx,
    phasesInStage: payload.phasesInStage,
    totalPhases: payload.totalPhases,
    designDocId: payload.designDocId,
    planId: payload.planId,
    priorPhases: payload.priorPhases ?? [],
    approvedVisuals: payload.approvedVisuals,
    designDocBody: enriched._designDocBody ?? '',
  });
};

/**
 * Build the phase-breakdown handler. The agent emits PHASE_GROUNDING via the
 * pass-through `create_phase_grounding` wrapper so the Run's report chain
 * captures each grounding round's `touchPoints[]`. The submission-tool gate
 * then confirms a PHASE_GROUNDING entry with non-empty touchPoints exists on
 * the chain; without the wrapper the chain stays empty and the gate has
 * nothing to validate against.
 */
export class PlanShapingPhaseBreakdownHandler implements UserLaunchablePromptTypeHandler<PlanShapingPhaseBreakdownPromptPayload> {
  public readonly id = 'plan_shaping_phase_breakdown';
  public readonly promptType = LocalPromptType.PlanShapingPhaseBreakdown;
  public readonly service = 'optional';
  public readonly launchEntity = 'required';
  public readonly implementationReadiness = 'none';
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly providerSessionStart = 'fresh' as const;
  public readonly providerSessionLifetime = 'turn' as const;
  public readonly reports = [];
  public readonly submissionTools: SubmissionToolDeclaration[];
  public readonly mcpToolUseCase = 'plan_shaping' as const;

  public constructor(
    createReportProxy: CreateReportProxy,
    admissionClient: PlanSubmissionAdmissionClient = passthroughPlanSubmissionAdmissionClient,
  ) {
    this.submissionTools = [
      createSubmitPhaseBreakdownTool(admissionClient),
      new CreatePhaseGroundingTool(createReportProxy),
    ];
  }

  public addUserMessage(payload: PlanShapingPhaseBreakdownPromptPayload) {
    return turnUserMessageBlock(payload.userMessage);
  }

  public prepare(
    run: AgenticSession,
    payload: PlanShapingPhaseBreakdownPromptPayload,
    deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<PlanShapingPhaseBreakdownPromptPayload>> {
    return preparePhaseBreakdownPayload(run, payload, deps);
  }

  public buildPrompt(
    payload: PlanShapingPhaseBreakdownPromptPayload,
    context?: PromptTypeHandlerContext,
  ): string {
    return renderPhaseBreakdownPrompt(payload, context);
  }

  public buildStartingMessage(): string | null {
    return 'Generating steps for plan phase…';
  }
}
