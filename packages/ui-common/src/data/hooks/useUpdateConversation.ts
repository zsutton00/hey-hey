import { useQueryClient } from "@tanstack/react-query";
import { updateConversation } from "../collections/conversations";
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
  options: UseUpdateConversationOptions = {},
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    conversationId,
    updateDto,
  }: UpdateConversationVariables): Promise<ConversationResponseDto> => {
    return updateConversation(
      queryClient,
      organizationId,
      projectId,
      conversationId,
      updateDto,
    );
  };

  return useMutation(mutationFn, options);
}
