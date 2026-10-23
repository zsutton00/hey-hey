import { usePlatformAdminAccess } from "@hey-hey/ui-common/data";
import { NotificationItem } from "@hey-hey/ui-common/components/Notifications";
import DailySessionIcon from "@mui/icons-material/CalendarTodayOutlined";
import CodingIcon from "@mui/icons-material/TimelineOutlined";
import {
  Button,
  ClickAwayListener,
  IconButton,
  Paper,
  Popper,
  Stack,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import React, { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  usePreviewHost,
  type EntityPreviewRequest,
} from "@hey-hey/ui-common/context";
import { WebPathService } from "@hey-hey/ui-common/services";
import { useProjectNotificationActivity } from "../../hooks/useProjectNotificationActivity";
import { useHasTabAt } from "../../hooks/useTabLocationRegistry";
import { broadcastHighlight } from "../../utils/tabLocationRegistry";

export interface ProjectNotificationCenterProps {
  organizationId: string;
  projectId: string;
}

export const ProjectNotificationCenter: React.FC<
  ProjectNotificationCenterProps
> = ({ organizationId, projectId }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const { isPlatformAdmin } = usePlatformAdminAccess();
  const [codingButtonEl, setCodingButtonEl] = useState<HTMLElement | null>(
    null,
  );
  const [dailySessionButtonEl, setDailySessionButtonEl] =
    useState<HTMLElement | null>(null);
  const previewHost = usePreviewHost();
  const navigate = useNavigate();

  const {
    currentDailySessionReportReadyToast,
    currentPullRequestMergedToast,
    currentSessionReportReadyToast,
    dismissNotification,
    hasUnseenDailySessionReportReady,
    hasUnseenPullRequestMerged,
    hasUnseenSessionReportReady,
    popCurrentDailySessionReportReadyToast,
    popCurrentPullRequestMergedToast,
    popCurrentSessionReportReadyToast,
    resetDailySessionReportReadyIndicator,
    resetPullRequestMergedIndicator,
    resetSessionReportReadyIndicator,
  } = useProjectNotificationActivity({
    organizationId,
    projectId,
    activityEnabled: false,
    coordinateSessionReportToasts: true,
  });

  const codingHref = WebPathService.projectAgentsCoding({ projectId });
  const dailySessionHref = `/projects/${projectId}?tab=project&view=daily-session`;

  const codingColor =
    hasUnseenSessionReportReady || hasUnseenPullRequestMerged
      ? "primary.main"
      : "text.secondary";
  const dailySessionColor = hasUnseenDailySessionReportReady
    ? "primary.main"
    : "text.secondary";

  const handleCodingClick = (): void => {
    if (hasUnseenSessionReportReady) {
      resetSessionReportReadyIndicator();
    }
    if (hasUnseenPullRequestMerged) {
      resetPullRequestMergedIndicator();
    }
  };

  const handleDailySessionClick = (): void => {
    if (hasUnseenDailySessionReportReady) {
      resetDailySessionReportReadyIndicator();
    }
  };

  const handleSessionToastAcknowledge = (notificationId: string): void => {
    popCurrentSessionReportReadyToast();
    void dismissNotification(notificationId);
  };

  const handlePullRequestMergedToastAcknowledge = (
    notificationId: string,
  ): void => {
    popCurrentPullRequestMergedToast();
    void dismissNotification(notificationId);
  };

  const handleDailySessionToastAcknowledge = (notificationId: string): void => {
    popCurrentDailySessionReportReadyToast();
    resetDailySessionReportReadyIndicator();
    void dismissNotification(notificationId);
  };

  const handleSessionClickAway = (): void => {
    if (currentSessionReportReadyToast) {
      popCurrentSessionReportReadyToast();
    }
    if (currentPullRequestMergedToast) {
      popCurrentPullRequestMergedToast();
    }
  };

  const handleOpenPullRequest = (url: string): void => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleOpenTask = (taskId: string): void => {
    navigate(`/projects/${projectId}/tasks/${taskId}`);
  };

  const handleDailySessionClickAway = (): void => {
    if (currentDailySessionReportReadyToast) {
      popCurrentDailySessionReportReadyToast();
    }
  };

  const handleDailySessionToastClick = (): void => {
    resetDailySessionReportReadyIndicator();
    navigate(dailySessionHref);
  };

  const handlePreview = (sessionId: string): void => {
    const previewRequest: EntityPreviewRequest = {
      entityType: "agent_session",
      entityId: sessionId as EntityPreviewRequest["entityId"],
    };
    previewHost.openPreview(previewRequest);
  };

  const toastTargetPathname = currentSessionReportReadyToast
    ? `/projects/${projectId}/agent-sessions/${currentSessionReportReadyToast.sessionId}`
    : null;
  const hasOpenTab = useHasTabAt(toastTargetPathname);

  const isToastOpen = Boolean(
    (currentSessionReportReadyToast || currentPullRequestMergedToast) &&
    codingButtonEl,
  );
  const isDailySessionToastOpen = Boolean(
    currentDailySessionReportReadyToast && dailySessionButtonEl,
  );

  return (
    <>
      {isMobile ? (
        <IconButton
          aria-label="Activity"
          component={RouterLink}
          data-testid="coding-link"
          onClick={handleCodingClick}
          ref={setCodingButtonEl}
          size="medium"
          sx={{ color: codingColor }}
          to={codingHref}
        >
          <CodingIcon fontSize="small" />
        </IconButton>
      ) : (
        <Stack direction="row" spacing={1}>
          <Button
            component={RouterLink}
            data-testid="coding-link"
            endIcon={<CodingIcon fontSize="small" />}
            onClick={handleCodingClick}
            ref={setCodingButtonEl}
            size="small"
            sx={{
              color: codingColor,
              textTransform: "none",
            }}
            to={codingHref}
            variant="text"
          >
            Activity
          </Button>

          {isPlatformAdmin ? (
            <Button
              component={RouterLink}
              data-testid="daily-session-link"
              endIcon={<DailySessionIcon fontSize="small" />}
              onClick={handleDailySessionClick}
              ref={setDailySessionButtonEl}
              size="small"
              sx={{
                color: dailySessionColor,
                textTransform: "none",
              }}
              to={dailySessionHref}
              variant="text"
            >
              Daily Session
            </Button>
          ) : null}
        </Stack>
      )}

      <Popper
        anchorEl={codingButtonEl}
        data-testid="session-report-ready-toast-popper"
        open={isToastOpen}
        placement="bottom-end"
        sx={{ zIndex: theme.zIndex.tooltip }}
      >
        {currentSessionReportReadyToast || currentPullRequestMergedToast ? (
          <ClickAwayListener onClickAway={handleSessionClickAway}>
            <Stack spacing={1} sx={{ mt: 1, minWidth: 320, maxWidth: 420 }}>
              {currentPullRequestMergedToast ? (
                <Paper data-testid="pull-request-merged-toast" elevation={6}>
                  <NotificationItem
                    notification={currentPullRequestMergedToast.notification}
                    onAcknowledge={handlePullRequestMergedToastAcknowledge}
                    onOpenPullRequest={handleOpenPullRequest}
                    onOpenTask={handleOpenTask}
                  />
                </Paper>
              ) : null}
              {currentSessionReportReadyToast ? (
                <Paper data-testid="session-report-ready-toast" elevation={6}>
                  <NotificationItem
                    notification={currentSessionReportReadyToast.notification}
                    onAcknowledge={handleSessionToastAcknowledge}
                    onPreview={handlePreview}
                    onShowTab={
                      hasOpenTab && toastTargetPathname
                        ? () => broadcastHighlight(toastTargetPathname)
                        : undefined
                    }
                  />
                </Paper>
              ) : null}
            </Stack>
          </ClickAwayListener>
        ) : (
          <span />
        )}
      </Popper>

      {isPlatformAdmin ? (
        <Popper
          anchorEl={dailySessionButtonEl}
          data-testid="daily-session-report-ready-toast-popper"
          open={isDailySessionToastOpen}
          placement="bottom-end"
          sx={{ zIndex: theme.zIndex.tooltip }}
        >
          {currentDailySessionReportReadyToast ? (
            <ClickAwayListener onClickAway={handleDailySessionClickAway}>
              <Paper
                data-testid="daily-session-report-ready-toast"
                elevation={6}
                onClick={handleDailySessionToastClick}
                sx={{ mt: 1, minWidth: 320, maxWidth: 420 }}
              >
                <NotificationItem
                  notification={
                    currentDailySessionReportReadyToast.notification
                  }
                  onAcknowledge={handleDailySessionToastAcknowledge}
                />
              </Paper>
            </ClickAwayListener>
          ) : (
            <span />
          )}
        </Popper>
      ) : null}
    </>
  );
};
