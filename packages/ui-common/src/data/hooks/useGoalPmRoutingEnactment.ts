import { useQueryClient } from "@tanstack/react-query";
import type {
  GoalPmRoutingEnactmentRequest,
  GoalPmRoutingEnactmentResponse,
  RunCreatePayloadEntityConversation,
} from "../../api";
import { suggestionsClient } from "../../clients/serviceClients";
import { invalidateConversationMessages } from "../collections/messages";
import { useAgentSessionInteractionAccessResolver } from "../../components/AgentSession/operations/useAgentSessionInteractionAccess";
import { useMutation } from "../core/useMutation";

export interface GoalPmRoutingEnactmentVariables {
  organizationId: string;
  projectId: string;
  goalId: string;
  sourceConversationId: string;
  input: GoalPmRoutingEnactmentRequest;
}

export function useGoalPmRoutingEnactment() {
  const queryClient = useQueryClient();
  const accessResolver = useAgentSessionInteractionAccessResolver();
  return useMutation(
    async ({
      organizationId,
      projectId,
      goalId,
      sourceConversationId,
      input,
    }: GoalPmRoutingEnactmentVariables): Promise<GoalPmRoutingEnactmentResponse> => {
      const refresh = () =>
        void invalidateConversationMessages(
          queryClient,
          organizationId,
          projectId,
          sourceConversationId,
        );
      try {
        const response = await suggestionsClient.enactGoalPmRoutingChoice({
          organizationId,
          conversationId: sourceConversationId,
          goalPmRoutingEnactmentRequest: input,
        });
        const result = response.data.data;
        if (!result) throw new Error("No routing outcome was returned.");
        refresh();
        if (result.answer.state === "COMPLETED") return result;
        const { answer } = result;
        const { outcome, creation } = answer;
        if (
          !outcome ||
          outcome.entityType !== "CONVERSATION" ||
          !outcome.agentSessionId ||
          !creation
        ) {
          throw new Error(
            "The selected choice is saved, but its completion is unavailable. Retry to recover it.",
          );
        }
        const access = accessResolver.getAccess(creation.machineId);
        if (!access.isDeviceEnabled)
          throw new Error(access.unavailable.message);
        const identity = {
          organizationId,
          projectId,
          agentSessionId: outcome.agentSessionId,
          conversationId: outcome.entityId,
          operationId: answer.operationId,
        };
        const payload: RunCreatePayloadEntityConversation = {
          promptType: "entity_conversation",
          entity: { entityType: "TASK", entityId: goalId, taskType: "GOAL" },
          userMessage: answer.pendingRequest,
        };
        const operation =
          answer.selectedOption.kind === "startNewConversation"
            ? await access.interactions.startSession({
                ...identity,
                intent: {
              attachments: [],
                  handlerPromptType: "entity_conversation",
                  payload,
                  model: creation.config.model,
                  config: creation.config,
                  reasoningEffort: creation.config.effort ?? "medium",
                  provider: creation.provider,
                  ...(creation.fastMode !== undefined
                    ? { fastMode: creation.fastMode }
                    : {}),
                  contextMetadata: {
                    capturedAt: answer.requestedAt,
                    organizationId,
                    projectId,
                    agentSessionId: outcome.agentSessionId,
                    userComments: [],
                    fileReferences: { resolved: [], unresolved: [] },
                  },
                  initialMessage: { role: "USER" },
                },
              })
            : await access.interactions.submitMessage({
                ...identity,
                intent: {
                  projectId,
                  conversationId: outcome.entityId,
                  type: "USER",
                  data: {
                    agentInput:
                      answer.selectedOption.kind === "refineSearch"
                        ? {
                            promptType: "goal_pm",
                            entity: {
                              entityType: "TASK",
                              entityId: goalId,
                              taskType: "GOAL",
                            },
                            userMessage: answer.selectedOption.prompt,
                          }
                        : {
                            promptType: "entity_conversation",
                            entity: payload.entity,
                            userMessage: answer.pendingRequest,
                          },
                  },
                },
              });
        if (operation.state !== "succeeded" && operation.state !== "accepted")
          throw new Error(
            operation.state === "cancelled"
              ? "The conversation is saved. Request authorization was cancelled; retry when ready."
              : operation.message,
          );
        const completed = await suggestionsClient.completeGoalPmRoutingChoice({
          organizationId,
          conversationId: sourceConversationId,
          goalPmRoutingCompletionRequest: { selection: input.selection },
        });
        if (!completed.data.data)
          throw new Error(
            "The request was sent, but its saved answer could not be refreshed. Retry to recover the result.",
          );
        return completed.data.data;
      } finally {
        refresh();
      }
    },
  );
}
