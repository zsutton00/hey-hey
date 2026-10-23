import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
  MutationCallbacks,
} from "../core/types";
import { agentSessionListQueryOptions } from "../collections/agentSessions";
import type { AgentSessionDto, AgentSessionType, EntityType } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import {
  useAgentSessionCurrentStates,
  type AgentSessionWithCurrentState,
} from "./useAgentSessionCurrentState";
import { useAgentSessionOutputAttentions } from "./useAgentSessionOutputAttention";
import type { AgentSessionOutputAttentionMap } from "../collections/agentSessionLiveState";

export interface UseAgentSessionsOptions
  extends CollectionHookOptions<AgentSessionDto> {
  ids?: string[];
  userId?: string;
  conversationId?: string;
  entityType?: EntityType;
  entityId?: string;
  serviceId?: string;
  type?: AgentSessionType;
  includeOutputAttention?: boolean;
}

export interface UseAgentSessionsReturn
  extends DataCollectionHookReturn<AgentSessionDto> {
  agentSessions: AgentSessionWithCurrentState[];
  outputAttentionById: AgentSessionOutputAttentionMap;
  remove: (id: string, callbacks?: MutationCallbacks<void>) => Promise<void>;
}

const EMPTY_SESSIONS: AgentSessionDto[] = [];

export function useAgentSessions(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseAgentSessionsOptions = {}
): UseAgentSessionsReturn {
  const {
    ids,
    userId,
    conversationId,
    entityType,
    entityId,
    serviceId,
    type,
    includeOutputAttention = false,
    enabled: enabledOption = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;
  const enabled = enabledOption && !!organizationId && !!projectId;
  const queryClient = useQueryClient();

  const idsKey = ids?.join(",") ?? "";
  const queryOptions = useMemo(
    () =>
      agentSessionListQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        {
          ids: idsKey ? idsKey.split(",") : undefined,
          userId,
          conversationId,
          entityType,
          entityId,
          serviceId,
          type,
        }
      ),
    [
      organizationId,
      projectId,
      idsKey,
      userId,
      conversationId,
      entityType,
      entityId,
      serviceId,
      type,
    ]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  });

  const canonicalAgentSessions =
    (enabled ? result.data : undefined) ?? EMPTY_SESSIONS;
  const agentSessionIds = useMemo(
    () => canonicalAgentSessions.map((agentSession) => agentSession.id),
    [canonicalAgentSessions]
  );
  const currentStateOverlay = useAgentSessionCurrentStates(
    organizationId,
    projectId,
    agentSessionIds,
    { enabled }
  );
  const outputAttentionById = useAgentSessionOutputAttentions(
    organizationId,
    projectId,
    agentSessionIds,
    { enabled: includeOutputAttention && enabled }
  );
  const agentSessions = useMemo(
    () =>
      canonicalAgentSessions.map((agentSession) => {
        const liveState = currentStateOverlay.currentStateById[agentSession.id];
        return liveState
          ? { ...agentSession, currentState: liveState.currentState }
          : agentSession;
      }),
    [canonicalAgentSessions, currentStateOverlay.currentStateById]
  );

  const remove = useCallback(
    async (id: string, callbacks?: MutationCallbacks<void>): Promise<void> => {
      if (!organizationId || !projectId) {
        throw new Error(
          "Organization ID and Project ID are required to delete agent sessions"
        );
      }

      const queryKey = queryOptions.queryKey;
      const previous = queryClient.getQueryData<AgentSessionDto[]>(queryKey);
      if (!previous?.some((session) => session.id === id)) {
        throw new Error(`Agent session ${id} not found`);
      }

      // Hide the row while the delete is in flight; restore it on failure.
      queryClient.setQueryData<AgentSessionDto[]>(queryKey, (current) =>
        current?.filter((session) => session.id !== id)
      );

      try {
        await unifiedApiClient.deleteAgentSession(
          organizationId,
          projectId,
          id
        );
        callbacks?.onSuccess?.();
      } catch (error) {
        queryClient.setQueryData(queryKey, previous);
        const err = error as Error;
        callbacks?.onError?.(err);
        throw err;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [organizationId, projectId, queryClient, queryOptions.queryKey]
  );

  return {
    agentSessions,
    outputAttentionById,
    data: agentSessions,
    ...state,
    remove,
  };
}
