import { queryOptions } from "@tanstack/react-query";
import type { AdminProjectImplementationHintsDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export const adminProjectImplementationHintsKeys = {
  root: () => ["adminProjectImplementationHints"] as const,
  project: (projectId: string) =>
    [...adminProjectImplementationHintsKeys.root(), projectId] as const,
};

/** Platform-admin read of a project's implementation hints, archived Services included. */
export function adminProjectImplementationHintsQueryOptions(projectId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: adminProjectImplementationHintsKeys.project(projectId),
    queryFn: async ({
      signal,
    }): Promise<AdminProjectImplementationHintsDto> => {
      const response =
        await unifiedApiClient.getAdminProjectImplementationHints(
          { projectId },
          { ...captureRequestOptions(), signal },
        );
      const hints = response.data?.data;
      if (!hints) {
        throw new Error("The implementation hints response was incomplete.");
      }
      return hints;
    },
  });
}
