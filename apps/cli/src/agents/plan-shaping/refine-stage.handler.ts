/**
 * `plan_shaping_refine_stage` prompt-type handler.
 *
 * Fires when the user opens a stage in REFINING status from the plan UI.
 * The agent reads the stage's approved theme rows via `get_full_entity`
 * and expands them into concrete step proposals via the plan-shaping
 * MCP tools, then advances via READY once the user is happy with what
 * sits under the stage. Refine-stage starts its own provider session
 * (it is the session-start handler for the refine-stage flow), so it
 * declares its own subset of the plan-shaping allowlist — narrowed to
 * step-shaping because it never reshapes the stage backbone.
 */

import { FUTURE_REVISION_MCP_TOOLS } from '../mcp-server-config';

import {
  LocalPromptType,
  type PlanShapingRefineStagePromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import { turnUserMessageBlock, type UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import { buildRefineStagePrompt } from './prompts';
import { preparePlanShapingPayload } from './prepare-payload';
import { refineStageSubmissionTools } from './submission-tools';
import { taskIdFromHandlerContext } from '../run-entity';

const REFINE_STAGE_ALLOWED_TOOLS: readonly string[] = [
  'get_authoring_guidance',
  'create_work_item',
  'edit_work_item',
  'get_proposal',
  'update_proposal',
  ...FUTURE_REVISION_MCP_TOOLS,
];

export const planShapingRefineStageHandler: UserLaunchablePromptTypeHandler<PlanShapingRefineStagePromptPayload> =
  {
    id: 'plan_shaping_refine_stage',
    promptType: LocalPromptType.PlanShapingRefineStage,
    service: 'optional',
    launchEntity: 'required',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    submissionTools: [...refineStageSubmissionTools],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    mcpToolUseCase: 'plan_shaping',
    additionalAllowedTools: REFINE_STAGE_ALLOWED_TOOLS,

    prepare: (run, payload, deps) =>
      preparePlanShapingPayload(
        run,
        payload,
        deps,
        'plan_shaping_refine_stage.prepare.turn_starting',
      ),

    buildPrompt(payload: PlanShapingRefineStagePromptPayload, context): string {
      return buildRefineStagePrompt({
        taskId: taskIdFromHandlerContext(context),
        provider: context?.provider,
        userMessage: payload.userMessage ?? null,
        planId: payload.planId,
        stageId: payload.stageId,
        validation: payload.validation,
      });
    },

    buildStartingMessage(): string | null {
      return 'Refining this stage…';
    },
  };
