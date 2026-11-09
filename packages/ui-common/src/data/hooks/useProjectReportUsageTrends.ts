import { useMemo } from "react";
import type { ReportUsageTrends } from "../../api";
import {
  projectReportUsageTrendsQueryOptions,
  type ProjectReportUsageTrendsParams,
} from "../collections/reports";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseProjectReportUsageTrendsReturn {
  trends: ReportUsageTrends | null;
  isLoading: boolean;
  error: Error | null;
}

/** Placeholder for the disabled query while the chosen period is invalid. */
const NO_PERIOD: ProjectReportUsageTrendsParams = {
  from: "1970-01-01T00:00:00.000Z",
  to: "1970-01-02T00:00:00.000Z",
  granularity: "day",
  reportKinds: [],
  providers: [],
  models: [],
  efforts: [],
};

export function useProjectReportUsageTrends(
  organizationId: string | undefined,
  projectId: string | undefined,
  params: ProjectReportUsageTrendsParams | null,
): UseProjectReportUsageTrendsReturn {
  const queryOptions = useMemo(
    () =>
      projectReportUsageTrendsQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        params ?? NO_PERIOD,
      ),
    [organizationId, projectId, params],
  );
  const { result } = useDataLayerQuery(queryOptions, {
    enabled: !!organizationId && !!projectId && params !== null,
  });

  return {
    trends: result.data ?? null,
    isLoading: result.isLoading,
    error: result.error ?? null,
  };
}
