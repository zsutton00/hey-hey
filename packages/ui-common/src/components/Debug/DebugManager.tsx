import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Fab, Tooltip, Zoom } from "@mui/material";
import DebugIcon from "@mui/icons-material/BugReport";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { WebSocketDebugModal } from "./WebSocketDebugModal";
import { UnifiedDebugPanel } from "./UnifiedDebugPanel";
import type { WebSocketDebugPreferences } from "./debug.types";
import type { DebugTab } from "./types/debugTypes";
import { useDebugContext } from "../../hooks/useDebugContext";

interface DebugManagerProps {
  /** Whether debug mode is enabled */
  enabled?: boolean;
  /** Initial visibility state */
  initialVisible?: boolean;
  /** Debug preferences */
  preferences?: Partial<WebSocketDebugPreferences>;
  /** Use unified debug panel instead of separate panels */
  useUnifiedPanel?: boolean;
  /** Initial tab for unified panel */
  initialTab?: DebugTab;
  /** Enabled tabs for unified panel */
  enabledTabs?: DebugTab[];
}

const DEFAULT_PREFERENCES: WebSocketDebugPreferences = {
  panelPosition: "bottom-left",
  autoStart: true,
  maxEventHistory: 1000,
  enableHotkeys: true,
  exportFormat: "json",
};

export const DebugManager: React.FC<DebugManagerProps> = ({
  enabled = process.env.NODE_ENV === "development",
  initialVisible = false,
  preferences: propPreferences = {},
  initialTab = "workflow",
  enabledTabs = ["workflow", "websocket-events", "websocket-stats"],
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  // Get debug context instead of props
  const {
    workflowId,
    organizationId,
    debugPanelVisible,
    toggleDebugPanel,
    showDebugPanel,
    hideDebugPanel,
  } = useDebugContext();

  const preferences = { ...DEFAULT_PREFERENCES, ...propPreferences };

  const [debugModalOpen, setDebugModalOpen] = useState(false);
  const [fabVisible, setFabVisible] = useState(enabled && !debugPanelVisible);

  // Memoize workflowId to prevent unnecessary re-renders
  const stableWorkflowId = useMemo(
    () => (workflowId ?? undefined) as string | undefined,
    [workflowId],
  );

  useEffect(() => {
    if (!enabled || !initialVisible) {
      return;
    }

    showDebugPanel();
    setFabVisible(false);
  }, [enabled, initialVisible, showDebugPanel]);

  // Store debug state in localStorage
  useEffect(() => {
    if (!enabled) return;

    try {
      localStorage.setItem(
        "debug-panel-visible",
        JSON.stringify(debugPanelVisible),
      );
    } catch (error) {
      console.warn("[DEBUG MANAGER] Failed to save debug state:", error);
    }
  }, [enabled, debugPanelVisible]);

  // Load debug state from localStorage
  useEffect(() => {
    if (!enabled) return;

    try {
      const saved = localStorage.getItem("debug-panel-visible");
      if (saved !== null) {
        const wasVisible = JSON.parse(saved);
        if (wasVisible) {
          showDebugPanel();
        } else {
          hideDebugPanel();
        }
        setFabVisible(!wasVisible);
      }
    } catch (error) {
      console.warn("[DEBUG MANAGER] Failed to load debug state:", error);
    }
  }, [enabled, showDebugPanel, hideDebugPanel]);

  const handleToggleDebugPanel = useCallback(() => {
    toggleDebugPanel();
    setFabVisible(!debugPanelVisible);
  }, [toggleDebugPanel, debugPanelVisible]);

  const closeDebugPanel = useCallback(() => {
    hideDebugPanel();
    setFabVisible(true);
  }, [hideDebugPanel]);

  const openDebugModal = useCallback(() => {
    setDebugModalOpen(true);
  }, []);

  const closeDebugModal = useCallback(() => {
    setDebugModalOpen(false);
  }, []);

  const closeAllDebugInterfaces = useCallback(() => {
    hideDebugPanel();
    setDebugModalOpen(false);
    setFabVisible(true);
  }, [hideDebugPanel]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!enabled || !preferences.enableHotkeys) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Shift+D - Toggle debug mode
      if (event.ctrlKey && event.shiftKey && event.key === "D") {
        event.preventDefault();
        handleToggleDebugPanel();
      }

      // Ctrl+Shift+M - Open debug modal
      if (event.ctrlKey && event.shiftKey && event.key === "M") {
        event.preventDefault();
        setDebugModalOpen(true);
      }

      // Escape - Close all debug interfaces
      if (event.key === "Escape" && (debugPanelVisible || debugModalOpen)) {
        event.preventDefault();
        closeAllDebugInterfaces();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    preferences.enableHotkeys,
    debugPanelVisible,
    debugModalOpen,
    handleToggleDebugPanel,
    closeAllDebugInterfaces,
  ]);

  // Expose debug controls to window for console access
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const debugControls = {
      togglePanel: handleToggleDebugPanel,
      openModal: openDebugModal,
      closeAll: closeAllDebugInterfaces,
      isVisible: () => debugPanelVisible,
      isModalOpen: () => debugModalOpen,
    };

    (
      window as typeof window & { debugControls: typeof debugControls }
    ).debugControls = debugControls;

    if (process.env.NODE_ENV === "development") {
      console.log(
        "🐛 [DEBUG MANAGER] Debug controls available at window.debugControls:",
        Object.keys(debugControls),
      );
    }

    return () => {
      delete (
        window as typeof window & { debugControls?: typeof debugControls }
      ).debugControls;
    };
  }, [
    enabled,
    debugPanelVisible,
    debugModalOpen,
    handleToggleDebugPanel,
    openDebugModal,
    closeAllDebugInterfaces,
  ]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* Floating Action Button to show/hide debug panel */}
      <Zoom in={fabVisible}>
        <Tooltip
          title={t("debug.toggleDebug", "Toggle Debug Panel (Ctrl+Shift+D)")}
          placement="left"
        >
          <Fab
            color="secondary"
            size="small"
            onClick={handleToggleDebugPanel}
            sx={{
              position: "fixed",
              bottom: 80, // Above other FABs if they exist
              right: 16,
              zIndex: theme.zIndex.speedDial,
              opacity: 0.8,
              "&:hover": {
                opacity: 1,
              },
            }}
          >
            <DebugIcon />
          </Fab>
        </Tooltip>
      </Zoom>

      <UnifiedDebugPanel
        visible={debugPanelVisible}
        onClose={closeDebugPanel}
        onOpenModal={openDebugModal}
        position={preferences.panelPosition}
        initialTab={initialTab}
        enabledTabs={enabledTabs}
        workflowId={stableWorkflowId}
        organizationId={organizationId ?? undefined}
        maxEvents={preferences.maxEventHistory}
        updateInterval={10000}
        exportEnabled={true}
        clearEnabled={true}
        keyboardShortcuts={preferences.enableHotkeys}
      />

      {/* WebSocket Debug Modal */}
      {debugModalOpen && (
        <WebSocketDebugModal
          open={debugModalOpen}
          onClose={closeDebugModal}
          maxEvents={preferences.maxEventHistory}
        />
      )}

      {/* Development overlay indicator */}
      {process.env.NODE_ENV === "development" &&
        (debugPanelVisible || debugModalOpen) && (
          <Box
            sx={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              background: `linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
              zIndex: theme.zIndex.tooltip + 2,
              opacity: 0.6,
            }}
          />
        )}
    </>
  );
};
