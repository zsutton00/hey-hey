import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CreateUserMessage } from "../../api";
import { submitConversationMessage } from "./operations/submitConversationMessage";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";
import { useCliRequired } from "./runtime/hooks/useCliRequired";

export interface ConversationMessageSubmitterIds {
  organizationId: string | undefined;
  projectId: string | undefined;
  agentSessionId: string | undefined;
  conversationId: string | undefined;
}

/** Submits ordinary user messages to the CLI bound to an existing conversation. */
export const useConversationMessageSubmitter = ({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
}: ConversationMessageSubmitterIds): ((
  message: CreateUserMessage,
) => Promise<void>) => {
  const queryClient = useQueryClient();
  const recoveryState = useCliRequired(
    organizationId,
    projectId,
    conversationId,
  );
  const interactionAccess = useAgentSessionInteractionAccess(
    recoveryState.type === "ready" ? recoveryState.machine.machineId : null,
  );

  return useCallback(
    async (message) => {
      if (!organizationId || !projectId || !agentSessionId || !conversationId) {
        throw new Error(
          "The conversation is not ready for message submission.",
        );
      }

      await submitConversationMessage({
        interactionAccess,
        queryClient,
        organizationId,
        projectId,
        agentSessionId,
        conversationId,
        message,
      });
    },
    [
      interactionAccess,
      queryClient,
      organizationId,
      projectId,
      agentSessionId,
      conversationId,
    ],
  );
};
