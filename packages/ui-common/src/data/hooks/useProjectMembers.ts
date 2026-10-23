import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { PaginationDto, ProjectMemberResponseDto } from "../../api";
import {
  projectMembersQueryOptions,
  type ProjectMembersPage,
} from "../collections/projectMembers";
import { projectKeys } from "../collections/projects";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useCollectionQueryState } from "../query/useCollectionQueryState";
import { dataLayerQueryPolicy, shouldRetryOnMount } from "../query/queryPolicy";

export interface UseProjectMembersReturn
  extends DataCollectionHookReturn<ProjectMemberResponseDto> {
  pagination: PaginationDto | undefined;
  page: number;
  total: number | undefined;
  hasNext: boolean;
  fetchNextPage: () => void;
}

function collectMembers(
  pages: ProjectMembersPage[]
): ProjectMemberResponseDto[] {
  const seen = new Set<string>();
  return pages
    .flatMap((page) => page.members)
    .filter((member) => {
      if (seen.has(member.id)) return false;
      seen.add(member.id);
      return true;
    });
}

export function useProjectMembers(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: CollectionHookOptions<ProjectMemberResponseDto> = {}
): UseProjectMembersReturn {
  const org = organizationId ?? "";
  const project = projectId ?? "";
  const enabled = (options.enabled ?? true) && !!organizationId && !!projectId;
  const queryKey = projectKeys.members(org, project);
  const client = useQueryClient();
  const result = useInfiniteQuery({
    ...projectMembersQueryOptions(org, project),
    enabled,
    staleTime: options.staleTimeMs ?? dataLayerQueryPolicy.staleTime,
    retryOnMount: shouldRetryOnMount(
      client.getQueryState(queryKey),
      options.staleTimeMs
    ),
    ...(options.refetchOnMount ? { refetchOnMount: "always" as const } : {}),
    ...(options.refetchOnWindowFocus
      ? { refetchOnWindowFocus: "always" as const }
      : {}),
  });
  const state = useCollectionQueryState(result, queryKey, enabled, options);
  const pages = result.data?.pages ?? [];
  const data = useMemo(
    () => (result.data ? collectMembers(result.data.pages) : []),
    [result.data]
  );
  const pagination = pages[pages.length - 1]?.pagination;
  const refetch = useCallback(async () => {
    const next = await state.refetch();
    return next ? collectMembers(next.pages) : null;
  }, [state.refetch]);
  const fetchNextPage = useCallback(() => {
    if (result.hasNextPage && !result.isFetching) void result.fetchNextPage();
  }, [result.hasNextPage, result.isFetching, result.fetchNextPage]);
  return {
    ...state,
    data,
    pagination,
    page: pages.length || 1,
    total: pagination?.total,
    hasNext: result.hasNextPage,
    fetchNextPage,
    refetch,
  };
}
