import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  OpenItemGoalTrackedWorkFilter,
  WorkStatus,
  type TrackedEntitySnapshot,
} from "../../api";
import { agentSessionListQueryOptions } from "../collections/agentSessions";
import { agentSessionCurrentStateQueryOptions } from "../collections/agentSessionLiveState";
import { useWorkItem } from "./useWorkItem";

const EMPTY_WORK: TrackedEntitySnapshot[] = [];

/** Mounted only for an expanded Goal. No base-row entity hydration. */
export function useOpenItemGoalWork(
  organizationId: string,
  projectId: string,
  goalId: string,
  filter: OpenItemGoalTrackedWorkFilter,
) {
  const queryClient = useQueryClient();
  const goal = useWorkItem(organizationId, "task", goalId, { projectId });
  const trackedWork =
    goal.workItem && "trackedEntities" in goal.workItem
      ? (goal.workItem.trackedEntities ?? EMPTY_WORK)
      : EMPTY_WORK;
  const activeCandidates = useMemo(
    () =>
      filter === OpenItemGoalTrackedWorkFilter.Active
        ? trackedWork.filter((work) => work.status !== WorkStatus.Active)
        : EMPTY_WORK,
    [filter, trackedWork],
  );
  const sessionQueries = useQueries({
    queries: activeCandidates.map((work) =>
      agentSessionListQueryOptions(organizationId, projectId, {
        entityType: work.targetEntityType,
        entityId: work.targetEntityId,
      }),
    ),
  });
  const runningSessions = sessionQueries.flatMap((query) =>
    (query.data ?? []).filter(
      (session) => session.status === AgentSessionStatus.InProgress,
    ),
  );
  const sessionIds = [
    ...new Set(runningSessions.map((session) => session.id)),
  ].sort();
  const currentStates = useQueries({
    queries: sessionIds.map((id) =>
      agentSessionCurrentStateQueryOptions(
        queryClient,
        organizationId,
        projectId,
        id,
      ),
    ),
  });
  const stateById = new Map(
    sessionIds.map((id, index) => [
      id,
      currentStates[index]?.data?.currentState,
    ]),
  );
  const activeWorkKeys = new Set<string>();
  sessionQueries.forEach((query, index) => {
    if (
      (query.data ?? []).some((session) => {
        const state = stateById.get(session.id) ?? session.currentState;
        return (
          session.status === AgentSessionStatus.InProgress &&
          state !== undefined &&
          state !== AgentSessionCurrentState.Idle
        );
      })
    ) {
      const work = activeCandidates[index];
      activeWorkKeys.add(`${work.targetEntityType}:${work.targetEntityId}`);
    }
  });
  const work = trackedWork.filter((item) => {
    switch (filter) {
      case OpenItemGoalTrackedWorkFilter.None:
        return false;
      case OpenItemGoalTrackedWorkFilter.All:
        return true;
      case OpenItemGoalTrackedWorkFilter.ActiveAndBacklog:
        return (
          item.status !== WorkStatus.Completed &&
          item.status !== WorkStatus.Cancelled
        );
      case OpenItemGoalTrackedWorkFilter.Active:
        return (
          item.status === WorkStatus.Active ||
          activeWorkKeys.has(`${item.targetEntityType}:${item.targetEntityId}`)
        );
    }
  });
  const error =
    goal.error ??
    sessionQueries.find((query) => query.error)?.error ??
    currentStates.find((query) => query.error)?.error ??
    null;
  const isLoading =
    goal.isLoading ||
    sessionQueries.some((query) => query.isPending) ||
    currentStates.some((query) => query.isPending);
  const retry = async () => {
    await goal.refetch();
    await Promise.all(
      [...sessionQueries, ...currentStates].map((query) => query.refetch()),
    );
  };
  return { work, isLoading, error, retry };
}
