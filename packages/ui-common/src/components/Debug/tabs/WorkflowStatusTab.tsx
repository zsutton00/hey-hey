/**
 * Workflow Status Tab Component
 * Displays workflow monitoring and debugging information
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  Box,
  Typography,
  Chip,
  IconButton,
  Divider,
  Stack,
  CircularProgress,
} from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import RefreshIcon from "@mui/icons-material/Refresh";
import ViewLogsIcon from "@mui/icons-material/Visibility";
import TimelineIcon from "@mui/icons-material/Timeline";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { useWorkflowStatusMonitoring } from "../../../hooks/useWorkflowStatusMonitoring";
import type { WorkflowStatusTabProps } from "../types/debugTypes";
import { WorkflowTimelineViewer } from "../../WorkflowManagement/WorkflowTimelineViewer";

const getStatusColor = (
  status: string
): "success" | "error" | "primary" | "warning" | "default" => {
  switch (status?.toLowerCase()) {
    case "completed":
      return "success";
    case "failed":
    case "error":
      return "error";
    case "running":
    case "active":
      return "primary";
    case "paused":
      return "warning";
    default:
      return "default";
  }
};

const formatDuration = (ms: number): string => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

export const WorkflowStatusTab: React.FC<WorkflowStatusTabProps> = ({
  workflowId,
  organizationId: _organizationId,
  updateInterval = 1000,
  visible = true,
  enabledTabs = ["workflow"],
  onViewLogs,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const [stableWorkflowId, setStableWorkflowId] = useState("");

  // Internal state for pause/resume
  const [isPaused, setIsPaused] = useState(false);

  // Timeline viewer state
  const [showTimeline, setShowTimeline] = useState(false);

  useEffect(() => {
    if (workflowId && workflowId !== stableWorkflowId) {
      setStableWorkflowId(workflowId);
    }
  }, [workflowId, stableWorkflowId]);

  // Workflow status monitoring hook
  const {
    status: workflowStatus,
    isLoading,
    error,
    lastUpdate,
    refresh: refreshWorkflow,
    fetchLogs: _fetchLogs,
  } = useWorkflowStatusMonitoring({
    workflowId,
    pollingInterval: isPaused ? 0 : updateInterval,
    enabled:
      visible &&
      !!stableWorkflowId &&
      !isPaused &&
      enabledTabs.includes("workflow"),
  });

  // Event handlers
  const handlePause = useCallback(() => {
    setIsPaused(true);
  }, []);

  const handleResume = useCallback(() => {
    setIsPaused(false);
  }, []);

  const handleRefresh = useCallback(() => {
    refreshWorkflow();
  }, [refreshWorkflow]);

  const handleViewTimeline = useCallback(() => {
    setShowTimeline(true);
  }, []);

  const handleCloseTimeline = useCallback(() => {
    setShowTimeline(false);
  }, []);

  // Error state
  if (error) {
    return (
      <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
        <Typography variant="body2" color="error">
          {t("debug.error", "Error")}: {error}
        </Typography>
      </Box>
    );
  }

  // Invalid workflow ID state
  if (/(mock)/.test(stableWorkflowId)) {
    return (
      <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
        <Typography variant="body2" color="text.secondary">
          {t(
            "debug.mockWorkflowId",
            "Mock workflow ID detected - monitoring disabled"
          )}
        </Typography>
      </Box>
    );
  }

  // Loading state
  if (isLoading && !workflowStatus) {
    return (
      <Box
        sx={{
          p: 2,
          height: "100%",
          overflow: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            {t("debug.loading", "Loading...")}
          </Typography>
        </Box>
      </Box>
    );
  }

  // No workflow data state
  if (!workflowStatus) {
    return (
      <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
        <Typography variant="body2" color="text.secondary">
          {isPaused
            ? t("debug.pausedNoData", "Monitoring paused - no data available")
            : t("debug.noData", "No workflow data available")}
        </Typography>
      </Box>
    );
  }

  // Main content
  return (
    <Box sx={{ height: "100%", overflow: "auto" }}>
      <Stack spacing={2} sx={{ p: 2 }}>
        {/* Status Overview */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t("debug.status", "Status")}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Chip
              label={workflowStatus.status.toUpperCase()}
              size="small"
              color={getStatusColor(workflowStatus.status)}
              sx={{ fontWeight: 600 }}
            />
            {workflowStatus.currentStep && (
              <Typography variant="body2" color="text.secondary">
                {workflowStatus.currentStep}
              </Typography>
            )}
          </Box>

          {/* Workflow ID */}
          <Typography
            variant="body2"
            sx={{
              fontFamily: "monospace",
              fontSize: "0.75rem",
              mt: 1,
              wordBreak: "break-all",
            }}
          >
            ID: {workflowStatus.workflowId}
          </Typography>
        </Box>

        <Divider />

        {/* Current Step Details */}
        {workflowStatus.stepDetails && (
          <>
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t("debug.currentStep", "Current Step Details")}
              </Typography>
              <Stack spacing={1}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Step:
                  </Typography>
                  <Typography variant="body2">
                    {workflowStatus.stepDetails.step}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Phase:
                  </Typography>
                  <Typography variant="body2">
                    {workflowStatus.stepDetails.phase}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Current Node:
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.85rem",
                    }}
                  >
                    {workflowStatus.stepDetails.currentNodeId}
                  </Typography>
                </Box>

                {workflowStatus.stepDetails.pathTaken.length > 0 && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Path Taken:
                    </Typography>
                    <Box
                      sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 0.5,
                        mt: 0.5,
                      }}
                    >
                      {workflowStatus.stepDetails.pathTaken.map(
                        (step: string, index: number) => (
                          <Chip
                            key={index}
                            label={step}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: "0.7rem" }}
                          />
                        )
                      )}
                    </Box>
                  </Box>
                )}

                <Box sx={{ display: "flex", gap: 2 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Complete:
                    </Typography>
                    <Typography variant="body2">
                      {workflowStatus.stepDetails.isComplete ? "Yes" : "No"}
                    </Typography>
                  </Box>

                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Iterations:
                    </Typography>
                    <Typography variant="body2">
                      {workflowStatus.stepDetails.iterations}
                    </Typography>
                  </Box>
                </Box>
              </Stack>
            </Box>

            <Divider />
          </>
        )}

        {/* Controls */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t("debug.controls", "Controls")}
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <IconButton
              size="small"
              onClick={isPaused ? handleResume : handlePause}
              sx={{
                color: isPaused ? theme.palette.warning.main : "inherit",
              }}
              title={
                isPaused
                  ? t("debug.resume", "Resume monitoring")
                  : t("debug.pause", "Pause monitoring")
              }
            >
              {isPaused ? <PlayIcon /> : <PauseIcon />}
            </IconButton>

            <IconButton
              size="small"
              onClick={handleRefresh}
              disabled={isLoading}
              title={t("debug.refresh", "Refresh now")}
            >
              <RefreshIcon />
            </IconButton>

            <IconButton
              size="small"
              onClick={onViewLogs}
              title={t("debug.showLogs", "Show Logs")}
            >
              <ViewLogsIcon />
            </IconButton>

            <IconButton
              size="small"
              onClick={handleViewTimeline}
              title={t("workflow.timeline.viewTimeline", "View Timeline")}
            >
              <TimelineIcon />
            </IconButton>

            {isPaused && (
              <Chip
                label={t("debug.paused", "PAUSED")}
                size="small"
                color="warning"
                sx={{ ml: 1, height: 24, fontSize: "0.75rem", fontWeight: 600 }}
              />
            )}
          </Box>
        </Box>

        {/* Timing */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {t("debug.timing", "Timing")}
          </Typography>
          {workflowStatus.startedAt && (
            <Typography variant="body2" color="text.secondary">
              {t("debug.duration", "Duration")}:{" "}
              {formatDuration(
                Date.now() - new Date(workflowStatus.startedAt).getTime()
              )}
            </Typography>
          )}
          {lastUpdate && (
            <Typography variant="body2" color="text.secondary">
              {t("debug.lastUpdate", "Last update")}:{" "}
              {lastUpdate.toLocaleTimeString()}
              {isPaused && (
                <Typography
                  component="span"
                  variant="body2"
                  color="warning.main"
                  sx={{ ml: 1 }}
                >
                  ({t("debug.pausedNote", "monitoring paused")})
                </Typography>
              )}
            </Typography>
          )}
        </Box>

        {/* Workflow Details */}
        {workflowStatus.metadata && (
          <>
            <Divider />
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {t("debug.details", "Workflow Details")}
              </Typography>
              <Stack spacing={1}>
                {Boolean(workflowStatus.metadata.runId) && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Run ID:
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                      }}
                    >
                      {String(workflowStatus.metadata.runId)}
                    </Typography>
                  </Box>
                )}

                {Boolean(workflowStatus.metadata.taskQueue) && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Task Queue:
                    </Typography>
                    <Typography variant="body2">
                      {String(workflowStatus.metadata.taskQueue)}
                    </Typography>
                  </Box>
                )}

                {Boolean(workflowStatus.metadata.conversationId) && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Conversation ID:
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                      }}
                    >
                      {String(workflowStatus.metadata.conversationId)}
                    </Typography>
                  </Box>
                )}

                {Boolean(workflowStatus.metadata.projectId) && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Project ID:
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                      }}
                    >
                      {String(workflowStatus.metadata.projectId)}
                    </Typography>
                  </Box>
                )}

                {Boolean(workflowStatus.metadata.debugInfo) && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      Debug Info:
                    </Typography>
                    <Typography
                      variant="body2"
                      component="pre"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.7rem",
                        whiteSpace: "pre-wrap",
                        backgroundColor:
                          theme.palette.mode === "dark"
                            ? "grey.800"
                            : "grey.100",
                        p: 1,
                        borderRadius: 1,
                        mt: 0.5,
                        overflow: "auto",
                        maxHeight: 200,
                      }}
                    >
                      {JSON.stringify(
                        workflowStatus.metadata.debugInfo,
                        null,
                        2
                      )}
                    </Typography>
                  </Box>
                )}
              </Stack>
            </Box>
          </>
        )}

        {/* Error Display */}
        {workflowStatus.error && (
          <>
            <Divider />
            <Box>
              <Typography variant="subtitle2" gutterBottom color="error">
                {t("debug.error", "Error")}
              </Typography>
              <Typography variant="body2" color="error">
                {workflowStatus.error}
              </Typography>
            </Box>
          </>
        )}
      </Stack>

      {/* Timeline Viewer Dialog */}
      {showTimeline && (
        <WorkflowTimelineViewer
          workflowId={stableWorkflowId}
          isDialog={true}
          onClose={handleCloseTimeline}
        />
      )}
    </Box>
  );
};
