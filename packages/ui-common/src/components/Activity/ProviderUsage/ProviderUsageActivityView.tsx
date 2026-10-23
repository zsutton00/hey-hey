import {
  Alert,
  CircularProgress,
  Grid,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useProviderUsage } from "../../../data/hooks/useProviderUsage";
import { ProviderUsageCard } from "./ProviderUsageCard";
import {
  resolveProviderUsageViewState,
  type ProviderUsageViewState,
} from "./resolveProviderUsageViewState";

export interface ProviderUsageActivityViewProps {
  organizationId: string;
  projectId: string;
  routingAgentSessionId: string;
}

const assertNever = (value: never): never => {
  throw new Error(
    `Unexpected provider usage view state: ${JSON.stringify(value)}`,
  );
};

export const StateContent = ({ state }: { state: ProviderUsageViewState }) => {
  switch (state.kind) {
    case "initial-loading":
      return (
        <Paper
          data-testid="provider-usage-loading"
          sx={{ display: "flex", justifyContent: "center", p: 4 }}
        >
          <CircularProgress size={28} />
        </Paper>
      );
    case "timeout":
      return (
        <Alert data-testid="provider-usage-timeout" severity="warning">
          The connected CLI timed out while reading provider usage.{" "}
          {state.message}
        </Alert>
      );
    case "unavailable":
      return (
        <Alert data-testid="provider-usage-unavailable" severity="info">
          {state.message}
        </Alert>
      );
    case "source-error":
      return (
        <Alert data-testid="provider-usage-source-error" severity="error">
          Provider usage source error ({state.error.code}):{" "}
          {state.error.message}
        </Alert>
      );
    case "request-error":
      return (
        <Alert data-testid="provider-usage-request-error" severity="error">
          {state.error.message}
        </Alert>
      );
    case "ready": {
      const columns = Math.max(1, Math.min(3, state.providers.length));
      return (
        <Grid container data-testid="provider-usage-cards" spacing={2}>
          {state.providers.map((usage) => (
            <Grid key={usage.provider} size={{ xs: 12, md: 12 / columns }}>
              <ProviderUsageCard usage={usage} />
            </Grid>
          ))}
        </Grid>
      );
    }
    default:
      return assertNever(state);
  }
};

export const ProviderUsageActivityView = ({
  organizationId,
  projectId,
  routingAgentSessionId,
}: ProviderUsageActivityViewProps) => {
  const usage = useProviderUsage(
    organizationId,
    projectId,
    routingAgentSessionId,
  );
  const state = resolveProviderUsageViewState(usage);

  return (
    <Stack data-testid="provider-usage-view" spacing={2}>
      <Stack spacing={0.25}>
        <Typography component="h2" variant="h6">
          Usage
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Plan limits reported by each provider through the connected CLI
        </Typography>
      </Stack>
      <StateContent state={state} />
    </Stack>
  );
};
