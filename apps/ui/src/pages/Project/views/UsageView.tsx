import { ProviderUsageActivityView } from "@hey-hey/ui-common/components";
import { Alert, CircularProgress, Stack } from "@mui/material";
import {
  getCostsRoutingUnavailableMessage,
  useCostsRouting,
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
  const { machines, routingAgentSessionId, isLoading } = useCostsRouting(
    organizationId,
    projectId,
    userId,
  );

  if (isLoading) {
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

  if (!routingAgentSessionId) {
    return (
      <Alert data-testid="project-usage-host-unavailable" severity="info">
        {getCostsRoutingUnavailableMessage(machines, "Provider usage")}
      </Alert>
    );
  }

  return (
    <ProviderUsageActivityView
      organizationId={organizationId}
      projectId={projectId}
      routingAgentSessionId={routingAgentSessionId}
    />
  );
};
