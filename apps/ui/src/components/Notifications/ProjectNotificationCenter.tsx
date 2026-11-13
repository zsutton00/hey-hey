import { NotificationItem } from "@hey-hey/ui-common/components/Notifications";
import CodingIcon from "@mui/icons-material/TimelineOutlined";
import {
  Button,
  ClickAwayListener,
  IconButton,
  Paper,
  Popper,
  Stack,
  Tooltip,
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
  const [codingButtonEl, setCodingButtonEl] = useState<HTMLElement | null>(
    null,
  );
  const previewHost = usePreviewHost();
  const navigate = useNavigate();

  const {
    currentPullRequestMergedToast,
    currentSessionReportReadyToast,
    dismissNotification,
    hasUnseenPullRequestMerged,
    hasUnseenSessionReportReady,
    popCurrentPullRequestMergedToast,
    popCurrentSessionReportReadyToast,
    resetPullRequestMergedIndicator,
    resetSessionReportReadyIndicator,
  } = useProjectNotificationActivity({
    organizationId,
    projectId,
    activityEnabled: false,
    coordinateSessionReportToasts: true,
  });

  const codingHref = WebPathService.projectAgentsCoding({ projectId });

  const codingColor =
    hasUnseenSessionReportReady || hasUnseenPullRequestMerged
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

  return (
    <>
      {isMobile ? (
        <Tooltip title="Sessions">
          <IconButton
            aria-label="Sessions"
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
        </Tooltip>
      ) : (
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
          Sessions
        </Button>
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
    </>
  );
};
