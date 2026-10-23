import { WebPathService } from "@hey-hey/ui-common/services";

export interface EntityConversationRouteSession {
  agentSessionId: string;
  conversationId?: string | null;
  entityId?: string;
  entityType?: string;
}

export const buildEntityConversationPath = (
  projectId: string,
  session: EntityConversationRouteSession,
): string | null => {
  if (
    !session.conversationId ||
    !session.entityId ||
    !session.entityType
  ) {
    return null;
  }

  return WebPathService.entityConversation({
    projectId,
    agentSessionId: session.agentSessionId,
    conversationId: session.conversationId,
    entityId: session.entityId,
    entityType: session.entityType,
  });
};
