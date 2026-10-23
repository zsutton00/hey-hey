import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMembershipQueries } from "../query/projectOrganizationInvalidation";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface RemoveOrganizationMemberVariables {
  organizationId: string;
  userId: string;
}

export class LastOrganizationOwnerError extends Error {
  constructor(message = "Cannot remove the last owner of an organization") {
    super(message);
    this.name = "LastOrganizationOwnerError";
  }
}

export interface UseRemoveOrganizationMemberOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useRemoveOrganizationMember(
  options: UseRemoveOrganizationMemberOptions = {}
) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    userId,
  }: RemoveOrganizationMemberVariables): Promise<void> => {
    try {
      await unifiedApiClient.removeOrganizationMember({
        organizationId: organizationId,
        userId: userId,
      });

      void invalidateMembershipQueries(queryClient, organizationId);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        const message = (
          error.response.data as { message?: string } | undefined
        )?.message;
        throw new LastOrganizationOwnerError(message);
      }
      throw error;
    }
  };

  return useMutation(mutationFn, options);
}
