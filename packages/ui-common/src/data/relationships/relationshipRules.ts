import { DataEventType } from "./dataEvents";
import type { DataEvent, RelationshipContext } from "./dataEvents";

type DataEventTypeName = (typeof DataEventType)[keyof typeof DataEventType];

type RelationshipRule<T extends DataEventTypeName> = (
  event: Extract<DataEvent, { type: T }>,
  context: RelationshipContext,
) => void;

export const relationshipRules: {
  [K in DataEventTypeName]: RelationshipRule<K>;
} = {
  [DataEventType.AgentSessionCreated]: (event, context) => {
    context.invalidateWorkItem(event.organizationId, event.taskId);
  },
  [DataEventType.AgentSessionDeleted]: (event, context) => {
    context.invalidateWorkItem(event.organizationId, event.taskId);
  },
  [DataEventType.ConversationUpdated]: (event, context) => {
    context.invalidateConversation(event.conversationId);
  },
};

export function emitDataEvent<T extends DataEventTypeName>(
  event: Extract<DataEvent, { type: T }>,
  context: RelationshipContext,
): void {
  relationshipRules[event.type](event, context);
}
