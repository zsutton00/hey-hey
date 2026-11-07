import { useQuery } from "@tanstack/react-query";
import type { WorkItemTypeCanonicalComparisonDto } from "../../api";
import {
  getWorkItemTypesApi,
  workItemTypeKeys,
} from "../collections/workItemTypes";
import { captureRequestOptions } from "../core/requestInitiator";

/**
 * Reads a canonical override next to the current canonical definition of the
 * same key. Read-only: the two definitions are displayed, never merged.
 * Keyed under the project's work-item-type prefix so any type change that
 * marks registry data stale also refreshes the comparison.
 */
export function useWorkItemTypeCanonicalComparison(
  organizationId: string | undefined,
  projectId: string | undefined,
  typeKey: string | undefined,
  enabled: boolean,
) {
  const isEnabled = enabled && !!organizationId && !!projectId && !!typeKey;

  return useQuery({
    queryKey: [
      ...workItemTypeKeys.all(organizationId ?? "", projectId ?? ""),
      "canonicalComparison",
      typeKey ?? "",
    ] as const,
    enabled: isEnabled,
    queryFn: async ({
      signal,
    }): Promise<WorkItemTypeCanonicalComparisonDto> => {
      const response =
        await getWorkItemTypesApi().organizationsOrganizationIdProjectsProjectIdWorkItemTypesTypeKeyCanonicalComparisonGet(
          {
            organizationId: organizationId as string,
            projectId: projectId as string,
            typeKey: typeKey as string,
          },
          { ...captureRequestOptions(), signal },
        );
      const comparison = response.data.data;
      if (!comparison) {
        throw new Error("No canonical comparison returned for work-item type");
      }

      return comparison;
    },
  });
}
