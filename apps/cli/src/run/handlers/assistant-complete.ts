/**
 * Handler: assistant_complete
 *
 * Final assistant output (taskComplete) — appends the completion as a fresh
 * write at the conversation tail (via `createOutOfBand`), in natural arrival
 * order like every other write. It no longer completes the turn-open anchor
 * in place.
 *
 * First tries the central response-type dispatcher; if the summary matches a
 * known `responseType`, it posts the structured message and fires the
 * registered side effects. Otherwise falls through to the prompt-type
 * handler's `transformOutput`.
 *
 * Handler resolution reads `eventTurn.handler` — a reference captured by the
 * dispatcher at event-arrival time — not `ctx.promptType`. The Run's
 * `promptType` can be overwritten by a subsequent Turn's `begin()` before this
 * handler's async chain resolves; the captured Turn reference stays valid for
 * the whole chain.
 */

import {
  MessageStatus,
  MessageType,
  SystemMessageDataActionHintEnum,
  SystemMessageDataTypeEnum,
} from '../../shared/api/index';
import type { AgentSystemMessageData, UpdateMessageDto } from '../../shared/api/index';
import type { OnCompleteDeps } from '../../agents/prompt-type-handler';
import {
  dispatchResponseType,
  resolveResponseDispatchContext,
  type DispatchContext,
} from '../../agents/response-dispatch';
import { warnOnExternalAgentNodeIdMismatch } from '../../agents/submission-tools/action-poster';
import type { Turn } from '../../turn/turn';
import type {
  AssistantCompleteEvent,
  CreateMessageBody,
  HandlerDeps,
  MessageStamp,
} from '../types';
import type { Run } from '../run';
import { withFeatureVerificationSuggestion } from '../../agents/completion-reconciliation/message-mapper';
import { buildCompletionData, buildTurnMessageStamp } from './assistant-utils';
import { addDataToMessage as addFeatureSyncAffordances } from './feature-sync-affordances';

/**
 * Convert the turn's update-shaped completion data into a create DTO for a
 * fresh tail append. Mirrors the conversion in `handleAssistantDelta`: the
 * completion is no longer an in-place update of the turn-open anchor but a
 * plain `createOutOfBand` write that arrives last in the conversation tail.
 */
const buildCompletionTailDto = (
  updateData: UpdateMessageDto,
  projectId: string,
  fallbackResponse: string,
  artifactIds: { proposalIds: string[]; reportIds: string[] },
): CreateMessageBody => {
  const data =
    updateData.data ??
    ({
      type: SystemMessageDataTypeEnum.Agent,
      response: fallbackResponse,
      detectedIntent: 'agent_response',
      intentConfidence: 1,
    } satisfies AgentSystemMessageData);

  return {
    type: MessageType.System,
    status: updateData.status ?? MessageStatus.Completed,
    projectId,
    proposalIds: artifactIds.proposalIds,
    reportIds: artifactIds.reportIds,
    // Stamp the turn-completion marker. A streaming delta and the turn's
    // final completion are otherwise the same shape (both append-to-tail
    // SYSTEM messages with `type: AGENT`/a structured responseType and
    // `status: Completed`), so `actionHint: task_complete` is the only thing
    // that distinguishes the completion — it is what `detectsAgentCompletion`
    // keys on, and what the conversation view groups a turn's carrier-borne
    // proposals beneath. Without it only `startup_plan_v1` completions (which
    // set the hint in their registry entry) would be identifiable; every
    // generic/structured completion would read as narrative and its turn's
    // proposals would never surface. Preserve an explicit hint if a registry
    // entry already set one.
    data: {
      type: SystemMessageDataTypeEnum.Agent,
      ...data,
      // `UpdateMessageDto.data` is typed `object` by the generated client, so
      // read the optional hint through a narrowed view rather than off `object`.
      actionHint:
        (data as { actionHint?: SystemMessageDataActionHintEnum }).actionHint ??
        SystemMessageDataActionHintEnum.TaskComplete,
    },
  };
};

export const handleAssistantComplete = async (
  event: AssistantCompleteEvent,
  ctx: Run,
  deps: HandlerDeps,
  eventTurn: Turn | null,
  activeDispatchId?: symbol,
): Promise<void> => {
  const turnPromptType = eventTurn?.handler?.promptType ?? null;
  const stamp: MessageStamp | null = eventTurn ? buildTurnMessageStamp(ctx, eventTurn) : null;

  if (!eventTurn) {
    deps.logger.info('local.handler.assistant_complete.no_active_turn', {
      runId: ctx.runId,
      promptType: turnPromptType,
      summaryLength: event.summary.length,
    });
    return;
  }

  if (eventTurn.changedFileReporting.isRepairing) return;
  const handler = eventTurn.handler ?? null;
  if (handler?.requiresChangedFileReporting && eventTurn.completedAssistantMessageId !== null)
    return;
  const onCompleteDeps: OnCompleteDeps | null = deps.onCompleteDeps
    ? {
        fetchImpl: deps.onCompleteDeps.fetchImpl,
        auth: deps.onCompleteDeps.auth,
        apiBaseUrl: deps.onCompleteDeps.apiBaseUrl,
        machineEffectProofSigner: deps.onCompleteDeps.machineEffectProofSigner,
        logger: deps.logger,
        taskMonitorDecisionStore: deps.onCompleteDeps.taskMonitorDecisionStore,
        sessionMonitorEvaluationStore: deps.onCompleteDeps.sessionMonitorEvaluationStore,
        poster: deps.onCompleteDeps.poster,
        runStore: deps.onCompleteDeps.runStore,
        reportIndex: deps.onCompleteDeps.reportIndex,
        platformWebSocketManager: deps.onCompleteDeps.platformWebSocketManager,
      }
    : null;

  // Some handler-owned workflow contracts are not responseType envelopes. The
  // handler still owns their typed action mapping; the Run owns trigger
  // identity and completion-last ordering just as it does for dispatcher
  // completions.
  const handlerCompletionAction = handler?.getCompletionAction?.(event, eventTurn.payload) ?? null;
  const recordHandlerCompletion = (): void => {
    if (!handlerCompletionAction) return;
    const triggerCtx = ctx.triggerContext;
    if (!triggerCtx) {
      deps.logger.warn('local.handler.assistant_complete.handler_completion_skipped_no_trigger', {
        runId: ctx.runId,
        promptType: turnPromptType,
        action: handlerCompletionAction.action.action,
      });
      return;
    }
    warnOnExternalAgentNodeIdMismatch(deps.logger, {
      site: 'assistant-complete.handler_completion',
      runId: ctx.runId,
      declaredNodeId: triggerCtx.externalAgentNodeId,
      runStampedNodeId: triggerCtx.externalAgentNodeId,
      triggerMessageId: triggerCtx.triggerMessageId,
      action: handlerCompletionAction.action.action,
    });
    ctx.recordPendingCompletion({
      action: handlerCompletionAction.action,
      externalAgentNodeId: triggerCtx.externalAgentNodeId,
      triggerMessageId: triggerCtx.triggerMessageId,
      userFacingResponse: handlerCompletionAction.userFacingResponse ?? '',
      ...(handlerCompletionAction.hidden === true ? { hidden: true } : {}),
      stamp,
    });
    deps.logger.info('local.handler.assistant_complete.handler_completion_recorded', {
      runId: ctx.runId,
      promptType: turnPromptType,
      action: handlerCompletionAction.action.action,
    });
  };

  const completionValidation = handler?.validateCompletion?.(event, eventTurn.payload);
  if (completionValidation && !completionValidation.ok) {
    deps.logger.warn('local.handler.assistant_complete.pre_completion_validation_failed', {
      runId: ctx.runId,
      promptType: turnPromptType,
      code: completionValidation.error.code,
      message: completionValidation.error.message,
      issues: completionValidation.error.issues,
    });
    // While correction remains available the trigger stays open: no handler
    // action, no failure message. The Run asks the agent to correct the answer
    // at Turn end and re-dispatches the last rejection only on exhaustion.
    if (!eventTurn.completionCorrection.isExhausted) {
      eventTurn.completionCorrection.reject(event, completionValidation.error);
      return;
    }
    recordHandlerCompletion();
    if (!handler.onInvalidCompletion || !onCompleteDeps) {
      deps.logger.error('local.handler.assistant_complete.invalid_completion_unhandled', {
        runId: ctx.runId,
        promptType: turnPromptType,
        hasInvalidCompletionHandler: !!handler.onInvalidCompletion,
        hasOnCompleteDeps: !!onCompleteDeps,
      });
      return;
    }
    try {
      await handler.onInvalidCompletion(
        event,
        {
          runId: ctx.runId,
          organizationId: ctx.organizationId,
          projectId: ctx.projectId,
          conversationId: ctx.conversationId,
          stamp,
          payload: eventTurn.payload,
        },
        onCompleteDeps,
        completionValidation.error,
      );
    } catch (error) {
      deps.logger.error('local.handler.assistant_complete.invalid_completion_handler_failed', {
        runId: ctx.runId,
        promptType: turnPromptType,
        error,
      });
    }
    return;
  }

  if (completionValidation) eventTurn.completionCorrection.accept();

  if (
    handler?.requiresChangedFileReporting &&
    !handler.skipChangedFileReporting?.(event) &&
    !eventTurn.changedFileReporting.isReleasing
  ) {
    if (!eventTurn.changedFileReporting.isRepairing) {
      // Retain even an omitted report until in-flight submissions and edits settle.
      // The coordinator then releases omissions without validation or repair.
      eventTurn.changedFileReporting.retain(event);
      await ctx.persistChangedFileReporting(eventTurn);
    }
    return;
  }

  const dispatchContext: DispatchContext = {
    taskId: ctx.taskId,
    promptType: turnPromptType,
    expectedResponseTypes: handler?.expectedResponseTypes ?? [],
    emitLegacyStartupPlanUiElement: handler?.emitLegacyStartupPlanUiElement ?? false,
  };
  let resolvedDispatchContext: DispatchContext;
  try {
    resolvedDispatchContext = await resolveResponseDispatchContext(
      event.summary,
      dispatchContext,
      () => ctx.readCurrentWorkflowNodeId(),
    );
  } catch (error) {
    eventTurn.recordCompletionPublicationFailure();
    deps.logger.error('local.handler.assistant_complete.readiness_node_lookup_failed', {
      runId: ctx.runId,
      promptType: turnPromptType,
      error,
    });
    return;
  }

  recordHandlerCompletion();

  const dispatchResult = dispatchResponseType(event.summary, resolvedDispatchContext, deps.logger);

  // The completion is a fresh tail append; its id is unknown until the post
  // returns. Captured here so the post-completion `onComplete` hook can edit
  // the very message it just wrote.
  let completionMessageId: string | null = null;
  let completedSuccessfully = false;
  await ctx.prepareTurnCompletionArtifacts(eventTurn, activeDispatchId);
  const completionArtifactIds = eventTurn.snapshotCompletionArtifactIds(
    ctx.readReportIdsForTurn(eventTurn.turnId),
  );
  deps.logger.info('local.handler.assistant_complete.attachments_resolved', {
    runId: ctx.runId,
    turnId: eventTurn.turnId,
    promptType: turnPromptType,
    proposalIds: completionArtifactIds.proposalIds,
    reportIds: completionArtifactIds.reportIds,
    proposalCount: completionArtifactIds.proposalIds.length,
    reportCount: completionArtifactIds.reportIds.length,
  });

  const unsavedOutputFailure =
    dispatchResult.matched || dispatchResult.incompatibleResponseType
      ? null
      : (handler?.getUnsavedOutputFailure?.(event, eventTurn.payload, {
          codingPlanElementTypes: ctx.readCodingPlanElementTypes(eventTurn.turnId),
        }) ?? null);

  if (dispatchResult.matched) {
    deps.logger.info('local.handler.assistant_complete.dispatched', {
      runId: ctx.runId,
      responseType: dispatchResult.responseType,
      sideEffectCount: dispatchResult.sideEffects.length,
    });

    const dispatchedData = addFeatureSyncAffordances(dispatchResult.updateData, {
      promptType: turnPromptType,
      lastSubmissionAction: ctx.lastSubmissionAction,
    });

    // Record the EXTERNAL_AGENT routing completion to flush at turn-end rather
    // than posting it here. The server's workflow engine reads
    // `completesExternalAgentNode` off the conversation to advance the node;
    // deferring the post to the Run's terminal write keeps the structured body
    // (and any trailing narrative) ahead of the advancing completion.
    // Envelope-first ordering is not load-bearing, so completion-last is safe.
    if (dispatchResult.pendingCompletion) {
      const triggerCtx = ctx.triggerContext;
      if (triggerCtx) {
        // ctx === Run, so declaredNodeId and runStampedNodeId resolve to the
        // same field; the comparison is structurally vacuous here but kept
        // for site parity with the other completion-posting paths so the
        // warning event is a single greppable signal across all of them.
        warnOnExternalAgentNodeIdMismatch(deps.logger, {
          site: 'assistant-complete.pending_completion',
          runId: ctx.runId,
          declaredNodeId: triggerCtx.externalAgentNodeId,
          runStampedNodeId: triggerCtx.externalAgentNodeId,
          triggerMessageId: triggerCtx.triggerMessageId,
          action: dispatchResult.pendingCompletion.action,
        });
        ctx.recordPendingCompletion({
          action: {
            action: dispatchResult.pendingCompletion.action,
            ...(dispatchResult.pendingCompletion.payload !== undefined
              ? { payload: dispatchResult.pendingCompletion.payload }
              : {}),
          },
          externalAgentNodeId: triggerCtx.externalAgentNodeId,
          triggerMessageId: triggerCtx.triggerMessageId,
          userFacingResponse: '',
          stamp,
        });
        deps.logger.info('local.handler.assistant_complete.pending_completion_recorded', {
          runId: ctx.runId,
          responseType: dispatchResult.responseType,
          action: dispatchResult.pendingCompletion.action,
        });
      } else {
        deps.logger.warn('local.handler.assistant_complete.pending_completion_skipped_no_trigger', {
          runId: ctx.runId,
          responseType: dispatchResult.responseType,
          action: dispatchResult.pendingCompletion.action,
        });
      }
    }

    try {
      completionMessageId = await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: buildCompletionTailDto(
          dispatchedData,
          ctx.projectId,
          event.summary,
          completionArtifactIds,
        ),
        stamp,
      });
      completedSuccessfully = true;
    } catch (error) {
      eventTurn.recordCompletionPublicationFailure();
      deps.logger.error('local.handler.assistant_complete.dispatched_complete_failed', {
        runId: ctx.runId,
        responseType: dispatchResult.responseType,
        error,
      });
    }

    for (const effect of dispatchResult.sideEffects) {
      if (!deps.reportSyncService) {
        deps.logger.warn('local.handler.assistant_complete.side_effect_executor_missing', {
          runId: ctx.runId,
          effectType: effect.type,
        });
        continue;
      }
      void deps.reportSyncService
        .executeSideEffect({ runId: ctx.runId, effect })
        .then(() => {
          deps.logger.debug('local.handler.assistant_complete.side_effect_executed', {
            runId: ctx.runId,
            effectType: effect.type,
          });
        })
        .catch((error: unknown) => {
          deps.logger.error('local.handler.assistant_complete.side_effect_failed', {
            runId: ctx.runId,
            effectType: effect.type,
            error,
          });
        });
    }
  } else if (unsavedOutputFailure !== null) {
    deps.logger.error('local.handler.assistant_complete.required_output_unsaved', {
      runId: ctx.runId,
      turnId: eventTurn.turnId,
      promptType: turnPromptType,
      summaryLength: event.summary.length,
      summaryPreview: event.summary.slice(0, 300),
    });
    try {
      await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: {
          type: MessageType.System,
          status: MessageStatus.Failed,
          projectId: ctx.projectId,
          data: {
            type: SystemMessageDataTypeEnum.Agent,
            response: unsavedOutputFailure,
            detectedIntent: 'required_output_unsaved',
            intentConfidence: 1,
          } satisfies AgentSystemMessageData,
        },
        stamp,
      });
    } catch (error) {
      deps.logger.error('local.handler.assistant_complete.unsaved_output_failure_post_failed', {
        runId: ctx.runId,
        error,
      });
    }
    // Fails the Turn so Run state reports the failure, not a completed reply.
    eventTurn.recordCompletionPublicationFailure();
  } else {
    const baseData = dispatchResult.incompatibleResponseType
      ? {
          data: {
            type: SystemMessageDataTypeEnum.Agent,
            response: event.summary,
            detectedIntent: 'agent_response',
            intentConfidence: 1,
          } satisfies AgentSystemMessageData,
        }
      : buildCompletionData(event, handler, eventTurn.payload);
    const data = withFeatureVerificationSuggestion(
      addFeatureSyncAffordances(baseData, {
        promptType: turnPromptType,
        lastSubmissionAction: ctx.lastSubmissionAction,
      }),
      eventTurn.featureVerificationSuggestion,
    );

    deps.logger.info('local.handler.assistant_complete.no_response_type_match', {
      runId: ctx.runId,
      promptType: turnPromptType,
      summaryLength: event.summary.length,
      summaryPreview: event.summary.slice(0, 300),
    });

    try {
      completionMessageId = await deps.poster.createOutOfBand({
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        dto: buildCompletionTailDto(data, ctx.projectId, event.summary, completionArtifactIds),
        stamp,
      });
      completedSuccessfully = true;
    } catch (error) {
      eventTurn.recordCompletionPublicationFailure();
      deps.logger.error('local.handler.assistant_complete.complete_failed', {
        runId: ctx.runId,
        error,
      });
    }
  }

  if (completedSuccessfully && completionMessageId !== null && handler) {
    eventTurn.recordCompletedAssistantMessage(completionMessageId);
    ctx.observeFinalAssistantMessageCommitted(eventTurn.turnId, completionMessageId);
    // Record the last text block the provider stream emitted — what the user
    // saw — rather than `event.summary` (the raw structured-response text) or a
    // re-rendered markdown summary. Falls back to `event.summary` only if no
    // assistant text was captured this turn (a completed turn always has one).
    ctx.recordPreviousProviderSession({
      promptType: handler.promptType,
      lastMessage: ctx.lastProviderStreamMessage ?? event.summary,
      completedAt: new Date().toISOString(),
    });
  }

  if (
    !completedSuccessfully ||
    completionMessageId === null ||
    !handler?.onComplete ||
    !onCompleteDeps
  ) {
    deps.logger.warn('local.handler.assistant_complete.on_complete_skipped', {
      runId: ctx.runId,
      promptType: turnPromptType,
      completedSuccessfully,
      hasHandler: !!handler,
      hasHandlerOnComplete: !!handler?.onComplete,
      hasOnCompleteDeps: !!deps.onCompleteDeps,
    });
    return;
  }

  deps.logger.debug('local.handler.assistant_complete.on_complete_starting', {
    runId: ctx.runId,
    promptType: turnPromptType,
    messageId: completionMessageId,
  });

  try {
    await handler.onComplete(
      event,
      {
        runId: ctx.runId,
        run: ctx,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        messageId: completionMessageId,
        stamp,
        payload: eventTurn.payload,
      },
      onCompleteDeps,
    );
    deps.logger.debug('local.handler.assistant_complete.on_complete_succeeded', {
      runId: ctx.runId,
      promptType: turnPromptType,
      messageId: completionMessageId,
    });
  } catch (error) {
    deps.logger.error('local.handler.assistant_complete.on_complete_failed', {
      runId: ctx.runId,
      promptType: turnPromptType,
      error,
    });
  }
};
