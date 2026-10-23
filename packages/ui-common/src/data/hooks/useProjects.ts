import {
  useCreateProject,
  useUpdateProject,
  useRemoveProject,
} from "./useProjectMutations";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import orderBy from "lodash/orderBy.js";
import type {
  CreateProjectDto,
  UpdateProjectDto,
  ProjectResponseDto,
  OrganizationProjectEntitlementDto,
} from "../../api";
import { usePathService } from "../../contexts";
import { projectKeys, projectsQueryOptions } from "../collections/projects";
import type { CollectionHookOptions, MutationCallbacks } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useOrganizationProjectEntitlement } from "./useOrganizationProjectEntitlement";
export interface UseProjectsReturn {
  projects: ProjectResponseDto[];
  isLoading: boolean; // Only true during initial fetch (when never fetched before)
  isFetching: boolean; // True during any fetch operation (initial or background)
  isFetched: boolean; // Have attempted to fetch at least once
  isReady: boolean; // Safe to show data/empty states (isFetched && !error)
  error: ReactNode | null;
  isStale: boolean;
  fetchingProjects: boolean; // Backward compatibility alias
  create: (
    projectData: CreateProjectDto,
    callbacks?: MutationCallbacks<ProjectResponseDto> & {
      skipNavigation?: boolean;
    },
  ) => Promise<boolean>;
  update: (
    id: string,
    updates: UpdateProjectDto,
    callbacks?: MutationCallbacks<ProjectResponseDto>,
  ) => Promise<ProjectResponseDto>;
  remove: (id: string, callbacks?: MutationCallbacks<void>) => Promise<void>;
  selectProject: (projectId: string) => void;
  refetch: () => Promise<ProjectResponseDto[] | null>;
  markStale: () => void;
  clearError: () => void;
  entitlement: OrganizationProjectEntitlementDto | null;
  entitlementLoading: boolean;
  refreshEntitlement: () => Promise<OrganizationProjectEntitlementDto | null>;
}

export function useProjects(
  organizationId: string | undefined,
  options: CollectionHookOptions<ProjectResponseDto> = {},
): UseProjectsReturn {
  const navigate = useNavigate();
  const pathService = usePathService();
  const client = useQueryClient();
  const org = organizationId ?? "";
  const key = projectKeys.list(org);
  const entitlementQuery = useOrganizationProjectEntitlement(organizationId, {
    enabled: options.enabled !== false && !!organizationId,
  });
  const { result, state } = useDataLayerQuery(projectsQueryOptions(org), {
    ...options,
    enabled: options.enabled !== false && !!organizationId,
  });

  const create = useCreateProject(organizationId, entitlementQuery);
  const update = useUpdateProject(organizationId);
  const remove = useRemoveProject(organizationId);

  const selectProject = useCallback(
    (projectId: string) => navigate(pathService.onboarding({ projectId })),
    [navigate, pathService],
  );
  const clearError = useCallback(() => {
    void client.resetQueries({ queryKey: key, exact: true });
  }, [client, org]);
  const sort = options.sort ?? ["createdAt", "desc"];
  return {
    ...state,
    projects: orderBy(result.data ?? [], sort[0], sort[1]),
    error: state.error?.message ?? null,
    fetchingProjects: state.isFetching,
    create,
    update,
    remove,
    selectProject,
    clearError,
    entitlement: entitlementQuery.entitlement,
    entitlementLoading: entitlementQuery.isLoading,
    refreshEntitlement: entitlementQuery.refetch,
  };
}
