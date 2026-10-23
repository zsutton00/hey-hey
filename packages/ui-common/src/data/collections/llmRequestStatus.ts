import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { unifiedApiClient } from "../../clients/serviceClients";
export const llmRequestStatusKeys = {
  root: () => ["llmRequestStatus"] as const,
  detail: (requestId: string) =>
    [...llmRequestStatusKeys.root(), requestId] as const,
};
export function llmRequestStatusQueryOptions(requestId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: llmRequestStatusKeys.detail(requestId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getLLMRequestStatus(
        { requestId },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? null;
    },
  });
}
