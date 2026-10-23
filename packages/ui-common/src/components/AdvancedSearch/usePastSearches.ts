import { useMemo } from "react";
import { AgentSessionType } from "../../api";
import { useAgentSessions } from "../../data/hooks/useAgentSessions";
import { buildPastSearches, type PastSearch } from "./pastSearches";

const PAST_SEARCH_LIMIT = 20;

export interface UsePastSearchesReturn {
  pastSearches: PastSearch[];
  isLoading: boolean;
}

export function usePastSearches(
  organizationId: string,
  projectId: string,
  userId: string | undefined
): UsePastSearchesReturn {
  const { agentSessions, isLoading } = useAgentSessions(
    organizationId,
    projectId,
    {
      type: AgentSessionType.AgentSearch,
      ...(userId ? { userId } : {}),
      enabled: Boolean(userId),
    }
  );

  const pastSearches = useMemo(
    () => buildPastSearches(agentSessions, { limit: PAST_SEARCH_LIMIT }),
    [agentSessions]
  );

  return { pastSearches, isLoading };
}
