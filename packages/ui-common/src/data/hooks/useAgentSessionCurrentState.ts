import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionCurrentState, AgentSessionDto } from "../../api";
import {
  agentSessionCurrentStateQueryOptions,
  normalizeAgentSessionIds,
  type AgentSessionCurrentStateMap,
  type AgentSessionCurrentStateValue,
} from "../collections/agentSessionLiveState";

export type AgentSessionWithCurrentState = AgentSessionDto;

export const getCanonicalAgentSessionCurrentState = (
  agentSession: AgentSessionDto | null,
): AgentSessionCurrentState | undefined => {
  return agentSession?.currentState;
};

export interface UseAgentSessionCurrentStateReturn {
  currentState: AgentSessionCurrentState | undefined;
  revision: number | undefined;
  transitionedAt: string | undefined;
  isFetching: boolean;
}

export interface UseAgentSessionCurrentStatesReturn {
  currentStateById: AgentSessionCurrentStateMap;
  isFetching: boolean;
}

/**
 * Live current state for one session, read through the shared paced batch
 * and kept current by realtime events. Falls back to `canonicalCurrentState`
 * while no live revision is known.
 */
export function useAgentSessionCurrentState(
  organizationId: string | undefined,
  projectId: string | undefined,
  agentSessionId: string | undefined,
  options: {
    enabled?: boolean;
    canonicalCurrentState?: AgentSessionCurrentState;
  } = {},
): UseAgentSessionCurrentStateReturn {
  const queryClient = useQueryClient();
  const enabled =
    (options.enabled ?? true) &&
    !!organizationId &&
    !!projectId &&
    !!agentSessionId;
  const query = useQuery({
    ...agentSessionCurrentStateQueryOptions(
      queryClient,
      organizationId ?? "__noop__",
      projectId ?? "__noop__",
      agentSessionId ?? "__noop__",
    ),
    enabled,
  });
  const liveState = enabled ? query.data : undefined;

  return {
    currentState: liveState?.currentState ?? options.canonicalCurrentState,
    revision: liveState?.revision ?? undefined,
    transitionedAt: liveState?.transitionedAt ?? undefined,
    isFetching: enabled && query.isFetching,
  };
}

/** Live current state for many sessions, keyed by session id. */
export function useAgentSessionCurrentStates(
  organizationId: string | undefined,
  projectId: string | undefined,
  agentSessionIds: readonly string[],
  options: { enabled?: boolean } = {},
): UseAgentSessionCurrentStatesReturn {
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) && !!organizationId && !!projectId;
  const ids = useMemo(
    () => (enabled ? normalizeAgentSessionIds(agentSessionIds) : []),
    [agentSessionIds, enabled],
  );
  // A stable combine lets TanStack return the same result until data changes.
  const combine = useCallback(
    (results: Parameters<typeof combineById>[1]) => combineById(ids, results),
    [ids],
  );

  return useQueries({
    queries: ids.map((agentSessionId) => ({
      ...agentSessionCurrentStateQueryOptions(
        queryClient,
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        agentSessionId,
      ),
      // Untracked results: tracking costs grow with the set on every access.
      notifyOnChangeProps: ["data" as const, "isFetching" as const],
    })),
    combine,
  });
}

const combineById = (
  ids: readonly string[],
  results: ReadonlyArray<{
    data: AgentSessionCurrentStateValue | null | undefined;
    isFetching: boolean;
  }>,
): UseAgentSessionCurrentStatesReturn => {
  const currentStateById: Record<string, AgentSessionCurrentStateValue> = {};
  results.forEach((result, index) => {
    if (result.data) currentStateById[ids[index]] = result.data;
  });
  return {
    currentStateById,
    isFetching: results.some((result) => result.isFetching),
  };
};
