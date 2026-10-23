import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import type { LocalDailySessionPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type {
  PrepareResult,
  PromptTypeHandlerDeps,
  UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import { buildDailySessionCoachPrompt } from './daily-session-coach-prompt';
import { fetchRecentAttention } from './fetch-attention';
import { prepareDailySessionInput } from './prepare-daily-session-input';
import type { DailySessionCoachPromptInput, DailySessionEnrichedPayload } from './types';

type CoachEnrichedPayload = DailySessionEnrichedPayload<DailySessionCoachPromptInput>;

const emptyCoachInput = (): DailySessionCoachPromptInput => ({
  activitySnapshot: [],
  computedDelta: {
    statusChanges: [],
    itemCompletions: [],
    newSignals: [],
    computedAt: new Date().toISOString(),
  },
  attentionEvidence: [],
});

export const dailySessionCoachHandler: UserLaunchablePromptTypeHandler<LocalDailySessionPromptPayload> =
  {
    id: 'daily_session_coach',
    promptType: LocalPromptType.DailySession,
    service: 'optional',
    launchEntity: 'none',
    implementationReadiness: 'none',
    graphResearchGuidance: true,
    epistemicCalibration: true,
    expectedResponseTypes: [],
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    providerSessionLifetime: 'turn',
    rebuildPromptOnUserMessage: true,
    reports: [],

    addUserMessage(payload: LocalDailySessionPromptPayload): string | null {
      const text = payload.userMessage?.trim();
      return text ? `\n\n## User Message\n\n${text}` : null;
    },

    async prepare(
      run,
      payload,
      deps: PromptTypeHandlerDeps,
    ): Promise<PrepareResult<LocalDailySessionPromptPayload>> {
      return prepareDailySessionInput(run, payload, deps, {
        enrichPromptInput: async (input, context) => {
          const attentionEvidence = await fetchRecentAttention({
            organizationId: context.organizationId,
            projectId: context.projectId,
            activitySnapshot: input.activitySnapshot,
            fetchImpl: deps.fetchImpl,
            accessToken: context.accessToken,
            apiBaseUrl: deps.apiBaseUrl,
            logger: deps.logger,
          });

          deps.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
            stage: 'coach_prompt_input_ready',
            runId: run.agentic_session_id,
            attentionCount: attentionEvidence.length,
          });

          return { ...input, attentionEvidence };
        },
      });
    },

    buildPrompt(payload: LocalDailySessionPromptPayload): string {
      const enriched = (payload as CoachEnrichedPayload)._enriched ?? emptyCoachInput();
      const logger = (payload as CoachEnrichedPayload)._logger;
      const prompt = buildDailySessionCoachPrompt(enriched);

      logger?.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
        stage: 'coach_prompt_built',
        promptLength: prompt.length,
        activityCount: enriched.activitySnapshot.length,
        attentionCount: enriched.attentionEvidence.length,
        hasUserFocus: !!enriched.userFocus,
        hasUserMessage: !!payload.userMessage,
      });

      return prompt;
    },

    buildStartingMessage(): string {
      return 'Starting your daily session...';
    },
  };
