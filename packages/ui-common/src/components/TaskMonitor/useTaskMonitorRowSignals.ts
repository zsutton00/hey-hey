import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import {
  readWorkItemExecutionStateDelivery,
  subscribeWorkItemExecutionStateDelivery,
  workItemExecutionStateQueryOptions,
} from "../../data/collections/workItemExecutionState";
import { useWebsocketSubscriptions } from "../../data/hooks/useWebsocketSubscriptions";
import {
  taskMonitorRowSignal,
  type TaskMonitorRowSignal,
} from "./taskMonitorRowSignal";

/**
 * Live signals for the visible Task Monitor rows, keyed by monitor id. Each
 * monitor shares one cache entry with every other consumer (including its own
 * page), so rows update from pushed snapshots with no polling and no detail
 * read. Dropping an id releases its subscription once no consumer holds it.
 */
export function useTaskMonitorRowSignals(
  organizationId: string,
  projectId: string,
  monitorIds: readonly string[],
): Record<string, TaskMonitorRowSignal> {
  const queryClient = useQueryClient();
  const ids = useMemo(() => [...new Set(monitorIds)].sort(), [monitorIds]);
  const results = useQueries({
    queries: ids.map((id) =>
      workItemExecutionStateQueryOptions(
        queryClient,
        organizationId,
        projectId,
        id,
      ),
    ),
  });
  useWebsocketSubscriptions(
    { projectIds: [projectId] },
    { enabled: ids.length > 0 },
  );
  const delivery = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        subscribeWorkItemExecutionStateDelivery(queryClient, listener),
      [queryClient],
    ),
    () =>
      readWorkItemExecutionStateDelivery(
        queryClient,
        organizationId,
        projectId,
      ),
  );

  return useMemo(() => {
    const signals: Record<string, TaskMonitorRowSignal> = {};
    ids.forEach((id, index) => {
      const { data, error } = results[index];
      if (data?.result === "RETAINED") {
        const { state, freshness } = data.executionState;
        signals[id] = taskMonitorRowSignal({
          status: "retained",
          delivery,
          freshness,
          projection: state.projection,
        });
      } else if (data) {
        signals[id] = taskMonitorRowSignal({ status: "missing" });
      } else {
        signals[id] = taskMonitorRowSignal({
          status: error ? "error" : "loading",
        });
      }
    });

    return signals;
  }, [ids, results, delivery]);
}
