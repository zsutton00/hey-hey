import { useMemo } from "react";
import {
  AgentSessionContinuationState,
  type AgentSessionContinuationStatusDto,
} from "../../api";
import { agentSessionContinuationQueryOptions } from "../collections/agentSessionContinuation";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

/** Re-read while a delivered attempt waits for its destination's outcome. */
const PENDING_DELIVERY_POLL_MS = 2_000;

export type UseAgentSessionContinuationStatusReturn =
  DataHookReturn<AgentSessionContinuationStatusDto>;

export function useAgentSessionContinuationStatus(
  organizationId: string | undefined,
  projectId: string | undefined,
  agentSessionId: string | undefined,
  options: CollectionHookOptions<AgentSessionContinuationStatusDto> = {},
): UseAgentSessionContinuationStatusReturn {
  const enabled =
    (options.enabled ?? true) &&
    !!organizationId &&
    !!projectId &&
    !!agentSessionId;

  const queryOptions = useMemo(
    () => ({
      ...agentSessionContinuationQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        agentSessionId ?? "__noop__",
      ),
      refetchInterval: (query: {
        state: { data: AgentSessionContinuationStatusDto | null | undefined };
      }) =>
        query.state.data?.attempt?.state ===
        AgentSessionContinuationState.Pending
          ? PENDING_DELIVERY_POLL_MS
          : false,
    }),
    [organizationId, projectId, agentSessionId],
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });

  return {
    data: enabled ? (result.data ?? null) : null,
    ...state,
  };
}
