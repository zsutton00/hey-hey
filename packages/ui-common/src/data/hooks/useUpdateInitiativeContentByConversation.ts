import { platformClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";
import type { UpdateInitiativeContentByConversationRequest } from "../../api";

export interface UpdateInitiativeContentByConversationVariables {
  orgId: string;
  projectId: string;
  conversationId: string;
  initiativeId: string;
  data: UpdateInitiativeContentByConversationRequest;
}

export interface UpdateInitiativeContentByConversationOptions {
  onSuccess?: (data: unknown) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export const useUpdateInitiativeContentByConversation = (
  options: UpdateInitiativeContentByConversationOptions = {}
) => {
  const mutationFn = async ({
    orgId,
    projectId,
    conversationId,
    initiativeId,
    data,
  }: UpdateInitiativeContentByConversationVariables): Promise<unknown> => {
    const response = await platformClient.updateInitiativeContentByConversation(
      {
        organizationId: orgId,
        projectId: projectId,
        conversationId: conversationId,
        initiativeId: initiativeId,
        updateInitiativeContentByConversationRequest: data,
      }
    );
    return response.data;
  };

  const mutation = useMutation(mutationFn, options);

  return {
    update: mutation.mutate,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
