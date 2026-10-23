import { useState, useCallback, useEffect } from "react";
import type { GitHubRepositoryDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { extractErrorMessage } from "../../utils/errorUtils";
import logger from "../../utils/logger";

export interface UseGitHubRepositoriesOptions {
  organizationId: string | undefined;
  projectId: string | undefined;
  integrationId: string | undefined;
  org?: string;
  enabled?: boolean;
}

export interface UseGitHubRepositoriesReturn {
  repositories: GitHubRepositoryDto[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  total: number;
}

const DEFAULT_PAGE_SIZE = 30;

export function useGitHubRepositories({
  organizationId,
  projectId,
  integrationId,
  org,
  enabled = true,
}: UseGitHubRepositoriesOptions): UseGitHubRepositoriesReturn {
  const [repositories, setRepositories] = useState<GitHubRepositoryDto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);

  const fetchRepositories = useCallback(
    async (pageNum: number, append: boolean = false) => {
      if (!enabled || !organizationId || !projectId || !integrationId) {
        logger.info(
          "data_hooks",
          "[useGitHubRepositories] Skipping fetch - missing required params or disabled",
          { enabled, organizationId, projectId, integrationId }
        );
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        logger.info(
          "data_hooks",
          "[useGitHubRepositories] Fetching repositories",
          { organizationId, projectId, integrationId, page: pageNum, org }
        );

        const response = await unifiedApiClient.listGitHubRepositories({
          organizationId: organizationId,
          projectId: projectId,
          integrationId: integrationId,
          page: pageNum,
          limit: DEFAULT_PAGE_SIZE,
          org: org,
        });

        const data = response.data.data;

        if (data) {
          setRepositories((prev) =>
            append ? [...prev, ...data.data] : data.data
          );
          setTotal(data.pagination.total);
          setTotalPages(data.pagination.totalPages);

          logger.info(
            "data_hooks",
            "[useGitHubRepositories] Successfully fetched repositories",
            {
              count: data.data.length,
              total: data.pagination.total,
              page: pageNum,
            }
          );
        } else {
          logger.warn(
            "data_hooks",
            "[useGitHubRepositories] No data in response"
          );
          setRepositories([]);
          setTotal(0);
          setTotalPages(0);
        }
      } catch (err: unknown) {
        const errorMessage =
          extractErrorMessage(err) ?? "Failed to fetch repositories";
        logger.error("data_hooks", "[useGitHubRepositories] Fetch failed", {
          error: err,
          errorMessage,
        });
        setError(errorMessage);
      } finally {
        setIsLoading(false);
      }
    },
    [enabled, organizationId, projectId, integrationId, org]
  );

  useEffect(() => {
    if (enabled && organizationId && projectId && integrationId) {
      setPage(1);
      fetchRepositories(1, false);
    }
  }, [
    enabled,
    organizationId,
    projectId,
    integrationId,
    org,
    fetchRepositories,
  ]);

  const refetch = useCallback(async () => {
    setPage(1);
    await fetchRepositories(1, false);
  }, [fetchRepositories]);

  const loadMore = useCallback(async () => {
    if (page < totalPages && !isLoading) {
      const nextPage = page + 1;
      setPage(nextPage);
      await fetchRepositories(nextPage, true);
    }
  }, [page, totalPages, isLoading, fetchRepositories]);

  const hasMore = page < totalPages;

  return {
    repositories,
    isLoading,
    error,
    refetch,
    hasMore,
    loadMore,
    total,
  };
}
