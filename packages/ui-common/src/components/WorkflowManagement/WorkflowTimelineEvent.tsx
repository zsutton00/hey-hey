/**
 * Workflow Timeline Event Component
 *
 * Displays a single event marker on the timeline positioned above its step
 */

import React from "react";
import { Box, Typography, Tooltip } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useTheme } from "@mui/material/styles";
import type { WorkflowTimelineEventDto } from "../../api";

interface WorkflowTimelineEventProps {
  /** Event data to display */
  event: WorkflowTimelineEventDto;
  /** Callback when event is clicked */
  onClick: () => void;
  /** Horizontal position in pixels within the node */
  positionPx?: number;
  /** Vertical layer index (0 = bottom) */
  layer?: number;
}

/**
 * Get color for event level
 */
const getEventLevelColor = (
  level: string | null | undefined,
  theme: Theme
): string => {
  switch (level?.toLowerCase()) {
    case "error":
      return theme.palette.error.main;
    case "warn":
    case "warning":
      return theme.palette.warning.main;
    case "info":
      return theme.palette.info.main;
    case "debug":
      return theme.palette.grey[500];
    default:
      return theme.palette.text.secondary;
  }
};

/**
 * Format timestamp for display
 */
const formatEventTime = (timestamp: string | null | undefined): string => {
  if (!timestamp) return "";

  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
};

export const WorkflowTimelineEvent: React.FC<WorkflowTimelineEventProps> = ({
  event,
  onClick,
  positionPx = 0,
  layer = 0,
}) => {
  const theme = useTheme();
  const eventColor = getEventLevelColor(event.level, theme);
  const formattedTime = formatEventTime(event.at);

  // Truncate message to 50 characters
  const displayMessage =
    event.message && event.message.length > 50
      ? `${event.message.substring(0, 47)}...`
      : event.message || "";

  const eventHeight = 18;
  const eventSpacing = 2;
  // Calculate vertical position based on layer with no overlap
  const bottomPosition = layer * (eventHeight + eventSpacing);

  return (
    <Tooltip
      title={
        <>
          <Box sx={{ fontWeight: 600, mb: 0.5 }}>
            {event.level?.toUpperCase() || "LOG"}
          </Box>
          <Box sx={{ fontSize: "0.75rem", mb: 0.5 }}>{formattedTime}</Box>
          <Box sx={{ fontSize: "0.85rem" }}>{event.message}</Box>
        </>
      }
      arrow
      placement="top"
    >
      <Box
        onClick={onClick}
        sx={{
          position: "absolute",
          left: `${positionPx}px`,
          bottom: `${bottomPosition}px`,
          height: `${eventHeight}px`,
          cursor: "pointer",
          bgcolor: eventColor,
          color: "white",
          px: 0.5,
          py: 0.25,
          borderRadius: 0.5,
          border: `1px solid ${theme.palette.divider}`,
          maxWidth: "200px",
          display: "flex",
          alignItems: "center",
          "&:hover": {
            opacity: 0.9,
          },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: "0.65rem",
            fontWeight: 500,
            lineHeight: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayMessage}
        </Typography>
      </Box>
    </Tooltip>
  );
};
