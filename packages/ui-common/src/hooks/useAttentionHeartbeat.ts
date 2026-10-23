import { useEffect, useRef } from "react";
import type {
  AttentionEntityType,
  AttentionEvent,
} from "../types/userTracking";

export const useAttentionHeartbeat = (
  entityType: AttentionEntityType,
  entityId: string,
  trackAttention: (event: AttentionEvent) => void,
  tab?: string
): void => {
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Initialize as visible (document.hidden defaults to false when undefined)
  const isVisibleRef = useRef<boolean>(document.hidden === true ? false : true);

  useEffect(() => {
    // Skip tracking if no valid entity ID
    if (!entityId) {
      return;
    }

    const emitHeartbeat = () => {
      if (!isVisibleRef.current) {
        return;
      }

      const event: AttentionEvent = {
        eventType: "attention",
        entity: {
          type: entityType,
          id: entityId,
        },
        timestamp: Date.now(),
        kind: "heartbeat",
      };

      if (tab) {
        event.tab = tab;
      }

      trackAttention(event);
    };

    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;
    };

    // Set up visibility listener
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Start heartbeat interval (30 seconds)
    intervalRef.current = setInterval(emitHeartbeat, 30000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [entityType, entityId, tab, trackAttention]);
};
