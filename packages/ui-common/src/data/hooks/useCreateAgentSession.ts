import { useQueryClient } from "@tanstack/react-query";
import type { AgentSessionDto, CreateAgentSessionDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { writeAgentSession } from "../collections/agentSessions";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";

export interface CreateAgentSessionVariables {
  organizationId: string;
  agentSession: CreateAgentSessionDto;
}

export type UseCreateAgentSessionOptions = MutationOptions<AgentSessionDto>;

/**
 * Creates a session and caches its canonical read from the response. Lists
 * and paginated feeds are not written: they pick the session up through the
 * `agent_session.created` re-read, so a feed's "Updates available" hold still
 * applies.
 */
export function useCreateAgentSession(
  options: UseCreateAgentSessionOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    agentSession,
  }: CreateAgentSessionVariables): Promise<AgentSessionDto> => {
    const response = await unifiedApiClient.createAgentSession({
      organizationId,
      projectId: agentSession.projectId,
      createAgentSessionDto: agentSession,
    });
    const createdSession = response.data?.data;

    if (!createdSession) {
      throw new Error("No agent session returned from create endpoint");
    }

    writeAgentSession(
      queryClient,
      organizationId,
      createdSession.projectId,
      createdSession
    );

    return createdSession;
  };

  return useMutation(mutationFn, options);
}
