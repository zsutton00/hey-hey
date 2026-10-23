/**
 * `plan_shaping_finalize` prompt-type handler.
 *
 * Terminal step of the plan-shaping flow: confirms the plan is complete,
 * summarizes what landed, and terminates via the DONE submission tool.
 * The server-side flow self-loops on DONE so `currentNodeId` stays
 * non-null after the plan has landed — same invariant the feature-sync
 * terminal node relies on.
 */

import {
  LocalPromptType,
  type PlanShapingFinalizePromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import { ReportAudience, ReportType } from '../../shared/api/index';
import { turnUserMessageBlock, type UserLaunchablePromptTypeHandler } from '../prompt-type-handler';
import { buildFinalizePrompt } from './prompts';
import { preparePlanShapingPayload } from './prepare-payload';
import { finalizeSubmissionTools } from './submission-tools';
import { taskIdFromHandlerContext } from '../run-entity';

export const planShapingFinalizeHandler: UserLaunchablePromptTypeHandler<PlanShapingFinalizePromptPayload> =
  {
    id: 'plan_shaping_finalize',
    promptType: LocalPromptType.PlanShapingFinalize,
    service: 'optional',
    launchEntity: 'required',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [
      { reportType: ReportType.Plan, audience: ReportAudience.ProjectVisible, required: true },
    ],

    submissionTools: [...finalizeSubmissionTools],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    // Read-only `plan_shaping` base. `create_report` is reached via the
    // run-scoped submission tool wrapper, not the platform MCP tool.
    mcpToolUseCase: 'plan_shaping',

    prepare: (run, payload, deps) =>
      preparePlanShapingPayload(run, payload, deps, 'plan_shaping_finalize.prepare.turn_starting'),

    buildPrompt(payload: PlanShapingFinalizePromptPayload, context): string {
      return buildFinalizePrompt({
        taskId: taskIdFromHandlerContext(context),
        userMessage: payload.userMessage ?? null,
      });
    },

    buildStartingMessage(): string | null {
      return 'Wrapping up the plan...';
    },
  };
