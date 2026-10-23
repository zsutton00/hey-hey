import { skipToken, useQuery } from "@tanstack/react-query";
import type { AgentSessionContextSize } from "../../api";
import { agentSessionKeys } from "../collections/agentSessions";
import { pickNewerContextSize } from "../collections/agentSessionLiveState";

export type SessionContextSize = {
  totalTokens: number;
  /** Model context window; undefined when the provider did not report one. */
  maxTokens: number | undefined;
};

/**
 * Live context-window size (tokens) for an Agent Session's latest provider
 * session. Seeds from the canonical session read and overlays newer
 * `agent_session.context_size_changed` values held in the query cache (there
 * is no read for this dataset; only events write it). Returns undefined when
 * no reading is known, or when the reading describes a provider session other
 * than `latestProviderSessionId` (e.g. after a handler swap, until the next
 * turn completes).
 */
export const useSessionContextSize = ({
  organizationId,
  projectId,
  agentSessionId,
  seed,
  latestProviderSessionId,
}: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  seed: AgentSessionContextSize | null | undefined;
  latestProviderSessionId: string | undefined;
}): SessionContextSize | undefined => {
  const { data: live } = useQuery<AgentSessionContextSize | null>({
    queryKey: agentSessionKeys.contextSize(
      organizationId,
      projectId,
      agentSessionId
    ),
    queryFn: skipToken,
  });
  const value = pickNewerContextSize(seed, live);
  if (!value) return undefined;
  if (
    latestProviderSessionId !== undefined &&
    value.providerSessionId !== latestProviderSessionId
  ) {
    return undefined;
  }
  return {
    totalTokens: value.totalTokens,
    maxTokens: value.maxTokens ?? undefined,
  };
};
