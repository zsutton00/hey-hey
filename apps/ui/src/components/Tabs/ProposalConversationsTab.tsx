import { EntityType } from "@hey-hey/ui-common/api";
import { usePathService } from "@hey-hey/ui-common/context";
import { useAgentSessions, useProposal } from "@hey-hey/ui-common/data";
import { List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { format } from "date-fns";
import React from "react";
import { useNavigate } from "react-router-dom";
import { TabContainer } from "./TabContainer";

interface ProposalConversationsTabProps {
  organizationId: string;
  projectId: string;
  proposalId: string;
}

interface ConversationRow {
  key: string;
  typeLabel: string;
  title: string;
  lastActive?: string;
  href: string;
}

const sessionTypeLabel = (type: string): string =>
  type
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

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

  if (proposalLoading || sessionsLoading) return null;

  const rows: ConversationRow[] = [
    ...(proposal?.conversationId
      ? [
          {
            key: `conversation-${proposal.conversationId}`,
            typeLabel: "Origin conversation",
            title: proposal.title ?? "Proposal",
            lastActive: proposal.createdAt,
            href: pathService.conversation({
              projectId,
              conversationId: proposal.conversationId,
            }),
          },
        ]
      : []),
    ...agentSessions.map((session) => ({
      key: `session-${session.id}`,
      typeLabel: sessionTypeLabel(session.type),
      title: session.title,
      lastActive: session.updatedAt ?? session.sessionDate,
      href: pathService.agentSession({
        projectId,
        agentSessionId: session.id,
      }),
    })),
  ];

  return (
    <TabContainer>
      {rows.length === 0 ? (
        <Typography data-testid="proposal-conversations-empty">
          No conversations about this proposal yet.
        </Typography>
      ) : (
        <List data-testid="proposal-conversations-list">
          {rows.map((row) => (
            <ListItemButton
              key={row.key}
              data-testid="proposal-conversation-row"
              onClick={() => navigate(row.href)}
            >
              <ListItemText
                primary={row.title}
                secondary={[
                  row.typeLabel,
                  row.lastActive
                    ? `Last active ${format(new Date(row.lastActive), "PPp")}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </TabContainer>
  );
};
