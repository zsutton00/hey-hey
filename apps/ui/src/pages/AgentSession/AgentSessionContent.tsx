import { AgentSessionType } from "@hey-hey/ui-common/api";
import { useAgentSession } from "@hey-hey/ui-common/data";
import {
  ExistingEntityConversationSession,
  isExistingEntityConversationAgentSession,
  LoadingPanel,
} from "@hey-hey/ui-common/components";
import { Alert, Box } from "@mui/material";
import React from "react";
import { AgenticAgentSessionPage } from "./agentic/AgenticAgentSessionPage";
import { FeatureTreeConversationPage } from "./FeatureTreeConversationPage";

export interface AgentSessionContentProps {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  preview?: boolean;
}

export const AgentSessionContent: React.FC<AgentSessionContentProps> = ({
  organizationId,
  projectId,
  agentSessionId,
  preview = false,
}) => {
  const { agentSession, error, isFetched, isLoading } = useAgentSession(
    organizationId || undefined,
    projectId,
    agentSessionId,
    { enabled: !!organizationId && !!agentSessionId },
  );
  if (!organizationId.trim() || !projectId.trim() || !agentSessionId.trim()) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" data-testid="agent-session-preview-scope-error">
          Agent session Preview requires organization, project, and session IDs.
        </Alert>
      </Box>
    );
  }

  if (isLoading || !isFetched) {
    return <LoadingPanel label="Loading agent session..." />;
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" data-testid="agent-session-preview-query-error">
          {error.message || "Unable to load agent session."}
        </Alert>
      </Box>
    );
  }

  if (!agentSession) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning" data-testid="agent-session-preview-not-found">
          Agent session not found.
        </Alert>
      </Box>
    );
  }

  if (agentSession.type === AgentSessionType.ProjectConversation) {
    return (
      <FeatureTreeConversationPage
        organizationId={organizationId}
        projectId={projectId}
        agentSessionId={agentSessionId}
        preview={preview}
      />
    );
  }

  if (preview && agentSession.type === AgentSessionType.EntityConversation) {
    if (!isExistingEntityConversationAgentSession(agentSession)) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert
            severity="error"
            data-testid="entity-conversation-preview-metadata-error"
          >
            This entity-conversation session does not have the session and
            conversation identifiers required for Preview.
          </Alert>
        </Box>
      );
    }

    return (
      <ExistingEntityConversationSession
        organizationId={organizationId}
        projectId={projectId}
        agentSession={agentSession}
      />
    );
  }

  return (
    <AgenticAgentSessionPage
      routeFamily="project"
      organizationId={organizationId}
      projectId={projectId}
      agentSessionId={agentSessionId}
      preview={preview}
    />
  );
};
