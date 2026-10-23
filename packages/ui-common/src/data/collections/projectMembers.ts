import { infiniteQueryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { projectKeys } from "./projects";
import type { PaginationDto, ProjectMemberResponseDto } from "../../api";
export interface ProjectMembersPage {
  members: ProjectMemberResponseDto[];
  pagination: PaginationDto | undefined;
}
const DEFAULT_PROJECT_MEMBERS_PAGE_LIMIT = 50;
export const projectMembersQueryOptions = (
  organizationId: string,
  projectId: string,
) =>
  infiniteQueryOptions({
    ...dataLayerQueryPolicy,
    queryKey: projectKeys.members(organizationId, projectId),
    initialPageParam: 1,
    getNextPageParam: (last: ProjectMembersPage, _pages, page) =>
      last.pagination?.hasNext ? page + 1 : undefined,
    queryFn: async ({ pageParam: page }): Promise<ProjectMembersPage> => {
      const result = (
        await unifiedApiClient.listProjectMembers(
          {
            organizationId,
            projectId,
            page,
            limit: DEFAULT_PROJECT_MEMBERS_PAGE_LIMIT,
          },
          captureRequestOptions(),
        )
      ).data?.data;
      return {
        members: [...(result?.members ?? [])].sort((a, b) =>
          (a.user?.name ?? "").localeCompare(b.user?.name ?? ""),
        ),
        pagination: result?.pagination,
      };
    },
  });
