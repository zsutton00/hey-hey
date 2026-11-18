import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { AgentSessionDto } from "../../api";
import { paginatedAgentSessionsQueryOptions } from "../collections/agentSessions";

export const AGENT_SESSION_TITLE_OPTIONS_PAGE_SIZE = 20;

export interface UseAgentSessionTitleOptionsReturn {
  options: Array<Pick<AgentSessionDto, "id" | "title">>;
  hasNextPage: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  /** The first page failed; there are no options to show. */
  initialError: Error | null;
  /** A later page failed; the pages already loaded stay usable. */
  nextPageError: Error | null;
  loadNextPage: () => void;
  retry: () => void;
}

/**
 * Sessions for a title picker: one server-searched page at a time, newest
 * activity first. Reads only the paginated list; it never subscribes to
 * per-session live state. Each search term is its own query, so a late
 * response for an earlier term lands in that term's cache entry and never
 * replaces the current results.
 */
export function useAgentSessionTitleOptions(
  organizationId: string,
  projectId: string,
  { search, enabled }: { search: string; enabled: boolean },
): UseAgentSessionTitleOptionsReturn {
  const term = search.trim();
  const queryOptions = useMemo(
    () =>
      paginatedAgentSessionsQueryOptions(organizationId, projectId, {
        search: term || undefined,
        limit: AGENT_SESSION_TITLE_OPTIONS_PAGE_SIZE,
      }),
    [organizationId, projectId, term],
  );
  const query = useInfiniteQuery({ ...queryOptions, enabled });
  const { data, fetchNextPage, refetch, isFetchNextPageError } = query;

  const options = useMemo(() => {
    const seen = new Set<string>();
    const unique: UseAgentSessionTitleOptionsReturn["options"] = [];
    for (const page of data?.pages ?? []) {
      for (const { agentSession } of page.items) {
        if (!seen.has(agentSession.id)) {
          seen.add(agentSession.id);
          unique.push({ id: agentSession.id, title: agentSession.title });
        }
      }
    }
    return unique;
  }, [data]);

  const loadNextPage = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const retry = useCallback(() => {
    if (isFetchNextPageError) {
      void fetchNextPage();
    } else {
      void refetch();
    }
  }, [fetchNextPage, isFetchNextPageError, refetch]);

  return {
    options,
    hasNextPage: query.hasNextPage,
    isLoading: enabled && query.isPending && !query.isFetchNextPageError,
    isFetchingNextPage: query.isFetchingNextPage,
    initialError: query.isError && !data ? query.error : null,
    nextPageError: query.isFetchNextPageError ? query.error : null,
    loadNextPage,
    retry,
  };
}
