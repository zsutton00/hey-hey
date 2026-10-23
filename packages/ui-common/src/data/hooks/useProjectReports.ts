import { useMemo } from "react";
import type {
  ReportDto,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
} from "../../api";
import { projectReportsQueryOptions } from "../collections/reports";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export interface UseProjectReportsOptions
  extends CollectionHookOptions<ReportDto> {
  types?: ReportType[];
  limit?: number;
  offset?: number;
  sortBy?: ReportSortBy;
  sortOrder?: ReportSortOrder;
}

export interface UseProjectReportsReturn
  extends DataCollectionHookReturn<ReportDto> {
  reports: ReportDto[];
}

const NO_REPORTS: ReportDto[] = [];
export function useProjectReports(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseProjectReportsOptions = {}
): UseProjectReportsReturn {
  const { types, limit, offset, sortBy, sortOrder } = options;
  const queryOptions = useMemo(
    () =>
      projectReportsQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        { types, limit, offset, sortBy, sortOrder }
      ),
    [organizationId, projectId, types, limit, offset, sortBy, sortOrder]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: (options.enabled ?? true) && !!organizationId && !!projectId,
  });
  const reports = result.data ?? NO_REPORTS;
  return { ...state, reports, data: reports };
}
