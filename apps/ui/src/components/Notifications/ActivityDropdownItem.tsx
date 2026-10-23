import { EntityIcon } from "@hey-hey/ui-common/components";
import { useCorrelatedActivity } from "@hey-hey/ui-common/data";
import { Box, Chip, Paper, Stack, Typography } from "@mui/material";
import { formatDistanceToNow } from "date-fns";
import React from "react";

export interface ActivityDropdownItemProps {
  activity: ReturnType<typeof useCorrelatedActivity>["records"][number];
  onClick: () => void;
}

const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  AGENT_SESSION_COMPLETED: "Session Completed",
  NOTIFICATION: "Notification",
  UNBLOCKED: "Unblocked",
  VIEWED: "Viewed",
};

const SOURCE_LABELS: Record<string, string> = {
  ATTENTION_EVENT: "Attention",
  AGENT_SESSION: "Agent Session",
  REPORT: "Report",
  SYSTEM: "System",
  TASK_RELATIONSHIP: "Task Relationship",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  BACKLOG: "Backlog",
  BLOCKED: "Blocked",
  DONE: "Done",
  IN_PROGRESS: "In Progress",
  REVIEW: "Review",
  VERIFYING: "Verifying",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number(value);
    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
};

const formatDurationMs = (durationMs: number): string => {
  if (durationMs < 60000) {
    return `${Math.max(1, Math.round(durationMs / 1000))}s`;
  }

  if (durationMs < 3600000) {
    return `${Math.round(durationMs / 60000)}m`;
  }

  const hours = Math.floor(durationMs / 3600000);
  const minutes = Math.round((durationMs % 3600000) / 60000);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
};

const getDurationLabel = (
  activity: ReturnType<typeof useCorrelatedActivity>["records"][number],
): string | null => {
  if (!("metadata" in activity) || !isRecord(activity.metadata)) {
    return null;
  }

  const durationMs = toNumber(activity.metadata.durationMs);
  if (durationMs !== null && durationMs > 0) {
    return `Duration ${formatDurationMs(durationMs)}`;
  }

  const duration = toNumber(activity.metadata.duration);
  if (duration !== null && duration > 0) {
    const normalizedDurationMs = duration >= 1000 ? duration : duration * 1000;
    return `Duration ${formatDurationMs(normalizedDurationMs)}`;
  }

  return null;
};

const getTimeContextLabel = (timestamp: string): string => {
  const parsedDate = new Date(timestamp);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Time unavailable";
  }

  return formatDistanceToNow(parsedDate, { addSuffix: true });
};

const humanizeLabel = (value: string): string =>
  value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());

const getActivityTypeLabel = (
  activity: ReturnType<typeof useCorrelatedActivity>["records"][number],
): string => {
  if (activity.kind === "recent") {
    return humanizeLabel(activity.entityType);
  }

  return ACTIVITY_TYPE_LABELS[activity.activityType] ?? activity.activityType;
};

const getSecondaryLabel = (
  activity: ReturnType<typeof useCorrelatedActivity>["records"][number],
): string | null => {
  if (activity.kind === "recent") {
    if (activity.status) {
      return STATUS_LABELS[activity.status] ?? humanizeLabel(activity.status);
    }

    return humanizeLabel(activity.mode);
  }

  return SOURCE_LABELS[activity.source] ?? activity.source;
};

const getLinkedEntityLabel = (
  activity: ReturnType<typeof useCorrelatedActivity>["records"][number],
): string => {
  if (activity.linkedEntities.length === 0) {
    return "Linked entities: none";
  }

  const linkedEntityTitles = activity.linkedEntities
    .map((entity) => entity.title.trim())
    .filter((title) => title.length > 0);

  if (linkedEntityTitles.length === 0) {
    return `Linked entities: ${activity.linkedEntities.length}`;
  }

  const visibleTitles = linkedEntityTitles.slice(0, 2).join(", ");
  const remainingCount = linkedEntityTitles.length - 2;
  if (remainingCount > 0) {
    return `Linked entities: ${visibleTitles} +${remainingCount}`;
  }

  return `Linked entities: ${visibleTitles}`;
};

const getReportTitle = (
  activity: ReturnType<typeof useCorrelatedActivity>["records"][number],
): string | null => {
  const title = activity.reports[0]?.title?.trim();
  return title && title.length > 0 ? title : null;
};

export const ActivityDropdownItem: React.FC<ActivityDropdownItemProps> = ({
  activity,
  onClick,
}) => {
  const reportTitle = getReportTitle(activity);
  const timeContextLabel = getTimeContextLabel(activity.timestamp);
  const durationLabel = getDurationLabel(activity);
  const activityTypeLabel = getActivityTypeLabel(activity);
  const secondaryLabel = getSecondaryLabel(activity);

  return (
    <Paper
      aria-label="Open activity"
      data-testid={`activity-item-card-${activity.activityId}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      role="link"
      sx={{
        cursor: "pointer",
        p: 1.25,
        "&:hover": {
          backgroundColor: "action.hover",
          borderColor: "primary.main",
        },
      }}
      tabIndex={0}
      variant="outlined"
    >
      <Stack spacing={0.75}>
        <Stack alignItems="center" direction="row" spacing={1}>
          <Box
            sx={{
              alignItems: "center",
              color: "text.secondary",
              display: "flex",
              flexShrink: 0,
            }}
          >
            <EntityIcon entityType={activity.entityType} size={16} />
          </Box>
          <Typography
            data-testid={`activity-dropdown-title-${activity.activityId}`}
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            variant="body2"
          >
            {activity.title}
          </Typography>
        </Stack>

        <Stack direction="row" flexWrap="wrap" gap={0.5}>
          <Chip
            data-testid={`activity-dropdown-type-${activity.activityId}`}
            label={activityTypeLabel}
            size="small"
            variant="outlined"
          />
          {secondaryLabel ? (
            <Chip label={secondaryLabel} size="small" variant="outlined" />
          ) : null}
          <Chip label={timeContextLabel} size="small" variant="outlined" />
          {durationLabel ? (
            <Chip label={durationLabel} size="small" variant="outlined" />
          ) : null}
        </Stack>

        <Typography
          color="text.secondary"
          sx={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          variant="caption"
        >
          {getLinkedEntityLabel(activity)}
        </Typography>

        {reportTitle ? (
          <Typography
            color="text.secondary"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            variant="caption"
          >
            Report: {reportTitle}
          </Typography>
        ) : null}
      </Stack>
    </Paper>
  );
};
