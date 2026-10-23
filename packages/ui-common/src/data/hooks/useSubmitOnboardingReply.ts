import type {
  MessageResponseDto,
  OnboardingReplyAnswers,
  SubmitOnboardingReplyRequestDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useCallback } from "react";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface SubmitOnboardingReplyVariables {
  organizationId: string;
  projectId: string;
  conversationId: string;
  parentMessageId: string;
  answers: OnboardingReplyAnswers;
}

export type UseSubmitOnboardingReplyOptions =
  MutationOptions<MessageResponseDto>;

export function useSubmitOnboardingReply(
  options: UseSubmitOnboardingReplyOptions = {}
) {
  const mutationFn = useCallback(
    async ({
      organizationId,
      projectId,
      conversationId,
      parentMessageId,
      answers,
    }: SubmitOnboardingReplyVariables): Promise<MessageResponseDto> => {
      // Message updates intentionally do not refresh the conversation envelope.
      // Read the admission version at the user's gesture, not from that envelope.
      const versionResponse = await unifiedApiClient.getConversationVersion({
        organizationId,
        projectId,
        conversationId,
      });
      const expectedConversationVersion = versionResponse.data.data?.version;
      if (
        expectedConversationVersion === undefined ||
        !Number.isFinite(expectedConversationVersion)
      ) {
        throw new Error("No current conversation version returned from API");
      }
      const request: SubmitOnboardingReplyRequestDto = {
        parentMessageId,
        expectedConversationVersion,
        answers,
      };

      const response = await unifiedApiClient.submitOnboardingReply({
        organizationId,
        projectId,
        conversationId,
        submitOnboardingReplyRequestDto: request,
      });
      const message = response.data?.data;
      if (!message) {
        throw new Error("No onboarding reply message returned from API");
      }

      return message;
    },
    []
  );

  return useMutation(mutationFn, options);
}
