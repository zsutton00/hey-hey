import { useQueryClient } from "@tanstack/react-query";
import type {
  ResolveWorkItemCoordinatorAgentSessionDto,
  ResolveWorkItemCoordinatorAgentSessionResponseDto,
} from "../../api";
import { agentSessionsClient } from "../../clients/serviceClients";
import { writeAgentSession } from "../collections/agentSessions";
import { useMutation, type MutationOptions } from "../core/useMutation";

export interface ResolveWorkItemCoordinatorVariables {
  organizationId: string;
  projectId: string;
  body: ResolveWorkItemCoordinatorAgentSessionDto;
}

export type UseResolveWorkItemCoordinatorOptions =
  MutationOptions<ResolveWorkItemCoordinatorAgentSessionResponseDto>;

export function useResolveWorkItemCoordinator(
  options: UseResolveWorkItemCoordinatorOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    body,
  }: ResolveWorkItemCoordinatorVariables): Promise<ResolveWorkItemCoordinatorAgentSessionResponseDto> => {
    const response = await agentSessionsClient.resolveWorkItemCoordinator({
      organizationId: organizationId,
      projectId: projectId,
      resolveWorkItemCoordinatorAgentSessionDto: body,
    });
    const payload = response.data?.data;
    if (!payload) {
      throw new Error(
        "The platform did not return a Task Monitor coordinator."
      );
    }

    writeAgentSession(
      queryClient,
      organizationId,
      projectId,
      payload.agentSession
    );

    return payload;
  };

  return useMutation(mutationFn, options);
}
