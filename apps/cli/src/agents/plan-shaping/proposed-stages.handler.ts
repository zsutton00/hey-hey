/**
 * `plan_shaping_proposed_stages` prompt-type handler.
 *
 * First step of the plan-from-design-doc plan-shaping flow: proposes the
 * plan's stages as platform proposals via the plan-shaping MCP tools, and advances via READY once
 * the user is happy with the stage shape.
 */

import { FUTURE_REVISION_MCP_TOOLS } from '../mcp-server-config';

import {
  LocalPromptType,
  type PlanShapingProposedStagesPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  turnUserMessageBlock,
  type PrepareResult,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildProposedStagesPrompt } from './prompts';
import { proposedStagesSubmissionTools } from './submission-tools';
import { taskIdFromSession } from '../run-entity';

/**
 * The plan-authoring (stages + steps) tools this handler contributes on top of
 * the read-only `plan_shaping` MCP base (`PLAN_SHAPING_MCP_TOOLS`). The Claude
 * SDK freezes `allowedTools` at session mint, so the surface pinned here —
 * the `plan_shaping` base plus these authoring tools — is what every later
 * plan-shaping step (e.g. `finalize`) inherits via the default
 * `providerSessionStart: 'inherit'` and rides on. proposed-stages itself
 * declares `'fresh'` so it does not ride on whatever the upstream handler
 * (feature-sync analyze, in the `plan_from_design_doc` workflow) pinned —
 * those sessions allow-list a different surface that does not cover the
 * plan-shaping authoring tools or the run's submission tools.
 *
 * `create_report` is not listed: it is a run-scoped submission tool wrapper,
 * not a platform MCP tool, so the frozen `allowedTools` on a resumed session
 * does not constrain it.
 */
export const PLAN_SHAPING_ALLOWED_TOOLS: readonly string[] = [
  'get_authoring_guidance',
  'create_work_item',
  'edit_work_item',
  'get_proposal',
  'update_proposal',
  ...FUTURE_REVISION_MCP_TOOLS,
];

export const planShapingProposedStagesHandler: UserLaunchablePromptTypeHandler<PlanShapingProposedStagesPromptPayload> =
  {
    id: 'plan_shaping_proposed_stages',
    promptType: LocalPromptType.PlanShapingProposedStages,
    service: 'optional',
    launchEntity: 'required',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    providerSessionStart: 'fresh',
    reports: [],

    submissionTools: [...proposedStagesSubmissionTools],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    mcpToolUseCase: 'plan_shaping',
    additionalAllowedTools: PLAN_SHAPING_ALLOWED_TOOLS,

    prepare: async (
      run,
      payload,
      deps,
    ): Promise<PrepareResult<PlanShapingProposedStagesPromptPayload>> => {
      const taskId = taskIdFromSession(run);
      const userMessage = payload.userMessage?.trim() ?? '';
      const turnKind = userMessage.length > 0 ? 'follow_up' : 'initial';
      deps.logger.info('plan_shaping_proposed_stages.prepare.turn_starting', {
        runId: run.agentic_session_id,
        taskId: taskId ?? null,
        turnKind,
        userMessageLength: userMessage.length,
      });
      return { payload };
    },

    buildPrompt(payload: PlanShapingProposedStagesPromptPayload): string {
      return buildProposedStagesPrompt({
        userMessage: payload.userMessage ?? null,
        designDocId: payload.designDocId,
        planId: payload.planId,
      });
    },

    buildStartingMessage(): string | null {
      return 'Sketching out the stages...';
    },
  };
