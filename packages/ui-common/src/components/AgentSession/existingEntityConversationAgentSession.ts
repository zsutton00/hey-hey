import { AgentSessionType, type AgentSessionDto } from "../../api";

export type ExistingEntityConversationAgentSession = AgentSessionDto & {
  type: typeof AgentSessionType.EntityConversation;
  conversationId: string;
};

export const isExistingEntityConversationAgentSession = (
  agentSession: AgentSessionDto
): agentSession is ExistingEntityConversationAgentSession =>
  agentSession.type === AgentSessionType.EntityConversation &&
  agentSession.id.trim().length > 0 &&
  typeof agentSession.conversationId === "string" &&
  agentSession.conversationId.trim().length > 0;
