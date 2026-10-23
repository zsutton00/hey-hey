import { queryOptions } from "@tanstack/react-query";
import { designDocsClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { designDocKeys } from "./designDocs";

export function designDocLibraryQueryOptions(
  organizationId: string,
  projectId: string
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: designDocKeys.library(organizationId, projectId),
    queryFn: async ({ signal }) => {
      const response = await designDocsClient.getDesignDocLibrary(
        { organizationId, projectId },
        { ...captureRequestOptions(), signal }
      );
      return response.data.data ?? [];
    },
  });
}
