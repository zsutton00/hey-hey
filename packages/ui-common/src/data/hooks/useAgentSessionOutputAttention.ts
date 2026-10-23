import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
  acknowledgeAgentSessionOutputAttention,
  agentSessionOutputAttentionQueryOptions,
  normalizeAgentSessionIds,
  writeAgentSessionOutputAttention,
  type AgentSessionOutputAttentionMap,
  type AgentSessionOutputAttentionValue,
} from "../collections/agentSessionLiveState";

const combineById = (
  ids: readonly string[],
  results: ReadonlyArray<{
    data: AgentSessionOutputAttentionValue | null | undefined;
  }>,
): AgentSessionOutputAttentionMap => {
  const byId: Record<string, AgentSessionOutputAttentionValue> = {};
  results.forEach((result, index) => {
    if (result.data) byId[ids[index]] = result.data;
  });
  return byId;
};

/**
 * Output attention for many sessions, keyed by session id. Each session is
 * read once through the shared paced batch however many components show it.
 * Reading never acknowledges.
 */
export const useAgentSessionOutputAttentions = (
  organizationId: string | undefined,
  projectId: string | undefined,
  agentSessionIds: readonly string[],
  options: { enabled?: boolean } = {},
): AgentSessionOutputAttentionMap => {
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) && !!organizationId && !!projectId;
  const ids = useMemo(
    () => (enabled ? normalizeAgentSessionIds(agentSessionIds) : []),
    [agentSessionIds, enabled],
  );
  const combine = useCallback(
    (results: Parameters<typeof combineById>[1]) => combineById(ids, results),
    [ids],
  );

  return useQueries({
    queries: ids.map((agentSessionId) => ({
      ...agentSessionOutputAttentionQueryOptions(
        queryClient,
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        agentSessionId,
      ),
      // Untracked results: tracking costs grow with the set on every access.
      notifyOnChangeProps: ["data" as const],
    })),
    combine,
  });
};

/** Explicit acknowledgment; the returned entry is written into the cache. */
export const useAcknowledgeAgentSessionOutputAttention = (
  organizationId: string | undefined,
  projectId: string | undefined,
  agentSessionId: string | undefined,
): (() => Promise<void>) => {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    if (!organizationId || !projectId || !agentSessionId) return;
    const entry = await acknowledgeAgentSessionOutputAttention(
      organizationId,
      projectId,
      agentSessionId,
    );
    writeAgentSessionOutputAttention(
      queryClient,
      organizationId,
      projectId,
      entry,
    );
  }, [agentSessionId, organizationId, projectId, queryClient]);
};
