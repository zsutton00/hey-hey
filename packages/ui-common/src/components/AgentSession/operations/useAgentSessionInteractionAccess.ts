import { useCallback, useContext, useMemo } from "react";
import { useUserPairedMachines } from "../../../data/hooks/useUserPairedMachines";
import type { AgentSessionInteractionAccess } from "./AgentOperationCoordinator";
import {
  AgentOperationContext,
  defaultAgentOperationCoordinator,
} from "./AgentOperationProvider";

const disabled = (
  unavailable: Extract<
    AgentSessionInteractionAccess,
    { isDeviceEnabled: false }
  >["unavailable"]
): AgentSessionInteractionAccess => ({
  isDeviceEnabled: false,
  interactions: null,
  unavailable,
});

export interface AgentSessionInteractionAccessResolver {
  getAccess(
    machineId: string | null | undefined
  ): AgentSessionInteractionAccess;
}

export const useAgentSessionInteractionAccessResolver =
  (): AgentSessionInteractionAccessResolver => {
    const contextCoordinator = useContext(AgentOperationContext);
    const coordinator = contextCoordinator ?? defaultAgentOperationCoordinator;
    const machinesQuery = useUserPairedMachines();

    const getAccess = useCallback(
      (machineId: string | null | undefined): AgentSessionInteractionAccess => {
        if (!machineId) {
          return disabled({
            type: "machine_not_selected",
            message: "Select an execution-ready machine to continue.",
          });
        }
        if (!machinesQuery.isFetched || machinesQuery.isLoading) {
          return disabled({
            type: "inventory_loading",
            message:
              "Checking whether this browser can use the selected machine.",
          });
        }
        if (machinesQuery.error) {
          return disabled({
            type: "inventory_error",
            message: "Machine availability could not be loaded.",
          });
        }
        const machine = machinesQuery.machines.find(
          (candidate) => candidate.machineId === machineId
        );
        if (!machine) {
          return disabled({
            type: "machine_unavailable",
            message: "The selected machine is no longer available.",
          });
        }
        return coordinator.accessForMachine(machine);
      },
      [
        coordinator,
        machinesQuery.error,
        machinesQuery.isFetched,
        machinesQuery.isLoading,
        machinesQuery.machines,
      ]
    );

    return useMemo(() => ({ getAccess }), [getAccess]);
  };

export const useAgentSessionInteractionAccess = (
  machineId: string | null | undefined
): AgentSessionInteractionAccess => {
  const resolver = useAgentSessionInteractionAccessResolver();
  return useMemo(() => resolver.getAccess(machineId), [machineId, resolver]);
};
