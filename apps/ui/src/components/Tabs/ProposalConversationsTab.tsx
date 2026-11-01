import {
  EntityType,
  type AgentSessionLastMessageSummary,
  type ConversationResponseDto,
  type PaginatedAgentSessionItemDto,
} from "@hey-hey/ui-common/api";
import { usePathService } from "@hey-hey/ui-common/context";
import {
  useAgentSessions,
  useConversationMessages,
  useConversations,
  useProposal,
} from "@hey-hey/ui-common/data";
import {
  AgentSessionListItem,
  EntityListItem,
  conversationAdapter,
} from "@hey-hey/ui-common/components";
import {
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Divider,
  Typography,
} from "@mui/material";
import React from "react";
import { useNavigate } from "react-router-dom";
import { TabContainer } from "./TabContainer";

interface ProposalConversationsTabProps {
  organizationId: string;
  projectId: string;
  proposalId: string;
}

interface ProposalSessionRowProps {
  organizationId: string;
  projectId: string;
  session: ReturnType<typeof useAgentSessions>["agentSessions"][number];
  buildSessionPath: (agentSessionId: string) => string;
}

const ProposalSessionRow: React.FC<ProposalSessionRowProps> = ({
  organizationId,
  projectId,
  session,
  buildSessionPath,
}) => {
  const { orderedData } = useConversationMessages(
    organizationId,
    projectId,
    session.conversationId ?? undefined,
    { enabled: !!session.conversationId },
  );
  const message = orderedData.at(-1);
  const lastMessage: AgentSessionLastMessageSummary | null = message
    ? {
        id: message.id,
        conversationId: message.conversationId,
        type: message.type,
        status: message.status,
        data: message.data,
        createdAt:
          message.createdAt ?? session.updatedAt ?? session.sessionDate,
      }
    : null;
  const item: PaginatedAgentSessionItemDto = {
    agentSession: session,
    lastMessage,
    parentEntity: null,
    reports: [],
    services: [],
  };

  return (
    <Stack data-testid="proposal-conversation-row" spacing={0.5}>
      <AgentSessionListItem
        buildSessionPath={buildSessionPath}
        item={item}
        projectId={projectId}
        variant="conversations"
      />
    </Stack>
  );
};

interface ProposalConversationRowProps {
  organizationId: string;
  projectId: string;
  conversation: ConversationResponseDto;
  buildSessionPath: (agentSessionId: string) => string;
}

const ProposalConversationRow: React.FC<ProposalConversationRowProps> = ({
  organizationId,
  projectId,
  conversation,
  buildSessionPath,
}) => {
  const { agentSessions, isLoading: sessionsLoading } = useAgentSessions(
    organizationId,
    projectId,
    { conversationId: conversation.id },
  );
  const { orderedData } = useConversationMessages(
    organizationId,
    projectId,
    conversation.id,
  );
  const message = orderedData.at(-1);
  const preview = message
    ? message.type === "SYSTEM"
      ? message.data.response
      : message.data.agentInput?.userMessage
    : undefined;
  const itemProps = conversationAdapter.toEntityListItemProps(conversation, {
    projectId,
  });
  const session = agentSessions.find(
    (candidate) => candidate.conversationId === conversation.id,
  );
  const lastMessage: AgentSessionLastMessageSummary | null = message
    ? {
        id: message.id,
        conversationId: message.conversationId,
        type: message.type,
        status: message.status,
        data: message.data,
        createdAt:
          message.createdAt ?? session?.updatedAt ?? session?.sessionDate,
      }
    : null;

  if (sessionsLoading) {
    return null;
  }

  if (session) {
    const item: PaginatedAgentSessionItemDto = {
      agentSession: session,
      lastMessage,
      parentEntity: null,
      reports: [],
      services: [],
    };

    return (
      <Stack data-testid="proposal-conversation-row" spacing={0.5}>
        <AgentSessionListItem
          buildSessionPath={buildSessionPath}
          item={item}
          projectId={projectId}
          variant="conversations"
        />
      </Stack>
    );
  }

  return (
    <Stack data-testid="proposal-conversation-row" spacing={0.5}>
      <EntityListItem
        {...itemProps}
        href={itemProps.href}
        description={
          typeof preview === "string" ? preview : itemProps.description
        }
      />
    </Stack>
  );
};

/**
 * Every conversation and agent session about a proposal. Suggestions are
 * decided in the conversation that made them, so this tab offers no
 * Accept or Reject actions.
 */
export const ProposalConversationsTab: React.FC<
  ProposalConversationsTabProps
> = ({ organizationId, projectId, proposalId }) => {
  const pathService = usePathService();
  const navigate = useNavigate();
  const { proposal, isLoading: proposalLoading } = useProposal(
    organizationId,
    projectId,
    proposalId,
  );
  const { agentSessions, isLoading: sessionsLoading } = useAgentSessions(
    organizationId,
    projectId,
    { entityType: EntityType.Proposal, entityId: proposalId },
  );
  const { agentSessions: originSessions, isLoading: originSessionsLoading } =
    useAgentSessions(organizationId, projectId, {
      conversationId: proposal?.conversationId ?? undefined,
      enabled: Boolean(proposal?.conversationId),
    });
  const { data: proposalConversations, isLoading: conversationsLoading } =
    useConversations(organizationId, projectId, {
      workflowAboutId: proposalId,
      workflowAboutType: "proposal",
    });

  if (
    proposalLoading ||
    sessionsLoading ||
    conversationsLoading ||
    originSessionsLoading
  ) {
    return null;
  }

  const sessionConversationIds = new Set([
    ...(proposal?.conversationId ? [proposal.conversationId] : []),
    ...agentSessions.flatMap((session) =>
      session.conversationId ? [session.conversationId] : [],
    ),
  ]);
  const refinementConversations = (proposalConversations ?? []).filter(
    (conversation) => !sessionConversationIds.has(conversation.id),
  );

  const originSession = originSessions.find(
    (session) => session.conversationId === proposal?.conversationId,
  );
  const hasOriginConversation = Boolean(proposal?.conversationId);
  const hasProposalConversations =
    agentSessions.length > 0 || refinementConversations.length > 0;
  const hasRows = hasOriginConversation || hasProposalConversations;

  return (
    <TabContainer>
      {!hasRows ? (
        <Typography data-testid="proposal-conversations-empty">
          No conversations about this proposal yet.
        </Typography>
      ) : (
        <List data-testid="proposal-conversations-list">
          {hasOriginConversation ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2">Origin conversation</Typography>
              {originSession ? (
                <ProposalSessionRow
                  organizationId={organizationId}
                  projectId={projectId}
                  session={originSession}
                  buildSessionPath={(agentSessionId) =>
                    pathService.agentSession({ projectId, agentSessionId })
                  }
                />
              ) : (
                <ListItemButton
                  data-testid="proposal-conversation-row"
                  onClick={() => {
                    if (proposal?.conversationId) {
                      navigate(
                        pathService.conversation({
                          projectId,
                          conversationId: proposal.conversationId,
                        }),
                      );
                    }
                  }}
                >
                  <ListItemText primary={proposal?.title ?? "Proposal"} />
                </ListItemButton>
              )}
            </Stack>
          ) : null}
          {hasOriginConversation && hasProposalConversations ? (
            <Divider sx={{ my: 2 }} />
          ) : null}
          {hasProposalConversations ? (
            <Stack spacing={1}>
              <Typography variant="subtitle2">
                Proposal conversations
              </Typography>
              {agentSessions.map((session) => (
                <ProposalSessionRow
                  key={`shared-session-${session.id}`}
                  organizationId={organizationId}
                  projectId={projectId}
                  session={session}
                  buildSessionPath={(agentSessionId) => {
                    const rowSession = agentSessions.find(
                      (candidate) => candidate.id === agentSessionId,
                    );
                    return rowSession?.conversationId
                      ? pathService.agentSession({
                          projectId,
                          agentSessionId: rowSession.id,
                        })
                      : pathService.agentSession({ projectId, agentSessionId });
                  }}
                />
              ))}
              {refinementConversations.map((conversation) => (
                <ProposalConversationRow
                  key={`shared-conversation-${conversation.id}`}
                  organizationId={organizationId}
                  projectId={projectId}
                  conversation={conversation}
                  buildSessionPath={(agentSessionId) =>
                    pathService.agentSession({ projectId, agentSessionId })
                  }
                />
              ))}
            </Stack>
          ) : null}
        </List>
      )}
    </TabContainer>
  );
};
