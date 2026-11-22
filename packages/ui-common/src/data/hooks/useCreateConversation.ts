import { useApolloClient } from "@apollo/client/react";
import type { ConversationResponseDto, CreateConversationDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { refreshConversationLists } from "../graphql/conversationCache";
import { useMutation } from "../core/useMutation";

export interface CreateConversationVariables {
  organizationId: string;
  projectId: string;
  conversationDto: CreateConversationDto;
}

export interface UseCreateConversationOptions {
  onSuccess?: (conversation: ConversationResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useCreateConversation(
  options: UseCreateConversationOptions = {},
) {
  const graphqlClient = useApolloClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    conversationDto,
  }: CreateConversationVariables): Promise<ConversationResponseDto> => {
    const response = await platformClient.createConversation({
      organizationId: organizationId,
      projectId: projectId,
      createConversationDto: conversationDto,
    });
    const conversationData = response.data?.data;
    if (!conversationData) {
      throw new Error("No conversation data returned from API");
    }

    void refreshConversationLists(graphqlClient);

    return conversationData;
  };

  return useMutation(mutationFn, options);
}
