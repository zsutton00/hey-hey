import { useMemo } from "react";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { agentSessionQueryOptions } from "../collections/agentSessions";
import type { AgentSessionDto } from "../../api";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import {
  getCanonicalAgentSessionCurrentState,
  useAgentSessionCurrentState,
  type AgentSessionWithCurrentState,
} from "./useAgentSessionCurrentState";

export type UseAgentSessionOptions = CollectionHookOptions<AgentSessionDto>;

export interface UseAgentSessionReturn extends DataHookReturn<AgentSessionDto> {
  agentSession: AgentSessionWithCurrentState | null;
}

export function useAgentSession(
  organizationId: string | undefined,
  projectId: string | undefined,
  agentSessionId: string | undefined,
  options: UseAgentSessionOptions = {}
): UseAgentSessionReturn {
  const {
    enabled: enabledOption = true,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  } = options;
  const enabled =
    enabledOption && !!organizationId && !!projectId && !!agentSessionId;

  const queryOptions = useMemo(
    () =>
      agentSessionQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        agentSessionId ?? "__noop__"
      ),
    [organizationId, projectId, agentSessionId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount,
    refetchOnWindowFocus,
    staleTimeMs,
    maxCacheAgeMs,
  });

  const canonicalAgentSession = enabled ? result.data ?? null : null;
  const liveCurrentState = useAgentSessionCurrentState(
    organizationId,
    projectId,
    agentSessionId,
    {
      enabled,
      canonicalCurrentState: getCanonicalAgentSessionCurrentState(
        canonicalAgentSession
      ),
    }
  );
  const liveState = liveCurrentState.currentState;
  const agentSession = useMemo(
    () =>
      canonicalAgentSession &&
      liveState !== undefined &&
      liveState !== canonicalAgentSession.currentState
        ? { ...canonicalAgentSession, currentState: liveState }
        : canonicalAgentSession,
    [canonicalAgentSession, liveState]
  );

  return {
    agentSession,
    data: agentSession,
    ...state,
  };
}
