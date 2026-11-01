import { getErrorMessage } from "../../../utils/errorUtils";
import { useState } from "react";
import { LocalPromptType, MessageType, WorkflowName } from "../../../api";
import { workflowsClient } from "../../../clients/serviceClients";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import { submitControllerAuthorizedWorkflowAnswer } from "../../../data/hooks/submitControllerAuthorizedWorkflowAnswer";
import { useAgentSessionInteractionAccess } from "../../AgentSession/operations/useAgentSessionInteractionAccess";
import { buildFollowupAgentInput } from "../../AgentSession/runtime/hooks/directTriggerInput";
import type { CodingPlanVersionApproval } from "../../../api";
import type { FieldComponentContext } from "./types";

export const CODING_PLAN_REVIEW_NODE = "feature-sync-coding-plan";

export function useCodingPlanConversation(context: FieldComponentContext) {
  const { agentSession } = useAgentSession(
    context.organizationId,
    context.projectId,
    context.agentSessionId,
  );
  const access = useAgentSessionInteractionAccess(agentSession?.machineId);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (
    input: { reply: string } | { approval: CodingPlanVersionApproval },
  ): Promise<boolean> => {
    if (sending) return false;
    setSending(true);
    setError(null);
    try {
      if (!context.agentSessionId || !context.messageId)
        throw new Error("The planning conversation is unavailable.");
      const scope = {
        organizationId: context.organizationId,
        projectId: context.projectId,
        conversationId: context.conversationId,
      };
      const node = (await workflowsClient.getConversationWorkflowNode(scope))
        .data.data;
      if (node?.currentNodeId !== CODING_PLAN_REVIEW_NODE)
        throw new Error("Planning is no longer awaiting approval.");
      if ("reply" in input) {
        if (!access.isDeviceEnabled)
          throw new Error(access.unavailable.message);
        const operation = await access.interactions.submitMessage({
          ...scope,
          agentSessionId: context.agentSessionId,
          intent: {
            type: MessageType.User,
            projectId: context.projectId,
            conversationId: context.conversationId,
            parentMessageId: context.messageId,
            data: {
              agentInput: buildFollowupAgentInput(
                LocalPromptType.StartupSession,
                input.reply,
              ),
            },
          },
        });
        if (operation.state !== "succeeded" && operation.state !== "accepted")
          throw new Error(
            operation.state === "cancelled"
              ? "Reply cancelled."
              : operation.message,
          );
      } else {
        const gate = (await workflowsClient.getConversationPromptType(scope))
          .data.data;
        if (
          gate?.workflowState !== "agent-pending" ||
          gate.nodeId !== CODING_PLAN_REVIEW_NODE ||
          !gate.triggerMessageId
        ) {
          throw new Error("There is no pending planning approval.");
        }
        await submitControllerAuthorizedWorkflowAnswer({
          ...scope,
          operationId: crypto.randomUUID(),
          agentSessionId: context.agentSessionId,
          workflowName: WorkflowName.FeatureSync,
          nodeId: CODING_PLAN_REVIEW_NODE,
          parentMessageId: context.messageId,
          action: "APPROVED",
          payload: { ...input.approval },
        });
      }
      return true;
    } catch (cause) {
      setError(
        getErrorMessage(cause, "The planning reply could not be saved."),
      );
      return false;
    } finally {
      setSending(false);
    }
  };
  return { agentSession, sending, error, submit };
}
