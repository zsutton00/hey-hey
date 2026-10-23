import { useEffect, useRef } from "react";
import type {
  AttentionEntityType,
  AttentionEvent,
} from "../types/userTracking";
import { logger } from "../utils/logger";

export const useNavigationAttention = (
  entityType: AttentionEntityType,
  entityId: string,
  trackAttention: (event: AttentionEvent) => void,
  tab?: string
): void => {
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previousEntityRef = useRef<string | null>(null);
  if (!entityId || !entityType) {
    logger.warn("analytics", "missing value for useAttention", {
      entityId,
      entityType,
    });
  }

  useEffect(() => {
    if (!entityId || !entityType) {
      return;
    }
    const currentEntity = `${entityType}:${entityId}`;

    if (previousEntityRef.current === currentEntity) {
      return;
    }

    previousEntityRef.current = currentEntity;

    // Clear any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const event: AttentionEvent = {
        eventType: "attention",
        entity: {
          type: entityType,
          id: entityId,
        },
        timestamp: Date.now(),
        kind: "navigation",
      };

      if (tab) {
        event.tab = tab;
      }

      trackAttention(event);
    }, 3000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [entityType, entityId, tab, trackAttention]);
};
