import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import {
  useAgentSessions,
  useMessage,
} from "@hey-hey/ui-common/data";
import { usePathService } from "@hey-hey/ui-common/context";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";

/**
 * Resolves a message ID to the appropriate detail view: when the message's
 * conversation has an associated agent session, redirects to the
 * agent-session-by-id resolver so per-session-type routing handles the
 * destination; otherwise redirects to the plain conversation route.
 */
export const MessageByIdResolver: React.FC = () => {
  const { projectId, messageId } = useParams<{
    projectId: string;
    messageId: string;
  }>();
  const navigate = useNavigate();
  const pathService = usePathService();
  const organizationId = useUserIdentity()?.currentOrgId ?? "";

  const {
    data: message,
    isLoading: messageLoading,
    isFetched: messageFetched,
  } = useMessage(
    organizationId || undefined,
    projectId,
    messageId,
    {
      enabled: !!organizationId && !!projectId && !!messageId,
    },
  );

  const conversationId = message?.conversationId;

  const {
    agentSessions,
    error: sessionsError,
    isFetched: sessionsFetched,
    isLoading: sessionsLoading,
  } = useAgentSessions(organizationId || undefined, projectId, {
    conversationId: conversationId ?? undefined,
    enabled: !!organizationId && !!projectId && !!conversationId,
  });

  const sessionsLookupPending =
    !!conversationId && (sessionsLoading || !sessionsFetched);
  const isLoading = messageLoading || sessionsLookupPending;
  const agentSession = agentSessions?.[0];

  useEffect(() => {
    if (isLoading || !projectId || !conversationId) {
      return;
    }

    if (agentSession) {
      navigate(
        pathService.agentSession({
          projectId,
          agentSessionId: agentSession.id,
        }),
        { replace: true },
      );
      return;
    }

    navigate(
      pathService.conversation({ projectId, conversationId }),
      { replace: true },
    );
  }, [
    isLoading,
    projectId,
    conversationId,
    agentSession,
    navigate,
    pathService,
  ]);

  if (isLoading || !messageFetched) {
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
          Loading message...
        </Typography>
      </Box>
    );
  }

  if (sessionsError) {
    return <Alert severity="error">{sessionsError.message}</Alert>;
  }

  if (!message) {
    return <Alert severity="error">Unable to find message.</Alert>;
  }

  return null;
};
