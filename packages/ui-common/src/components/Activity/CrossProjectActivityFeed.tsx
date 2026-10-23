import { Alert, Button, CircularProgress, Paper, Stack } from "@mui/material";
import React from "react";
import type {
  CrossProjectActivityFilterParams,
  CrossProjectActivityMetricParams,
  CrossProjectActivityHistoryParams,
} from "../../data/collections/activityCorrelations";
import {
  useCrossProjectActivity,
  type UseCrossProjectActivityOptions,
} from "../../data/hooks/useCorrelatedActivity";
import { CorrelatedActivityList } from "./CorrelatedActivityList";
import type { ActivityExpandPayload } from "./ActivityHistoryRow";

export type CrossProjectActivityFeedQuery =
  | Omit<CrossProjectActivityFilterParams, "organizationId">
  | Omit<CrossProjectActivityMetricParams, "organizationId">
  | Omit<CrossProjectActivityHistoryParams, "organizationId">;

export interface CrossProjectActivityFeedProps {
  organizationId: string;
  query?: CrossProjectActivityFeedQuery;
  enabled?: boolean;
  emptyMessage?: string;
  onExpandActivity?: (payload: ActivityExpandPayload) => void;
  onPageChange?: (offset: number) => void;
}

const buildHookOptions = (
  query: CrossProjectActivityFeedQuery | undefined,
  enabled: boolean
): UseCrossProjectActivityOptions => {
  if (query?.historyFilter !== undefined) {
    return {
      activityScope: "organization",
      historyFilter: query.historyFilter,
      limit: query.limit,
      offset: query.offset,
      enabled,
      view: "full",
    };
  }
  if (query?.metricContinuation !== undefined) {
    return {
      activityScope: "organization",
      metricContinuation: query.metricContinuation,
      limit: query.limit,
      offset: query.offset,
      enabled,
      view: "full",
    };
  }

  return {
    activityScope: "organization",
    projectId: query?.projectId,
    userId: query?.userId,
    entityType: query?.entityType,
    activityMode: query?.activityMode,
    activityType: query?.activityType,
    source: query?.source,
    serviceId: query?.serviceId,
    since: query?.since,
    until: query?.until,
    affectsMe: query?.affectsMe,
    sinceLastVisit: query?.sinceLastVisit,
    limit: query?.limit,
    offset: query?.offset,
    enabled,
    view: "full",
  };
};

export const CrossProjectActivityFeed: React.FC<
  CrossProjectActivityFeedProps
> = ({
  organizationId,
  query,
  enabled = true,
  emptyMessage = "No activity found for these filters",
  onExpandActivity,
  onPageChange,
}) => {
  const hookOptions = React.useMemo(
    () => buildHookOptions(query, enabled),
    [enabled, query]
  );
  const {
    records,
    error,
    isFetching,
    isLoading,
    isFetched,
    pagination,
    refetch,
  } = useCrossProjectActivity(organizationId, hookOptions);

  const currentOffset = query?.offset ?? 0;
  const currentLimit = query?.limit ?? pagination.limit ?? 50;
  const fallbackNextOffset =
    pagination.totalCount !== null &&
    currentOffset + records.length < pagination.totalCount
      ? currentOffset + currentLimit
      : null;
  const nextOffset = pagination.nextOffset ?? fallbackNextOffset;
  const canPaginate = onPageChange !== undefined;

  if ((isLoading || !isFetched) && records.length === 0) {
    return (
      <Paper
        data-testid="cross-project-activity-loading"
        sx={{ p: 3, display: "flex", justifyContent: "center" }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper data-testid="cross-project-activity-error" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Alert severity="error">{error.message}</Alert>
          <Button
            data-testid="cross-project-activity-retry"
            onClick={() => {
              void refetch().catch(() => undefined);
            }}
            size="small"
            sx={{ alignSelf: "flex-start" }}
            variant="outlined"
          >
            Retry
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack data-testid="cross-project-activity-feed" spacing={1.5}>
      {isFetching ? (
        <CircularProgress
          aria-label="Refreshing activity"
          data-testid="cross-project-activity-refreshing"
          size={18}
        />
      ) : null}
      <CorrelatedActivityList
        emptyMessage={emptyMessage}
        onExpandActivity={onExpandActivity}
        organizationId={organizationId}
        projectId={
          query?.metricContinuation !== undefined ? undefined : query?.projectId
        }
        showHeader={false}
        records={records}
      />
      {canPaginate && (currentOffset > 0 || nextOffset !== null) ? (
        <Stack
          alignItems="center"
          data-testid="cross-project-activity-pagination"
          direction="row"
          justifyContent="space-between"
        >
          <Button
            data-testid="cross-project-activity-previous"
            disabled={currentOffset === 0}
            onClick={() =>
              onPageChange?.(Math.max(0, currentOffset - currentLimit))
            }
            size="small"
            variant="outlined"
          >
            Previous
          </Button>
          <Button
            data-testid="cross-project-activity-next"
            disabled={nextOffset === null}
            onClick={() => {
              if (nextOffset !== null) {
                onPageChange?.(nextOffset);
              }
            }}
            size="small"
            variant="outlined"
          >
            Next
          </Button>
        </Stack>
      ) : null}
    </Stack>
  );
};
