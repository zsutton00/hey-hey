import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { unifiedApiClient } from "../../clients/serviceClients";
export const privateBetaAdmissionModeKeys = {
  root: () => ["privateBetaAdmissionMode"] as const,
  current: () => [...privateBetaAdmissionModeKeys.root(), "current"] as const,
};
export function privateBetaAdmissionModeQueryOptions() {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: privateBetaAdmissionModeKeys.current(),
    queryFn: async ({ signal }) => {
      const response =
        await unifiedApiClient.getPrivateBetaSelfServiceAdmissionMode({
          ...captureRequestOptions(),
          signal,
        });
      const data = response.data?.data;
      if (!data)
        throw new Error(
          "The private-beta admission mode response was incomplete."
        );
      return data;
    },
  });
}
