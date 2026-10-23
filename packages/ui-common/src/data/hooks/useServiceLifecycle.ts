import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { ProjectRole, type ServiceDto } from "../../api";
import { getApiRuntime } from "../../clients";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import { serviceKeys } from "../collections/services";
import { useMutation, type MutationResult } from "../core/useMutation";
import { useProjectMembers } from "./useProjectMembers";

/** Role Permissions: archiving or deleting a Service is Owner/Architect only. */
const SERVICE_LIFECYCLE_ROLES: ReadonlySet<ProjectRole> = new Set([
  ProjectRole.Owner,
  ProjectRole.Architect,
]);

/**
 * The caller's canonical role in the project, read from project membership.
 * Returns null while loading or when the caller is not a member; the member
 * list is paginated, so later pages are fetched until the caller is found.
 */
export function useProjectRole(
  organizationId: string | undefined,
  projectId: string | undefined,
): ProjectRole | null {
  const identity = useUserIdentity();
  const userId = identity?.userId;
  const {
    data: members,
    hasNext,
    fetchNextPage,
  } = useProjectMembers(organizationId, projectId, { enabled: !!userId });
  const role = members.find((member) => member.userId === userId)?.role ?? null;

  useEffect(() => {
    if (userId && !role && hasNext) fetchNextPage();
  }, [userId, role, hasNext, fetchNextPage]);

  return role;
}

export interface UseServiceLifecycleReturn {
  /** Hides controls only; the server remains the authority on eligibility. */
  canManageLifecycle: boolean;
  archive: MutationResult<string, ServiceDto>;
  remove: MutationResult<string, void>;
}

/**
 * Archive-before-delete Service lifecycle. `remove` only succeeds on an
 * archived Service (the API returns 409 otherwise) and removes the Service
 * from the project — it never touches files or directories.
 */
export function useServiceLifecycle(
  organizationId: string | undefined,
  projectId: string | undefined,
): UseServiceLifecycleReturn {
  const queryClient = useQueryClient();
  const role = useProjectRole(organizationId, projectId);

  const requireOrganization = (): string => {
    if (!organizationId) throw new Error("Organization is required");
    return organizationId;
  };
  const invalidateServices = (): void => {
    if (organizationId) {
      void queryClient.invalidateQueries({
        queryKey: serviceKeys.all(organizationId),
      });
    }
  };

  const archive = useMutation(
    async (serviceId: string): Promise<ServiceDto> => {
      const response = await getApiRuntime().clients.services.archiveService({
        organizationId: requireOrganization(),
        serviceId,
      });
      const archived = response.data?.data;
      if (!archived)
        throw new Error("No service returned from archive endpoint");
      return archived;
    },
    { onSuccess: invalidateServices },
  );

  const remove = useMutation(
    async (serviceId: string): Promise<void> => {
      await getApiRuntime().clients.services.deleteService({
        organizationId: requireOrganization(),
        serviceId,
      });
    },
    { onSuccess: invalidateServices },
  );

  return {
    canManageLifecycle: role !== null && SERVICE_LIFECYCLE_ROLES.has(role),
    archive,
    remove,
  };
}
