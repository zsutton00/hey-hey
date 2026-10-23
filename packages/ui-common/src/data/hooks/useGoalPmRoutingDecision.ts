import type {
  GoalPmRoutingDecisionResponseDto,
  GoalPmRoutingSelectionPayload,
} from "../../api";
import { suggestionsClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface GoalPmRoutingDecisionVariables {
  organizationId: string;
  conversationId: string;
  selection: GoalPmRoutingSelectionPayload;
}

export function useGoalPmRoutingDecision() {
  return useMutation(
    async ({
      organizationId,
      conversationId,
      selection,
    }: GoalPmRoutingDecisionVariables): Promise<GoalPmRoutingDecisionResponseDto> => {
      const response = await suggestionsClient.recordGoalPmRoutingDecision({
        organizationId,
        conversationId,
        goalPmRoutingSelectionPayload: selection,
      });
      if (!response.data.data)
        throw new Error("No saved routing choice returned");
      return response.data.data;
    }
  );
}
