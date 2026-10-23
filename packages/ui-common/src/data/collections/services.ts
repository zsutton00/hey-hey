import {
  queryOptions,
  type QueryKey as TanStackQueryKey,
} from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type {
  ServiceDto,
  CreateService201Response,
  ListServices200Response,
} from "../../api";
import { dataClient } from "../../clients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import type { CollectionInvalidator } from "../relationships/invalidator";
import { logger } from "../../utils/logger";

export type ServiceStatus = "ACTIVE" | "ARCHIVED" | "DEPRECATED";

export type ServicesFilters = {
  projectId?: string;
  status?: ServiceStatus;
};

const filterOrder: Array<keyof ServicesFilters> = ["projectId", "status"];

/**
 * Prefix tree for service reads. Services are organization-scoped, so any
 * service change invalidates `all(organizationId)`, covering every list and
 * by-id read in that organization.
 */
export const serviceKeys = {
  root: () => ["services"] as const,
  all: (organizationId: string) => ["services", organizationId] as const,
  lists: (organizationId: string) =>
    [...serviceKeys.all(organizationId), "list"] as const,
  list: (organizationId: string, filters: ServicesFilters = {}) =>
    [
      ...serviceKeys.lists(organizationId),
      { projectId: filters.projectId || null, status: filters.status ?? null },
    ] as const,
  byId: (organizationId: string, serviceId: string) =>
    [...serviceKeys.all(organizationId), "byId", serviceId] as const,
};

async function fetchService(
  organizationId: string,
  serviceId: string,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<ServiceDto | null> {
  logger.info("data_core", "[servicesCollection] Fetch service", {
    organizationId,
    serviceId,
  });

  const response = await dataClient.request<CreateService201Response>({
    ...requestOptions,
    method: "GET",
    url: `/organizations/${organizationId}/services/${serviceId}`,
  });

  const service = response.data?.data;

  if (!service) {
    logger.warn("data_core", "[servicesCollection] Missing service", {
      organizationId,
      serviceId,
    });
    return null;
  }

  return service as ServiceDto;
}

async function fetchServices(
  organizationId: string,
  filters: ServicesFilters,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<ServiceDto[]> {
  logger.info("data_core", "[servicesCollection] Fetch services", {
    organizationId,
    filters,
  });

  const response = await dataClient.request<ListServices200Response>({
    ...requestOptions,
    method: "GET",
    url: `/organizations/${organizationId}/services`,
    params: normalizeFilters(filters),
  });

  const data = response.data?.data;

  if (!Array.isArray(data)) {
    logger.warn(
      "data_core",
      "[servicesCollection] Unexpected response format",
      {
        organizationId,
        filters,
        dataType: typeof data,
      }
    );
    return [];
  }

  return data as ServiceDto[];
}

function normalizeFilters(filters: ServicesFilters): Record<string, string> {
  const params: Record<string, string> = {};

  filterOrder.forEach((key) => {
    const value = filters[key];
    if (value === undefined || value === null || value === "") {
      return;
    }

    params[key] = value;
  });

  return params;
}

export function servicesQueryOptions(
  organizationId: string,
  filters: ServicesFilters = {}
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: serviceKeys.list(organizationId, filters),
    queryFn: ({ signal }) =>
      fetchServices(organizationId, filters, {
        ...captureRequestOptions(),
        signal,
      }),
  });
}

export function serviceQueryOptions(organizationId: string, serviceId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: serviceKeys.byId(organizationId, serviceId),
    queryFn: async ({ signal }) => {
      const service = await fetchService(organizationId, serviceId, {
        ...captureRequestOptions(),
        signal,
      });
      if (!service) {
        throw new Error(`Service not found: ${serviceId}`);
      }
      return service;
    },
  });
}

/**
 * Relationship-invalidation registration for services. Every scope pattern
 * maps to the organization prefix: service lists are small and filters
 * (project, status) can move a service between them, so the whole
 * organization re-reads; item cascades target the single by-id read.
 */
export function createServiceInvalidator(
  organizationId: string,
  invalidate: (queryKey: TanStackQueryKey) => void
): CollectionInvalidator<TanStackQueryKey> {
  return {
    dispatch: (action) => invalidate(action.queryKey),
    buildScopeKey: () => serviceKeys.all(organizationId),
    buildItemKey: ({ id }) => serviceKeys.byId(organizationId, id),
  };
}
