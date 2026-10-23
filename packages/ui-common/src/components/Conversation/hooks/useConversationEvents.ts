import { useCallback, useRef } from "react";
import type { VersionConflictError } from "../../../types/conversation";
import type { FormValue } from "../../LlmForms/types";
import type { SecondaryActionSubmitOptions } from "../../LlmForms/Registry/types";

/**
 * Event types for conversation coordination
 * Replaces direct function calls to break circular dependencies
 */
export type ConversationEvent =
  | {
      type: "version-conflict";
      payload: {
        error: VersionConflictError;
        retryFn: (data: Record<string, FormValue>) => Promise<void>;
        originalFormData: Record<string, FormValue>;
        parentMessageId: string;
        options?: SecondaryActionSubmitOptions;
      };
    }
  | {
      type: "retry-requested";
      payload: {
        data: Record<string, FormValue>;
        parentId: string;
        options?: SecondaryActionSubmitOptions;
      };
    }
  | {
      type: "submission-success";
      payload: {
        messageId: string;
        data: Record<string, FormValue>;
      };
    }
  | {
      type: "submission-error";
      payload: {
        error: unknown;
        data: Record<string, FormValue>;
        parentMessageId: string;
      };
    }
  | {
      type: "optimistic-update";
      payload: {
        status: "sending" | "sent" | "conflict" | "processing" | "rollback";
        messageId?: string;
      };
    }
  | {
      type: "analysis-acknowledged";
      payload: {
        messageId: string;
      };
    }
  | {
      type: "retry-success";
      payload: {
        messageId: string;
      };
    };

type EventHandler = (event: ConversationEvent) => void;

interface ConversationEventScopeState {
  handlers: Map<string, Set<EventHandler>>;
  eventDepth: number;
  isCircularDetected: boolean;
}

const scopeStates = new Map<string, ConversationEventScopeState>();
let localScopeCounter = 0;

const createScopeState = (): ConversationEventScopeState => ({
  handlers: new Map(),
  eventDepth: 0,
  isCircularDetected: false,
});

const getScopeState = (scopeKey: string): ConversationEventScopeState => {
  const existing = scopeStates.get(scopeKey);
  if (existing) {
    return existing;
  }

  const created = createScopeState();
  scopeStates.set(scopeKey, created);
  return created;
};

const removeScopeIfUnused = (scopeKey: string): void => {
  const state = scopeStates.get(scopeKey);
  if (!state) {
    return;
  }

  if (state.handlers.size === 0) {
    scopeStates.delete(scopeKey);
  }
};

/**
 * Event-based coordination system to break circular dependencies.
 * Replaces patterns like: handleNext → handleVersionConflict → retry callback → handleNext
 *
 * Instead uses: handleNext → emit('version-conflict') → handler → emit('retry-requested') → handleNext
 *
 * @param scopeKey optional scope key to share events across hooks in the same conversation
 * @returns Event emission and subscription system
 */
export const useConversationEvents = (scopeKey?: string) => {
  const localScopeKeyRef = useRef<string | null>(null);
  if (!localScopeKeyRef.current) {
    localScopeCounter += 1;
    localScopeKeyRef.current = `local-scope-${localScopeCounter}`;
  }

  const resolvedScopeKey = scopeKey ?? localScopeKeyRef.current;

  // Maximum event depth to prevent infinite loops in development
  const MAX_EVENT_DEPTH = 10;

  const emit = useCallback(
    (event: ConversationEvent) => {
      const scopeState = getScopeState(resolvedScopeKey);
      const isDevEnvironment = process.env.NODE_ENV === "development";
      let shouldSkipHandlers = false;

      if (isDevEnvironment) {
        if (scopeState.isCircularDetected) {
          return;
        }

        scopeState.eventDepth += 1;

        if (scopeState.eventDepth > MAX_EVENT_DEPTH) {
          console.error("Circular event detected!", event);
          scopeState.isCircularDetected = true;
          shouldSkipHandlers = true;
        }
      }

      try {
        if (shouldSkipHandlers) {
          return;
        }

        const eventHandlers = scopeState.handlers.get(event.type);
        if (eventHandlers) {
          eventHandlers.forEach((handler) => {
            try {
              handler(event);
            } catch (error) {
              console.error(`Error in event handler for ${event.type}:`, error);
            }
          });
        }
      } finally {
        if (isDevEnvironment) {
          scopeState.eventDepth = Math.max(0, scopeState.eventDepth - 1);
          if (scopeState.eventDepth === 0) {
            scopeState.isCircularDetected = false;
          }
        }
      }
    },
    [resolvedScopeKey]
  );

  const on = useCallback(
    (eventType: ConversationEvent["type"], handler: EventHandler) => {
      const scopeState = getScopeState(resolvedScopeKey);
      if (!scopeState.handlers.has(eventType)) {
        scopeState.handlers.set(eventType, new Set());
      }
      scopeState.handlers.get(eventType)!.add(handler);

      // Return unsubscribe function
      return () => {
        const currentState = getScopeState(resolvedScopeKey);
        const eventHandlers = currentState.handlers.get(eventType);
        if (eventHandlers) {
          eventHandlers.delete(handler);
          // Clean up empty event handler sets
          if (eventHandlers.size === 0) {
            currentState.handlers.delete(eventType);
            removeScopeIfUnused(resolvedScopeKey);
          }
        }
      };
    },
    [resolvedScopeKey]
  );

  const off = useCallback(
    (eventType: ConversationEvent["type"], handler?: EventHandler) => {
      const scopeState = getScopeState(resolvedScopeKey);
      if (handler) {
        // Remove specific handler
        const eventHandlers = scopeState.handlers.get(eventType);
        if (eventHandlers) {
          eventHandlers.delete(handler);
          if (eventHandlers.size === 0) {
            scopeState.handlers.delete(eventType);
            removeScopeIfUnused(resolvedScopeKey);
          }
        }
      } else {
        // Remove all handlers for event type
        scopeState.handlers.delete(eventType);
        removeScopeIfUnused(resolvedScopeKey);
      }
    },
    [resolvedScopeKey]
  );

  // Cleanup all event handlers (useful for unmounting)
  const cleanup = useCallback(() => {
    const scopeState = getScopeState(resolvedScopeKey);
    scopeState.handlers.clear();
    scopeState.eventDepth = 0;
    scopeState.isCircularDetected = false;
    scopeStates.delete(resolvedScopeKey);
  }, [resolvedScopeKey]);

  return {
    emit,
    on,
    off,
    cleanup,
    // Expose handlers count for testing
    getHandlersCount: () => getScopeState(resolvedScopeKey).handlers.size,
  };
};
