/**
 * Unified Debug Hook
 * Coordinates workflow monitoring and WebSocket debugging into a single interface
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { WebSocketEventFilter } from "../components/Debug/debug.types";
import type {
  AggregatedErrorState,
  DebugTab,
  ModalState,
  TabConfig,
  UnifiedDebugState,
  UseUnifiedDebugOptions,
  UseUnifiedDebugReturn,
  WebSocketDomainState,
  WebSocketStatistics,
  WorkflowDomainState,
} from "../components/Debug/types/debugTypes";
import { useWebSocketContext } from "../contexts/WebSocketContext";
import { useWebSocketDebug } from "../data/websockets/debug";
import { useWorkflowStatusMonitoring } from "./useWorkflowStatusMonitoring";

// UUID validation regex
const UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const containsValidUuid = (id?: string): boolean => {
  return Boolean(id && UUID_REGEX.test(id));
};

export const useUnifiedDebug = (
  options: UseUnifiedDebugOptions
): UseUnifiedDebugReturn => {
  const {
    workflowId,
    organizationId,
    updateInterval = 1000,
    maxEvents = 1000,
    visible = true,
    initialTab = "workflow",
    enabledTabs = ["workflow", "websocket-events", "websocket-stats"],
  } = options;

  // UI State
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedTab, setSelectedTab] = useState<DebugTab>(initialTab);
  const [modals, setModals] = useState<ModalState>({
    workflowLogs: false,
    fullscreen: false,
  });
  const [workflowPaused, setWorkflowPaused] = useState(false);

  // Validate workflow ID
  const isValidWorkflowId = containsValidUuid(workflowId);

  // Workflow monitoring hook
  const workflowData = useWorkflowStatusMonitoring({
    workflowId,
    pollingInterval: workflowPaused ? 0 : updateInterval,
    enabled: visible && isValidWorkflowId && !workflowPaused,
    includeLogs: true,
  });

  // WebSocket debug hook
  const webSocketData = useWebSocketDebug({
    updateInterval,
    maxEvents,
    filter: {} as WebSocketEventFilter,
  });

  // WebSocket context for real connection state
  const webSocketContext = useWebSocketContext();

  const webSocketStatistics = useMemo<WebSocketStatistics>(() => {
    const eventsInLastHour = webSocketData.events.filter((event) => {
      const eventTime = new Date(event.timestamp).getTime();
      return Date.now() - eventTime <= 3600000;
    }).length;

    const lastReconnectTimestamp = webSocketData.statistics.lastReconnectTime
      ? new Date(webSocketData.statistics.lastReconnectTime).getTime()
      : null;

    const connectionUptime =
      webSocketContext.isConnected && lastReconnectTimestamp
        ? Date.now() - lastReconnectTimestamp
        : 0;

    const memoryUsage = (() => {
      if (typeof performance === "undefined") {
        return 0;
      }

      const performanceWithMemory = performance as Performance & {
        memory?: { usedJSHeapSize?: number };
      };

      return performanceWithMemory.memory?.usedJSHeapSize ?? 0;
    })();

    return {
      totalEvents: webSocketData.statistics.totalEvents,
      eventsInLastHour,
      errorsInLastHour: webSocketData.statistics.errorsInLastHour,
      avgEventProcessingTime:
        webSocketData.statistics.averageEventProcessingTime,
      connectionUptime,
      memoryUsage,
    };
  }, [
    webSocketContext.isConnected,
    webSocketData.events,
    webSocketData.statistics,
  ]);

  // Create workflow domain state
  const workflowDomainState: WorkflowDomainState = useMemo(
    () => ({
      status: workflowData.status,
      isLoading: workflowData.isLoading,
      error: workflowData.error,
      isPaused: workflowPaused,
      lastUpdate: workflowData.lastUpdate,
      isPolling: !workflowPaused && Boolean(workflowData.status),
    }),
    [
      workflowData.status,
      workflowData.isLoading,
      workflowData.error,
      workflowData.lastUpdate,
      workflowPaused,
    ]
  );

  // Create WebSocket domain state
  const webSocketDomainState = useMemo<WebSocketDomainState>(
    () => ({
      events: webSocketData.events,
      connectionState: {
        isConnected: webSocketContext.isConnected,
        isAuthenticated: webSocketContext.isAuthenticated,
        connectionError: webSocketContext.connectionError,
        lastConnectionAttempt: null,
        reconnectionAttempts: 0,
      },
      collections: webSocketData.collections,
      statistics: webSocketStatistics,
      filter: {} as WebSocketEventFilter,
    }),
    [
      webSocketData.events,
      webSocketData.collections,
      webSocketContext.isConnected,
      webSocketContext.isAuthenticated,
      webSocketContext.connectionError,
      webSocketStatistics,
    ]
  );

  // Aggregate errors from both domains
  const aggregatedErrors: AggregatedErrorState = useMemo(() => {
    const sources: ("workflow" | "websocket")[] = [];
    const details: { workflow?: string; websocket?: string[] } = {};

    // Check workflow errors
    if (workflowDomainState.error) {
      sources.push("workflow");
      details.workflow = workflowDomainState.error;
    }

    // Check WebSocket errors
    const recentWebSocketErrors = webSocketDomainState.events
      .filter((event) => {
        const isError =
          event.metadata?.success === false ||
          JSON.stringify(event.data).toLowerCase().includes("error");
        const isRecent =
          Date.now() - new Date(event.timestamp).getTime() < 60000; // Last minute
        return isError && isRecent;
      })
      .map((event) => event.metadata?.error || "WebSocket error")
      .filter((error, index, arr) => arr.indexOf(error) === index); // Remove duplicates

    if (recentWebSocketErrors.length > 0) {
      sources.push("websocket");
      details.websocket = recentWebSocketErrors;
    }

    return {
      hasErrors: sources.length > 0,
      errorCount:
        sources.length +
        (details.websocket?.length || 0) -
        (sources.includes("websocket") ? 1 : 0),
      sources,
      details,
    };
  }, [workflowDomainState.error, webSocketDomainState.events]);

  // Create tab configurations
  const tabConfigs: TabConfig[] = useMemo(
    () =>
      enabledTabs.map((tabId) => ({
        id: tabId,
        label: tabId.replace("-", " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        icon: () => null, // Icons will be handled in the component
        enabled: true,
        visible: true,
      })),
    [enabledTabs]
  );

  // Unified state
  const unifiedState: UnifiedDebugState = useMemo(
    () => ({
      isExpanded,
      selectedTab,
      workflow: workflowDomainState,
      websocket: webSocketDomainState,
      aggregatedErrors,
      modals,
      enabledTabs,
      tabConfigs,
    }),
    [
      isExpanded,
      selectedTab,
      workflowDomainState,
      webSocketDomainState,
      aggregatedErrors,
      modals,
      enabledTabs,
      tabConfigs,
    ]
  );

  // Control methods
  const refreshWorkflow = useCallback(() => {
    if (workflowData.refresh) {
      workflowData.refresh();
    }
  }, [workflowData]);

  const pauseWorkflow = useCallback(() => {
    setWorkflowPaused(true);
  }, []);

  const resumeWorkflow = useCallback(() => {
    setWorkflowPaused(false);
  }, []);

  const clearWebSocketEvents = useCallback(() => {
    if (webSocketData.clearEventLog) {
      webSocketData.clearEventLog();
    }
  }, [webSocketData]);

  const exportData = useCallback(() => {
    const exportData = {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      sessionInfo: {
        userAgent: navigator.userAgent,
        url: window.location.href,
        sessionDuration:
          Date.now() - (performance.timing?.navigationStart || 0),
        organizationId,
      },
      workflow: {
        status: workflowDomainState.status,
        error: workflowDomainState.error,
        isPaused: workflowDomainState.isPaused,
        pollingInterval: updateInterval,
      },
      websocket: webSocketData.exportDebugData
        ? webSocketData.exportDebugData()
        : {},
      aggregatedErrors,
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `unified-debug-export-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [workflowDomainState, webSocketData, aggregatedErrors, updateInterval]);

  const fetchWorkflowLogs = useCallback(async (): Promise<unknown> => {
    if (workflowData.fetchLogs) {
      return await workflowData.fetchLogs();
    }
    return null;
  }, [workflowData]);

  // State update methods
  const setSelectedTabHandler = useCallback(
    (tab: DebugTab) => {
      if (enabledTabs.includes(tab)) {
        setSelectedTab(tab);
      }
    },
    [enabledTabs]
  );

  const setModalOpen = useCallback((modal: keyof ModalState, open: boolean) => {
    setModals((prev) => ({ ...prev, [modal]: open }));
  }, []);

  const setWebSocketFilter = useCallback((filter: WebSocketEventFilter) => {
    // This will be handled by individual tab components
    // The filter state is managed at the tab level, not globally
    console.log("Filter update:", filter);
  }, []);

  const getFilteredEvents = useCallback(
    (filter?: WebSocketEventFilter) => {
      if (!filter) return webSocketDomainState.events;

      let filtered = webSocketDomainState.events;

      if (filter.type) {
        filtered = filtered.filter((event) => event.type === filter.type);
      }

      if (filter.source) {
        filtered = filtered.filter((event) => event.source === filter.source);
      }

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        filtered = filtered.filter(
          (event) =>
            event.type.toLowerCase().includes(searchLower) ||
            event.source.toLowerCase().includes(searchLower) ||
            JSON.stringify(event.data).toLowerCase().includes(searchLower)
        );
      }

      if (filter.showErrorsOnly) {
        filtered = filtered.filter(
          (event) =>
            event.metadata?.success === false ||
            JSON.stringify(event.data).toLowerCase().includes("error")
        );
      }

      if (filter.timeRange) {
        const { start, end } = filter.timeRange;
        filtered = filtered.filter((event) => {
          const eventTime = new Date(event.timestamp);
          const isAfterStart = start ? eventTime >= start : true;
          const isBeforeEnd = end ? eventTime <= end : true;
          return isAfterStart && isBeforeEnd;
        });
      }

      return filtered;
    },
    [webSocketDomainState.events]
  );

  const exportDebugData = useCallback(() => {
    return webSocketData.exportDebugData
      ? webSocketData.exportDebugData()
      : "{}";
  }, [webSocketData]);

  // Ensure selected tab is valid
  useEffect(() => {
    if (!enabledTabs.includes(selectedTab)) {
      const firstEnabledTab = enabledTabs[0];
      if (firstEnabledTab) {
        setSelectedTab(firstEnabledTab);
      }
    }
  }, [enabledTabs, selectedTab]);

  // Return the complete unified debug interface
  return {
    ...unifiedState,

    // Control methods
    refreshWorkflow,
    pauseWorkflow,
    resumeWorkflow,
    clearWebSocketEvents,
    exportData,
    fetchWorkflowLogs,

    // State update methods
    setSelectedTab: setSelectedTabHandler,
    setExpanded: setIsExpanded,
    setModalOpen,
    setWebSocketFilter,

    // Utility methods
    getFilteredEvents,
    exportDebugData,
  };
};
