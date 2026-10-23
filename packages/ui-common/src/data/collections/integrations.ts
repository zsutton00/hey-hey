import { queryOptions } from "@tanstack/react-query";
import type {
  IntegrationType,
  IntegrationState,
  IntegrationConnectionStatus,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export interface IntegrationFilters {
  type?: IntegrationType;
  state?: IntegrationState;
  connectionStatus?: IntegrationConnectionStatus;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}
export const integrationKeys = {
  root: () => ["integrations"] as const,
  project: (org: string, project: string) =>
    ["integrations", org, project] as const,
  detail: (org: string, project: string, id: string) =>
    ["integrations", org, project, "detail", id] as const,
  list: (org: string, project: string, filters: IntegrationFilters = {}) =>
    ["integrations", org, project, "list", filters] as const,
};
export const integrationQueryOptions = (
  organizationId: string,
  projectId: string,
  integrationId: string
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: integrationKeys.detail(organizationId, projectId, integrationId),
    queryFn: async () =>
      (
        await unifiedApiClient.findOneIntegration(
          { organizationId, projectId, integrationId },
          captureRequestOptions()
        )
      ).data.data ?? null,
  });
export const integrationsQueryOptions = (
  organizationId: string,
  projectId: string,
  filters: IntegrationFilters = {}
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: integrationKeys.list(organizationId, projectId, filters),
    queryFn: async () =>
      (
        await unifiedApiClient.findAllIntegrations(
          { organizationId, projectId, ...filters },
          captureRequestOptions()
        )
      ).data.data ?? [],
  });
