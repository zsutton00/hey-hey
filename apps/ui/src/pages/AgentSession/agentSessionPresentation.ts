import { AgentSessionType, type AgentSessionDto } from "@hey-hey/ui-common/api";
import type { AgentSessionPresentationSnapshot } from "@hey-hey/ui-common/context";
import { buildAgentSessionLabel } from "./agentic/agentSessionLabel";

export const buildAgentSessionPresentation = (
  agentSession: AgentSessionDto,
  serviceName?: string,
  entityConversationRoute?: {
    conversationId?: string | null;
    entityId?: string;
    entityType?: string;
  },
  conversationTitle?: string | null,
): AgentSessionPresentationSnapshot => {
  const launchServiceId =
    agentSession.launchServiceId ?? agentSession.service?.id;
  const embeddedLaunchServiceName =
    agentSession.service && agentSession.service.id === launchServiceId
      ? agentSession.service.name?.trim()
      : undefined;
  const route = entityConversationRoute ?? {
    conversationId: agentSession.conversationId,
    entityId: agentSession.entityId,
    entityType: agentSession.entityType,
  };
  const hasEntityConversationRoute =
    agentSession.type === AgentSessionType.EntityConversation &&
    Boolean(route.conversationId && route.entityId && route.entityType);
  const conversationTitleLabel =
    agentSession.type === AgentSessionType.EntityConversation
      ? conversationTitle?.trim()
      : undefined;

  return {
    kind: "agent_session",
    label:
      conversationTitleLabel ||
      buildAgentSessionLabel(
        agentSession,
        serviceName?.trim() || embeddedLaunchServiceName,
      ),
    sessionType: agentSession.type,
    ...(hasEntityConversationRoute
      ? {
          entityConversationRoute: {
            conversationId: route.conversationId!,
            entityId: route.entityId!,
            entityType: route.entityType!,
          },
        }
      : {}),
  };
};
