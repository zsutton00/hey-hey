import { queryOptions } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import {
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum,
  type OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum as WorkItemReferenceSortBy,
  type OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum as WorkItemReferenceSortOrder,
  type PaginatedWorkItemReferenceResponseDto,
  type WorkStatus,
  type WorkItemReferenceDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export type { WorkItemReferenceDto } from "../../api";

export const WORK_ITEM_REFERENCE_PAGE_LIMIT = 500 as const;
export const WORK_ITEM_REFERENCE_PICKER_PAGE_LIMIT = 20 as const;
export const WORK_ITEM_REFERENCE_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export interface WorkItemReferenceScope {
  organizationId: string;
  projectId: string;
  workItemType: string;
}

export interface WorkItemReferencePageQuery extends WorkItemReferenceScope {
  page: number;
  limit: number;
  filter?: string;
  statuses?: readonly WorkStatus[];
  sortBy?: WorkItemReferenceSortBy;
  sortOrder?: WorkItemReferenceSortOrder;
}

const DEFAULT_WORK_ITEM_REFERENCE_SORT = {
  sortBy:
    OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortByEnum.Name,
  sortOrder:
    OrganizationsOrganizationIdProjectsProjectIdWorkItemsReferencesGetSortOrderEnum.Asc,
} as const;

/**
 * Prefix tree for reference reads. A work-item change in a project
 * invalidates `project(organizationId, projectId)`, covering the full
 * reference list of every type and every picker page in that project.
 */
export const workItemReferenceKeys = {
  root: () => ["workItemReferences"] as const,
  all: (organizationId: string) =>
    ["workItemReferences", organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...workItemReferenceKeys.all(organizationId), projectId] as const,
  list: ({ organizationId, projectId, workItemType }: WorkItemReferenceScope) =>
    [
      ...workItemReferenceKeys.project(organizationId, projectId),
      "list",
      workItemType,
    ] as const,
  page: (query: WorkItemReferencePageQuery) =>
    [
      ...workItemReferenceKeys.project(query.organizationId, query.projectId),
      "page",
      {
        workItemType: query.workItemType,
        page: query.page,
        limit: query.limit,
        filter: query.filter?.trim() ?? "",
        statuses: query.statuses?.join(",") ?? "",
        sortBy: query.sortBy ?? DEFAULT_WORK_ITEM_REFERENCE_SORT.sortBy,
        sortOrder:
          query.sortOrder ?? DEFAULT_WORK_ITEM_REFERENCE_SORT.sortOrder,
      },
    ] as const,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isWorkItemReference = (
  value: unknown,
): value is WorkItemReferenceDto =>
  isRecord(value) &&
  typeof value.id === "string" &&
  value.id.trim().length > 0 &&
  typeof value.name === "string" &&
  value.name.trim().length > 0 &&
  typeof value.type === "string" &&
  value.type.trim().length > 0 &&
  (value.parentTaskId === null ||
    (typeof value.parentTaskId === "string" &&
      value.parentTaskId.trim().length > 0));

const isPagination = (
  value: unknown,
): value is PaginatedWorkItemReferenceResponseDto["pagination"] =>
  isRecord(value) &&
  typeof value.page === "number" &&
  Number.isInteger(value.page) &&
  value.page >= 1 &&
  typeof value.limit === "number" &&
  Number.isInteger(value.limit) &&
  value.limit >= 1 &&
  typeof value.total === "number" &&
  Number.isInteger(value.total) &&
  value.total >= 0 &&
  typeof value.totalPages === "number" &&
  Number.isInteger(value.totalPages) &&
  value.totalPages >= 0 &&
  typeof value.hasNext === "boolean" &&
  typeof value.hasPrevious === "boolean";

const isPaginatedWorkItemReferenceResponse = (
  value: unknown,
): value is PaginatedWorkItemReferenceResponseDto =>
  isRecord(value) &&
  Array.isArray(value.items) &&
  value.items.every(isWorkItemReference) &&
  isPagination(value.pagination);

export const parseWorkItemReferencePage = (
  payload: unknown,
): PaginatedWorkItemReferenceResponseDto => {
  if (!isPaginatedWorkItemReferenceResponse(payload)) {
    throw new Error(
      "Work-item reference response is missing required identity, name, or pagination data.",
    );
  }

  return payload;
};

export async function fetchWorkItemReferencePage(
  { organizationId, projectId, workItemType }: WorkItemReferenceScope,
  page: number,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<PaginatedWorkItemReferenceResponseDto> {
  const response = await unifiedApiClient.listWorkItemReferences(
    {
      organizationId,
      projectId,
      type: workItemType,
      page,
      limit: WORK_ITEM_REFERENCE_PAGE_LIMIT,
    },
    requestOptions,
  );

  return parseWorkItemReferencePage(response.data?.data);
}

export async function fetchWorkItemReferencePageQuery(
  query: WorkItemReferencePageQuery,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<PaginatedWorkItemReferenceResponseDto> {
  const response = await unifiedApiClient.listWorkItemReferences(
    {
      organizationId: query.organizationId,
      projectId: query.projectId,
      type: query.workItemType,
      page: query.page,
      limit: query.limit,
      filter: query.filter?.trim() || undefined,
      statuses:
        query.statuses && query.statuses.length > 0
          ? [...query.statuses]
          : undefined,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    },
    requestOptions,
  );

  return parseWorkItemReferencePage(response.data?.data);
}

export async function fetchAllWorkItemReferences(
  scope: WorkItemReferenceScope,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<WorkItemReferenceDto[]> {
  const references: WorkItemReferenceDto[] = [];
  let page = 1;

  while (true) {
    const pageResponse = await fetchWorkItemReferencePage(
      scope,
      page,
      requestOptions,
    );
    if (pageResponse.pagination.page !== page) {
      throw new Error(
        `Work-item reference pagination returned page ${pageResponse.pagination.page} while requesting page ${page}.`,
      );
    }

    references.push(...pageResponse.items);
    if (!pageResponse.pagination.hasNext) {
      return references;
    }

    if (
      pageResponse.pagination.totalPages === 0 ||
      page >= pageResponse.pagination.totalPages
    ) {
      throw new Error(
        "Work-item reference pagination reported another page beyond its total page count.",
      );
    }

    page += 1;
  }
}

export function workItemReferencesQueryOptions(scope: WorkItemReferenceScope) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    staleTime: WORK_ITEM_REFERENCE_CACHE_AGE_MS,
    queryKey: workItemReferenceKeys.list(scope),
    queryFn: ({ signal }) =>
      fetchAllWorkItemReferences(scope, { ...captureRequestOptions(), signal }),
  });
}

export function workItemReferencePageQueryOptions(
  query: WorkItemReferencePageQuery,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: workItemReferenceKeys.page(query),
    queryFn: ({ signal }) =>
      fetchWorkItemReferencePageQuery(query, {
        ...captureRequestOptions(),
        signal,
      }),
  });
}
