import { Alert, CircularProgress, Paper, Stack } from "@mui/material";
import { useLocalStorage } from "@uidotdev/usehooks";
import React from "react";
import type {
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
  WebSocketSystemNotificationEvent,
} from "../../api";
import { useOptionalWebSocketService } from "../../contexts/WebSocketContext";
import {
  DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE,
  getSortOptionsForMode,
  getUiDefaultSort,
  isValidSortForMode,
} from "../../data/collections/activityCorrelations";
import {
  useCorrelatedActivity,
  type UseCorrelatedActivityOptions,
} from "../../data/hooks/useCorrelatedActivity";
import { CorrelatedActivityList } from "./CorrelatedActivityList";
import type { ActivityExpandPayload } from "./ActivityHistoryRow";

export interface CorrelatedActivityFeedProps {
  organizationId: string;
  projectId: string;
  sort?: RecentActivityCorrelationSort;
  limit?: number;
  offset?: number;
  view?: "dropdown" | "full";
  enabled?: boolean;
  userId?: string;
  subscribeToUpdates?: UseCorrelatedActivityOptions["subscribeToUpdates"];
  emptyMessage?: string;
  showHeader?: boolean;
  showModeSelector?: boolean;
  showSortSelector?: boolean;
  modeOptions?: readonly RecentActivityCorrelationMode[];
  onExpandActivity?: (payload: ActivityExpandPayload) => void;
}

export const CorrelatedActivityFeed: React.FC<CorrelatedActivityFeedProps> = ({
  organizationId,
  projectId,
  sort,
  limit,
  offset,
  view,
  enabled,
  userId,
  subscribeToUpdates,
  emptyMessage,
  showHeader,
  showModeSelector,
  showSortSelector,
  modeOptions,
  onExpandActivity,
}) => {
  const webSocketService = useOptionalWebSocketService();
  const [uncontrolledMode, setUncontrolledMode] =
    useLocalStorage<RecentActivityCorrelationMode>(
      "activity-mode",
      DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE
    );
  const [persistedSort, setPersistedSort] =
    useLocalStorage<RecentActivityCorrelationSort | null>(
      "activity-sort",
      null
    );

  const subscribeToSystemNotification = React.useCallback<
    NonNullable<UseCorrelatedActivityOptions["subscribeToUpdates"]>
  >(
    (onUpdate) => {
      if (!webSocketService) {
        return;
      }

      const subscriptionId = webSocketService.subscribe({
        events: {
          onSystemNotification: (event: WebSocketSystemNotificationEvent) => {
            if (event.organizationId !== organizationId) {
              return;
            }
            if (userId && event.userId !== userId) {
              return;
            }

            onUpdate();
          },
        },
      });

      return () => {
        webSocketService.unsubscribe(subscriptionId);
      };
    },
    [organizationId, userId, webSocketService]
  );

  const effectiveSubscribeToUpdates =
    subscribeToUpdates ??
    (webSocketService ? subscribeToSystemNotification : undefined);
  const selectedMode: RecentActivityCorrelationMode =
    modeOptions &&
    modeOptions.length > 0 &&
    !modeOptions.includes(uncontrolledMode)
      ? modeOptions[0]
      : uncontrolledMode;
  const resolvedSort = React.useMemo<RecentActivityCorrelationSort>(() => {
    if (sort) {
      return sort;
    }
    if (persistedSort && isValidSortForMode(persistedSort, selectedMode)) {
      return persistedSort;
    }
    return getUiDefaultSort(selectedMode);
  }, [sort, persistedSort, selectedMode]);
  const sortOptions = React.useMemo(
    () => getSortOptionsForMode(selectedMode),
    [selectedMode]
  );
  const effectiveShowModeSelector = showModeSelector ?? true;
  const effectiveShowSortSelector = showSortSelector ?? true;

  const handleModeChange = React.useCallback(
    (nextMode: RecentActivityCorrelationMode) => {
      setUncontrolledMode(nextMode);
    },
    []
  );

  const handleSortChange = React.useCallback(
    (nextSort: RecentActivityCorrelationSort) => {
      setPersistedSort(nextSort);
    },
    [setPersistedSort]
  );

  const { records, isLoading, isFetching, isFetched, error } =
    useCorrelatedActivity(organizationId, {
      projectId,
      mode: selectedMode,
      sort: resolvedSort,
      limit,
      offset,
      view,
      enabled,
      subscribeToUpdates: effectiveSubscribeToUpdates,
    });

  if (isLoading || (!isFetched && !error && records.length === 0)) {
    return (
      <Paper
        data-testid="correlated-activity-feed-loading"
        sx={{ p: 3, display: "flex", justifyContent: "center" }}
      >
        <CircularProgress size={24} />
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper data-testid="correlated-activity-feed-error" sx={{ p: 2 }}>
        <Alert severity="error">{error.message}</Alert>
      </Paper>
    );
  }

  return (
    <Stack data-testid="correlated-activity-feed" spacing={1.5}>
      {isFetching && (
        <CircularProgress
          size={18}
          aria-label="Refreshing activity"
          data-testid="correlated-activity-feed-refreshing"
        />
      )}
      <CorrelatedActivityList
        emptyMessage={emptyMessage}
        modeOptions={modeOptions}
        onExpandActivity={onExpandActivity}
        showHeader={showHeader}
        onSortChange={effectiveShowSortSelector ? handleSortChange : undefined}
        organizationId={organizationId}
        projectId={projectId}
        records={records}
        selectedMode={selectedMode}
        selectedSort={effectiveShowSortSelector ? resolvedSort : undefined}
        sortOptions={effectiveShowSortSelector ? sortOptions : undefined}
        onModeChange={effectiveShowModeSelector ? handleModeChange : undefined}
      />
    </Stack>
  );
};
