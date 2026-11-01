import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
/**
 * Unified Debug Panel Component
 * Combines WorkflowStatusDebug and WebSocketDebug into a single tabbed interface
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tabs,
  Tab,
  Collapse,
  Badge,
  Tooltip,
  Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import WebSocketIcon from "@mui/icons-material/Cable";
import WorkflowIcon from "@mui/icons-material/Timeline";
import StatsIcon from "@mui/icons-material/BarChart";
import EventsIcon from "@mui/icons-material/List";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExportIcon from "@mui/icons-material/GetApp";
import ClearIcon from "@mui/icons-material/Clear";
import FullscreenIcon from "@mui/icons-material/OpenInFull";
import ChatIcon from "@mui/icons-material/Chat";
import AdvancedIcon from "@mui/icons-material/Analytics";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type {
  UnifiedDebugPanelProps,
  DebugTab,
  PanelPosition,
  PositionStyles,
  TabConfig,
} from "./types/debugTypes";
import { POSITION_STYLES } from "./types/debugTypes";
import { WorkflowStatusTab } from "./tabs/WorkflowStatusTab";
import { WebSocketEventsTab } from "./tabs/WebSocketEventsTab";
import { WebSocketStatsTab } from "./tabs/WebSocketStatsTab";
import { ChatMessagesTab } from "./tabs/ChatMessagesTab";
import { AdvancedDebugPanel } from "./AdvancedDebugPanel";
import { WorkflowLogsModal } from "./WorkflowLogsModal";
import { useWebSocketDebug } from "../../data/websockets/debug";
import { useDebugContext } from "../../hooks/useDebugContext";
import type { EnhancedWebSocketEventFilter } from "../../data/websockets/debug";

// Position utility function
const getPositionStyles = (position: PanelPosition): PositionStyles => {
  return POSITION_STYLES[position];
};

// Tab configuration
const createTabConfigs = (
  enabledTabs: DebugTab[],
  t: ReturnType<typeof useTranslation>["t"],
): TabConfig[] => {
  const allTabs: Record<DebugTab, Omit<TabConfig, "enabled" | "visible">> = {
    workflow: {
      id: "workflow",
      label: t("debug.workflow", "Workflow"),
      icon: WorkflowIcon,
    },
    "websocket-events": {
      id: "websocket-events",
      label: t("debug.events", "Events"),
      icon: EventsIcon,
    },
    "websocket-stats": {
      id: "websocket-stats",
      label: t("debug.stats", "Stats"),
      icon: StatsIcon,
    },
    "chat-messages": {
      id: "chat-messages",
      label: t("debug.chatMessages", "Chat"),
      icon: ChatIcon,
    },
    "advanced-analytics": {
      id: "advanced-analytics",
      label: t("debug.advancedAnalytics", "Advanced Analytics"),
      icon: AdvancedIcon,
    },
  };

  return (
    Object.entries(allTabs) as Array<
      [DebugTab, Omit<TabConfig, "enabled" | "visible">]
    >
  ).map(([key, config]) => ({
    ...config,
    enabled: enabledTabs.includes(key),
    visible: enabledTabs.includes(key),
  }));
};

export const UnifiedDebugPanel: React.FC<UnifiedDebugPanelProps> = ({
  visible = true,
  position = "bottom-left" as PanelPosition,
  initialTab = "workflow" as DebugTab,
  enabledTabs = [
    "workflow",
    "websocket-events",
    "websocket-stats",
  ] as DebugTab[],
  onClose,
  onOpenModal,
  updateInterval = 1000,
  maxEvents = 1000,
  exportEnabled = true,
  clearEnabled = true,
  keyboardShortcuts = true,
  workflowId,
  organizationId: _organizationId,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  // Get conversation messages from debug context
  const { conversationMessages } = useDebugContext();

  // UI State
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedTab, setSelectedTab] = useState<DebugTab>(initialTab);
  const [isLogsModalOpen, setIsLogsModalOpen, isLogsModalOpenOwnerKey] =
    useModalState(false);

  // Workflow ID validation - allow any non-empty string that's not a mock ID
  const isValidWorkflowId = Boolean(
    workflowId &&
    workflowId.trim().length > 0 &&
    !workflowId.toLowerCase().includes("mock") &&
    !workflowId.toLowerCase().includes("test"),
  );

  console.log(
    "[DebugManager] UnifiedDebugPanel Render:",
    JSON.stringify({
      workflowId,
      isValidWorkflowId,
    }),
  );

  // WebSocket debug data
  const {
    events: webSocketEvents,
    connectionState,
    statistics: webSocketStats,
    collections,
    clearEventLog: clearWebSocketEvents,
    getFilteredEvents,
  } = useWebSocketDebug({
    maxEvents,
    updateInterval,
  });

  // WebSocket filter state - using compatible filter type
  const [webSocketFilter, setWebSocketFilter] =
    useState<EnhancedWebSocketEventFilter>({
      showErrorsOnly: false,
    });

  // Mock subscription stats for now - would be provided by real WebSocket service
  const subscriptionStats = useMemo(
    () => ({
      totalActiveSubscriptions: 0,
      uniqueDataSubscriptions: 0,
      subscriptionCountByKey: {} as Record<string, number>,
      duplicateSubscriptions: 0,
    }),
    [],
  );

  const activeSubscriptions = useMemo(
    () =>
      [] as Array<{
        subscriptionKey: string;
        webSocketSubscriptionId: string;
        referenceCount: number;
        config: {
          projectIds: string[];
          conversationIds: string[];
          initiativeIds: string[];
          eventTypes: string[];
          subscriptionType: string;
          subscriptionIndex: number;
          eventCount: number;
        };
      }>,
    [],
  );

  // Tab configuration
  const tabConfigs = createTabConfigs(enabledTabs, t);
  const visibleTabs = tabConfigs.filter((tab) => tab.visible);

  // Ensure initial tab is valid and enabled
  useEffect(() => {
    if (!enabledTabs.includes(selectedTab)) {
      const firstEnabledTab = enabledTabs[0];
      if (firstEnabledTab) {
        setSelectedTab(firstEnabledTab);
      }
    }
  }, [enabledTabs, selectedTab]);

  // Event handlers
  const handleTabChange = useCallback(
    (_event: React.SyntheticEvent, newTab: string) => {
      setSelectedTab(newTab as DebugTab);
    },
    [],
  );

  const handleToggleExpansion = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const handleExport = useCallback(() => {
    const exportData = {
      timestamp: new Date().toISOString(),
      selectedTab,
      webSocketEvents:
        selectedTab === "websocket-events" ? webSocketEvents : [],
      webSocketStats:
        selectedTab === "websocket-stats"
          ? { connectionState, statistics: webSocketStats, subscriptionStats }
          : null,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `debug-${selectedTab}-${new Date()
      .toISOString()
      .slice(0, 19)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [
    selectedTab,
    webSocketEvents,
    connectionState,
    webSocketStats,
    subscriptionStats,
  ]);

  const handleClear = useCallback(() => {
    if (selectedTab === "websocket-events") {
      clearWebSocketEvents();
    }
    // Workflow tab doesn't have a clear action
  }, [selectedTab, clearWebSocketEvents]);

  const handleRefresh = useCallback(() => {
    // WebSocket tabs auto-refresh, no manual refresh needed
    // Workflow tab handles its own refresh internally
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    if (!keyboardShortcuts || !visible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Shift+W - Toggle panel expansion
      if (event.ctrlKey && event.shiftKey && event.key === "W") {
        event.preventDefault();
        handleToggleExpansion();
      }
      // Ctrl+Shift+X - Clear current tab
      if (event.ctrlKey && event.shiftKey && event.key === "X") {
        event.preventDefault();
        if (clearEnabled) handleClear();
      }
      // Ctrl+Shift+E - Export data
      if (event.ctrlKey && event.shiftKey && event.key === "E") {
        event.preventDefault();
        if (exportEnabled) handleExport();
      }
      // Ctrl+Shift+1/2/3 - Tab switching
      if (
        event.ctrlKey &&
        event.shiftKey &&
        ["1", "2", "3"].includes(event.key)
      ) {
        event.preventDefault();
        const tabIndex = parseInt(event.key) - 1;
        const targetTab = visibleTabs[tabIndex];
        if (targetTab) {
          setSelectedTab(targetTab.id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    keyboardShortcuts,
    visible,
    clearEnabled,
    exportEnabled,
    visibleTabs,
    handleToggleExpansion,
    handleClear,
    handleExport,
  ]);

  // Calculate error count from WebSocket events
  const webSocketErrors = webSocketEvents.filter(
    (event) => event.metadata?.error,
  ).length;
  const errorCount = webSocketErrors;

  // Event handler for workflow logs modal
  const handleViewLogs = useCallback(() => {
    setIsLogsModalOpen(true);
  }, []);

  const handleWebSocketFilterChange = useCallback(
    (filter: typeof webSocketFilter) => {
      setWebSocketFilter(filter);
    },
    [],
  );

  const handleExportWebSocketEvents = useCallback(() => {
    // Export filtered events
    const filteredEvents = getFilteredEvents(webSocketFilter);
    const exportData = {
      timestamp: new Date().toISOString(),
      events: filteredEvents,
      filter: webSocketFilter,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `websocket-events-${new Date()
      .toISOString()
      .slice(0, 19)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [getFilteredEvents, webSocketFilter]);

  // Chat messages export handler
  const handleExportChatMessages = useCallback(() => {
    const exportData = {
      timestamp: new Date().toISOString(),
      workflowId,
      messages: conversationMessages,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat-messages-${new Date()
      .toISOString()
      .slice(0, 19)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [conversationMessages, workflowId]);

  // Don't render if not visible
  if (!visible) {
    return null;
  }

  return (
    <Paper
      elevation={8}
      sx={{
        position: "fixed",
        ...getPositionStyles(position),
        width: isExpanded ? 500 : 280,
        maxWidth: "90vw",
        maxHeight: "80vh",
        zIndex: theme.zIndex.tooltip + 1,
        transition: "width 0.3s ease-in-out",
        bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
        border: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          p: 1.5,
          bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Badge
            badgeContent={errorCount > 0 ? errorCount : null}
            color="error"
          >
            <WebSocketIcon fontSize="small" color="primary" />
          </Badge>
          <Typography variant="body2" fontWeight={600}>
            {t("debug.unified", "Debug Panel")}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {/* Control Buttons */}
          <Tooltip
            title={t("debug.toggleExpand", "Toggle Expand (Ctrl+Shift+W)")}
          >
            <IconButton
              size="small"
              onClick={handleToggleExpansion}
              sx={{ padding: 0.5 }}
            >
              {isExpanded ? (
                <ExpandLessIcon fontSize="small" />
              ) : (
                <ExpandMoreIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>

          {clearEnabled && (
            <Tooltip title={t("debug.clear", "Clear (Ctrl+Shift+X)")}>
              <IconButton
                size="small"
                onClick={handleClear}
                sx={{ padding: 0.5 }}
              >
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip title={t("debug.refresh", "Refresh")}>
            <IconButton
              size="small"
              onClick={handleRefresh}
              sx={{ padding: 0.5 }}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          {exportEnabled && (
            <Tooltip title={t("debug.export", "Export (Ctrl+Shift+E)")}>
              <IconButton
                size="small"
                onClick={handleExport}
                sx={{ padding: 0.5 }}
              >
                <ExportIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {onOpenModal && (
            <Tooltip title={t("debug.openModal", "Open Full View")}>
              <IconButton
                size="small"
                onClick={onOpenModal}
                sx={{ padding: 0.5 }}
              >
                <FullscreenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          {onClose && (
            <Tooltip title={t("debug.close", "Close")}>
              <IconButton size="small" onClick={onClose} sx={{ padding: 0.5 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* Content */}
      <Collapse in={isExpanded}>
        <Box sx={{ height: 600, display: "flex", flexDirection: "column" }}>
          {/* Stats Summary (always visible when expanded) */}
          <Box sx={{ p: 2, pb: 1 }}>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {enabledTabs.includes("websocket-events") && (
                <Chip
                  label={`${webSocketEvents.length} ${t(
                    "debug.events",
                    "Events",
                  )}`}
                  size="small"
                  variant="outlined"
                  color="default"
                />
              )}
              {enabledTabs.includes("websocket-stats") && (
                <Chip
                  label={`${subscriptionStats.totalActiveSubscriptions} ${t(
                    "debug.subscriptions",
                    "Subs",
                  )}`}
                  size="small"
                  variant="outlined"
                  color="default"
                />
              )}
              {errorCount > 0 && (
                <Chip
                  label={`${errorCount} ${t("debug.errors", "Errors")}`}
                  size="small"
                  variant="outlined"
                  color="error"
                />
              )}
            </Box>
          </Box>

          {/* Tabs */}
          {visibleTabs.length > 1 && (
            <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
              <Tabs
                value={selectedTab}
                onChange={handleTabChange}
                aria-label="debug tabs"
                variant="fullWidth"
                sx={{ minHeight: 40 }}
              >
                {visibleTabs.map((tab) => {
                  const IconComponent = tab.icon;
                  return (
                    <Tab
                      key={tab.id}
                      label={
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                          }}
                        >
                          <IconComponent fontSize="small" />
                          <span>{tab.label}</span>
                        </Box>
                      }
                      value={tab.id}
                      sx={{ minHeight: 40, fontSize: "0.8rem" }}
                    />
                  );
                })}
              </Tabs>
            </Box>
          )}

          {/* Tab Content */}
          <Box sx={{ flex: 1, overflow: "hidden" }}>
            {selectedTab === "workflow" && enabledTabs.includes("workflow") && (
              <WorkflowStatusTab
                workflowId={workflowId}
                organizationId={_organizationId}
                updateInterval={updateInterval}
                visible={visible}
                enabledTabs={enabledTabs}
                onViewLogs={handleViewLogs}
              />
            )}

            {selectedTab === "websocket-events" &&
              enabledTabs.includes("websocket-events") && (
                <WebSocketEventsTab
                  events={webSocketEvents}
                  filter={webSocketFilter}
                  onFilterChange={handleWebSocketFilterChange}
                  onClearEvents={clearWebSocketEvents}
                  onExportEvents={handleExportWebSocketEvents}
                  autoScroll={true}
                  showTimestamps={true}
                  maxHeight="100%"
                />
              )}

            {selectedTab === "websocket-stats" &&
              enabledTabs.includes("websocket-stats") && (
                <WebSocketStatsTab
                  connectionState={{
                    ...connectionState,
                    lastConnectionAttempt: null,
                    reconnectionAttempts: 0,
                  }}
                  statistics={{
                    ...webSocketStats,
                    eventsInLastHour: webSocketEvents.filter((e) => {
                      const eventTime = new Date(e.timestamp);
                      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                      return eventTime >= oneHourAgo;
                    }).length,
                    avgEventProcessingTime:
                      webSocketStats.averageEventProcessingTime,
                    connectionUptime: Date.now() - (Date.now() - 60000), // Mock 1 minute uptime
                    memoryUsage: 0,
                  }}
                  collections={collections}
                  subscriptionStats={subscriptionStats}
                  activeSubscriptions={activeSubscriptions}
                  onRefreshStats={() => {
                    /* Auto-refreshed via hook */
                  }}
                />
              )}

            {selectedTab === "chat-messages" &&
              enabledTabs.includes("chat-messages") && (
                <ChatMessagesTab
                  messages={conversationMessages}
                  onExportMessages={handleExportChatMessages}
                  maxHeight="100%"
                />
              )}
            {selectedTab === "advanced-analytics" &&
              enabledTabs.includes("advanced-analytics") && (
                <AdvancedDebugPanel />
              )}
          </Box>
        </Box>
      </Collapse>

      {/* Compact View */}
      {!isExpanded && (
        <Box sx={{ p: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              bgcolor:
                errorCount > 0
                  ? theme.palette.error.main
                  : connectionState.isConnected
                    ? theme.palette.success.main
                    : theme.palette.warning.main,
            }}
          />
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
            {webSocketEvents.length} events,{" "}
            {subscriptionStats.totalActiveSubscriptions} subs
          </Typography>
          {errorCount > 0 && (
            <Chip
              label={errorCount}
              size="small"
              color="error"
              sx={{ height: 20, fontSize: "0.7rem" }}
            />
          )}
        </Box>
      )}

      {/* Workflow Logs Modal */}
      <ModalWorkOwner.Provider value={isLogsModalOpenOwnerKey}>
        <WorkflowLogsModal
          open={isLogsModalOpen}
          onClose={() => setIsLogsModalOpen(false)}
          workflowId={isValidWorkflowId ? workflowId : undefined}
          onFetchLogs={() => Promise.resolve([])}
        />
      </ModalWorkOwner.Provider>
    </Paper>
  );
};
