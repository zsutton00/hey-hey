import { Alert, Box, Link, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import type { ConversationResponseDto, ProjectResponseDto } from "../../api";
import {
  AgentSessionMetadata,
  type AgentSessionMetadataValues,
} from "../AgentSession/AgentSessionMetadata";
import { ConversationViewer } from "../Conversation";
import type { ConversationScrollPolicy } from "../Conversation";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { EntityIcon } from "../Entity";
import { RenderErrorBoundary } from "../shared/RenderErrorBoundary";

export interface TaskMonitorConversationPaneProps {
  title: string;
  conversation: ConversationResponseDto | null;
  project: ProjectResponseDto | null;
  readOnly: boolean;
  loading: boolean;
  fetched: boolean;
  errorMessage: string | null;
  emptyMessage: string;
  testId: string;
  sessionHref?: string;
  agentSessionMetadata?: AgentSessionMetadataValues;
  monitorId?: string;
  contentAfter?: ReactNode;
}

export const TaskMonitorConversationPane = ({
  title,
  conversation,
  project,
  readOnly,
  loading,
  fetched,
  errorMessage,
  emptyMessage,
  testId,
  sessionHref,
  agentSessionMetadata,
  monitorId,
  contentAfter,
}: TaskMonitorConversationPaneProps) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollPolicy = useMemo<ConversationScrollPolicy>(
    () => ({ mode: "owned", ownerRef: scrollContainerRef }),
    []
  );

  return (
    <Stack
      spacing={1.5}
      data-testid={testId}
      sx={{
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        p: 2,
        backgroundColor: sessionHref ? "action.hover" : undefined,
        borderRadius: sessionHref ? 1 : undefined,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={sessionHref ? { pb: 0.5 } : undefined}
      >
        {sessionHref ? (
          <Link
            href={sessionHref}
            variant="subtitle1"
            sx={{
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              minWidth: 0,
            }}
            data-testid="task-monitor-session-title-link"
          >
            <EntityIcon
              aria-hidden="true"
              entityType="agent_session"
              agentSessionType="CODING"
              data-testid="task-monitor-session-icon"
              sx={{ flexShrink: 0, fontSize: "1rem" }}
              size={24}
            />
            <Box
              component="span"
              sx={{
                minWidth: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </Box>
          </Link>
        ) : (
          <Typography variant="h6" sx={{ flex: 1 }}>
            {title}
          </Typography>
        )}
      </Stack>
      <Box
        ref={scrollContainerRef}
        data-testid={`${testId}-scroll-container`}
        sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
      >
        <DataStateBoundary loading={loading} fetched={fetched}>
          {errorMessage ? (
            <Alert severity="error">{errorMessage}</Alert>
          ) : conversation && project ? (
            <RenderErrorBoundary
              key={conversation.id}
              fallback={
                <Alert
                  severity="warning"
                  data-testid={`${testId}-conversation-error`}
                >
                  This conversation is temporarily unavailable. The rest of
                  the Task Monitor remains available.
                </Alert>
              }
            >
              <ConversationViewer
                animationType="minimal"
                conversation={conversation}
                project={project}
                taskMonitorId={monitorId}
                readOnly={readOnly}
                showNavigation={false}
                hideAnalysisAction
                hideRetryButton
                renderNestedUserMessages
                renderTimestamp
                timelineAnimationMode="none"
                scrollPolicy={scrollPolicy}
                slotProps={{
                  paper: {
                    sx: {
                      background: "transparent",
                    },
                  },
                }}
              />
            </RenderErrorBoundary>
          ) : (
            <Typography color="text.secondary">{emptyMessage}</Typography>
          )}
          {contentAfter}
        </DataStateBoundary>
      </Box>
      {agentSessionMetadata ? (
        <AgentSessionMetadata
          placement="below-conversation"
          {...agentSessionMetadata}
        />
      ) : null}
    </Stack>
  );
};
