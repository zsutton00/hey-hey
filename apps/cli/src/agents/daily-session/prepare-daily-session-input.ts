import type { AgenticSession } from '../../session/types';
import { extractUserIdFromToken } from '../../auth/index';
import type { DeltaResult } from './delta-calculator';
import { computeActivityDelta } from './activity-delta';
import { fetchActiveGoals } from './fetch-active-goals';
import { fetchRecentActivity } from './fetch-activity';
import { fetchUserFocusMessage } from './fetch-user-focus';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../shared/logging/daily-session';
import type { DailySessionEnrichedPayload, DailySessionPromptInput } from './types';
import type { LocalDailySessionPromptPayload } from '../../shared/agent-bridge-contract/generated/api';
import type { PrepareResult, PromptTypeHandlerDeps } from '../prompt-type-handler';

interface DailySessionInputEnrichmentContext {
  organizationId: string;
  projectId: string;
  accessToken: string;
}

export interface DailySessionInputPreparationOptions {
  enrichPromptInput?: (
    input: DailySessionPromptInput,
    context: DailySessionInputEnrichmentContext,
  ) => Promise<DailySessionPromptInput>;
}

/**
 * Builds the canonical evidence set shared by every Daily Session
 * personality. Keeping this preparation in one place prevents the report and
 * coach paths from drifting on snapshot, focus, goal, or trigger semantics.
 */
export const prepareDailySessionInput = async (
  run: AgenticSession,
  payload: LocalDailySessionPromptPayload,
  deps: PromptTypeHandlerDeps,
  options: DailySessionInputPreparationOptions = {},
): Promise<PrepareResult<LocalDailySessionPromptPayload>> => {
  deps.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
    stage: 'handler_prepare_started',
    runId: run.agentic_session_id,
  });

  const { organizationId, projectId } = run.contextMetadata;
  if (!organizationId || !projectId) {
    deps.logger.warn(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'handler_prepare_missing_context',
      runId: run.agentic_session_id,
      hasOrganizationId: !!organizationId,
      hasProjectId: !!projectId,
    });
    return { payload };
  }

  let accessToken: string;
  try {
    accessToken = await deps.auth.getAccessToken();
  } catch {
    deps.logger.warn(DAILY_SESSION_MONITOR_LOG_EVENT, {
      stage: 'handler_prepare_auth_failed',
      runId: run.agentic_session_id,
    });
    return { payload };
  }

  const currentActivities = await fetchRecentActivity({
    organizationId,
    projectId,
    fetchImpl: deps.fetchImpl,
    accessToken,
    apiBaseUrl: deps.apiBaseUrl,
    logger: deps.logger,
  });

  const raw = run.sessionContext?.['lastUserActivities'];
  const previousActivities = Array.isArray(raw) ? (raw as typeof currentActivities) : undefined;
  const computedDelta = computeActivityDelta(currentActivities, previousActivities);

  deps.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
    stage: 'handler_delta_computed',
    runId: run.agentic_session_id,
    currentActivityCount: currentActivities.length,
    previousActivityCount: previousActivities?.length ?? 0,
    statusChanges: computedDelta.statusChanges.length,
    itemCompletions: computedDelta.itemCompletions.length,
    newSignals: computedDelta.newSignals.length,
  });

  const triggerDelta = run.sessionContext?.['triggerDelta'] as DeltaResult | undefined;

  const conversationId = run.conversationId;
  let userFocus: string | null = null;
  if (conversationId) {
    userFocus = await fetchUserFocusMessage({
      organizationId,
      projectId,
      conversationId,
      fetchImpl: deps.fetchImpl,
      accessToken,
      apiBaseUrl: deps.apiBaseUrl,
      logger: deps.logger,
    });
  }

  const userId = extractUserIdFromToken(accessToken);
  const activeGoals = userId
    ? await fetchActiveGoals({
        organizationId,
        projectId,
        userId,
        fetchImpl: deps.fetchImpl,
        accessToken,
        apiBaseUrl: deps.apiBaseUrl,
        logger: deps.logger,
      })
    : undefined;

  const promptInput = {
    activitySnapshot: currentActivities,
    computedDelta,
    ...(payload.userMessage ? { userMessage: payload.userMessage } : {}),
    ...(triggerDelta ? { triggerDelta } : {}),
    ...(userFocus ? { userFocus } : {}),
    ...(activeGoals ? { activeGoals } : {}),
  } satisfies DailySessionPromptInput;

  const enrichedPromptInput = options.enrichPromptInput
    ? await options.enrichPromptInput(promptInput, { organizationId, projectId, accessToken })
    : promptInput;

  deps.logger.info(DAILY_SESSION_MONITOR_LOG_EVENT, {
    stage: 'handler_prompt_input_ready',
    runId: run.agentic_session_id,
    activityCount: enrichedPromptInput.activitySnapshot.length,
    hasTriggerDelta: !!enrichedPromptInput.triggerDelta,
    hasUserFocus: !!enrichedPromptInput.userFocus,
    hasActiveGoals: !!enrichedPromptInput.activeGoals,
  });

  const enriched: DailySessionEnrichedPayload = {
    ...payload,
    _enriched: enrichedPromptInput,
    _logger: deps.logger,
  };

  return {
    payload: enriched,
    sessionContext: {
      lastUserActivities: currentActivities,
      lastFetchedAt: new Date().toISOString(),
    },
  };
};
