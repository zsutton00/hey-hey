import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { Box, Tooltip, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import React, { useEffect, useState } from "react";
import {
  SystemMessageDataNoticeSeverityEnum,
  SystemMessageDataPresentationEnum,
  UserMessageAgentInputProvenance,
  type SystemMessageData,
  type UserMessageAgentInputProvenance as UserMessageAgentInputProvenanceType,
} from "../../../api";
import { capitalize } from "../../../i18n/terminology";
import { UserLink } from "../../shared/UserLink";
import {
  formatInterstitialDuration,
  getElapsedInterstitialDurationMs,
  type InterstitialTiming,
} from "./interstitialTiming";
import { formatMessageTimestamp } from "./messageTimestamp";

export interface MessageAuthorCaptionProps {
  messageId: string;
  /** Null for inputs that have not entered the timeline; no timestamp shows. */
  createdAt: string | null;
  renderTimestamp?: boolean;
  isInterstitialMessage?: boolean;
  interstitialActive?: boolean;
  interstitialTiming?: InterstitialTiming | null;
  /** SystemMessageData used to detect AGENT messages and extract agent label/tooltip */
  messageData?: SystemMessageData | null;
  userMessageProvenance?: UserMessageAgentInputProvenanceType | null;
  userName?: string | null;
  userId?: string | null;
  projectId: string;
  /** Shown in the timestamp slot when there is no timestamp (pending inputs). */
  status?: React.ReactNode;
  sx?: SxProps<Theme>;
}

export type NoticeSeverity = SystemMessageDataNoticeSeverityEnum;

/**
 * A SYSTEM message is an automated notice only when its publisher marked it;
 * a notice without a severity is informational.
 */
export const getNoticeSeverity = (
  messageData: SystemMessageData | null | undefined,
): NoticeSeverity | null =>
  messageData?.presentation === SystemMessageDataPresentationEnum.Notice
    ? (messageData.noticeSeverity ?? SystemMessageDataNoticeSeverityEnum.Info)
    : null;

export const getNoticeVisualTreatmentSx = (
  theme: Theme,
  severity: NoticeSeverity,
) => {
  const palette =
    severity === SystemMessageDataNoticeSeverityEnum.Warning
      ? theme.palette.warning
      : theme.palette.info;

  return {
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${palette.main}`,
    borderRadius: 1,
    px: 1.5,
    py: 1,
  };
};

export type UserMessageAuthorship = "human" | "monitor";

export const getUserMessageAuthorship = (
  provenance: UserMessageAgentInputProvenanceType | null | undefined,
): UserMessageAuthorship => {
  switch (provenance) {
    case UserMessageAgentInputProvenance.SessionMonitor:
    case UserMessageAgentInputProvenance.TaskMonitor:
      return "monitor";
    case null:
    case undefined:
    default:
      return "human";
  }
};

export const MessageAuthorCaption: React.FC<MessageAuthorCaptionProps> = ({
  messageId,
  createdAt,
  renderTimestamp = false,
  isInterstitialMessage = false,
  interstitialActive = false,
  interstitialTiming,
  messageData,
  userMessageProvenance,
  userName,
  userId,
  projectId,
  status,
  sx,
}) => {
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (
      !renderTimestamp ||
      !isInterstitialMessage ||
      !interstitialActive ||
      !interstitialTiming
    ) {
      return;
    }

    const updateCurrentTime = () => setCurrentTime(Date.now());
    updateCurrentTime();
    const intervalId = window.setInterval(updateCurrentTime, 1000);

    return () => window.clearInterval(intervalId);
  }, [
    interstitialActive,
    interstitialTiming?.endAt,
    interstitialTiming?.startAt,
    isInterstitialMessage,
    renderTimestamp,
  ]);

  const timestamp =
    renderTimestamp && !isInterstitialMessage && createdAt !== null
      ? formatMessageTimestamp(createdAt)
      : null;
  const interstitialDuration =
    renderTimestamp && isInterstitialMessage && interstitialTiming
      ? getElapsedInterstitialDurationMs(
          interstitialTiming,
          currentTime,
          interstitialActive,
        )
      : null;
  const interstitialCaption =
    interstitialDuration === null
      ? null
      : `${interstitialActive ? "thinking" : "thought"} for ${formatInterstitialDuration(
          interstitialDuration,
        )}`;
  const noticeSeverity = getNoticeSeverity(messageData);
  const isAgentMessage = messageData?.type === "AGENT";
  const isSessionMonitorMessage = messageData?.type === "SESSION_MONITOR";
  const isMonitorAuthoredUserMessage =
    getUserMessageAuthorship(userMessageProvenance) === "monitor";

  if (noticeSeverity) {
    const NoticeIcon =
      noticeSeverity === SystemMessageDataNoticeSeverityEnum.Warning
        ? WarningAmberOutlinedIcon
        : InfoOutlinedIcon;

    return (
      <Typography
        variant="caption"
        color={
          noticeSeverity === SystemMessageDataNoticeSeverityEnum.Warning
            ? "warning.main"
            : "info.main"
        }
        component="div"
        data-testid={`notice-caption-${messageId}`}
        data-notice-severity={noticeSeverity}
        sx={{ display: "flex", alignItems: "center", gap: 0.5, ...sx }}
      >
        <NoticeIcon sx={{ fontSize: 14 }} aria-hidden />
        System notice
        {timestamp ? ` · ${timestamp}` : status ? <> · {status}</> : null}
      </Typography>
    );
  }

  if (
    isAgentMessage ||
    isSessionMonitorMessage ||
    isMonitorAuthoredUserMessage ||
    isInterstitialMessage
  ) {
    const agentLabel = messageData?.promptHandler
      ? `${messageData.promptHandler
          .replace(/_/g, " ")
          .split(" ")
          .map(capitalize)
          .join(" ")} agent`
      : isSessionMonitorMessage || isMonitorAuthoredUserMessage
        ? "Auto-run Agent"
        : "Agent";
    const showTooltip = Boolean(
      messageData?.providerSessionId && messageData?.promptHandler,
    );

    return (
      <Typography
        variant="caption"
        color="text.secondary"
        component="div"
        data-testid={`agent-caption-${messageId}`}
        sx={sx}
      >
        {showTooltip ? (
          <Tooltip
            title={
              <Box>
                <Box>
                  <strong>providerSessionId:</strong>{" "}
                  {messageData?.providerSessionId}
                </Box>
              </Box>
            }
          >
            <Box
              component="span"
              data-testid={`agent-caption-tooltip-${messageId}`}
            >
              {agentLabel}
            </Box>
          </Tooltip>
        ) : (
          agentLabel
        )}
        {interstitialCaption ? (
          ` · ${interstitialCaption}`
        ) : timestamp ? (
          ` · ${timestamp}`
        ) : status ? (
          <>
            {" · "}
            {status}
          </>
        ) : null}
      </Typography>
    );
  }

  if (!timestamp && !userName && !isMonitorAuthoredUserMessage && !status) {
    return null;
  }

  return (
    <Typography
      variant="caption"
      color="text.secondary"
      component="div"
      data-testid={`message-timestamp-${messageId}`}
      sx={sx}
    >
      {userName && userId ? (
        <UserLink userId={userId} projectId={projectId}>
          {userName}
        </UserLink>
      ) : (
        userName
      )}
      {userName && (timestamp || status) ? " · " : null}
      {timestamp ?? status}
    </Typography>
  );
};
