import type { ConversationStartResponseDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface StartConversationVariables {
  organizationId: string;
  projectId: string;
  conversationId: string;
}

export interface UseStartConversationOptions {
  onSuccess?: (data: ConversationStartResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

/**
 * Transition a NOT_STARTED conversation to STARTED via POST
 * /organizations/{orgId}/projects/{projectId}/conversations/{conversationId}/start.
 *
 * The server is responsible for idempotency: re-calling against a conversation
 * already past NOT_STARTED returns 200 with `started=false`. No client-side
 * retries — the caller is expected to refetch the conversation on success so a
 * subsequent status read reflects IN_PROGRESS.
 */
export function useStartConversation(
  options: UseStartConversationOptions = {}
) {
  const mutationFn = async ({
    organizationId,
    projectId,
    conversationId,
  }: StartConversationVariables): Promise<ConversationStartResponseDto> => {
    const response = await platformClient.startConversation({
      organizationId: organizationId,
      projectId: projectId,
      conversationId: conversationId,
    });
    const data = response.data?.data;
    if (!data) {
      throw new Error("No start-conversation data returned from API");
    }
    return data;
  };

  return useMutation(mutationFn, options);
}
