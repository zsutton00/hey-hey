import { useEffect, useRef } from "react";
import { useOptionalWebSocketService } from "../../contexts/WebSocketContext";
import type { SubscriptionConfig } from "../../services/webSocketService";

export const useWebsocketSubscriptions = (
  config: SubscriptionConfig,
  options: {
    enabled: boolean;
  }
) => {
  const webSocketService = useOptionalWebSocketService();
  const subscriptionRef = useRef<string | null>(null);

  const idDependencies: string[] = [];
  if (config.conversationIds) {
    idDependencies.push(...config.conversationIds);
  }
  if (config.projectIds) {
    idDependencies.push(...config.projectIds);
  }
  if (config.initiativeIds) {
    idDependencies.push(...config.initiativeIds);
  }
  if (config.designDocIds) {
    idDependencies.push(...config.designDocIds);
  }
  idDependencies.sort();

  // Update WebSocket subscription
  useEffect(() => {
    if (
      !idDependencies.length ||
      options.enabled === false ||
      !webSocketService
    ) {
      return;
    }

    try {
      const subscriptionId = webSocketService.subscribe(config);
      subscriptionRef.current = subscriptionId;
    } catch (error) {
      // Log error but don't throw to prevent component crashes
      console.error("[WEBSOCKET_SUBSCRIPTION] Failed to subscribe:", error);
      return;
    }

    return () => {
      if (subscriptionRef.current) {
        try {
          webSocketService.unsubscribe(subscriptionRef.current);
        } catch (error) {
          console.error(
            "[WEBSOCKET_SUBSCRIPTION] Failed to unsubscribe:",
            error
          );
        }
        subscriptionRef.current = null;
      }
    };
    // config is ommitted because idDependencies accounts for it
  }, [idDependencies.join(","), options.enabled, webSocketService]);
};
