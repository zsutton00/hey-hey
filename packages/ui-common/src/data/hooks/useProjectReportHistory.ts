import { useMemo } from "react";
import { ProjectReportStatus } from "../../api";
import { projectReportHistoryQueryOptions } from "../collections/reports";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export function useProjectReportHistory(
  organizationId: string | undefined,
  projectId: string | undefined,
  offset: number,
  limit: number,
) {
  const options = useMemo(
    () =>
      projectReportHistoryQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        offset,
        limit,
      ),
    [organizationId, projectId, offset, limit],
  );
  const query = useDataLayerQuery(
    {
      ...options,
      refetchInterval: (current) =>
        current.state.data?.entries.some(
          (entry) =>
            entry.type === "REQUEST" &&
            (entry.status === ProjectReportStatus.Queued ||
              entry.status === ProjectReportStatus.Running),
        )
          ? 3000
          : false,
      refetchOnReconnect: "always",
    },
    { enabled: !!organizationId && !!projectId, refetchOnMount: true },
  );
  return {
    ...query.state,
    page: query.result.data,
    refetch: query.result.refetch,
  };
}
