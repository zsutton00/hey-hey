import type {
  MessageResponseDto,
  RepositoryImportReplyAnswers,
  SubmitRepositoryImportReplyRequestDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useCallback } from "react";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface SubmitRepositoryImportReplyVariables {
  organizationId: string;
  projectId: string;
  conversationId: string;
  parentMessageId: string;
  expectedConversationVersion: number;
  answers: RepositoryImportReplyAnswers;
}

export function useSubmitRepositoryImportReply(
  options: MutationOptions<MessageResponseDto> = {}
) {
  const mutationFn = useCallback(
    async ({
      organizationId,
      projectId,
      conversationId,
      parentMessageId,
      expectedConversationVersion,
      answers,
    }: SubmitRepositoryImportReplyVariables): Promise<MessageResponseDto> => {
      const request: SubmitRepositoryImportReplyRequestDto = {
        parentMessageId,
        expectedConversationVersion,
        answers,
      };
      const response = await unifiedApiClient.submitRepositoryImportReply({
        organizationId,
        projectId,
        conversationId,
        submitRepositoryImportReplyRequestDto: request,
      });
      const message = response.data?.data;
      if (!message) {
        throw new Error("No repository import reply message returned from API");
      }
      return message;
    },
    []
  );
  return useMutation(mutationFn, options);
}
