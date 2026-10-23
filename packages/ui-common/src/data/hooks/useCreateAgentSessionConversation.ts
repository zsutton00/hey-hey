import { useQueryClient } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import type {
  ConversationResponseDto,
  CreateAgentSessionConversationDto,
  CreateAgentSessionConversationResponseDto,
} from "../../api";
import { agentSessionsClient } from "../../clients/serviceClients";
import {
  invalidateAgentSessionDetail,
  writeAgentSession,
} from "../collections/agentSessions";
import {
  invalidateConversationLists,
  writeConversation,
} from "../collections/conversations";
import { useMutation, type MutationOptions } from "../core/useMutation";

export interface CreateAgentSessionConversationVariables {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  body: CreateAgentSessionConversationDto;
}

export type UseCreateAgentSessionConversationOptions =
  MutationOptions<CreateAgentSessionConversationResponseDto>;

export const isConflictError = (error: unknown): boolean => {
  const status = (error as AxiosError | undefined)?.response?.status;
  return status === 409;
};

export function useCreateAgentSessionConversation(
  options: UseCreateAgentSessionConversationOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    agentSessionId,
    body,
  }: CreateAgentSessionConversationVariables): Promise<CreateAgentSessionConversationResponseDto> => {
    const commitAgentSessionStale = (): void => {
      void invalidateAgentSessionDetail(
        queryClient,
        organizationId,
        projectId,
        agentSessionId
      );
    };

    let payload: CreateAgentSessionConversationResponseDto;
    try {
      const response =
        await agentSessionsClient.createAgentSessionConversation(
          {
            organizationId: organizationId,
            projectId: projectId,
            agentSessionId: agentSessionId,
            createAgentSessionConversationDto: body,
          }
        );
      const data = response.data?.data;
      if (!data) {
        throw new Error(
          "No data returned from create-agent-session-conversation endpoint"
        );
      }
      payload = data;
    } catch (error) {
      if (isConflictError(error)) {
        // Another client already linked a conversation; refetch the session.
        commitAgentSessionStale();
      }
      throw error;
    }

    const { agentSession, conversation } = payload;

    writeConversation(
      queryClient,
      organizationId,
      projectId,
      conversation as ConversationResponseDto
    );

    writeAgentSession(queryClient, organizationId, projectId, agentSession);

    void invalidateConversationLists(queryClient, organizationId, projectId);

    return payload;
  };

  return useMutation(mutationFn, options);
}
