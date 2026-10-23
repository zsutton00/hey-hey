import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMembershipQueries } from "../query/projectOrganizationInvalidation";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface RemoveProjectMemberVariables {
  organizationId: string;
  projectId: string;
  userId: string;
}

export class LastProjectOwnerError extends Error {
  constructor(message = "Cannot remove the last owner of a project") {
    super(message);
    this.name = "LastProjectOwnerError";
  }
}

export interface UseRemoveProjectMemberOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useRemoveProjectMember(
  options: UseRemoveProjectMemberOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    userId,
  }: RemoveProjectMemberVariables): Promise<void> => {
    try {
      await unifiedApiClient.removeProjectMember({
        organizationId: organizationId,
        projectId: projectId,
        userId: userId,
      });

      void invalidateMembershipQueries(queryClient, organizationId, projectId);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        const message = (
          error.response.data as { message?: string } | undefined
        )?.message;
        throw new LastProjectOwnerError(message);
      }
      throw error;
    }
  };

  return useMutation(mutationFn, options);
}
