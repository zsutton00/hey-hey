import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMembershipQueries } from "../query/projectOrganizationInvalidation";
import {
  OrganizationRole,
  type OrganizationMemberResponseDto,
  type ProjectRole,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface InviteByEmailVariables {
  organizationId: string;
  projectId: string;
  email: string;
  role: ProjectRole;
}

export class DuplicateEmailError extends Error {
  constructor(
    message = "User with that email already belongs to the organization"
  ) {
    super(message);
    this.name = "DuplicateEmailError";
  }
}

export interface UseInviteByEmailOptions {
  onSuccess?: (member: OrganizationMemberResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useInviteByEmail(options: UseInviteByEmailOptions = {}) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    email,
    role,
  }: InviteByEmailVariables): Promise<OrganizationMemberResponseDto> => {
    try {
      const response = await unifiedApiClient.inviteToOrganization({
        organizationId: organizationId,
        inviteToOrganizationDto: {
          email,
          role: OrganizationRole.Member,
          projects: [{ projectId, role }],
        },
      });

      const member = response.data?.data;
      if (!member) {
        throw new Error("Invite succeeded but no member was returned");
      }

      void invalidateMembershipQueries(queryClient, organizationId, projectId);
      return member;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const message = (
          error.response.data as { message?: string } | undefined
        )?.message;
        throw new DuplicateEmailError(message);
      }
      throw error;
    }
  };

  return useMutation(mutationFn, options);
}
