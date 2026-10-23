import type {
  SuggestionDecisionMetadata,
  SuggestionDecisionRequestDto,
  SuggestionDecisionResponseDto,
  SuggestionType,
} from "../../api";
import { suggestionsClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface SuggestionDecisionVariables {
  organizationId: string;
  type: SuggestionType;
  suggestionId: string;
  accepted: boolean;
  sourceConversationId: string;
  sourceMessageId: string;
  metadata?: SuggestionDecisionMetadata;
}

export interface UseSuggestionDecisionOptions {
  onSuccess?: (decision: SuggestionDecisionResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export const useSuggestionDecision = (
  options: UseSuggestionDecisionOptions = {}
) => {
  const mutationFn = async ({
    organizationId,
    type,
    suggestionId,
    accepted,
    sourceConversationId,
    sourceMessageId,
    metadata,
  }: SuggestionDecisionVariables): Promise<SuggestionDecisionResponseDto> => {
    const request: SuggestionDecisionRequestDto = {
      accepted,
      sourceConversationId,
      sourceMessageId,
      metadata,
    };

    const response =
      await suggestionsClient.recordSuggestionDecision(
        {
          organizationId: organizationId,
          type: type,
          suggestionId: suggestionId,
          suggestionDecisionRequestDto: request,
        }
      );

    const decision = response.data?.data;
    if (!decision) {
      throw new Error("No suggestion decision returned from API");
    }

    return decision;
  };

  return useMutation(mutationFn, options);
};
