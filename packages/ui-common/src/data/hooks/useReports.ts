import { useMemo } from "react";
import type { ReportDto } from "../../api";
import {
  reportsQueryOptions,
  type ReportsFilters,
} from "../collections/reports";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type ReportsSortBy =
  "createdAt" | "expiresAt" | "reportType" | "schemaVersion";
export type ReportsSortDirection = "asc" | "desc";

export interface UseReportsOptions
  extends CollectionHookOptions<ReportDto>, ReportsFilters {
  sortBy?: ReportsSortBy;
  sortDirection?: ReportsSortDirection;
}

export interface UseReportsReturn extends DataCollectionHookReturn<ReportDto> {
  reports: ReportDto[];
}

const NO_REPORTS: ReportDto[] = [];

const compareValues = (
  a: string | number,
  b: string | number,
  direction: ReportsSortDirection,
): number => {
  if (typeof a === "string" && typeof b === "string") {
    return direction === "asc" ? a.localeCompare(b) : b.localeCompare(a);
  }

  if (a === b) {
    return 0;
  }

  if (direction === "asc") {
    return a > b ? 1 : -1;
  }

  return a > b ? -1 : 1;
};

const sortReports = (
  reports: ReportDto[],
  sortBy: ReportsSortBy,
  sortDirection: ReportsSortDirection,
): ReportDto[] => {
  const sortedReports = [...reports];

  sortedReports.sort((left, right) => {
    switch (sortBy) {
      case "reportType":
        return compareValues(left.reportType, right.reportType, sortDirection);
      case "schemaVersion":
        return compareValues(
          left.schemaVersion,
          right.schemaVersion,
          sortDirection,
        );
      case "expiresAt":
        return compareValues(
          left.expiresAt ? new Date(left.expiresAt).getTime() : Infinity,
          right.expiresAt ? new Date(right.expiresAt).getTime() : Infinity,
          sortDirection,
        );
      case "createdAt":
      default:
        return compareValues(
          new Date(left.createdAt).getTime(),
          new Date(right.createdAt).getTime(),
          sortDirection,
        );
    }
  });

  return sortedReports;
};

export function useReports(
  organizationId: string | undefined,
  options: UseReportsOptions = {},
): UseReportsReturn {
  const {
    projectId,
    reportType,
    audience,
    sourceExecutionId,
    entityType,
    entityId,
    relation,
    parentReportId,
    includeExpired,
    limit,
    sortBy = "createdAt",
    sortDirection = "desc",
    enabled = true,
  } = options;

  const filters = useMemo(
    () => ({
      projectId,
      reportType,
      audience,
      sourceExecutionId,
      entityType,
      entityId,
      relation,
      parentReportId,
      includeExpired,
      limit,
    }),
    [
      projectId,
      reportType,
      audience,
      sourceExecutionId,
      entityType,
      entityId,
      relation,
      parentReportId,
      includeExpired,
      limit,
    ],
  );

  const queryOptions = useMemo(
    () => reportsQueryOptions(organizationId ?? "__noop__", filters),
    [organizationId, filters],
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: enabled && !!organizationId,
  });
  const reportsData = result.data ?? NO_REPORTS;
  const reports = useMemo(
    () => sortReports(reportsData, sortBy, sortDirection),
    [reportsData, sortBy, sortDirection],
  );
  return { ...state, reports, data: reports };
}
