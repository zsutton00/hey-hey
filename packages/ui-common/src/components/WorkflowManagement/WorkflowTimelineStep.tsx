/**
 * Workflow Timeline Step Component
 *
 * Displays a single workflow step bar
 */

import React from "react";
import { Box, Typography, Tooltip } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type { WorkflowTimelineStepDto } from "../../api";

interface WorkflowTimelineStepProps {
  /** Step data to display */
  step: WorkflowTimelineStepDto;
  /** Minimum width for the step bar in pixels */
  minWidth?: number;
}

/**
 * Get color for step status
 */
const getStepStatusColor = (status: string, theme: Theme): string => {
  switch (status) {
    case "COMPLETED":
      return theme.palette.success.main;
    case "FAILED":
      return theme.palette.error.main;
    case "IN_PROGRESS":
      return theme.palette.primary.main;
    default:
      return theme.palette.grey[500];
  }
};

/**
 * Format duration for display
 */
const formatDuration = (durationMs: number | null | undefined): string => {
  if (!durationMs) return "N/A";

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds.toFixed(1)}s`;
};

export const WorkflowTimelineStep: React.FC<WorkflowTimelineStepProps> = ({
  step,
  minWidth = 100,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const stepColor = getStepStatusColor(step.status, theme);
  const formattedDuration = formatDuration(step.durationMs);

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position: "relative",
        width: `${minWidth}px`,
        flex: 1,
      }}
    >
      {/* Step bar */}
      <Tooltip
        title={
          <Box>
            <Box sx={{ fontWeight: 600, mb: 0.5 }}>
              {step.name}
              {step.iteration !== null &&
                step.iteration !== undefined &&
                ` (iteration ${step.iteration})`}
            </Box>
            <Box sx={{ fontSize: "0.75rem", mb: 0.5 }}>
              {t("workflow.timeline.status", "Status")}: {step.status}
            </Box>
            <Box sx={{ fontSize: "0.75rem", mb: 0.5 }}>
              {t("workflow.timeline.duration", "Duration")}: {formattedDuration}
            </Box>
            {step.startedAt && (
              <Box sx={{ fontSize: "0.75rem" }}>
                {t("workflow.timeline.started", "Started")}:{" "}
                {new Date(step.startedAt).toLocaleTimeString()}
              </Box>
            )}
            {step.endedAt && (
              <Box sx={{ fontSize: "0.75rem" }}>
                {t("workflow.timeline.ended", "Ended")}:{" "}
                {new Date(step.endedAt).toLocaleTimeString()}
              </Box>
            )}
            {step.events.length > 0 && (
              <Box sx={{ fontSize: "0.75rem", mt: 0.5 }}>
                {step.events.length}{" "}
                {step.events.length === 1
                  ? t("workflow.timeline.event", "event")
                  : t("workflow.timeline.events", "events")}
              </Box>
            )}
          </Box>
        }
        arrow
        placement="bottom"
      >
        <Box
          sx={{
            width: "100%",
            height: "40px",
            bgcolor: stepColor,
            borderRadius: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            cursor: "pointer",
            opacity: 0.8,
            transition: "opacity 0.2s ease-in-out",
            "&:hover": {
              opacity: 1,
              boxShadow: theme.shadows[4],
            },
            border: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "white",
              fontWeight: 600,
              textAlign: "center",
              px: 1,
              fontSize: "0.7rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              width: "100%",
            }}
          >
            {step.name}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: "white",
              fontSize: "0.65rem",
              opacity: 0.9,
            }}
          >
            {formattedDuration}
          </Typography>
        </Box>
      </Tooltip>
    </Box>
  );
};
