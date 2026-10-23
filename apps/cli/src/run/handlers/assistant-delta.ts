/**
 * Handler: assistant_delta
 *
 * Intermediate assistant output. There are two shapes:
 *
 *   1. Structured output — the delta parses as a known response type (e.g.
 *      `startup_plan_v1`) via response-dispatch, or the prompt handler's
 *      `transformOutput` reshapes it (e.g. a refiner proposal carrier). These
 *      are not narration; each is appended as its own message row (via
 *      `createOutOfBand`, the server resolving the parent) exactly as before,
 *      so the UI renders it with its uiElements.
 *
 *   2. Generic narration — the short text the agent emits between tool calls.
 *      All of a Turn's narration coalesces into a SINGLE interstitial message:
 *      the first segment authors the row, later segments update it in place
 *      with the concatenated body. The row is marked `ragEnabled: false` and
 *      carries the `interstitial` UI field type so the conversation viewer
 *      renders it through the UI Field registry. The Run owns the per-Turn
 *      slot; it is sealed (cleared) at Turn end, so the next Turn opens a fresh
 *      row. This is the path that drove conversation-row growth — one row per
 *      emission — which coalescing eliminates.
 *
 * Handler resolution reads `eventTurn.handler` — a reference captured by the
 * dispatcher at event-arrival time — not `ctx.promptType`, which a later
 * Turn's `begin()` may have overwritten before this handler's async write
 * resolves. The Turn id off the same snapshot keys the narration slot.
 */

import {
  MessageType,
  MessageStatus,
  SystemMessageDataTypeEnum,
  ExtendedUIFieldType,
} from '../../shared/api/index';
import type { AgentSystemMessageData, SystemMessageData, UIElement } from '../../shared/api/index';
import { dispatchResponseType } from '../../agents/response-dispatch';
import { buildTurnMessageStamp } from './assistant-utils';
import type { AssistantDeltaEvent, HandlerDeps, MessageStamp } from '../types';
import type { Run } from '../run';
import type { Turn } from '../../turn/turn';

/**
 * The marker element that flags a coalesced narration row as interstitial. Its
 * visual treatment is owned by the UI Field registry entry keyed on this type;
 * `id`/`label` are required by the contract but unused by that render path.
 */
const INTERSTITIAL_UI_ELEMENT: UIElement = {
  id: 'interstitial',
  type: ExtendedUIFieldType.Interstitial,
  label: '',
};

export const handleAssistantDelta = async (
  event: AssistantDeltaEvent,
  ctx: Run,
  deps: HandlerDeps,
  eventTurn: Turn | null,
): Promise<void> => {
  const handler = eventTurn?.handler ?? null;
  const promptHandler = handler?.promptType ?? null;
  const stamp: MessageStamp | null = eventTurn ? buildTurnMessageStamp(ctx, eventTurn) : null;

  // Some providers surface the final structured envelope once as an output
  // delta and again as assistant_complete. The handler-owned completion path
  // validates and maps the latter; persisting the former as narration leaks
  // raw JSON into the conversation and duplicates the terminal response.
  if (handler?.isCompletionOutput?.(event)) {
    deps.logger.debug('local.handler.assistant_delta.terminal_output_deferred', {
      runId: ctx.runId,
      promptType: promptHandler,
      summaryLength: event.summary.length,
    });
    return;
  }

  const dispatchResult = dispatchResponseType(
    event.summary,
    {
      taskId: ctx.taskId,
      promptType: promptHandler,
      expectedResponseTypes: handler?.expectedResponseTypes ?? [],
      emitLegacyStartupPlanUiElement: handler?.emitLegacyStartupPlanUiElement ?? false,
    },
    deps.logger,
  );

  // Structured output stays a standalone appended row. A dispatch match wins;
  // an incompatible known response type stays raw so a different handler's
  // transformer cannot claim it. For ordinary output, the handler's
  // `transformOutput` gets a chance to reshape the delta (refiner proposal
  // carriers parse here and return non-null). Only when both decline is this
  // generic narration coalesced.
  const structured = dispatchResult.matched
    ? dispatchResult.updateData
    : dispatchResult.incompatibleResponseType
      ? null
      : (handler?.transformOutput?.(event) ?? null);

  // No active Turn means no slot to coalesce into — append a one-off row,
  // preserving the pre-coalescing behavior for the (defensive) no-Turn case.
  if (structured || eventTurn === null) {
    // `UpdateMessageDto.data` is typed loosely as `object`; the dispatch/
    // transform paths always build a real SystemMessageData, so narrow it here.
    const data: SystemMessageData =
      (structured?.data as SystemMessageData | undefined) ??
      ({
        type: SystemMessageDataTypeEnum.Agent,
        response: event.summary,
        detectedIntent: 'agent_response',
        intentConfidence: 1,
      } satisfies AgentSystemMessageData);
    try {
      await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: {
          type: MessageType.System,
          status: structured?.status ?? MessageStatus.Completed,
          projectId: ctx.projectId,
          data,
        },
        stamp,
      });
      if (dispatchResult.matched) {
        deps.logger.info('local.handler.assistant_delta.dispatched', {
          runId: ctx.runId,
          responseType: dispatchResult.responseType,
        });
      }
    } catch (error) {
      deps.logger.error('local.handler.assistant_delta.append_failed', {
        runId: ctx.runId,
        error,
      });
    }
    return;
  }

  // Generic narration → coalesce into the Turn's single interstitial row.
  const segment = `${event.summary} -- ${new Date().toISOString()}`;
  const { body, isFirst, messageId } = ctx.claimNarration(eventTurn.turnId, segment);
  const data: AgentSystemMessageData = {
    type: SystemMessageDataTypeEnum.Agent,
    response: body,
    detectedIntent: 'agent_response',
    intentConfidence: 1,
    // Exclude narration from RAG and from prompt-construction windows, and mark
    // it interstitial. The marking is re-sent on every update so the row stays
    // flagged regardless of how the update endpoint merges `data`.
    ragEnabled: false,
    uiElements: [INTERSTITIAL_UI_ELEMENT],
  };

  try {
    if (isFirst) {
      const createdId = await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: {
          type: MessageType.System,
          status: MessageStatus.Completed,
          projectId: ctx.projectId,
          data,
        },
        stamp,
      });
      ctx.resolveNarrationMessageId(eventTurn.turnId, createdId);
    } else {
      const createdId = await messageId;
      await deps.poster.update(ctx.organizationId, ctx.projectId, createdId, { data }, stamp);
    }
  } catch (error) {
    if (isFirst) ctx.rejectNarrationMessageId(eventTurn.turnId, error);
    deps.logger.error('local.handler.assistant_delta.append_failed', {
      runId: ctx.runId,
      error,
    });
  }
};
