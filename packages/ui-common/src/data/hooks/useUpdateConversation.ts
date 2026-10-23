import { useQueryClient } from "@tanstack/react-query";
import { platformClient } from "../../clients/serviceClients";
import { writeConversation } from "../collections/conversations";
import { useMutation } from "../core/useMutation";
import type { UpdateConversationDto, ConversationResponseDto } from "../../api";

export interface UpdateConversationVariables {
  organizationId: string;
  projectId: string;
  conversationId: string;
  updateDto: UpdateConversationDto;
}

export interface UseUpdateConversationOptions {
  onSuccess?: (conversation: ConversationResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useUpdateConversation(
  options: UseUpdateConversationOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    conversationId,
    updateDto,
  }: UpdateConversationVariables): Promise<ConversationResponseDto> => {
    const response = await platformClient.updateConversation({
      organizationId: organizationId,
      projectId: projectId,
      conversationId: conversationId,
      updateConversationDto: updateDto,
    });
    const conversationData = response.data?.data;
    if (!conversationData) {
      throw new Error("No conversation data returned from API");
    }

    writeConversation(queryClient, organizationId, projectId, conversationData);

    return conversationData;
  };

  return useMutation(mutationFn, options);
}
