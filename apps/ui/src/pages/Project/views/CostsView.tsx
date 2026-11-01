import type { MachineDto } from "@hey-hey/ui-common/api";
import {
  CostsActivityView,
  classifyMachineExecutionReadiness,
  isMachineExecutionReady,
} from "@hey-hey/ui-common/components";
import {
  useAgentSessionRouting,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { Alert, CircularProgress, Stack } from "@mui/material";
import { useMemo } from "react";

export interface CostsViewProps {
  organizationId: string;
  projectId: string;
  userId: string;
}

export const getCostsRoutingUnavailableMessage = (
  machines: MachineDto[],
  subject: string,
): string => {
  if (machines.length === 0) {
    return `${subject} is unavailable. Begin pairing locally from the CLI.`;
  }
  const ineligibleMachine = machines.find(
    (machine) => !isMachineExecutionReady(machine),
  );
  if (!machines.some(isMachineExecutionReady) && ineligibleMachine) {
    return `${subject} is unavailable. ${classifyMachineExecutionReadiness(ineligibleMachine).reason}`;
  }
  return `${subject} is unavailable because no Agent Session is bound to a ready CLI machine.`;
};

export const useCostsRouting = (
  organizationId: string,
  projectId: string,
  userId: string,
) => {
  const { machines, isLoading: areMachinesLoading } = useUserPairedMachines();
  const readyMachineIds = useMemo(
    () =>
      machines
        .filter(isMachineExecutionReady)
        .map((machine) => machine.machineId),
    [machines],
  );
  const { routingAgentSessionId, isLoading: isRoutingLoading } =
    useAgentSessionRouting(organizationId, projectId, userId, readyMachineIds);

  return {
    machines,
    routingAgentSessionId,
    isLoading: areMachinesLoading || isRoutingLoading,
  };
};

export const CostsView = ({
  organizationId,
  projectId,
  userId,
}: CostsViewProps) => {
  const { machines, routingAgentSessionId, isLoading } = useCostsRouting(
    organizationId,
    projectId,
    userId,
  );

  if (isLoading) {
    return (
      <Stack
        alignItems="center"
        data-testid="project-costs-routing-loading"
        p={4}
      >
        <CircularProgress size={28} />
      </Stack>
    );
  }

  if (!routingAgentSessionId) {
    return (
      <Alert data-testid="project-costs-host-unavailable" severity="info">
        {getCostsRoutingUnavailableMessage(machines, "Cost data")}
      </Alert>
    );
  }

  return (
    <CostsActivityView
      organizationId={organizationId}
      projectId={projectId}
      routingAgentSessionId={routingAgentSessionId}
    />
  );
};
