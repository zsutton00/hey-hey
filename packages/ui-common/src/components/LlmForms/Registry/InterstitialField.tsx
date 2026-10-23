import { Box, Typography, useTheme } from "@mui/material";
import { alpha } from "@mui/material/styles";
import React from "react";
import type { ReportDto, SystemMessageData } from "../../../api";
import { SystemMessage } from "../../Conversation/Components/SystemMessage";
import { formatMessageTimestamp } from "../../Conversation/Components/messageTimestamp";
import { getInterstitialSegments } from "../../Conversation/Components/interstitialTiming";
import {
  getSubtleActivityIconSx,
  ThoughtBubbleIcon,
} from "../../shared/SubtleActivityIcon";
import type { LatestTurnToolCallsState } from "../../AgentSession/runtime/hooks/useLatestTurnToolCalls";
import { groupToolCallsByThought } from "./groupToolCallsByThought";
import {
  LatestTurnToolCalls,
  TOOL_CALLS_PER_NARRATION_LIMIT,
} from "./LatestTurnToolCalls";
import type { FieldComponentProps } from "./types";

export const splitInterstitialThoughts = (body: string): string[] =>
  getInterstitialSegments(body)
    .map(({ text }) => text)
    .filter((thought) => thought.length > 0);

export const isInterstitialMessageData = (
  messageData: SystemMessageData,
): boolean =>
  messageData.uiElements?.some((element) => element.type === "interstitial") ===
  true;

export interface InterstitialThoughtProps {
  inlineReports?: ReportDto[];
  isActive: boolean;
  messageType: string;
  position: "first" | "middle" | "last" | "only";
  thought: string;
  timestamp?: string | null;
}

export const InterstitialThought: React.FC<InterstitialThoughtProps> = ({
  inlineReports,
  isActive,
  messageType,
  position,
  thought,
  timestamp,
}) => {
  const theme = useTheme();
  const isFirst = position === "first" || position === "only";
  const isLast = position === "last" || position === "only";

  return (
    <Box
      data-testid="interstitial-thought"
      data-position={position}
      sx={{
        display: "grid",
        gridTemplateColumns: "24px minmax(0, 1fr)",
        columnGap: { xs: 1, sm: 1.5 },
        minHeight: 48,
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...(!isFirst
            ? {
                "&::before": {
                  content: '""',
                  position: "absolute",
                  top: 0,
                  bottom: "calc(50% + 14px)",
                  width: "1px",
                  bgcolor: alpha(theme.palette.text.secondary, 0.3),
                },
              }
            : {}),
          ...(!isLast
            ? {
                "&::after": {
                  content: '""',
                  position: "absolute",
                  top: "calc(50% + 14px)",
                  bottom: 0,
                  width: "1px",
                  bgcolor: alpha(theme.palette.text.secondary, 0.3),
                },
              }
            : {}),
        }}
      >
        <Box
          sx={{
            zIndex: 1,
            display: "flex",
            color:
              isLast && isActive
                ? theme.palette.info.main
                : theme.palette.text.secondary,
            opacity: isLast ? 1 : 0.7,
            ...(isLast && isActive
              ? {
                  ...getSubtleActivityIconSx(theme),
                }
              : {}),
          }}
        >
          <ThoughtBubbleIcon sx={{ fontSize: 22 }} viewBox="0 0 32 32" />
        </Box>
      </Box>

      <Box sx={{ minWidth: 0, width: "100%" }}>
        <SystemMessage
          animationType="minimal"
          enableTypingAnimation={false}
          inlineReports={inlineReports}
          isCompleted
          type={messageType}
          text={thought}
          renderTimestamp={false}
          sx={{
            display: "block",
            width: "100%",
            maxWidth: "none",
            minHeight: "auto",
            mb: timestamp ? 0.25 : 1,
            px: { xs: 1.5, sm: 2 },
            py: 1.25,
            color: "text.primary",
            backgroundColor: alpha(theme.palette.background.paper, 0.38),
            border: `1px solid ${alpha(theme.palette.divider, 0.55)}`,
            borderRadius: 1.5,
            boxShadow: "none",
            opacity: isLast ? 1 : 0.78,
            backdropFilter: "blur(8px)",
            transition: theme.transitions.create(["opacity", "border-color"]),
            "& .system-message-markdown": {
              fontSize: { xs: "0.95rem", sm: "1rem" },
              lineHeight: 1.55,
            },
          }}
        />
        {timestamp ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="interstitial-thought-timestamp"
            sx={{
              display: "block",
              px: { xs: 1.5, sm: 2 },
              mb: 1,
            }}
          >
            {formatMessageTimestamp(timestamp)}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
};

/** Renders brief agent narration as a connected activity timeline. */
export const InterstitialField: React.FC<FieldComponentProps> = ({
  config,
  context,
  inlineReports,
  isSubmitted,
}) => {
  const messageData = context.messageData;
  const body =
    typeof messageData?.response === "string" ? messageData.response : "";
  const segments = getInterstitialSegments(body).filter(
    ({ text }) => text.length > 0,
  );
  const isActive = !isSubmitted && context.isLastInTimeline !== false;
  const toolCalls: LatestTurnToolCallsState =
    context.isLastInTimeline === false
      ? { status: "idle" }
      : (context.latestTurnToolCalls ?? { status: "idle" });

  if (segments.length === 0) {
    return null;
  }

  const toolCallGroups =
    toolCalls.status === "available"
      ? groupToolCallsByThought(
          segments.map(({ timestamp }) => timestamp),
          toolCalls.result.toolCalls,
        )
      : null;
  const hiddenToolCallCount =
    toolCalls.status === "available"
      ? toolCalls.result.omittedEarlierCount + toolCalls.result.evictedCount
      : 0;
  // Snapshot order is chronological and grouping keeps it within each group,
  // so the snapshot's last call is always in its group's visible tail.
  const newestToolCallEntryId =
    toolCalls.status === "available"
      ? (toolCalls.result.toolCalls.at(-1)?.entryId ?? null)
      : null;
  const firstToolCallGroup =
    toolCallGroups?.findIndex((group) => group.length > 0) ?? -1;
  const hiddenCountGroup =
    firstToolCallGroup === -1 ? segments.length - 1 : firstToolCallGroup;

  return (
    <Box
      data-testid="interstitial-field"
      data-field={config.field}
      sx={{
        width: "min(100%, 960px)",
        py: 0.5,
      }}
    >
      {segments.map(({ text, timestamp }, index) => {
        const position =
          segments.length === 1
            ? "only"
            : index === 0
              ? "first"
              : index === segments.length - 1
                ? "last"
                : "middle";
        return (
          <React.Fragment key={`${index}-${text}`}>
            <InterstitialThought
              inlineReports={
                position === "last" || position === "only"
                  ? inlineReports
                  : undefined
              }
              isActive={isActive}
              messageType={messageData?.type ?? "AGENT"}
              position={position}
              thought={text}
              timestamp={timestamp}
            />
            {toolCallGroups ? (
              <LatestTurnToolCalls
                toolCalls={toolCallGroups[index]}
                visibleLimit={TOOL_CALLS_PER_NARRATION_LIMIT}
                newestEntryId={newestToolCallEntryId}
                hiddenCount={
                  index === hiddenCountGroup ? hiddenToolCallCount : 0
                }
              />
            ) : null}
          </React.Fragment>
        );
      })}
    </Box>
  );
};
