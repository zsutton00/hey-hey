import { queryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export const userKeys = {
  root: () => ["users"] as const,
  all: (org: string) => ["users", org] as const,
};
export const usersQueryOptions = (organizationId: string) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: userKeys.all(organizationId),
    queryFn: async () =>
      [
        ...((
          await unifiedApiClient.getOrganizationMembers(
            { organizationId },
            captureRequestOptions()
          )
        ).data?.data ?? []),
      ].sort((a, b) => (a.user?.name ?? "").localeCompare(b.user?.name ?? "")),
  });
