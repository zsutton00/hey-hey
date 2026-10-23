import { useConversationCliStatus } from "../../../../data/hooks/useConversationCliStatus";
import { useUserPairedMachines } from "../../../../data/hooks/useUserPairedMachines";
import {
  resolveAgentBridgeRecoveryState,
  type AgentBridgeRecoveryState,
} from "../../agentBridgeRecoveryState";

export type CliRequiredResult = AgentBridgeRecoveryState;

export function useCliRequired(
  organizationId: string | undefined,
  projectId: string | undefined,
  conversationId: string | undefined,
  options?: { enabled?: boolean },
): CliRequiredResult {
  const status = useConversationCliStatus(
    organizationId,
    projectId,
    conversationId,
    options,
  );
  const machines = useUserPairedMachines({ enabled: options?.enabled });
  if (status.error) {
    return resolveAgentBridgeRecoveryState({ type: "status_unavailable" });
  }
  return resolveAgentBridgeRecoveryState({
    type: "bound_session",
    isLoading: (status.isLoading && status.data === null) || !machines.isReady,
    machines: machines.machines,
    status: status.data,
  });
}
