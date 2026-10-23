import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { AgentSessionDto } from "../../api";
import {
  agentSessionKeys,
  invalidateAgentSessionDetail,
} from "../collections/agentSessions";

interface CachedAgentSessionInput {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
}

interface UpdateCachedAgentSessionInput extends CachedAgentSessionInput {
  update: (agentSession: AgentSessionDto) => AgentSessionDto;
}

interface UseUpdateCachedAgentSessionReturn {
  updateCachedAgentSession: (input: UpdateCachedAgentSessionInput) => boolean;
  markCachedAgentSessionStale: (input: CachedAgentSessionInput) => void;
}

export function useUpdateCachedAgentSession(): UseUpdateCachedAgentSessionReturn {
  const queryClient = useQueryClient();

  /** Updates a cached canonical read; returns false when none is cached. */
  const updateCachedAgentSession = useCallback(
    ({
      organizationId,
      projectId,
      agentSessionId,
      update,
    }: UpdateCachedAgentSessionInput): boolean => {
      const queryKey = agentSessionKeys.detail(
        organizationId,
        projectId,
        agentSessionId,
      );
      if (!queryClient.getQueryData<AgentSessionDto>(queryKey)) return false;
      queryClient.setQueryData<AgentSessionDto>(queryKey, (current) =>
        current ? update(current) : current,
      );
      return true;
    },
    [queryClient],
  );

  const markCachedAgentSessionStale = useCallback(
    ({
      organizationId,
      projectId,
      agentSessionId,
    }: CachedAgentSessionInput): void => {
      void invalidateAgentSessionDetail(
        queryClient,
        organizationId,
        projectId,
        agentSessionId,
      );
    },
    [queryClient],
  );

  return {
    updateCachedAgentSession,
    markCachedAgentSessionStale,
  };
}
