import {
  LocalPromptType,
  type PlanShapingVisualPreviewPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import {
  turnUserMessageBlock,
  type PromptTypeHandlerDeps,
  type PrepareResult,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { visualPreviewSubmissionTools } from './visual-preview.submission-tools';
import { buildVisualPreviewPrompt } from './visual-preview.prompt';

export const VISUAL_PREVIEW_ALLOWED_TOOLS: readonly string[] = [
  'get_authoring_guidance',
  'create_work_item',
  'edit_work_item',
  'get_proposal',
  'update_proposal',
  'get_future_revision',
];

export const planShapingVisualPreviewHandler: UserLaunchablePromptTypeHandler<PlanShapingVisualPreviewPromptPayload> =
  {
    id: 'plan_shaping_visual_preview',
    promptType: LocalPromptType.PlanShapingVisualPreview,
    service: 'optional',
    launchEntity: 'none',
    implementationReadiness: 'none',
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    providerSessionStart: 'fresh',
    reports: [],
    submissionTools: [...visualPreviewSubmissionTools],
    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage ?? payload.feedback),
    mcpToolUseCase: 'plan_shaping',
    additionalAllowedTools: VISUAL_PREVIEW_ALLOWED_TOOLS,
    prepare: async (
      run,
      payload,
      deps: PromptTypeHandlerDeps,
    ): Promise<PrepareResult<PlanShapingVisualPreviewPromptPayload>> => {
      deps.logger.info('plan_shaping_visual_preview.prepare.turn_starting', {
        runId: run.agentic_session_id,
        agenticSessionId: run.agentic_session_id,
        conversationId: run.conversationId,
        refinementRound: payload.refinementRound,
        entryCount: payload.entries.length,
        feedbackLength: payload.feedback?.length ?? 0,
      });
      return { payload };
    },
    buildPrompt(payload, ctx): string {
      return buildVisualPreviewPrompt(payload, ctx?.provider);
    },
    buildStartingMessage(): string | null {
      return 'Preparing the visual plan preview…';
    },
  };
