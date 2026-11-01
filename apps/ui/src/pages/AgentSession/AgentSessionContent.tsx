import {
  AgentSessionType,
  LocalPromptType,
  MessageType,
  type CreateUserMessage,
  type LocalPromptProposalInput,
  type UserMessageDataProposalRefiner,
} from "@hey-hey/ui-common/api";
import { useAgentSession, useProposal } from "@hey-hey/ui-common/data";
import {
  AgentConversationView,
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
  const isProposalRefining =
    agentSession?.type === AgentSessionType.ProposalRefining;
  const {
    proposal,
    error: proposalError,
    isLoading: proposalLoading,
  } = useProposal(
    organizationId || undefined,
    projectId,
    isProposalRefining ? agentSession.entityId : undefined,
    { enabled: isProposalRefining },
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

  if (isProposalRefining) {
    if (!agentSession.conversationId) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">
            This proposal-refining session has no conversation to open.
          </Alert>
        </Box>
      );
    }
    if (proposalLoading) {
      return <LoadingPanel label="Loading proposal conversation..." />;
    }
    if (proposalError || !proposal) {
      return (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">
            {proposalError?.message || "Unable to load the proposal."}
          </Alert>
        </Box>
      );
    }

    const proposalInput: LocalPromptProposalInput = {
      id: proposal.id,
      action: proposal.action,
      status: proposal.status,
      targetEntityId: proposal.targetEntityId,
      targetEntityType: proposal.targetEntityType,
      title: proposal.title,
      updates: proposal.updates ?? {},
    };
    const conversationId = agentSession.conversationId;

    return (
      <AgentConversationView
        organizationId={organizationId}
        projectId={projectId}
        agentSessionId={agentSessionId}
        conversationId={conversationId}
        scrollable
        buildReplyMessage={(text, skillSelection, attachments = []) => {
          const agentInput: UserMessageDataProposalRefiner = {
            promptType: LocalPromptType.ProposalRefiner,
            payloadVersion: 1,
            proposal: proposalInput,
            userMessage: text,
            ...(skillSelection ? { skillSelection } : {}),
          };
          const message: CreateUserMessage = {
            projectId,
            conversationId,
            type: MessageType.User,
            data: { agentInput, attachments },
          };
          return message;
        }}
      />
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
