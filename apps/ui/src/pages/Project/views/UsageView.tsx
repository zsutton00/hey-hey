import { ProviderUsageActivityView } from "@hey-hey/ui-common/components";
import {
  useAgentSessions,
  useUserPairedMachines,
} from "@hey-hey/ui-common/data";
import { Alert, CircularProgress, Stack } from "@mui/material";
import {
  getCostsRoutingUnavailableMessage,
  selectCostsRoutingSession,
} from "./CostsView";

export interface UsageViewProps {
  organizationId: string;
  projectId: string;
  userId: string;
}

export const UsageView = ({
  organizationId,
  projectId,
  userId,
}: UsageViewProps) => {
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
        data-testid="project-usage-routing-loading"
        p={4}
      >
        <CircularProgress size={28} />
      </Stack>
    );
  }

  if (!routingSession) {
    return (
      <Alert data-testid="project-usage-host-unavailable" severity="info">
        {getCostsRoutingUnavailableMessage(
          agentSessions,
          machines,
          "Provider usage",
        )}
      </Alert>
    );
  }

  return (
    <ProviderUsageActivityView
      organizationId={organizationId}
      projectId={projectId}
      routingAgentSessionId={routingSession.id}
    />
  );
};
