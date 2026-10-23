import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { useProjectSessionCosts } from "../../../data/hooks/useProjectSessionCosts";
import {
  formatActivityRelativeTimestamp,
  formatActivityTimestamp,
} from "../activityFormatting";
import {
  CostsActivityFilters,
  type CostsActivityFilterDraft,
} from "./CostsActivityFilters";
import { CostsActivityRow } from "./CostsActivityRow";
import {
  resolveCostsActivityViewState,
  type CostsActivityViewState,
} from "./resolveCostsActivityViewState";

export interface CostsActivityViewProps {
  organizationId: string;
  projectId: string;
  routingAgentSessionId: string;
  pageSize?: number;
}

const toDateTimeLocalInput = (date: Date): string => {
  const localTime = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000
  );
  return localTime.toISOString().slice(0, 19);
};

const createInitialFilters = (): CostsActivityFilterDraft => {
  const now = new Date();
  now.setMilliseconds(0);
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  return {
    activityFrom: toDateTimeLocalInput(from),
    activityTo: toDateTimeLocalInput(now),
    minKnownCostUsd: "",
  };
};

const toActivityBoundary = (value: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  return new Date(value).toISOString();
};

const toPositiveCost = (value: string): number | undefined => {
  const parsed = Number(value);
  return value !== "" && Number.isFinite(parsed) && parsed > 0
    ? parsed
    : undefined;
};

const assertNever = (value: never): never => {
  throw new Error(`Unexpected Costs view state: ${JSON.stringify(value)}`);
};

const StateContent = ({
  projectId,
  state,
  hasNextPage,
  onLoadMore,
}: {
  projectId: string;
  state: CostsActivityViewState;
  hasNextPage: boolean;
  onLoadMore: () => void;
}) => {
  switch (state.kind) {
    case "initial-loading":
      return (
        <Paper
          data-testid="costs-activity-loading"
          sx={{ display: "flex", justifyContent: "center", p: 4 }}
        >
          <CircularProgress size={28} />
        </Paper>
      );
    case "timeout":
      return (
        <Alert data-testid="costs-activity-timeout" severity="warning">
          The connected CLI timed out while reading costs. {state.message}
        </Alert>
      );
    case "unavailable":
      return (
        <Alert data-testid="costs-activity-unavailable" severity="info">
          {state.message}
        </Alert>
      );
    case "source-error":
      return (
        <Alert data-testid="costs-activity-source-error" severity="error">
          Cost source error ({state.error.code}): {state.error.message}
        </Alert>
      );
    case "request-error":
      return (
        <Alert data-testid="costs-activity-request-error" severity="error">
          {state.error.message}
        </Alert>
      );
    case "empty":
      return (
        <Paper data-testid="costs-activity-empty" sx={{ p: 3 }}>
          <Typography color="text.secondary" variant="body2">
            No sessions match the current cost filters.
          </Typography>
          <Typography color="text.secondary" variant="caption">
            Cost data read {formatActivityTimestamp(state.costReadAt)}
          </Typography>
        </Paper>
      );
    case "ready":
      return (
        <Stack data-testid="costs-activity-results" spacing={1.5}>
          <Stack alignItems="center" direction="row" flexWrap="wrap" gap={1}>
            <Chip
              label={`Source ${state.result.sourceAvailability}`}
              size="small"
              variant="outlined"
            />
            <Typography color="text.secondary" variant="caption">
              Updated {formatActivityRelativeTimestamp(state.result.costReadAt)}
            </Typography>
          </Stack>
          {state.result.items.map((row) => (
            <CostsActivityRow
              key={row.agentSessionId}
              projectId={projectId}
              row={row}
            />
          ))}
          {hasNextPage ? (
            <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
              <Button
                data-testid="costs-activity-load-more"
                disabled={state.isLoadingMore}
                onClick={onLoadMore}
                variant="outlined"
              >
                {state.isLoadingMore ? "Loading…" : "Load more"}
              </Button>
            </Box>
          ) : null}
        </Stack>
      );
    default:
      return assertNever(state);
  }
};

export const CostsActivityView = ({
  organizationId,
  projectId,
  routingAgentSessionId,
  pageSize = 25,
}: CostsActivityViewProps) => {
  const [filters, setFilters] =
    useState<CostsActivityFilterDraft>(createInitialFilters);
  const queryOptions = useMemo(
    () => ({
      activityFrom: toActivityBoundary(filters.activityFrom),
      activityTo: toActivityBoundary(filters.activityTo),
      minKnownCostUsd: toPositiveCost(filters.minKnownCostUsd),
      limit: pageSize,
    }),
    [filters, pageSize]
  );
  const costs = useProjectSessionCosts(
    organizationId,
    projectId,
    routingAgentSessionId,
    queryOptions
  );
  const state = resolveCostsActivityViewState({
    result: costs.result,
    typedError: costs.typedError,
    requestError: costs.requestError,
    isInitialLoading: costs.isInitialLoading,
    isLoadingMore: costs.isLoadingMore,
  });

  return (
    <Stack data-testid="costs-activity-view" spacing={2}>
      <Stack
        alignItems={{ xs: "flex-start", sm: "center" }}
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        spacing={1}
      >
        <Stack spacing={0.25}>
          <Typography component="h2" variant="h6">
            Costs
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Agent-session costs reported by the connected CLI
          </Typography>
        </Stack>
      </Stack>
      <CostsActivityFilters onChange={setFilters} value={filters} />
      <StateContent
        hasNextPage={costs.hasNextPage}
        onLoadMore={costs.loadNextPage}
        projectId={projectId}
        state={state}
      />
    </Stack>
  );
};
