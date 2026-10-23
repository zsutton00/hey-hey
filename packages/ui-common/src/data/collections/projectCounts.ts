import { queryOptions } from "@tanstack/react-query";
import { projectsClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { projectKeys } from "./projects";
export const projectCountsQueryOptions = (
  organizationId: string,
  projectId: string
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: projectKeys.counts(organizationId, projectId),
    queryFn: async () =>
      (
        await projectsClient.getProjectCounts(
          { organizationId, projectId },
          captureRequestOptions()
        )
      ).data?.data ?? null,
  });
