import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";
import RemoveRoadOutlinedIcon from "@mui/icons-material/RemoveRoadOutlined";
import TaskAltOutlinedIcon from "@mui/icons-material/TaskAltOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { EntityIcon } from "@hey-hey/ui-common/components";
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import React from "react";
import type { NotificationAlertItem } from "../../hooks/useProjectNotificationActivity";

export interface NotificationAlertProps {
  item: NotificationAlertItem;
  onDismiss?: (notificationId: string) => void;
  onNavigateFullActivity?: (activityId: string) => void;
}

const normalizePreviewText = (item: NotificationAlertItem): string => {
  if (
    item.activity.kind === "entity" &&
    item.activity.activityType === "VIEWED" &&
    item.activity.source === "ATTENTION_EVENT"
  ) {
    return "Recently viewed";
  }

  const normalizedPreview = item.activity.previewText.trim();
  if (normalizedPreview.toLowerCase() === "viewed from attention") {
    return "Recently viewed";
  }

  return normalizedPreview;
};

const toActivityTitle = (item: NotificationAlertItem): string => {
  const previewText = normalizePreviewText(item);
  if (previewText.length > 0) {
    return previewText;
  }

  return "Activity update";
};

const toActivityIcon = (
  item: NotificationAlertItem,
): React.ReactNode => {
  if (item.activity.kind !== "entity") {
    return <NotificationsNoneOutlinedIcon fontSize="small" />;
  }

  switch (item.activity.activityType) {
    case "VIEWED":
      return <VisibilityOutlinedIcon fontSize="small" />;
    case "UNBLOCKED":
      return <RemoveRoadOutlinedIcon fontSize="small" />;
    case "AGENT_SESSION_COMPLETED":
      return <TaskAltOutlinedIcon fontSize="small" />;
    case "NOTIFICATION":
    default:
      return <NotificationsNoneOutlinedIcon fontSize="small" />;
  }
};

const toUniqueLinkedEntityTypes = (
  item: NotificationAlertItem,
): NotificationAlertItem["activity"]["linkedEntities"][number]["entityType"][] => {
  return [...new Set(item.activity.linkedEntities.map((entity) => entity.entityType))];
};

export const NotificationAlert: React.FC<NotificationAlertProps> = ({
  item,
  onDismiss,
  onNavigateFullActivity,
}) => {
  const { notificationId } = item;
  const hasReports = item.activity.reports.length > 0 || Boolean(item.reportId);
  const linkedEntityTypes = toUniqueLinkedEntityTypes(item);
  const showActions = Boolean(notificationId);
  const title = toActivityTitle(item);
  const previewText = normalizePreviewText(item);
  const showPreviewText =
    previewText.length > 0 && previewText.toLowerCase() !== title.toLowerCase();

  const handleNavigate = (): void => {
    onNavigateFullActivity?.(item.activity.activityId);
  };

  return (
    <Paper
      aria-label={onNavigateFullActivity ? "Open activity" : undefined}
      data-testid={`notification-alert-${item.activity.activityId}`}
      onClick={onNavigateFullActivity ? handleNavigate : undefined}
      onKeyDown={
        onNavigateFullActivity
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleNavigate();
              }
            }
          : undefined
      }
      role={onNavigateFullActivity ? "link" : undefined}
      sx={{
        p: 1.5,
        cursor: onNavigateFullActivity ? "pointer" : "default",
        "&:hover": onNavigateFullActivity
          ? {
              borderColor: "primary.main",
              backgroundColor: "action.hover",
            }
          : undefined,
      }}
      tabIndex={onNavigateFullActivity ? 0 : undefined}
      variant="outlined"
    >
      <Stack spacing={1.25}>
        <Stack alignItems="center" direction="row" spacing={1}>
          <Box
            sx={{
              alignItems: "center",
              color: "text.secondary",
              display: "flex",
              flexShrink: 0,
            }}
          >
            {toActivityIcon(item)}
          </Box>

          <Typography
            data-testid={`notification-alert-title-${item.activity.activityId}`}
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            variant="subtitle2"
          >
            {title}
          </Typography>

          <Stack alignItems="center" direction="row" spacing={0.5}>
            {hasReports ? (
              <DescriptionOutlinedIcon
                data-testid={`notification-alert-report-icon-${item.activity.activityId}`}
                fontSize="small"
                sx={{ color: "text.secondary" }}
              />
            ) : null}
            {linkedEntityTypes.map((entityType) => (
              <Box
                data-testid={`notification-alert-linked-entity-icon-${item.activity.activityId}-${entityType}`}
                key={entityType}
                sx={{ alignItems: "center", display: "flex" }}
              >
                <EntityIcon entityType={entityType} size={16} />
              </Box>
            ))}
          </Stack>
        </Stack>

        {showPreviewText ? (
          <Typography
            color="text.secondary"
            sx={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            variant="body2"
          >
            {previewText}
          </Typography>
        ) : null}

        {showActions ? (
          <Stack alignItems="center" direction="row" spacing={1}>
            {notificationId ? (
              <Button
                onClick={(event) => {
                  event.stopPropagation();
                  onDismiss?.(notificationId);
                }}
                size="small"
                variant="text"
              >
                Dismiss
              </Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
};
