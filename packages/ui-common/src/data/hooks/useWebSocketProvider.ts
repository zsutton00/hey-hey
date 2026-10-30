import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useEffect } from "react";
import { useStore } from "jotai";
import { WebSocketHandler } from "../websockets/handler";
import { WebSocketService } from "../../services/webSocketService";
import { logger } from "../../utils/logger";
import { ToastService } from "../../services/toastService";

export function useWebSocketProvider(): WebSocketService {
  const store = useStore(); // Get current Jotai store from React context
  // Realtime events reach the data layer only through this client.
  const queryClient = useQueryClient();

  // Create handler with React store (no userId needed - handler manages its own auth)
  const webSocketHandler = useMemo(() => {
    logger.info("data_hooks", "[WebSocket] Creating handler with React store");
    return new WebSocketHandler(store, undefined, queryClient);
  }, [store, queryClient]);

  // Create service with handler
  const webSocketService = useMemo(() => {
    logger.info(
      "data_hooks",
      "[WebSocket] Creating service with custom handler"
    );
    return new WebSocketService(webSocketHandler);
  }, [webSocketHandler]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      ToastService.debug(`Cleaning up WebSocket service`);
      logger.info("data_hooks", "[WebSocket] Cleaning up WebSocket service");
      webSocketService.disconnect();
      // Also clean up handler auth subscription
      webSocketHandler.destroy();
    };
  }, [webSocketService, webSocketHandler]);

  return webSocketService;
}
