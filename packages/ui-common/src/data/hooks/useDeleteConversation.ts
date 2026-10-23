import { useQueryClient } from "@tanstack/react-query";
import { platformClient } from "../../clients/serviceClients";
import { removeConversation } from "../collections/conversations";
import { useMutation } from "../core/useMutation";
import type { DeleteConversationRequest } from "../../api";

export interface DeleteConversationVariables {
  organizationId: string;
  projectId: string;
  conversationId: string;
  deleteRequest?: DeleteConversationRequest;
}

export interface UseDeleteConversationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useDeleteConversation(
  options: UseDeleteConversationOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    conversationId,
    deleteRequest,
  }: DeleteConversationVariables): Promise<void> => {
    await platformClient.deleteConversation({
      organizationId: organizationId,
      projectId: projectId,
      conversationId: conversationId,
      deleteConversationRequest: deleteRequest,
    });

    // Remove the conversation from collection state
    removeConversation(queryClient, organizationId, projectId, conversationId);
  };

  return useMutation(mutationFn, options);
}
