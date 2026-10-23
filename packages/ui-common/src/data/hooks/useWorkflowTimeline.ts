import { useState, useEffect, useCallback } from "react";
import type { WorkflowTimelineDto } from "../../api";
import { defaultClient } from "../../clients/serviceClients";
import { logger } from "../../utils/logger";

export interface UseWorkflowTimelineOptions {
  /** Start time filter for timeline data */
  from?: string;
  /** End time filter for timeline data */
  to?: string;
  /** Elasticsearch index to query */
  index?: string;
  /** Maximum number of results to return */
  maxResults?: number;
  /** Enable/disable the query */
  enabled?: boolean;
}

export interface UseWorkflowTimelineReturn {
  /** Timeline data */
  data: WorkflowTimelineDto | null;
  /** Whether data is currently being fetched */
  isLoading: boolean;
  /** Error if fetch failed */
  error: Error | null;
  /** Refresh the timeline data */
  refresh: () => void;
}

/**
 * Hook for fetching workflow timeline data
 *
 * @param workflowId - The workflow ID to fetch timeline for
 * @param options - Query options (from, to, index, maxResults, enabled)
 * @returns Timeline data, loading state, error, and refresh function
 */
export function useWorkflowTimeline(
  workflowId: string | undefined,
  options: UseWorkflowTimelineOptions = {}
): UseWorkflowTimelineReturn {
  const { from, to, index, maxResults, enabled = true } = options;
  const [data, setData] = useState<WorkflowTimelineDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const fetchTimeline = useCallback(async (): Promise<void> => {
    if (!workflowId || !enabled) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      logger.info("data_hooks", "Fetching workflow timeline", {
        workflowId,
        from,
        to,
        index,
        maxResults,
      });

      const response = await defaultClient.getWorkflowTimeline({
        workflowId: workflowId,
        from: from,
        to: to,
        index: index,
        maxResults: maxResults,
      });

      if (!response.data?.data) {
        throw new Error("No data returned from timeline API");
      }

      const timelineData = response.data.data;

      logger.info("data_hooks", "Workflow timeline fetched", {
        workflowId,
        nodeCount: timelineData.nodes?.length ?? 0,
        orphanCount: timelineData.orphans?.length ?? 0,
        stats: timelineData.stats,
      });

      setData(timelineData);
    } catch (err) {
      const errorObj =
        err instanceof Error ? err : new Error("Failed to fetch timeline");
      logger.error("data_hooks", "Failed to fetch workflow timeline", {
        workflowId,
        error: errorObj.message,
        errorDetails: err,
      });
      setError(errorObj);
      setData(null); // Clear any stale data on error
    } finally {
      setIsLoading(false);
    }
  }, [workflowId, from, to, index, maxResults, enabled]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline, refreshToken]);

  const refresh = useCallback(() => {
    logger.info("data_hooks", "Manually refreshing timeline", {
      workflowId,
    });
    setRefreshToken((prev) => prev + 1);
  }, [workflowId]);

  return {
    data,
    isLoading,
    error,
    refresh,
  };
}
