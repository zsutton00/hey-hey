import { queryOptions } from "@tanstack/react-query";
import type { PrivateBetaDisclosureStatusDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/** The current user's disclosure status: one key per signed-in client. */
export const privateBetaDisclosureKeys = {
  root: () => ["privateBetaDisclosure"] as const,
  current: () => [...privateBetaDisclosureKeys.root(), "current"] as const,
};

export function privateBetaDisclosureQueryOptions() {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: privateBetaDisclosureKeys.current(),
    queryFn: async ({ signal }): Promise<PrivateBetaDisclosureStatusDto> => {
      const response = await unifiedApiClient.getPrivateBetaDisclosureStatus({
        ...captureRequestOptions(),
        signal,
      });
      const status = response.data?.data;
      if (!status) {
        throw new Error(
          "The private-beta disclosure status response was incomplete."
        );
      }
      return status;
    },
  });
}
