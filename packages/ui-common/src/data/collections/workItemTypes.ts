import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  WorkItemTypeSummaryDto,
  WorkItemTypeLifecycleStatus,
  OrganizationsOrganizationIdProjectsProjectIdWorkItemTypesGet200Response,
} from "../../api";
import { WorkItemTypesApi } from "../../api";
import { dataClient } from "../../clients";
import { getApiRuntime } from "../../clients/runtime";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { logger } from "../../utils/logger";

export type WorkItemTypesFilters = {
  status?: WorkItemTypeLifecycleStatus;
};

/**
 * Prefix tree for work-item-type reads. Invalidating `all` (or the bare
 * `["workItemTypes"]` root) covers the catalog and every by-key read beneath
 * it. There is exactly one catalog key per project; status subsets are a
 * `select` over it, never a second request.
 */
export const workItemTypeKeys = {
  root: () => ["workItemTypes"] as const,
  all: (organizationId: string, projectId: string) =>
    ["workItemTypes", organizationId, projectId] as const,
  catalog: (organizationId: string, projectId: string) =>
    [...workItemTypeKeys.all(organizationId, projectId), "catalog"] as const,
  byKey: (organizationId: string, projectId: string, typeKey: string) =>
    [
      ...workItemTypeKeys.all(organizationId, projectId),
      "byKey",
      typeKey,
    ] as const,
};

export function getWorkItemTypesApi(): WorkItemTypesApi {
  return new WorkItemTypesApi(
    undefined,
    undefined,
    getApiRuntime().transport.axios
  );
}

async function fetchWorkItemTypes(
  organizationId: string,
  projectId: string,
  requestOptions: AxiosRequestConfig
): Promise<WorkItemTypeSummaryDto[]> {
  logger.info("data_core", "[workItemTypes] Fetch work item types", {
    organizationId,
    projectId,
  });

  const response =
    await dataClient.request<OrganizationsOrganizationIdProjectsProjectIdWorkItemTypesGet200Response>(
      {
        ...requestOptions,
        method: "GET",
        url: `/organizations/${organizationId}/projects/${projectId}/work-item-types`,
      }
    );

  const data = response.data?.data;

  if (!Array.isArray(data)) {
    logger.warn("data_core", "[workItemTypes] Unexpected response format", {
      organizationId,
      projectId,
      dataType: typeof data,
    });
    return [];
  }

  return data as WorkItemTypeSummaryDto[];
}

async function fetchWorkItemTypeByKey(
  organizationId: string,
  projectId: string,
  typeKey: string,
  signal: AbortSignal
): Promise<WorkItemTypeSummaryDto | null> {
  logger.info("data_core", "[workItemTypes] Fetch work item type", {
    organizationId,
    projectId,
    typeKey,
  });

  const response =
    await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyGet(
      { organizationId, projectId, typeKey },
      { ...captureRequestOptions(), signal }
    );

  return response.data.data ?? null;
}

export function filterWorkItemTypes(
  workItemTypes: WorkItemTypeSummaryDto[],
  filters: WorkItemTypesFilters
): WorkItemTypeSummaryDto[] {
  const { status } = filters;
  return status
    ? workItemTypes.filter((workItemType) => workItemType.status === status)
    : workItemTypes;
}

export function workItemTypeCatalogQueryOptions(
  organizationId: string,
  projectId: string
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: workItemTypeKeys.catalog(organizationId, projectId),
    queryFn: ({ signal }) =>
      fetchWorkItemTypes(organizationId, projectId, {
        ...captureRequestOptions(),
        signal,
      }),
  });
}

function isCompleteDefinition(
  workItemType: WorkItemTypeSummaryDto,
  typeKey: string
): boolean {
  const { definition } = workItemType;
  return (
    definition?.key === typeKey &&
    typeof definition.name === "string" &&
    !!definition.role &&
    Array.isArray(definition.sections) &&
    Array.isArray(definition.allowedStatuses)
  );
}

/**
 * Seeds a by-key read from the cached catalog row. The seed keeps the
 * catalog's fetch time, so reuse never extends freshness, and an invalidated
 * catalog is never a seed. A missing catalog row is not an authoritative
 * by-key absence, so the read still goes to the server.
 */
function catalogSeed(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  typeKey: string
): { data: WorkItemTypeSummaryDto; updatedAt: number } | undefined {
  const catalogKey = workItemTypeKeys.catalog(organizationId, projectId);
  const catalogState =
    queryClient.getQueryState<WorkItemTypeSummaryDto[]>(catalogKey);
  if (!catalogState?.data || catalogState.isInvalidated) return undefined;
  const row = catalogState.data.find((workItemType) =>
    isCompleteDefinition(workItemType, typeKey)
  );
  return row ? { data: row, updatedAt: catalogState.dataUpdatedAt } : undefined;
}

export function workItemTypeByKeyQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  typeKey: string
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: workItemTypeKeys.byKey(organizationId, projectId, typeKey),
    queryFn: ({ signal }) =>
      fetchWorkItemTypeByKey(organizationId, projectId, typeKey, signal),
    initialData: () =>
      catalogSeed(queryClient, organizationId, projectId, typeKey)?.data,
    initialDataUpdatedAt: () =>
      catalogSeed(queryClient, organizationId, projectId, typeKey)?.updatedAt,
  });
}
