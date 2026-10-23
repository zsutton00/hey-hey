import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useAgentSessions, useConversation } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { usePathService } from "@hey-hey/ui-common/context";
import { resolveConversationDestination } from "./resolveConversationDestination";

/**
 * Resolves the agent session for a given conversation and redirects to the
 * appropriate agent-session route.
 *
 * Conversation lists only have the conversationId — not the agentSessionId —
 * so we look it up via the agent-sessions endpoint before navigating.
 */
export const AgentSessionResolver: React.FC = () => {
  const { projectId, conversationId } = useParams<{
    projectId: string;
    conversationId: string;
  }>();
  const navigate = useNavigate();
  const pathService = usePathService();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  const {
    data: conversation,
    error: conversationError,
    isFetched: conversationFetched,
    isLoading: conversationLoading,
  } = useConversation(
    organizationId,
    projectId ?? "",
    { conversationId: conversationId ?? "" },
    {
      enabled: !!organizationId && !!projectId && !!conversationId,
      enablePolling: false,
    },
  );

  const {
    agentSessions,
    error: sessionsError,
    isFetched: sessionsFetched,
    isLoading: sessionsLoading,
  } = useAgentSessions(organizationId || undefined, projectId, {
    conversationId: conversationId ?? undefined,
    enabled: !!organizationId && !!projectId && !!conversationId,
  });

  const isLoading =
    conversationLoading ||
    !conversationFetched ||
    sessionsLoading ||
    !sessionsFetched;
  const destination = !isLoading && projectId && conversationId
    ? resolveConversationDestination(pathService, projectId, conversationId, conversation, agentSessions)
    : null;
  const resolutionError =
    conversationError
      ? conversationError.message || "Unable to load this conversation."
      : sessionsError
        ? sessionsError.message || "Unable to load conversation ownership."
        : destination?.kind === "error" ? destination.message : null;
  const destinationPath = destination?.kind === "resolved" ? destination.path : null;

  useEffect(() => {
    if (!isLoading && !resolutionError && destinationPath) {
      navigate(destinationPath, { replace: true });
    }
  }, [isLoading, resolutionError, destinationPath, navigate]);

  if (resolutionError) {
    return <Alert severity="error">{resolutionError}</Alert>;
  }

  if (isLoading) {
    return (
      <Box
        display="flex"
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        py={8}
        gap={2}
      >
        <CircularProgress size={28} />
        <Typography variant="body2" color="text.secondary">
          Loading agent session...
        </Typography>
      </Box>
    );
  }

  return null;
};
