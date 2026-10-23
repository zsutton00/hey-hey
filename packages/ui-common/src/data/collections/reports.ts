import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  ProjectReportPreviewRequestDto,
  ProjectReportRequestDto,
} from "../../api";
import { ProjectReportStatus } from "../../api";
import {
  unifiedApiClient,
  projectReportsClient,
} from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
export interface ReportsFilters {
  projectId?: string;
  reportType?: ReportType;
  audience?: ReportAudience;
  sourceExecutionId?: string;
  entityType?: ReportRelatedEntityType;
  entityId?: string;
  relation?: ReportEntityRelation;
  parentReportId?: string;
  includeExpired?: boolean;
  limit?: number;
}
export interface ProjectReportsFilters {
  types?: ReportType[];
  limit?: number;
  offset?: number;
  sortBy?: ReportSortBy;
  sortOrder?: ReportSortOrder;
}
export const reportKeys = {
  root: () => ["reports"] as const,
  all: (org: string) => ["reports", org] as const,
  detail: (org: string, id: string) =>
    [...reportKeys.all(org), "detail", id] as const,
  entityList: (org: string, project = "") =>
    [...reportKeys.all(org), "entityList", project] as const,
  projectList: (org: string, project: string) =>
    [...reportKeys.all(org), "projectList", project] as const,
  projectPreview: (
    org: string,
    project: string,
    request: ProjectReportPreviewRequestDto | null
  ) => [...reportKeys.all(org), "projectPreview", project, request] as const,
  projectRequest: (org: string, project: string, id: string) =>
    [...reportKeys.all(org), "projectRequest", project, id] as const,
};
export function reportQueryOptions(organizationId: string, reportId: string) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: reportKeys.detail(organizationId, reportId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getReport(
        { organizationId, reportId },
        { ...requestOptions, signal }
      );
      return response.data.data ?? null;
    },
  });
}
export function reportsQueryOptions(
  organizationId: string,
  filters: ReportsFilters = {}
) {
  const requestOptions = captureRequestOptions();
  const { projectId, ...params } = filters;
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: [
      ...reportKeys.entityList(organizationId, projectId),
      params,
    ] as const,
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.listReports(
        { organizationId, ...filters },
        { ...requestOptions, signal }
      );
      return response.data.data ?? [];
    },
  });
}
export function projectReportsQueryOptions(
  organizationId: string,
  projectId: string,
  filters: ProjectReportsFilters = {}
) {
  const requestOptions = captureRequestOptions();
  const normalized = {
    ...filters,
    types: filters.types?.length
      ? [...new Set(filters.types)].sort()
      : undefined,
  };
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: [
      ...reportKeys.projectList(organizationId, projectId),
      normalized,
    ] as const,
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.listProjectReports(
        { organizationId, projectId, ...normalized },
        { ...requestOptions, signal }
      );
      return response.data.data ?? [];
    },
  });
}
export function projectReportPreviewQueryOptions(
  organizationId: string,
  projectId: string,
  request: ProjectReportPreviewRequestDto | null
) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: reportKeys.projectPreview(organizationId, projectId, request),
    queryFn: async ({ signal }) => {
      if (!request) throw new Error("A preview request is required");
      const response = await projectReportsClient.previewProjectReportRequest(
        { organizationId, projectId, projectReportPreviewRequestDto: request },
        { ...requestOptions, signal }
      );
      return response.data.data;
    },
  });
}
export const isTerminalProjectReportRequest = (
  request: ProjectReportRequestDto | undefined
) =>
  request?.status === ProjectReportStatus.Completed ||
  request?.status === ProjectReportStatus.Failed;
export function projectReportRequestQueryOptions(
  organizationId: string,
  projectId: string,
  requestId: string
) {
  const requestOptions = captureRequestOptions();
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: reportKeys.projectRequest(organizationId, projectId, requestId),
    queryFn: async ({ signal }) => {
      const response = await projectReportsClient.getProjectReportRequest(
        { organizationId, projectId, requestId },
        { ...requestOptions, signal }
      );
      return response.data.data;
    },
  });
}
function durableReportId(request: ProjectReportRequestDto): string | undefined {
  if (request.status !== ProjectReportStatus.Completed) return undefined;
  const latest = [...request.attempts].sort(
    (a, b) => b.attemptNumber - a.attemptNumber
  )[0];
  return latest?.reportId;
}

// Coordination only: DTOs and read state remain in the query cache.
// Markers disappear when the owning request query is garbage-collected.
const completedReports = new WeakMap<object, Set<string>>();
function claimCompletedReport(query: object, reportId: string): boolean {
  const seen = completedReports.get(query) ?? new Set<string>();
  if (seen.has(reportId)) return false;
  seen.add(reportId);
  completedReports.set(query, seen);
  return true;
}

export function invalidateCompletedProjectReport(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  request: ProjectReportRequestDto
): void {
  const reportId = durableReportId(request);
  if (!reportId) return;
  const query = queryClient.getQueryCache().find({
    queryKey: reportKeys.projectRequest(organizationId, projectId, request.id),
    exact: true,
  });
  if (!query || !claimCompletedReport(query, reportId)) return;
  void Promise.all([
    invalidateWithFollowUpRead(queryClient, {
      queryKey: reportKeys.projectList(organizationId, projectId),
    }),
    invalidateWithFollowUpRead(queryClient, {
      queryKey: reportKeys.entityList(organizationId, projectId),
    }),
  ]);
}

/** Authoritative create, retry and accept responses replace older polls. */
export function storeProjectReportRequest(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  request: ProjectReportRequestDto
): void {
  const queryKey = reportKeys.projectRequest(
    organizationId,
    projectId,
    request.id
  );
  void queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData(queryKey, request);
  invalidateCompletedProjectReport(
    queryClient,
    organizationId,
    projectId,
    request
  );
}
