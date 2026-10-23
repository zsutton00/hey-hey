import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import type {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  ProjectLimitReachedDto,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts";
import {
  projectKeys,
  writeProject,
  removeCachedProject,
} from "../collections/projects";
import type { MutationCallbacks } from "../core/types";
import type { UseOrganizationProjectEntitlementReturn } from "./useOrganizationProjectEntitlement";
function mutationError(cause: unknown): Error {
  if (
    axios.isAxiosError<ProjectLimitReachedDto>(cause) &&
    cause.response?.data?.code === "ORGANIZATION_PROJECT_LIMIT_REACHED"
  )
    return new Error(cause.response.data.message);
  return cause instanceof Error ? cause : new Error(String(cause));
}

async function createAuthorizedProject(
  organizationId: string,
  projectData: CreateProjectDto,
  refetchEntitlement: UseOrganizationProjectEntitlementReturn["refetch"],
): Promise<ProjectResponseDto> {
  if (!projectData.name.trim()) throw new Error("Project name is required");
  const entitlement = await refetchEntitlement();
  if (!entitlement) throw new Error("Project entitlement is unavailable");
  if (!entitlement.canCreateProject) {
    throw new Error(
      entitlement.creationUnavailableReason ??
        "Project creation is unavailable for this organization.",
    );
  }
  const created = (
    await platformClient.createProject({
      organizationId,
      createProjectDto: projectData,
    })
  ).data?.data;
  if (!created) throw new Error("No data returned from create project");
  return created;
}

export function useCreateProject(
  organizationId: string | undefined,
  entitlementQuery: UseOrganizationProjectEntitlementReturn,
) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const pathService = usePathService();
  return useCallback(
    async (
      projectData: CreateProjectDto,
      callbacks?: MutationCallbacks<ProjectResponseDto> & {
        skipNavigation?: boolean;
      },
    ): Promise<boolean> => {
      try {
        if (!organizationId) throw new Error("No organization selected");
        const created = await createAuthorizedProject(
          organizationId,
          projectData,
          entitlementQuery.refetch,
        );
        writeProject(client, organizationId, created);
        client.setQueryData<ProjectResponseDto[]>(
          projectKeys.list(organizationId),
          (rows) =>
            rows && [...rows.filter((row) => row.id !== created.id), created],
        );
        if (!callbacks?.skipNavigation)
          navigate(
            pathService.onboarding({ projectId: created.id, isNew: true }),
            { replace: true },
          );
        callbacks?.onSuccess?.(created);
        return true;
      } catch (cause) {
        callbacks?.onError?.(mutationError(cause));
        return false;
      } finally {
        await entitlementQuery.refetch().catch(() => undefined);
        callbacks?.onSettled?.();
      }
    },
    [organizationId, client, entitlementQuery.refetch, navigate, pathService],
  );
}

export function useUpdateProject(organizationId: string | undefined) {
  const client = useQueryClient();
  return useCallback(
    async (
      id: string,
      updates: UpdateProjectDto,
      callbacks?: MutationCallbacks<ProjectResponseDto>,
    ): Promise<ProjectResponseDto> => {
      if (!organizationId) throw new Error("No organization selected");
      const listKey = projectKeys.list(organizationId);
      const detailKey = projectKeys.detail(organizationId, id);
      await Promise.all([
        client.cancelQueries({ queryKey: listKey, exact: true }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousList = client.getQueryData<ProjectResponseDto[]>(listKey);
      const previousDetail = client.getQueryData<ProjectResponseDto>(detailKey);
      const current =
        previousDetail ?? previousList?.find((row) => row.id === id);
      if (current)
        writeProject(client, organizationId, {
          ...current,
          ...updates,
          updatedAt: new Date().toISOString(),
        });
      try {
        const updated = (
          await platformClient.updateProject({
            organizationId,
            projectId: id,
            updateProjectDto: updates,
          })
        ).data?.data;
        if (!updated) throw new Error("Update response data is missing");
        writeProject(client, organizationId, updated);
        callbacks?.onSuccess?.(updated);
        return updated;
      } catch (cause) {
        client.setQueryData(listKey, previousList);
        if (previousDetail) client.setQueryData(detailKey, previousDetail);
        else client.removeQueries({ queryKey: detailKey, exact: true });
        const error = mutationError(cause);
        callbacks?.onError?.(error);
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, organizationId],
  );
}

export function useRemoveProject(organizationId: string | undefined) {
  const client = useQueryClient();
  return useCallback(
    async (id: string, callbacks?: MutationCallbacks<void>): Promise<void> => {
      if (!organizationId) throw new Error("No organization selected");
      const listKey = projectKeys.list(organizationId);
      const detailKey = projectKeys.detail(organizationId, id);
      await Promise.all([
        client.cancelQueries({ queryKey: listKey, exact: true }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousList = client.getQueryData<ProjectResponseDto[]>(listKey);
      client.setQueryData<ProjectResponseDto[]>(listKey, (rows) =>
        rows?.filter((row) => row.id !== id),
      );
      try {
        await platformClient.removeProject({ organizationId, projectId: id });
        removeCachedProject(client, organizationId, id);
        callbacks?.onSuccess?.();
      } catch (cause) {
        client.setQueryData(listKey, previousList);
        const error = mutationError(cause);
        callbacks?.onError?.(error);
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, organizationId],
  );
}
