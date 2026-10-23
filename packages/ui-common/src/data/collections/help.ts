import { captureRequestOptions } from "../core/requestInitiator";
import { queryOptions } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export const helpKeys = {
  root: () => ["help"] as const,
  detail: (idOrSlugPath: string) => [...helpKeys.root(), idOrSlugPath] as const,
};
export const helpNodeQueryOptions = (idOrSlugPath: string) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: helpKeys.detail(idOrSlugPath),
    queryFn: async ({ signal }) => {
      const response = await unifiedApiClient.getHelpNode(
        { idOrSlugPath },
        { ...captureRequestOptions(), signal }
      );
      return response.data?.data ?? null;
    },
  });
