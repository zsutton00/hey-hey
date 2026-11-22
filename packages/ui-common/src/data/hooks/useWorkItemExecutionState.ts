import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  WorkItemExecutionFreshness,
  WorkItemExecutionState,
} from "../../api";
import { useRequiredProjectContext } from "../../contexts/ProjectContext";
import {
  readWorkItemExecutionStateDelivery,
  subscribeWorkItemExecutionStateDelivery,
  workItemExecutionStateQueryOptions,
  type WorkItemExecutionStateDelivery,
} from "../collections/workItemExecutionState";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

/**
 * `retained` carries the type's own state and, separately, its freshness: a
 * `LAST_KNOWN` state is the owner's last report, not what is happening now.
 * `missing` means the platform holds nothing, which is not a readiness signal.
 * `delivery` qualifies both: `INTERRUPTED` means this client may have missed
 * newer reports (disconnected, or not yet recovered), so even a `CURRENT`
 * freshness is only what was true when delivery was last live.
 */
export type WorkItemExecutionStateResult =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "missing"; delivery: WorkItemExecutionStateDelivery }
  | {
      status: "retained";
      delivery: WorkItemExecutionStateDelivery;
      state: WorkItemExecutionState["state"];
      freshness: WorkItemExecutionFreshness;
      revision: number;
      ownerMachineId: string;
      acceptedAt: string;
    };

/**
 * Latest execution state of one work item in the current project, replayed on
 * first use and kept current by realtime updates. Every consumer of the same
 * item shares one entry, whether or not the item's own page is open.
 */
export function useWorkItemExecutionState(
  workItemId: string,
): WorkItemExecutionStateResult {
  const { organizationId, projectId } = useRequiredProjectContext();
  return useProjectWorkItemExecutionState(
    organizationId,
    projectId,
    workItemId,
  );
}

export function useProjectWorkItemExecutionState(
  organizationId: string,
  projectId: string,
  workItemId: string,
): WorkItemExecutionStateResult {
  const queryClient = useQueryClient();
  const query = useQuery(
    workItemExecutionStateQueryOptions(
      queryClient,
      organizationId,
      projectId,
      workItemId,
    ),
  );
  // Updates reach only members of the project room; each consumer holds its
  // own membership so it never depends on another component being mounted.
  useWebsocketSubscriptions({ projectIds: [projectId] }, { enabled: true });
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

  if (query.data?.result === "RETAINED") {
    const { state, freshness, revision, ownerMachineId, acceptedAt } =
      query.data.executionState;

    return {
      status: "retained",
      delivery,
      state,
      freshness,
      revision,
      ownerMachineId,
      acceptedAt,
    };
  }
  if (query.data) {
    return { status: "missing", delivery };
  }
  if (query.error) {
    return { status: "error", error: query.error };
  }

  return { status: "loading" };
}
