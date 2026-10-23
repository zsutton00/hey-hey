import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { unifiedApiClient } from "../../clients/serviceClients";
export const demoSandboxAdminKeys = {
  root: () => ["demoSandboxAdmin"] as const,
  overview: () => [...demoSandboxAdminKeys.root(), "overview"] as const,
};
export function demoSandboxAdminOverviewQueryOptions() {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: demoSandboxAdminKeys.overview(),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getDemoSandboxAdminOverview({
        ...captureRequestOptions(),
        signal,
      });
      const data = response.data?.data;
      if (!data)
        throw new Error("The demo sandbox overview response was incomplete.");
      return data;
    },
  });
}
