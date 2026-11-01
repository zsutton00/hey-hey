import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
/**
 * Workflow Timeline Viewer Component
 *
 * Main component for displaying workflow execution timeline with nodes, steps, and events
 */

import React, { useState } from "react";
import {
  Box,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  Button,
  Chip,
  IconButton,
  Tooltip,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tabs,
  Tab,
  Switch,
  FormControlLabel,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import ResetZoomIcon from "@mui/icons-material/RestartAlt";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useWorkflowTimeline } from "../../data/hooks/useWorkflowTimeline";
import { WorkflowTimelineNode } from "./WorkflowTimelineNode";
import { WorkflowTimelineEventDetails } from "./WorkflowTimelineEventDetails";
import type { WorkflowTimelineEventDto } from "../../api";

interface WorkflowTimelineViewerProps {
  /** Workflow ID to display timeline for */
  workflowId: string | undefined;
  /** Whether the timeline viewer is displayed in a dialog */
  isDialog?: boolean;
  /** Callback when dialog should close (if isDialog=true) */
  onClose?: () => void;
}

export const WorkflowTimelineViewer: React.FC<WorkflowTimelineViewerProps> = ({
  workflowId,
  isDialog = false,
  onClose,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [zoom, setZoom] = useState(1);
  const [selectedOrphanEvent, setSelectedOrphanEvent] =
    useState<WorkflowTimelineEventDto | null>(null);
  const [orphanDetailsOpen, setOrphanDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"timeline" | "orphaned">(
    "timeline",
  );
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  const {
    data: timeline,
    isLoading,
    error,
    refresh,
  } = useWorkflowTimeline(workflowId, {
    enabled: !!workflowId,
  });

  const handleZoomIn = (): void => {
    setZoom((prev) => Math.min(prev + 0.2, 3));
  };

  const handleZoomOut = (): void => {
    setZoom((prev) => Math.max(prev - 0.2, 0.5));
  };

  const handleResetZoom = (): void => {
    setZoom(1);
  };

  const handleOrphanEventClick = (event: WorkflowTimelineEventDto): void => {
    setSelectedOrphanEvent(event);
    setOrphanDetailsOpen(true);
  };

  const handleCloseOrphanDetails = (): void => {
    setOrphanDetailsOpen(false);
  };

  const nodeCount = timeline?.nodes?.length ?? 0;
  const orphanCount = timeline?.orphans?.length ?? 0;

  const handleTabChange = (
    _event: React.SyntheticEvent,
    newValue: "timeline" | "orphaned",
  ): void => {
    setActiveTab(newValue);
  };

  const renderContent = (): React.ReactNode => {
    // Loading state
    if (isLoading) {
      return (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            p: 4,
          }}
        >
          <CircularProgress />
          <Typography sx={{ ml: 2 }}>
            {t("workflow.timeline.loading", "Loading timeline...")}
          </Typography>
        </Box>
      );
    }

    // Error state
    if (error) {
      return (
        <Alert severity="error" sx={{ m: 2 }}>
          {t("workflow.timeline.error", "Failed to load timeline")}:{" "}
          {String(error)}
        </Alert>
      );
    }

    // No workflow ID
    if (!workflowId) {
      return (
        <Alert severity="info" sx={{ m: 2 }}>
          {t("workflow.timeline.noWorkflowId", "No workflow ID provided")}
        </Alert>
      );
    }

    // No data
    if (!timeline) {
      return (
        <Alert severity="info" sx={{ m: 2 }}>
          {t("workflow.timeline.noData", "No timeline data available")}
        </Alert>
      );
    }

    return (
      <>
        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
          <Tabs value={activeTab} onChange={handleTabChange}>
            <Tab
              label={`${t(
                "workflow.timeline.timelineTab",
                "Timeline",
              )} (${nodeCount})`}
              value="timeline"
            />
            <Tab
              label={`${t(
                "workflow.timeline.orphanedTab",
                "Orphaned",
              )} (${orphanCount})`}
              value="orphaned"
            />
          </Tabs>
        </Box>

        {/* Timeline View */}
        {activeTab === "timeline" && (
          <Box
            sx={{
              flex: 1,
              overflowX: "auto",
              overflowY: "auto",
              p: 2,
              display: "flex",
              alignItems: "flex-end",
            }}
          >
            {timeline.nodes && timeline.nodes.length > 0 ? (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "flex-end",
                  transform: `scale(${zoom})`,
                  transformOrigin: "bottom left",
                  transition: "transform 0.2s ease-in-out",
                  flexDirection: "row-reverse",
                  height: "100%",
                }}
              >
                {timeline.nodes.map((node, index) => (
                  <WorkflowTimelineNode
                    key={node.name}
                    node={node}
                    isFirst={index === timeline.nodes!.length - 1}
                    showDebugLogs={showDebugLogs}
                  />
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("workflow.timeline.noNodes", "No workflow nodes found")}
              </Typography>
            )}
          </Box>
        )}

        {/* Orphaned View */}
        {activeTab === "orphaned" && (
          <Box sx={{ flex: 1, overflowY: "auto", p: 2 }}>
            {timeline.orphans && timeline.orphans.length > 0 ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {timeline.orphans.map((event, index) => (
                  <Paper
                    key={`orphan-${index}`}
                    variant="outlined"
                    sx={{
                      p: 1.5,
                      cursor: "pointer",
                      "&:hover": {
                        bgcolor: theme.palette.action.hover,
                      },
                    }}
                    onClick={() => handleOrphanEventClick(event)}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 0.5,
                      }}
                    >
                      <Chip
                        label={event.level?.toUpperCase() || "LOG"}
                        size="small"
                        color={
                          event.level?.toLowerCase() === "error"
                            ? "error"
                            : event.level?.toLowerCase() === "warn"
                              ? "warning"
                              : "info"
                        }
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {event.at ? new Date(event.at).toLocaleString() : ""}
                      </Typography>
                    </Box>
                    <Typography variant="body2">{event.message}</Typography>
                  </Paper>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" color="text.secondary">
                {t("workflow.timeline.noOrphans", "No orphaned events")}
              </Typography>
            )}
          </Box>
        )}

        {/* Orphan Event Details Dialog */}
        <WorkflowTimelineEventDetails
          event={selectedOrphanEvent}
          open={orphanDetailsOpen}
          onClose={handleCloseOrphanDetails}
        />
      </>
    );
  };

  const controlsBar = (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        p: 2,
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.50",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="h6">
          {t("workflow.timeline.title", "Workflow Timeline")}
        </Typography>
        {workflowId && (
          <Chip
            label={workflowId}
            size="small"
            variant="outlined"
            sx={{ fontFamily: "monospace", fontSize: "0.7rem" }}
          />
        )}
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Tooltip title={t("workflow.timeline.zoomIn", "Zoom In")}>
          <IconButton size="small" onClick={handleZoomIn}>
            <ZoomInIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t("workflow.timeline.zoomOut", "Zoom Out")}>
          <IconButton size="small" onClick={handleZoomOut}>
            <ZoomOutIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Tooltip title={t("workflow.timeline.resetZoom", "Reset Zoom")}>
          <IconButton size="small" onClick={handleResetZoom}>
            <ResetZoomIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

        <Tooltip title={t("workflow.timeline.refresh", "Refresh")}>
          <IconButton size="small" onClick={refresh} disabled={isLoading}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        {activeTab === "timeline" && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showDebugLogs}
                  onChange={(e) => setShowDebugLogs(e.target.checked)}
                />
              }
              label={
                <Typography variant="caption">
                  {t("workflow.timeline.showDebugLogs", "Debug logs")}
                </Typography>
              }
            />
          </>
        )}

        {isDialog && onClose && (
          <>
            <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        )}
      </Box>
    </Box>
  );

  // Render as dialog
  if (isDialog) {
    return (
      <Dialog
        open={true}
        onClose={onClose}
        maxWidth="xl"
        fullWidth
        sx={{
          "& .MuiDialog-paper": {
            height: "90vh",
            maxHeight: "1200px",
          },
        }}
      >
        <DialogTitle sx={{ p: 0 }}>{controlsBar}</DialogTitle>
        <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
          {renderContent()}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${theme.palette.divider}` }}>
          <Button onClick={onClose} variant="contained">
            {t("common.close", "Close")}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  // Render inline
  return (
    <Paper
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {controlsBar}
      {renderContent()}
    </Paper>
  );
};
