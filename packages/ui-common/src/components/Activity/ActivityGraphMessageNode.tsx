import {
  lighten,
  Box,
  Paper,
  Popper,
  Typography,
  useTheme,
} from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position } from "reactflow";
import { Link as RouterLink } from "react-router-dom";
import { usePathService } from "../../contexts";
import type { ReportDto } from "../../api";
import { useCanHover } from "../../hooks/useCanHover";
import { MarkdownRenderer } from "../shared/MarkdownRenderer";
import { SystemMessage } from "../Conversation/Components/SystemMessage";
import type { ActivityGanttPlanScope } from "./activityGanttPrimitives";
import { resolveActivityGraphAgentSessionHref } from "./activityGraphLinkResolver";

export interface ActivityGraphMessageNodeData {
  responseText: string;
  streamingText?: string;
  isStreaming: boolean;
  createdAt?: string;
  agentSessionId: string;
  projectId?: string;
  planScope?: ActivityGanttPlanScope;
  nodeWidth: number;
  isUserMessage?: boolean;
  reports: ReportDto[];
  systemMessageType: string | null;
}

export interface ActivityGraphMessageNodeProps {
  data: ActivityGraphMessageNodeData;
}

const hiddenHandle = { opacity: 0 };

const SYSTEM_MESSAGE_FONT_FAMILY = [
  '"Tilt Neon"',
  '"Fira Code"',
  '"Source Code Pro"',
  '"SF Mono"',
  '"Cascadia Code"',
  '"Consolas"',
  "monospace",
].join(",");

export const ActivityGraphMessageNode: React.FC<
  ActivityGraphMessageNodeProps
> = ({ data }) => {
  const pathService = usePathService();
  const {
    responseText,
    streamingText,
    isStreaming,
    createdAt,
    agentSessionId,
    projectId,
    planScope,
    nodeWidth,
    isUserMessage,
    reports,
    systemMessageType,
  } = data;
  const theme = useTheme();
  const href = resolveActivityGraphAgentSessionHref({
    agentSessionId,
    projectId,
    planScope,
    pathService,
  });

  const displayText = isStreaming
    ? streamingText ?? responseText
    : responseText;

  const MAX_PREVIEW_CHARS = 500;
  const truncatedText =
    displayText.length > MAX_PREVIEW_CHARS
      ? displayText.slice(0, MAX_PREVIEW_CHARS) + "…"
      : displayText;

  const canHover = useCanHover();
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const isOverPopoverRef = useRef(false);

  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearCloseTimeout();
    closeTimeoutRef.current = window.setTimeout(() => {
      if (!isOverPopoverRef.current) {
        setHoverAnchor(null);
      }
    }, 100);
  }, [clearCloseTimeout]);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      clearCloseTimeout();
      isOverPopoverRef.current = false;
      const target = event.currentTarget;
      hoverTimeoutRef.current = window.setTimeout(() => {
        setHoverAnchor(target);
      }, 500);
    },
    [clearCloseTimeout]
  );

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  const handlePopoverMouseEnter = useCallback(() => {
    isOverPopoverRef.current = true;
    clearCloseTimeout();
  }, [clearCloseTimeout]);

  const handlePopoverMouseLeave = useCallback(() => {
    isOverPopoverRef.current = false;
    scheduleClose();
  }, [scheduleClose]);

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  const bgColor = isUserMessage
    ? theme.palette.mode === "dark"
      ? theme.palette.grey[800]
      : theme.palette.grey[100]
    : theme.palette.mode === "dark"
    ? theme.palette.primary.dark
    : theme.palette.primary.light;

  const borderColor = isUserMessage
    ? theme.palette.divider
    : theme.palette.attention?.main || theme.palette.primary.main;

  const textColor = isUserMessage
    ? theme.palette.text.primary
    : theme.palette.attention?.contrastText ||
      theme.palette.primary.contrastText;

  const hasInlineReports = reports.length > 0 && !isUserMessage;

  return (
    <>
      <Handle type="target" position={Position.Left} style={hiddenHandle} />
      <Box
        data-testid="activity-gantt-message-node"
        component={href && !hasInlineReports ? RouterLink : "div"}
        to={href && !hasInlineReports ? href : undefined}
        onMouseEnter={canHover ? handleMouseEnter : undefined}
        onMouseLeave={canHover ? handleMouseLeave : undefined}
        sx={{
          width: nodeWidth,
          minHeight: 60,
          p: hasInlineReports ? 0 : 1.5,
          borderRadius: 1,
          bgcolor: hasInlineReports ? "transparent" : bgColor,
          border: hasInlineReports ? 0 : `2px solid ${borderColor}`,
          boxShadow: hasInlineReports
            ? "none"
            : theme.palette.mode === "dark"
            ? "0 4px 12px rgba(8, 126, 139, 0.4)"
            : "0 4px 12px rgba(8, 126, 139, 0.16)",
          color: textColor,
          textDecoration: "none",
          display: "block",
          pointerEvents: "all",
          cursor: href && !hasInlineReports ? "pointer" : "default",
        }}
      >
        {hasInlineReports ? (
          <SystemMessage
            animationType="minimal"
            enableTypingAnimation={false}
            inlineReports={reports}
            sx={{
              mb: 0,
              maxWidth: "100%",
              minHeight: 0,
              width: "100%",
            }}
            text={displayText}
            type={systemMessageType ?? "CARRIER"}
          />
        ) : (
          <MarkdownRenderer
            mentionMode="minimal"
            sx={{
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              textOverflow: "ellipsis",
              fontFamily: isUserMessage
                ? "inherit"
                : SYSTEM_MESSAGE_FONT_FAMILY,
              fontSize: "0.85rem",
              lineHeight: 1.5,
              color: "inherit",
              "& p": { margin: 0, color: "inherit" },
            }}
          >
            {displayText}
          </MarkdownRenderer>
        )}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mt: 0.5,
          }}
        >
          {isStreaming && (
            <Box
              data-testid="activity-gantt-message-streaming-indicator"
              sx={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                bgcolor: lighten(borderColor, 0.3),
                animation: "pulse 1.5s ease-in-out infinite",
                "@keyframes pulse": {
                  "0%, 100%": { opacity: 0.4 },
                  "50%": { opacity: 1 },
                },
              }}
            />
          )}
          {createdAt && (
            <Typography
              variant="caption"
              sx={{
                color: "inherit",
                opacity: 0.7,
                fontSize: "0.6875rem",
              }}
            >
              {createdAt}
            </Typography>
          )}
        </Box>
      </Box>
      {canHover && hoverAnchor && (
        <Popper
          open
          anchorEl={hoverAnchor}
          placement="bottom-start"
          sx={{ zIndex: (t) => t.zIndex.tooltip }}
        >
          <Paper
            elevation={8}
            onMouseEnter={handlePopoverMouseEnter}
            onMouseLeave={handlePopoverMouseLeave}
            sx={{
              maxWidth: 400,
              maxHeight: 300,
              overflow: "auto",
              mt: 1,
              p: 2,
              bgcolor: "background.paper",
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: "pre-wrap" }}
            >
              {truncatedText}
            </Typography>
          </Paper>
        </Popper>
      )}
    </>
  );
};
