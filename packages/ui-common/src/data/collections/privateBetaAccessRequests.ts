import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

import { unifiedApiClient } from "../../clients/serviceClients";
export const privateBetaAccessRequestKeys = {
  root: () => ["privateBetaAccessRequests"] as const,
  list: () => [...privateBetaAccessRequestKeys.root(), "list"] as const,
  detail: (requestId: string) =>
    [...privateBetaAccessRequestKeys.root(), "detail", requestId] as const,
};
export function privateBetaAccessRequestsQueryOptions() {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: privateBetaAccessRequestKeys.list(),
    queryFn: async ({ signal }) => {
      const response =
        await unifiedApiClient.listPrivateBetaAccessRequestReviews({
          ...captureRequestOptions(),
          signal,
        });
      return response.data?.data ?? [];
    },
  });
}
export function privateBetaAccessRequestQueryOptions(requestId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: privateBetaAccessRequestKeys.detail(requestId),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getPrivateBetaAccessRequestReview(
        { requestId },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? null;
    },
  });
}
