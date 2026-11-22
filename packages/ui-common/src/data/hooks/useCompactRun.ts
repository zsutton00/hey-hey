import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
} from "../../api";
import { useCallback } from "react";
import { apiClient } from "../../clients/client";
import { useAgentSession } from "./useAgentSession";
import { useControllerAuthorizedAction } from "./useControllerAuthorizedAction";
import { useUserPairedMachines } from "./useUserPairedMachines";

/**
 * Ask the agent session's current Run to compact its context through the
 * controller-authorized compact control. Resolves once the request is
 * accepted; the Run reports progress and settlement with compaction notices.
 */
export const useCompactRun = (
  organizationId: string,
  projectId: string,
  agentSessionId: string,
  conversationId: string,
) => {
  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const { machines } = useUserPairedMachines();
  const authorization = useControllerAuthorizedAction();
  const authorize = authorization.mutate;

  return useCallback(async (): Promise<void> => {
    const machine = machines.find(
      (candidate) => candidate.machineId === agentSession?.machineId,
    );
    if (!machine) {
      throw new Error("The agent's computer is unavailable.");
    }

    const result = await authorize({
      organizationId,
      projectId,
      machine,
      action: {
        requestId: crypto.randomUUID(),
        actionCategory: HostActionCategory.AuthorityIncreasingControl,
        actionType: HostAffectingActionType.ConversationControlCompactRun,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: agentSessionId,
        inputs: {
          kind: "CONTROL",
          body: {
            kind: "compact_run",
            agentSessionId,
            conversationId,
            runId: agentSessionId,
          },
        },
      },
      submit: ({ authorization: admission }) =>
        apiClient.compactAgentSessionRun({
          organizationId,
          projectId,
          agentSessionId,
          compactRunRequestDto: { authorization: admission },
        }),
    });
    if (result.outcome === "DENIED") {
      throw new Error(`Controller authorization denied: ${result.reason}`);
    }
  }, [
    agentSession?.machineId,
    agentSessionId,
    authorize,
    conversationId,
    machines,
    organizationId,
    projectId,
  ]);
};
