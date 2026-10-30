import { useMemo } from "react";
import { agentSessionRoutingQueryOptions } from "../collections/agentSessions";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseAgentSessionRoutingReturn {
  routingAgentSessionId: string | null;
  isLoading: boolean;
}

/**
 * The user's most recently active session bound to one of `machineIds`, read
 * as a single id so callers never load the session list.
 */
export function useAgentSessionRouting(
  organizationId: string,
  projectId: string,
  userId: string,
  machineIds: readonly string[],
): UseAgentSessionRoutingReturn {
  const enabled = machineIds.length > 0;
  const queryOptions = useMemo(
    () =>
      agentSessionRoutingQueryOptions(
        organizationId,
        projectId,
        userId,
        machineIds,
      ),
    [organizationId, projectId, userId, machineIds],
  );
  const { result, state } = useDataLayerQuery(queryOptions, { enabled });

  return {
    routingAgentSessionId: enabled ? (result.data ?? null) : null,
    isLoading: enabled && state.isLoading,
  };
}
