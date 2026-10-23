import { atom } from "jotai/vanilla";
import type { WebSocketMessageRealtimeEvent } from "../../api";

export interface MessageRealtimePatch {
  messageId: string;
  requestId: string;
  lastSequence: number;
  response?: string;
  loadingText?: string;
  currentStep?: string;
  progress?: number;
  status?: string;
  toolName?: string;
  toolPhase?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ConversationRealtimeState {
  patchesByMessageId: Record<string, MessageRealtimePatch>;
  gapRefetchTriggered: boolean;
}

export interface ApplyRealtimeResult {
  nextState: Record<string, ConversationRealtimeState>;
  applied: boolean;
  duplicateOrStale: boolean;
  sequenceGapDetected: boolean;
  shouldRefetchConversation: boolean;
  unknownKind: boolean;
}

export const messageRealtimeByConversationAtom = atom<
  Record<string, ConversationRealtimeState>
>({});

function mergePatchFromEvent(
  existingPatch: MessageRealtimePatch,
  event: WebSocketMessageRealtimeEvent
): { patch: MessageRealtimePatch; unknownKind: boolean } {
  const payload = event.payload;

  switch (event.kind) {
    case "response.delta":
      return {
        patch: {
          ...existingPatch,
          response:
            (existingPatch.response ?? "") + (payload?.responseDelta ?? ""),
        },
        unknownKind: false,
      };
    case "response.replace":
      return {
        patch: {
          ...existingPatch,
          response: payload?.response ?? "",
        },
        unknownKind: false,
      };
    case "loading.update":
    case "tool.progress":
      return {
        patch: {
          ...existingPatch,
          loadingText: payload?.loadingText ?? existingPatch.loadingText,
          currentStep: payload?.currentStep ?? existingPatch.currentStep,
          progress:
            typeof payload?.progress === "number"
              ? payload.progress
              : existingPatch.progress,
          status: payload?.status ?? existingPatch.status,
          toolName: payload?.toolName ?? existingPatch.toolName,
          toolPhase: payload?.toolPhase ?? existingPatch.toolPhase,
          metadata:
            (payload?.metadata as Record<string, unknown> | undefined) ??
            existingPatch.metadata,
        },
        unknownKind: false,
      };
    case "run.status":
      return {
        patch: {
          ...existingPatch,
          status: payload?.status ?? existingPatch.status,
          metadata:
            (payload?.metadata as Record<string, unknown> | undefined) ??
            existingPatch.metadata,
        },
        unknownKind: false,
      };
    case "run.error":
      return {
        patch: {
          ...existingPatch,
          error: payload?.error ?? existingPatch.error,
          status: payload?.status ?? existingPatch.status,
          metadata:
            (payload?.metadata as Record<string, unknown> | undefined) ??
            existingPatch.metadata,
        },
        unknownKind: false,
      };
    default:
      return {
        patch: existingPatch,
        unknownKind: true,
      };
  }
}

export function applyRealtimeEvent(
  currentState: Record<string, ConversationRealtimeState>,
  event: WebSocketMessageRealtimeEvent
): ApplyRealtimeResult {
  const conversationId = event.conversationId;
  if (!conversationId) {
    return {
      nextState: currentState,
      applied: false,
      duplicateOrStale: false,
      sequenceGapDetected: false,
      shouldRefetchConversation: false,
      unknownKind: false,
    };
  }

  const conversationState = currentState[conversationId] ?? {
    patchesByMessageId: {},
    gapRefetchTriggered: false,
  };
  const previousPatch = conversationState.patchesByMessageId[event.messageId];
  const lastSequence = previousPatch?.lastSequence;

  if (typeof lastSequence === "number" && event.sequence <= lastSequence) {
    return {
      nextState: currentState,
      applied: false,
      duplicateOrStale: true,
      sequenceGapDetected: false,
      shouldRefetchConversation: false,
      unknownKind: false,
    };
  }

  const sequenceGapDetected =
    typeof lastSequence === "number" && event.sequence > lastSequence + 1;
  const shouldRefetchConversation =
    sequenceGapDetected && !conversationState.gapRefetchTriggered;

  const basePatch: MessageRealtimePatch = previousPatch ?? {
    messageId: event.messageId,
    requestId: event.requestId,
    lastSequence: event.sequence,
  };
  const { patch: mergedPatch, unknownKind } = mergePatchFromEvent(
    {
      ...basePatch,
      requestId: event.requestId,
      lastSequence: event.sequence,
    },
    event
  );

  if (unknownKind) {
    return {
      nextState: currentState,
      applied: false,
      duplicateOrStale: false,
      sequenceGapDetected,
      shouldRefetchConversation: false,
      unknownKind: true,
    };
  }

  const nextConversationState: ConversationRealtimeState = {
    patchesByMessageId: {
      ...conversationState.patchesByMessageId,
      [event.messageId]: mergedPatch,
    },
    gapRefetchTriggered:
      conversationState.gapRefetchTriggered || sequenceGapDetected,
  };

  return {
    nextState: {
      ...currentState,
      [conversationId]: nextConversationState,
    },
    applied: true,
    duplicateOrStale: false,
    sequenceGapDetected,
    shouldRefetchConversation,
    unknownKind: false,
  };
}

export function clearConversationRealtimePatches(
  currentState: Record<string, ConversationRealtimeState>,
  conversationId: string
): Record<string, ConversationRealtimeState> {
  if (!currentState[conversationId]) {
    return currentState;
  }

  const nextState = { ...currentState };
  delete nextState[conversationId];
  return nextState;
}

export function clearMessageRealtimePatches(
  currentState: Record<string, ConversationRealtimeState>,
  conversationId: string,
  messageIds: string[]
): Record<string, ConversationRealtimeState> {
  const conversationState = currentState[conversationId];
  if (!conversationState || messageIds.length === 0) {
    return currentState;
  }

  const nextPatchesByMessageId = { ...conversationState.patchesByMessageId };
  let removed = false;
  messageIds.forEach((messageId) => {
    if (nextPatchesByMessageId[messageId]) {
      delete nextPatchesByMessageId[messageId];
      removed = true;
    }
  });

  if (!removed) {
    return currentState;
  }

  if (Object.keys(nextPatchesByMessageId).length === 0) {
    return clearConversationRealtimePatches(currentState, conversationId);
  }

  return {
    ...currentState,
    [conversationId]: {
      ...conversationState,
      patchesByMessageId: nextPatchesByMessageId,
    },
  };
}
