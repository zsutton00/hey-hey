import { useQueryClient } from "@tanstack/react-query";
import type { ConversationResponseDto, CreateConversationDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import {
  invalidateConversationLists,
  writeConversation,
} from "../collections/conversations";
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
  options: UseCreateConversationOptions = {}
) {
  const queryClient = useQueryClient();

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

    writeConversation(queryClient, organizationId, projectId, conversationData);
    void invalidateConversationLists(queryClient, organizationId, projectId);

    return conversationData;
  };

  return useMutation(mutationFn, options);
}
