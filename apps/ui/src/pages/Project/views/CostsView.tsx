import type { AgentSessionDto, MachineDto } from "@hey-hey/ui-common/api";
import {
  CostsActivityView,
  classifyMachineExecutionReadiness,
  isMachineExecutionReady,
} from "@hey-hey/ui-common/components";
import {
  useAgentSessions,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { Alert, CircularProgress, Stack } from "@mui/material";

export interface CostsViewProps {
  organizationId: string;
  projectId: string;
  userId: string;
}

const activityTime = (session: AgentSessionDto): number => {
  const timestamp = Date.parse(
    session.updatedAt ?? session.createdAt ?? session.sessionDate,
  );
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const selectCostsRoutingSession = (
  sessions: AgentSessionDto[],
  machines: MachineDto[],
): AgentSessionDto | null => {
  const readyMachineIds = new Set(
    machines.filter(isMachineExecutionReady).map((machine) => machine.machineId),
  );
  const boundSessions = sessions.filter(
    (session): session is AgentSessionDto & { machineId: string } =>
      Boolean(session.machineId),
  );
  const readySessions = boundSessions.filter((session) =>
    readyMachineIds.has(session.machineId),
  );

  return (
    [...readySessions].sort(
      (left, right) =>
        activityTime(right) - activityTime(left) ||
        right.id.localeCompare(left.id),
    )[0] ?? null
  );
};

export const getCostsRoutingUnavailableMessage = (
  sessions: AgentSessionDto[],
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
  const boundReadyMachineIds = new Set(
    sessions.flatMap((session) => (session.machineId ? [session.machineId] : [])),
  );
  const unboundReadyMachine = machines.find(
    (machine) =>
      isMachineExecutionReady(machine) &&
      !boundReadyMachineIds.has(machine.machineId),
  );
  if (unboundReadyMachine) {
    return `${subject} is unavailable because no Agent Session is bound to a ready CLI machine.`;
  }
  return `${subject} is unavailable because no ready CLI route exists.`;
};

export const CostsView = ({
  organizationId,
  projectId,
  userId,
}: CostsViewProps) => {
  const { agentSessions, isLoading: areSessionsLoading } = useAgentSessions(
    organizationId,
    projectId,
    { userId },
  );
  const { machines, isLoading: areMachinesLoading } = useUserPairedMachines();
  const routingSession = selectCostsRoutingSession(agentSessions, machines);

  if (areSessionsLoading || areMachinesLoading) {
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

  if (!routingSession) {
    return (
      <Alert data-testid="project-costs-host-unavailable" severity="info">
        {getCostsRoutingUnavailableMessage(agentSessions, machines, "Cost data")}
      </Alert>
    );
  }

  return (
    <CostsActivityView
      organizationId={organizationId}
      projectId={projectId}
      routingAgentSessionId={routingSession.id}
    />
  );
};
