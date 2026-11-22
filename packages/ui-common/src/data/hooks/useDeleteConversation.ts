import { useApolloClient } from "@apollo/client/react";
import { getProjectGraphQLClient } from "../graphql/client";
import { platformClient } from "../../clients/serviceClients";
import {
  evictConversation,
  refreshConversationLists,
} from "../graphql/conversationCache";
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
  options: UseDeleteConversationOptions = {},
) {
  const graphqlClient = useApolloClient();

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

    const client = getProjectGraphQLClient(graphqlClient, {
      organizationId,
      projectId,
    });
    evictConversation(client, conversationId);
    void refreshConversationLists(client);
  };

  return useMutation(mutationFn, options);
}
