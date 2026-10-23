export const DataEventType = {
  AgentSessionCreated: "agentSession.created",
  AgentSessionDeleted: "agentSession.deleted",
  ConversationUpdated: "conversation.updated",
} as const;

export type DataEventType = (typeof DataEventType)[keyof typeof DataEventType];

export type DataEvent =
  | {
      type: typeof DataEventType.AgentSessionCreated;
      organizationId: string;
      taskId: string;
      agentSessionId: string;
    }
  | {
      type: typeof DataEventType.AgentSessionDeleted;
      organizationId: string;
      taskId: string;
      agentSessionId: string;
    }
  | {
      type: typeof DataEventType.ConversationUpdated;
      conversationId: string;
    };

export interface RelationshipContext {
  /** Invalidates the cached entries holding one work item. */
  invalidateWorkItem: (organizationId: string, taskId: string) => void;
  /** Invalidates a conversation's envelopes and the lists holding it. */
  invalidateConversation: (conversationId: string) => void;
}
