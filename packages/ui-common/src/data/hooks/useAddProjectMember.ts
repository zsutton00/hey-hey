import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMembershipQueries } from "../query/projectOrganizationInvalidation";
import type { ProjectMemberResponseDto, ProjectRole } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useMutation } from "../core/useMutation";

export interface AddProjectMemberVariables {
  organizationId: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
}

export class DuplicateMembershipError extends Error {
  constructor(message = "User is already a member of this project") {
    super(message);
    this.name = "DuplicateMembershipError";
  }
}

export interface UseAddProjectMemberOptions {
  onSuccess?: (member: ProjectMemberResponseDto) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

export function useAddProjectMember(options: UseAddProjectMemberOptions = {}) {
  const queryClient = useQueryClient();

  const mutationFn = async ({
    organizationId,
    projectId,
    userId,
    role,
  }: AddProjectMemberVariables): Promise<ProjectMemberResponseDto> => {
    try {
      const response = await unifiedApiClient.addProjectMember({
        organizationId: organizationId,
        projectId: projectId,
        addProjectMemberDto: { userId, role },
      });

      const member = response.data?.data;
      if (!member) {
        throw new Error("Add succeeded but no member was returned");
      }

      void invalidateMembershipQueries(queryClient, organizationId, projectId);
      return member;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const message = (
          error.response.data as { message?: string } | undefined
        )?.message;
        throw new DuplicateMembershipError(message);
      }
      throw error;
    }
  };

  return useMutation(mutationFn, options);
}
