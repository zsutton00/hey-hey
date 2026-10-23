import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProjectReportPreviewDto,
  ProjectReportPreviewRequestDto,
} from "../../api";
import { projectReportPreviewQueryOptions } from "../collections/reports";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export interface UseProjectReportPreviewReturn {
  /**
   * Server-authored preview for exactly the current request, or null while the
   * current request is loading or failed. A preview for an earlier request is
   * never returned as current.
   */
  data: ProjectReportPreviewDto | null;
  isLoading: boolean;
  error: Error | null;
  /**
   * The most recent successful preview and the request it answered. Callers
   * may keep rendering its rows while a request that differs only in
   * exclusions loads, but must not present its counts as current.
   */
  lastSettled: {
    request: ProjectReportPreviewRequestDto;
    data: ProjectReportPreviewDto;
  } | null;
  /** Re-runs the live preview for the unchanged request. */
  refresh: () => void;
}

export function useProjectReportPreview(
  organizationId: string | undefined,
  projectId: string | undefined,
  request: ProjectReportPreviewRequestDto | null
): UseProjectReportPreviewReturn {
  const enabled = !!organizationId && !!projectId && !!request;
  const queryOptions = useMemo(
    () =>
      projectReportPreviewQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        request
      ),
    [organizationId, projectId, request]
  );
  const { result, state } = useDataLayerQuery(queryOptions, { enabled });
  const { refetch } = result;
  const [lastSettled, setLastSettled] =
    useState<UseProjectReportPreviewReturn["lastSettled"]>(null);
  useEffect(() => {
    if (enabled && request && result.isSuccess && !result.isFetching)
      setLastSettled((previous) =>
        previous?.data === result.data &&
        JSON.stringify(previous.request) === JSON.stringify(request)
          ? previous
          : { request, data: result.data }
      );
  }, [enabled, request, result.isSuccess, result.isFetching, result.data]);
  const refresh = useCallback(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);
  return {
    data:
      enabled && !state.isFetching && !state.error ? result.data ?? null : null,
    isLoading: enabled && (result.isPending || state.isFetching),
    error: state.error,
    lastSettled,
    refresh,
  };
}
