/**
 * Shared `prepare` logic for the plan-shaping handlers (refine-stage,
 * finalize).
 *
 * Each handler runs the same three steps before the provider turn starts:
 *
 *   1. Pull the active task id from the persisted Run entity.
 *   2. Classify the turn (no user message = initial, message = follow_up)
 *      for log observability.
 *   3. Return the payload unchanged; `buildPrompt` reads canonical identity
 *      from the per-turn handler context.
 *
 * Centralizing this keeps the handler files tiny and guarantees the log
 * event / payload enrichment pattern stays identical across them.
 */

import type { AgenticSession } from '../../session/types';
import type { PromptTypeHandlerDeps, PrepareResult } from '../prompt-type-handler';
import { taskIdFromSession } from '../run-entity';

interface PlanShapingPayloadInput {
  userMessage?: string;
}

export const preparePlanShapingPayload = async <TPayload extends PlanShapingPayloadInput>(
  run: AgenticSession,
  payload: TPayload,
  deps: PromptTypeHandlerDeps,
  logEvent: string,
  extraLogFields?: Record<string, unknown>,
): Promise<PrepareResult<TPayload>> => {
  const taskId = taskIdFromSession(run);
  const userMessage = payload.userMessage?.trim() ?? '';
  const turnKind = userMessage.length > 0 ? 'follow_up' : 'initial';
  deps.logger.info(logEvent, {
    runId: run.agentic_session_id,
    agenticSessionId: run.agentic_session_id,
    conversationId: run.conversationId,
    providerSessionId: run.provider_session_id ?? null,
    taskId: taskId ?? null,
    turnKind,
    userMessageLength: userMessage.length,
    ...(extraLogFields ?? {}),
  });
  return { payload };
};
