import { captureRequestOptions } from "../core/requestInitiator";
import { queryOptions } from "@tanstack/react-query";
import type { ListImplementationHints200Response } from "../../api";
import { dataClient } from "../../clients";
import { unifiedApiClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export interface ImplementationHintsFilters {
  serviceId?: string;
  agentSessionId?: string;
}
export const implementationHintKeys = {
  root: () => ["implementationHints"] as const,
  all: (organizationId: string) =>
    [...implementationHintKeys.root(), organizationId] as const,
  details: (organizationId: string) =>
    [...implementationHintKeys.all(organizationId), "detail"] as const,
  detail: (organizationId: string, serviceId: string, hintId: string) =>
    [
      ...implementationHintKeys.details(organizationId),
      serviceId,
      hintId,
    ] as const,
  lists: (organizationId: string) =>
    [...implementationHintKeys.all(organizationId), "list"] as const,
  list: (organizationId: string, filters: ImplementationHintsFilters = {}) =>
    [
      ...implementationHintKeys.lists(organizationId),
      {
        serviceId: filters.serviceId || undefined,
        agentSessionId: filters.agentSessionId || undefined,
      },
    ] as const,
};
export const implementationHintQueryOptions = (
  organizationId: string,
  serviceId: string,
  hintId: string,
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: implementationHintKeys.detail(organizationId, serviceId, hintId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getImplementationHint(
        { organizationId, serviceId, hintId },
        { ...captureRequestOptions(), signal },
      );
      const hint = response.data?.data;
      if (!hint) throw new Error(`Implementation hint not found: ${hintId}`);
      return hint;
    },
  });
export const implementationHintsQueryOptions = (
  organizationId: string,
  filters: ImplementationHintsFilters = {},
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: implementationHintKeys.list(organizationId, filters),
    queryFn: async ({ signal }) => {
      const hints: NonNullable<ListImplementationHints200Response["data"]> = [];
      const size = 25;
      let page = 1;
      while (true) {
        const response =
          await dataClient.request<ListImplementationHints200Response>({
            ...captureRequestOptions(),
            signal,
            method: "GET",
            url: `/organizations/${organizationId}/implementation-hints`,
            params: {
              page,
              size,
              serviceId: filters.serviceId || undefined,
              agentSessionId: filters.agentSessionId || undefined,
            },
          });
        const items = response.data?.data ?? [];
        hints.push(...items);
        if (items.length < size) return hints;
        page += 1;
      }
    },
  });
