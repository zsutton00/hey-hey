import { AgentSessionType, WorkflowName, type AgentSessionDto, type ConversationResponseDto } from "@hey-hey/ui-common/api";
import type { PathService } from "@hey-hey/ui-common/services";
import { buildEntityConversationPath } from "./entityConversationRoute";

type ConversationDestination =
  | { kind: "resolved"; path: string }
  | { kind: "error"; message: string };

export const resolveConversationDestination = (
  pathService: PathService,
  projectId: string,
  conversationId: string,
  conversation: ConversationResponseDto | null | undefined,
  sessions: AgentSessionDto[],
): ConversationDestination => {
  if (!conversation || conversation.id !== conversationId) {
    return { kind: "error", message: "Unable to find this conversation." };
  }
  if (sessions.length === 0) {
    return { kind: "resolved", path: pathService.sessionlessConversation({ projectId, conversationId }) };
  }
  const owners = sessions.filter((session) => session.conversationId === conversationId);
  if (owners.length !== 1) {
    return {
      kind: "error",
      message: owners.length > 1
        ? "Multiple agent sessions own this conversation."
        : "The returned agent sessions do not own this conversation.",
    };
  }
  const owner = owners[0];
  if (owner.type === AgentSessionType.EntityConversation || conversation.workflowName === WorkflowName.AgentEntityConversation) {
    const path = buildEntityConversationPath(projectId, {
      agentSessionId: owner.id, conversationId,
      entityId: owner.entityId, entityType: owner.entityType,
    });
    return path
      ? { kind: "resolved", path }
      : { kind: "error", message: "The owning session is missing its entity context." };
  }
  return { kind: "resolved", path: `/projects/${projectId}/agent-sessions/${owner.id}` };
};
