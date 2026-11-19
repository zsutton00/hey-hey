import type { ApolloClient } from "@apollo/client";
import type { QueryClient } from "@tanstack/react-query";
import type { CreateUserMessage } from "../../../api";
import {
  messageKeys,
  refreshConversationMessages,
} from "../../../data/collections/messages";
import type { AgentSessionInteractionAccess } from "./AgentOperationCoordinator";

export interface SubmitConversationMessageInput {
  interactionAccess: AgentSessionInteractionAccess;
  queryClient: QueryClient;
  graphqlClient: ApolloClient;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  message: CreateUserMessage;
}

/** Sends a user message to the Agent Session's CLI and refreshes the conversation. */
export const submitConversationMessage = async ({
  interactionAccess,
  queryClient,
  graphqlClient,
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  message,
}: SubmitConversationMessageInput): Promise<void> => {
  if (!interactionAccess.isDeviceEnabled) {
    throw new Error(interactionAccess.unavailable.message);
  }

  const result = await interactionAccess.interactions.submitMessage({
    organizationId,
    projectId,
    agentSessionId,
    conversationId,
    intent: {
      projectId: message.projectId,
      type: message.type,
      ...(message.userId ? { userId: message.userId } : {}),
      ...(message.status ? { status: message.status } : {}),
      conversationId: message.conversationId,
      ...(message.parentMessageId !== undefined
        ? { parentMessageId: message.parentMessageId }
        : {}),
      ...(message.createdAt ? { createdAt: message.createdAt } : {}),
      data: message.data,
      ...(message.handler ? { handler: message.handler } : {}),
    },
  });
  if (result.state !== "succeeded" && result.state !== "accepted") {
    throw new Error(
      result.state === "cancelled"
        ? "The operation was cancelled."
        : result.message,
    );
  }

  void refreshConversationMessages(
    graphqlClient,
    { organizationId, projectId },
    conversationId,
  );
  void queryClient.invalidateQueries({
    queryKey: messageKeys.queuedInputs(
      organizationId,
      projectId,
      conversationId,
    ),
  });
};
