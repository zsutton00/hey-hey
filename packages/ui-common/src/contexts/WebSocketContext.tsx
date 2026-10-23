import React, {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useWebSocketProvider } from "../data/hooks/useWebSocketProvider";
import {
  WebSocketService,
  type WebSocketConfig,
} from "../services/webSocketService";
import { useAuth } from "./AuthContext";
import { useOptionalOrganization } from "./OrganizationContext";

interface WebSocketContextValue {
  isConnected: boolean;
  isAuthenticated: boolean;
  connectionError: string | null;
  service: WebSocketService;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(
  undefined,
);

interface WebSocketProviderProps {
  children: ReactNode;
  serverUrl?: string;
  /** Use the new store-aware WebSocket service instead of singleton */
  useNewProvider?: boolean;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
  children,
  serverUrl,
}) => {
  // Use new store-aware provider (no userId needed - handler manages its own auth)
  const service = useWebSocketProvider();

  // Use reactive auth context instead of direct service calls
  const { isAuthenticated, user } = useAuth();
  const organizationContext = useOptionalOrganization();

  const [contextValue, setContextValue] = React.useState<WebSocketContextValue>(
    {
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
      service,
    },
  );

  const hasOrganizationContext = organizationContext !== undefined;
  const organizationId = organizationContext?.currentOrganization?.id;

  // Initialize WebSocket service when user is authenticated. Under an
  // organization provider, hold until the confirmed organization resolves:
  // initializing without it and again once it arrives restarts the socket,
  // which the service treats as a reconnect and marks every collection stale.
  useEffect(() => {
    if (isAuthenticated && user?.email) {
      if (hasOrganizationContext && !organizationId) return;
      const config: WebSocketConfig = {
        userId: user.email,
        serverUrl,
        ...(organizationId ? { organizationId } : {}),
      };

      service.initialize(config);
    } else {
      service.disconnect();
    }
  }, [
    isAuthenticated,
    user,
    serverUrl,
    service,
    hasOrganizationContext,
    organizationId,
  ]);

  // Subscribe to WebSocket state changes
  useEffect(() => {
    const unsubscribe = service.onStateChange((state) => {
      setContextValue((prev) => ({
        ...prev,
        isConnected: state.isConnected,
        isAuthenticated: state.isAuthenticated,
        connectionError: state.connectionError,
      }));
    });

    // Set initial state
    const initialState = service.getState();
    setContextValue((prev) => ({
      ...prev,
      ...initialState,
    }));

    return unsubscribe;
  }, [service]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Note: We don't disconnect here because other parts of the app might still need it
      // The service will handle cleanup internally when appropriate
    };
  }, []);

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocketContext = (): WebSocketContextValue => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      "useWebSocketContext must be used within a WebSocketProvider",
    );
  }
  return context;
};

export const useWebSocketService = (): WebSocketService => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error(
      "useWebSocketService must be used within a WebSocketProvider",
    );
  }
  return context.service;
};

export const useOptionalWebSocketService = (): WebSocketService | null => {
  const context = useContext(WebSocketContext);
  return context?.service ?? null;
};

export const useOptionalWebSocketContext = ():
  | WebSocketContextValue
  | undefined => useContext(WebSocketContext);
