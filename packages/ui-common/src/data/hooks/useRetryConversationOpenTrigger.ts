import type { ConversationTriggerRetryResponseDto } from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { useMutation, type MutationOptions } from "../core/useMutation";

export interface RetryConversationOpenTriggerVariables {
  organizationId: string;
  projectId: string;
  conversationId: string;
}

export function useRetryConversationOpenTrigger(
  options: MutationOptions<ConversationTriggerRetryResponseDto> = {}
) {
  return useMutation(async (variables: RetryConversationOpenTriggerVariables) => {
    const response = await platformClient.retryConversationOpenTrigger(variables);
    const data = response.data?.data;
    if (!data) throw new Error("No retry-open-trigger data returned from API");
    return data;
  }, options);
}
