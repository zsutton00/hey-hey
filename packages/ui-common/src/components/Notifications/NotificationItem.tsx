import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ArticleIcon from "@mui/icons-material/Article";
import ChecklistIcon from "@mui/icons-material/Checklist";
import CodeIcon from "@mui/icons-material/Code";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import type { SvgIconComponent } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  ListItem,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ReportType } from "../../api";
import { usePathService } from "../../contexts/PathServiceContext";
import type { NotificationRecord } from "../../data/collections/notifications";
import { getReadStatusLabel } from "../../data/hooks/useNotifications";

const SESSION_REPORT_READY_ICON: Partial<Record<ReportType, SvgIconComponent>> =
  {
    IMPLEMENT: CodeIcon,
    COMMIT: CodeIcon,
    PLAN: ChecklistIcon,
    VALIDATION_WALKTHROUGH: FactCheckIcon,
    FEATURE_SYNC: AccountTreeIcon,
    FEATURE_SYNC_HANDOFF: AccountTreeIcon,
    FEATURE_TREE_ANALYSIS: AccountTreeIcon,
  };

const formatTimestamp = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

export interface NotificationItemProps {
  notification: NotificationRecord;
  onAcknowledge: (notificationId: string) => void;
  isUpdating?: boolean;
  /**
   * When provided, session_report_ready rows render a Preview button at the
   * bottom that calls back with the session id instead of navigating.
   */
  onPreview?: (sessionId: string) => void;
  /**
   * When provided, a "Show tab" button is rendered alongside Preview, calling
   * back to signal the already-open tab to highlight itself.
   */
  onShowTab?: () => void;
  onOpenPullRequest?: (url: string) => void;
  onOpenTask?: (taskId: string) => void;
}

const getStatusChipProps = (
  notification: NotificationRecord
): {
  color: "primary" | "info" | "default";
  label: string;
  variant: "filled" | "outlined";
} => {
  const label = getReadStatusLabel(notification.status);

  if (!notification.isRead) {
    return { color: "primary", label, variant: "filled" };
  }

  if (!notification.isAcknowledged) {
    return { color: "info", label, variant: "outlined" };
  }

  return { color: "default", label, variant: "outlined" };
};

const getTitleFontWeight = (notification: NotificationRecord): number => {
  if (notification.isAcknowledged) {
    return 400;
  }
  return 600;
};

const getItemOpacity = (notification: NotificationRecord): number => {
  if (notification.isAcknowledged) {
    return 0.7;
  }
  return 1;
};

interface SessionReportReadyRowProps {
  notification: NotificationRecord;
  chipProps: ReturnType<typeof getStatusChipProps>;
  reportType: ReportType;
}

const SessionReportReadyRow: React.FC<SessionReportReadyRowProps> = ({
  notification,
  chipProps,
  reportType,
}) => {
  const LeadingIcon = SESSION_REPORT_READY_ICON[reportType] ?? ArticleIcon;

  return (
    <ListItemText
      primaryTypographyProps={{ component: "div" }}
      secondaryTypographyProps={{ component: "div" }}
      primary={
        <Stack alignItems="center" direction="row" spacing={1}>
          <LeadingIcon
            color="primary"
            data-testid={`notification-item-icon-${notification.notificationId}`}
            fontSize="small"
          />
          <Typography
            data-testid={`notification-item-title-${notification.notificationId}`}
            sx={{ fontWeight: getTitleFontWeight(notification), flexGrow: 1 }}
            variant="subtitle1"
          >
            {notification.preview.title}
          </Typography>
          <Chip
            color={chipProps.color}
            data-testid={`notification-item-status-${notification.notificationId}`}
            label={chipProps.label}
            size="small"
            variant={chipProps.variant}
          />
        </Stack>
      }
      secondary={
        <Stack spacing={0.5} sx={{ pl: 4 }}>
          <Typography
            color="text.secondary"
            data-testid={`notification-item-summary-${notification.notificationId}`}
            variant="body2"
          >
            {notification.preview.summary}
          </Typography>
          <Typography
            color="text.secondary"
            data-testid={`notification-item-created-at-${notification.notificationId}`}
            variant="caption"
          >
            {formatTimestamp(notification.createdAt)}
          </Typography>
        </Stack>
      }
    />
  );
};

const PullRequestMergedRow: React.FC<GenericRowProps> = ({
  notification,
  chipProps,
}) => {
  if (notification.source.eventType !== "pull_request.merged") {
    return null;
  }

  const { actorLogin, mergedAt } = notification.source.payload;

  return (
    <ListItemText
      primaryTypographyProps={{ component: "div" }}
      secondaryTypographyProps={{ component: "div" }}
      primary={
        <Stack alignItems="center" direction="row" spacing={1}>
          <CallMergeIcon
            color="primary"
            data-testid={`notification-item-icon-${notification.notificationId}`}
            fontSize="small"
          />
          <Typography
            data-testid={`notification-item-title-${notification.notificationId}`}
            sx={{ fontWeight: getTitleFontWeight(notification), flexGrow: 1 }}
            variant="subtitle1"
          >
            {notification.preview.title}
          </Typography>
          <Chip
            color={chipProps.color}
            data-testid={`notification-item-status-${notification.notificationId}`}
            label={chipProps.label}
            size="small"
            variant={chipProps.variant}
          />
        </Stack>
      }
      secondary={
        <Stack spacing={0.5} sx={{ pl: 4 }}>
          <Typography
            color="text.secondary"
            data-testid={`notification-item-summary-${notification.notificationId}`}
            variant="body2"
          >
            {notification.preview.summary}
          </Typography>
          <Typography
            color="text.secondary"
            data-testid={`notification-item-merge-context-${notification.notificationId}`}
            variant="caption"
          >
            {`Merged by @${actorLogin} · ${formatTimestamp(mergedAt)}`}
          </Typography>
        </Stack>
      }
    />
  );
};

interface GenericRowProps {
  notification: NotificationRecord;
  chipProps: ReturnType<typeof getStatusChipProps>;
}

const GenericRow: React.FC<GenericRowProps> = ({ notification, chipProps }) => (
  <ListItemText
    primaryTypographyProps={{ component: "div" }}
    secondaryTypographyProps={{ component: "div" }}
    primary={
      <Stack alignItems="center" direction="row" spacing={1}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: notification.isRead
              ? "transparent"
              : "primary.main",
            flexShrink: 0,
          }}
        />
        <Typography
          data-testid={`notification-item-title-${notification.notificationId}`}
          sx={{ fontWeight: getTitleFontWeight(notification) }}
          variant="body1"
        >
          {notification.preview.title}
        </Typography>
        <Chip
          color={chipProps.color}
          data-testid={`notification-item-status-${notification.notificationId}`}
          label={chipProps.label}
          size="small"
          variant={chipProps.variant}
        />
      </Stack>
    }
    secondary={
      <Stack spacing={0.5} sx={{ pl: 2 }}>
        <Typography
          color="text.secondary"
          data-testid={`notification-item-summary-${notification.notificationId}`}
          variant="body2"
          sx={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {notification.preview.summary}
        </Typography>
        <Typography
          color="text.secondary"
          data-testid={`notification-item-created-at-${notification.notificationId}`}
          variant="caption"
        >
          {formatTimestamp(notification.createdAt)}
        </Typography>
      </Stack>
    }
  />
);

export const NotificationItem: React.FC<NotificationItemProps> = ({
  notification,
  onAcknowledge,
  isUpdating = false,
  onPreview,
  onShowTab,
  onOpenPullRequest,
  onOpenTask,
}) => {
  const chipProps = getStatusChipProps(notification);
  const location = useLocation();
  const navigate = useNavigate();
  const pathService = usePathService();

  const isSessionReportReady =
    notification.source.eventType === "session_report_ready";
  const showPreview = isSessionReportReady && Boolean(onPreview);
  const isPullRequestMerged =
    notification.source.eventType === "pull_request.merged";

  const handleClick = (): void => {
    if (isUpdating) {
      return;
    }
    onAcknowledge(notification.notificationId);

    if (notification.source.eventType === "session_report_ready") {
      const projectId = pathService.extractProjectId(location.pathname) ?? "";
      navigate(
        pathService.agentSession({
          projectId,
          agentSessionId: notification.source.payload.sessionId,
        })
      );
    }
  };

  const handlePreviewClick = (): void => {
    if (
      isUpdating ||
      !onPreview ||
      notification.source.eventType !== "session_report_ready"
    ) {
      return;
    }
    onPreview(notification.source.payload.sessionId);
  };

  const handleOpenPullRequest = (): void => {
    if (isUpdating || notification.source.eventType !== "pull_request.merged") {
      return;
    }
    const url = notification.source.payload.pullRequestUrl;
    if (onOpenPullRequest) {
      onOpenPullRequest(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleOpenTask = (): void => {
    if (isUpdating || notification.source.eventType !== "pull_request.merged") {
      return;
    }
    const taskId = notification.source.payload.taskId;
    if (!taskId) {
      return;
    }
    if (onOpenTask) {
      onOpenTask(taskId);
      return;
    }
    const projectId = notification.source.affectedEntities.find(
      (entity) => entity.type === "PROJECT"
    )?.id;
    if (projectId) {
      navigate(pathService.task({ projectId, taskId }));
    }
  };

  return (
    <ListItem
      data-testid={`notification-item-${notification.notificationId}`}
      disableGutters
      disablePadding
      divider
    >
      <Stack direction="column" width="100%">
        <ListItemButton
          data-testid={`notification-item-button-${notification.notificationId}`}
          disabled={isUpdating}
          onClick={handleClick}
          sx={{ py: 1.5, opacity: getItemOpacity(notification) }}
        >
          {notification.source.eventType === "session_report_ready" ? (
            <SessionReportReadyRow
              chipProps={chipProps}
              notification={notification}
              reportType={notification.source.payload.reportType}
            />
          ) : notification.source.eventType === "pull_request.merged" ? (
            <PullRequestMergedRow
              chipProps={chipProps}
              notification={notification}
            />
          ) : (
            <GenericRow chipProps={chipProps} notification={notification} />
          )}
        </ListItemButton>

        {showPreview && (
          <Stack direction="row" spacing={1} sx={{ px: 2, pb: 1.5 }}>
            <Button
              data-testid={`notification-item-preview-${notification.notificationId}`}
              disabled={isUpdating}
              onClick={handlePreviewClick}
              size="small"
              sx={{ flex: 1 }}
              variant="outlined"
            >
              Preview
            </Button>
            {onShowTab && (
              <Button
                data-testid={`notification-item-show-tab-${notification.notificationId}`}
                disabled={isUpdating}
                onClick={onShowTab}
                size="small"
                sx={{ flex: 1 }}
                variant="outlined"
              >
                Show tab
              </Button>
            )}
          </Stack>
        )}
        {isPullRequestMerged && (
          <Stack direction="row" spacing={1} sx={{ px: 2, pb: 1.5 }}>
            <Button
              data-testid={`notification-item-open-pull-request-${notification.notificationId}`}
              disabled={isUpdating}
              onClick={handleOpenPullRequest}
              size="small"
              sx={{ flex: 1 }}
              variant="outlined"
            >
              Open pull request
            </Button>
            {notification.source.eventType === "pull_request.merged" &&
              notification.source.payload.taskId && (
                <Button
                  data-testid={`notification-item-open-task-${notification.notificationId}`}
                  disabled={isUpdating}
                  onClick={handleOpenTask}
                  size="small"
                  sx={{ flex: 1 }}
                  variant="outlined"
                >
                  Open linked task
                </Button>
              )}
          </Stack>
        )}
      </Stack>
    </ListItem>
  );
};
