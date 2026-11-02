import type { ConversationResponseDto, MessageResponseDto } from "../api";
import {
  toOpenApiMessageId,
  toOpenApiOrganizationId,
} from "../clients/contractIdentifierAdapters";

const messagesByConversation = new WeakMap<
  ConversationResponseDto,
  MessageResponseDto[]
>();
export function conversationFixture(
  metadata: ConversationResponseDto,
  messages: MessageResponseDto[],
): ConversationResponseDto {
  const conversation = {
    ...metadata,
    organizationId:
      metadata.organizationId ?? toOpenApiOrganizationId("test-org"),
  };
  messagesByConversation.set(conversation, messages);
  return conversation;
}
export const fixtureMessages = (
  conversation: ConversationResponseDto,
): MessageResponseDto[] => messagesByConversation.get(conversation) ?? [];
export function flattenFixtureMessages(
  messages: MessageResponseDto[],
  parentMessageId?: string,
): MessageResponseDto[] {
  return messages.flatMap((message) => [
    {
      ...message,
      parentMessageId:
        message.parentMessageId ??
        (parentMessageId ? toOpenApiMessageId(parentMessageId) : undefined),
      responses: [],
    },
    ...flattenFixtureMessages(message.responses ?? [], message.id),
  ]);
}
