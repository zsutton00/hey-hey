/**
 * Workflow Timeline Node Component
 *
 * Displays a workflow node containing multiple steps with their events
 */

import React, { useState } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type {
  WorkflowTimelineNodeDto,
  WorkflowTimelineEventDto,
} from "../../api";
import { WorkflowTimelineStep } from "./WorkflowTimelineStep";
import { WorkflowTimelineEvent } from "./WorkflowTimelineEvent";
import { WorkflowTimelineEventDetails } from "./WorkflowTimelineEventDetails";

interface WorkflowTimelineNodeProps {
  /** Node data to display */
  node: WorkflowTimelineNodeDto;
  /** Whether this is the first node in the timeline */
  isFirst?: boolean;
  /** Whether to show debug level logs */
  showDebugLogs?: boolean;
}

export const WorkflowTimelineNode: React.FC<WorkflowTimelineNodeProps> = ({
  node,
  isFirst = false,
  showDebugLogs = false,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [selectedEvent, setSelectedEvent] =
    useState<WorkflowTimelineEventDto | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Filter events based on level
  const displayEvents = (node.events || []).filter((event) => {
    const level = event.level?.toLowerCase();
    if (showDebugLogs) {
      return level === "info" || level === "error" || level === "debug";
    }
    return level === "info" || level === "error";
  });

  // Calculate node time span from steps and events
  const validSteps = node.steps.filter((s) => s.startedAt);
  const validEvents = displayEvents.filter((e) => e.at);

  const stepTimes = validSteps.flatMap((s) => {
    const times = [];
    if (s.startedAt) times.push(new Date(s.startedAt).getTime());
    if (s.endedAt) times.push(new Date(s.endedAt).getTime());
    return times;
  });

  const eventTimes = validEvents.map((e) => new Date(e.at!).getTime());
  const allTimes = [...stepTimes, ...eventTimes];

  const nodeStartTime =
    allTimes.length > 0 ? Math.min(...allTimes) : Date.now();
  const nodeEndTime = allTimes.length > 0 ? Math.max(...allTimes) : Date.now();

  const nodeWidthPx = 500;
  const maxLeftPx = 300; // Leave 200px margin on right

  // Calculate event positions in pixels based on timestamp within node duration
  const calculateEventPosition = (
    eventTime: string | null | undefined
  ): number => {
    if (!eventTime) return 0;

    const eventTimestamp = new Date(eventTime).getTime();
    const nodeDuration = nodeEndTime - nodeStartTime;

    if (nodeDuration <= 0) return 0;

    const eventOffset = eventTimestamp - nodeStartTime;
    const positionPx = (eventOffset / nodeDuration) * nodeWidthPx;

    // Clamp to 0-480px
    return Math.max(0, Math.min(maxLeftPx, positionPx));
  };

  const handleEventClick = (event: WorkflowTimelineEventDto): void => {
    setSelectedEvent(event);
    setDetailsOpen(true);
  };

  const handleCloseDetails = (): void => {
    setDetailsOpen(false);
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        mr: 1,
        alignItems: "stretch",
        position: "relative",
        width: `${nodeWidthPx}px`,
      }}
    >
      {/* Node events positioned above steps */}
      {displayEvents.length > 0 && (
        <Box
          sx={{
            position: "relative",
            width: "100%",
            height: `${displayEvents.length * 20 + 10}px`,
            mb: 0.5,
          }}
        >
          {displayEvents.map((event, index) => (
            <WorkflowTimelineEvent
              key={`${node.name}-event-${index}`}
              event={event}
              onClick={() => handleEventClick(event)}
              positionPx={calculateEventPosition(event.at)}
              layer={index}
            />
          ))}
        </Box>
      )}

      {/* Steps - horizontal layout */}
      {node.steps && node.steps.length > 0 ? (
        <Box
          sx={{
            display: "flex",
            gap: 0.5,
            alignItems: "flex-end",
          }}
        >
          {node.steps.map((step) => (
            <WorkflowTimelineStep key={step.key} step={step} />
          ))}
        </Box>
      ) : null}

      {/* Node label at bottom */}
      <Box
        sx={{
          bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.100",
          p: 1,
          borderTop: `2px solid ${theme.palette.divider}`,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          justifyContent: "center",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            fontFamily: "monospace",
            color: theme.palette.text.primary,
          }}
        >
          {node.name}
        </Typography>
        {isFirst && (
          <Chip
            label={t("workflow.timeline.firstNode", "Start")}
            size="small"
            color="primary"
            sx={{ height: 16, fontSize: "0.65rem" }}
          />
        )}
      </Box>

      {/* Event details dialog */}
      <WorkflowTimelineEventDetails
        event={selectedEvent}
        open={detailsOpen}
        onClose={handleCloseDetails}
      />
    </Box>
  );
};
