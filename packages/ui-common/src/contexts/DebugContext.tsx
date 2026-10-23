import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import type { ReactNode } from "react";
import type { ConversationMessage } from "../types/conversation";
import {
  useWebSocketDebug,
  type WebSocketEvent,
  type WebSocketDebugState,
  type EnhancedWebSocketEventFilter,
} from "../data/websockets/debug";

// Split into two contexts to prevent unnecessary re-renders
// Actions context: stable callbacks that don't change
// Data context: real-time data that updates frequently

export interface DebugActionsContextType {
  // Actions
  setWorkflowId: (id: string | null) => void;
  setOrganizationId: (id: string | null) => void;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  toggleDebugPanel: () => void;
  showDebugPanel: () => void;
  hideDebugPanel: () => void;
  clearWebSocketEvents: () => void;
  exportWebSocketDebugData: () => string;
  filteredWebSocketEvents: (
    filter: EnhancedWebSocketEventFilter
  ) => WebSocketEvent[];
}

export interface DebugDataContextType {
  // State
  workflowId: string | null;
  organizationId: string | null;
  conversationMessages: ConversationMessage[];
  debugPanelVisible: boolean;

  // WebSocket Debug Data
  webSocketEvents: WebSocketEvent[];
  webSocketStats: WebSocketDebugState["statistics"];
  webSocketConnectionState: WebSocketDebugState["connectionState"];
  webSocketCollections: WebSocketDebugState["collections"];

  // Advanced Debug Features
  isWebSocketHealthy: boolean;
  lastEventTimestamp: string | null;
}

export interface DebugContextType
  extends DebugActionsContextType,
    DebugDataContextType {}

const DebugActionsContext = createContext<DebugActionsContextType | null>(null);
const DebugDataContext = createContext<DebugDataContextType | null>(null);

export interface DebugProviderProps {
  children: ReactNode;
  initialWorkflowId?: string | null;
  initialOrganizationId?: string | null;
}

export const DebugProvider: React.FC<DebugProviderProps> = ({
  children,
  initialWorkflowId = null,
  initialOrganizationId = null,
}) => {
  // State management
  const [workflowId, setWorkflowIdState] = useState<string | null>(
    initialWorkflowId
  );
  const [organizationId, setOrganizationIdState] = useState<string | null>(
    initialOrganizationId
  );
  const [conversationMessages, setConversationMessages] = useState<
    ConversationMessage[]
  >([]);
  const [debugPanelVisible, setDebugPanelVisible] = useState(false);

  // WebSocket Debug Integration - only poll when debug panel is open
  const webSocketDebugData = useWebSocketDebug({
    updateInterval: debugPanelVisible ? 1000 : 10000,
  });

  // Auto-populate WebSocket debug data
  useEffect(() => {
    // WebSocket debug data is automatically updated via the useWebSocketDebug hook
    // No additional state management needed as the hook provides real-time data
  }, [webSocketDebugData.events]);

  // Actions
  const setWorkflowId = useCallback((id: string | null) => {
    console.log("[DebugContext] Setting workflowId:", id);
    setWorkflowIdState(id);
  }, []);

  const setOrganizationId = useCallback((id: string | null) => {
    console.log("[DebugContext] Setting organizationId:", id);
    setOrganizationIdState(id);
  }, []);

  const toggleDebugPanel = useCallback(() => {
    setDebugPanelVisible((prev) => !prev);
  }, []);

  const showDebugPanel = useCallback(() => {
    setDebugPanelVisible(true);
  }, []);

  const hideDebugPanel = useCallback(() => {
    setDebugPanelVisible(false);
  }, []);

  const clearWebSocketEvents = useCallback(() => {
    console.log("[DebugContext] Clearing WebSocket events");
    webSocketDebugData.clearEventLog();
  }, [webSocketDebugData]);

  const exportWebSocketDebugData = useCallback((): string => {
    console.log("[DebugContext] Exporting WebSocket debug data");
    return webSocketDebugData.exportDebugData();
  }, [webSocketDebugData]);

  // Advanced debug features
  const filteredWebSocketEvents = useCallback(
    (filter: EnhancedWebSocketEventFilter) => {
      return webSocketDebugData.getFilteredEvents(filter);
    },
    [webSocketDebugData]
  );

  const isWebSocketHealthy = React.useMemo(() => {
    return (
      webSocketDebugData.connectionState.isConnected &&
      webSocketDebugData.connectionState.isAuthenticated &&
      !webSocketDebugData.connectionState.connectionError
    );
  }, [webSocketDebugData.connectionState]);

  const lastEventTimestamp = React.useMemo(() => {
    const events = webSocketDebugData.events;
    return events.length > 0 ? events[events.length - 1].timestamp : null;
  }, [webSocketDebugData.events]);

  // Stable actions context - only updates when callbacks change (rarely/never)
  const actionsValue: DebugActionsContextType = React.useMemo(
    () => ({
      setWorkflowId,
      setOrganizationId,
      setConversationMessages,
      toggleDebugPanel,
      showDebugPanel,
      hideDebugPanel,
      clearWebSocketEvents,
      exportWebSocketDebugData,
      filteredWebSocketEvents,
    }),
    [
      setWorkflowId,
      setOrganizationId,
      setConversationMessages,
      toggleDebugPanel,
      showDebugPanel,
      hideDebugPanel,
      clearWebSocketEvents,
      exportWebSocketDebugData,
      filteredWebSocketEvents,
    ]
  );

  // Real-time data context - updates frequently
  const dataValue: DebugDataContextType = React.useMemo(
    () => ({
      workflowId,
      organizationId,
      conversationMessages,
      debugPanelVisible,
      webSocketEvents: webSocketDebugData.events,
      webSocketStats: webSocketDebugData.statistics,
      webSocketConnectionState: webSocketDebugData.connectionState,
      webSocketCollections: webSocketDebugData.collections,
      isWebSocketHealthy,
      lastEventTimestamp,
    }),
    [
      workflowId,
      organizationId,
      conversationMessages,
      debugPanelVisible,
      webSocketDebugData.events,
      webSocketDebugData.statistics,
      webSocketDebugData.connectionState,
      webSocketDebugData.collections,
      isWebSocketHealthy,
      lastEventTimestamp,
    ]
  );

  return (
    <DebugActionsContext.Provider value={actionsValue}>
      <DebugDataContext.Provider value={dataValue}>
        {children}
      </DebugDataContext.Provider>
    </DebugActionsContext.Provider>
  );
};

// Hook to access actions only (won't re-render on data changes)
export const useDebugActions = (): DebugActionsContextType => {
  const context = useContext(DebugActionsContext);
  if (!context) {
    throw new Error("useDebugActions must be used within a DebugProvider");
  }
  return context;
};

// Hook to access data only (will re-render on data changes)
export const useDebugData = (): DebugDataContextType => {
  const context = useContext(DebugDataContext);
  if (!context) {
    throw new Error("useDebugData must be used within a DebugProvider");
  }
  return context;
};

// Backward compatibility: hook to access both (will re-render on any change)
export const useDebugContext = (): DebugContextType => {
  const actions = useDebugActions();
  const data = useDebugData();
  return React.useMemo(() => ({ ...actions, ...data }), [actions, data]);
};
