import { useServices } from "../../data/hooks/useServices";
import type { AgentSessionDto } from "../../api";
import type { AgentSessionMetadataValues } from "./AgentSessionMetadata";
import { resolveAgentSessionMetadata } from "./resolveAgentSessionMetadata";

/**
 * Resolves the metadata row for a session, including each selected Service's
 * recorded place. Service names are looked up here so every surface shows the
 * same entries; resolving without the names drops every Service.
 */
export const useAgentSessionMetadata = (
  agentSession: AgentSessionDto | null | undefined,
): AgentSessionMetadataValues | undefined => {
  const services = useServices(agentSession?.organizationId, {
    projectId: agentSession?.projectId,
    enabled: (agentSession?.serviceIds?.length ?? 0) > 0,
  });

  if (!agentSession) {
    return undefined;
  }

  return resolveAgentSessionMetadata(agentSession, services.services);
};
