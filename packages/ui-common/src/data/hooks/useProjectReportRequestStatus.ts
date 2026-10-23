import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import type { ProjectReportRequestDto } from "../../api";
import {
  projectReportRequestQueryOptions,
  storeProjectReportRequest,
  isTerminalProjectReportRequest,
  invalidateCompletedProjectReport,
} from "../collections/reports";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export const PROJECT_REPORT_STATUS_POLL_INTERVAL_MS = 3000;

export interface UseProjectReportRequestStatusOptions {
  /** A request DTO already returned by create or retry, shown until the first read. */
  initialRequest?: ProjectReportRequestDto | null;
  pollIntervalMs?: number;
}

export interface UseProjectReportRequestStatusReturn {
  request: ProjectReportRequestDto | null;
  error: Error | null;
  /** Adopts a fresher request DTO (for example a retry response) and resumes polling. */
  accept: (request: ProjectReportRequestDto) => void;
  refetch: () => Promise<void>;
}

export function useProjectReportRequestStatus(
  organizationId: string | undefined,
  projectId: string | undefined,
  requestId: string | null,
  options: UseProjectReportRequestStatusOptions = {}
): UseProjectReportRequestStatusReturn {
  const queryClient = useQueryClient();
  const enabled = !!organizationId && !!projectId && !!requestId;
  const queryOptions = useMemo(
    () =>
      projectReportRequestQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        requestId ?? "__noop__"
      ),
    [organizationId, projectId, requestId]
  );
  const { result, state } = useDataLayerQuery(
    {
      ...queryOptions,
      initialData:
        options.initialRequest?.id === requestId
          ? options.initialRequest
          : undefined,
      refetchInterval: (query) =>
        isTerminalProjectReportRequest(query.state.data)
          ? false
          : options.pollIntervalMs ?? PROJECT_REPORT_STATUS_POLL_INTERVAL_MS,
    },
    { enabled }
  );
  const accept = useCallback(
    (next: ProjectReportRequestDto) => {
      if (!organizationId || !projectId || !requestId || next.id !== requestId)
        return;
      storeProjectReportRequest(queryClient, organizationId, projectId, next);
    },
    [organizationId, projectId, requestId, queryClient]
  );
  const { refetch: refetchQuery } = result;
  const refetch = useCallback(async () => {
    if (enabled) await refetchQuery();
  }, [enabled, refetchQuery]);
  useEffect(() => {
    if (organizationId && projectId && requestId && result.data)
      invalidateCompletedProjectReport(
        queryClient,
        organizationId,
        projectId,
        result.data
      );
  }, [queryClient, organizationId, projectId, requestId, result.data]);
  return {
    request: enabled ? result.data ?? null : null,
    error: state.error,
    accept,
    refetch,
  };
}
