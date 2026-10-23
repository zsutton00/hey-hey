import {
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  type PermissionDecisionRequestDto,
} from "../../api";
import { useCallback } from "react";
import { apiClient } from "../../clients/client";
import { useAgentSession } from "./useAgentSession";
import { useControllerAuthorizedAction } from "./useControllerAuthorizedAction";
import { useUserPairedMachines } from "./useUserPairedMachines";

export type BrowserPermissionDecisionRequest = Omit<
  PermissionDecisionRequestDto,
  "authorization"
>;

export const useSubmitControllerAuthorizedPermissionDecision = (
  organizationId: string,
  projectId: string,
  agentSessionId: string | undefined
) => {
  const { agentSession } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId
  );
  const { machines } = useUserPairedMachines();
  const authorization = useControllerAuthorizedAction();
  const authorize = authorization.mutate;

  const submit = useCallback(
    async (request: BrowserPermissionDecisionRequest): Promise<void> => {
      if (!agentSessionId) {
        throw new Error("An agent session is required for this decision.");
      }
      const machine = machines.find(
        (candidate) => candidate.machineId === agentSession?.machineId
      );
      if (!machine) {
        throw new Error("The selected execution machine is unavailable.");
      }

      const result = await authorize({
        organizationId,
        projectId,
        machine,
        action: {
          requestId: crypto.randomUUID(),
          actionCategory: HostActionCategory.AuthorityIncreasingControl,
          actionType:
            HostAffectingActionType.ConversationControlPermissionDecision,
          targetKind: HostActionTargetKind.AgentSession,
          targetId: agentSessionId,
        },
        submit: ({ authorization: admission }) =>
          apiClient.submitAgentSessionPermissionDecision({
            organizationId,
            projectId,
            agentSessionId,
            permissionDecisionRequestDto: {
              ...request,
              authorization: admission,
            },
          }),
      });
      if (result.outcome === "DENIED") {
        throw new Error(`Controller authorization denied: ${result.reason}`);
      }
    },
    [
      agentSession?.machineId,
      agentSessionId,
      authorize,
      machines,
      organizationId,
      projectId,
    ]
  );

  return { submit, isPending: authorization.isPending };
};
