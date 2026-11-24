import {
  WorkItemTypeLifecycleStatus,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/contracts/api";
import { useWorkItemTypes } from "@hey-hey/ui-common/data";
import { useMemo } from "react";
import { getWorkItemTypePluralDisplayName } from "../types/workItemTypes";

export interface ExplorerWorkItemSection {
  key: string;
  label: string;
  summary: WorkItemTypeSummaryDto;
}

export interface ExplorerSections {
  /** False until the work-item type registry has resolved. */
  isReady: boolean;
  isLoading: boolean;
  /** Registry-defined sections, in Explorer order. Empty until ready. */
  workItemSections: ExplorerWorkItemSection[];
}

/**
 * The registry-defined sections the Explorer shows after Open Items, in the
 * Explorer's order and with its labels. The Explorer sidebar and the Search
 * modal tabs both read this so a newly configured type appears in both.
 */
export function useExplorerSections(
  organizationId: string,
  projectId: string,
  enabled = true,
): ExplorerSections {
  const { workItemTypes, isLoading, isReady } = useWorkItemTypes(
    organizationId,
    {
      projectId,
      status: WorkItemTypeLifecycleStatus.Active,
      enabled,
    },
  );

  const workItemSections = useMemo<ExplorerWorkItemSection[]>(
    () =>
      isReady
        ? workItemTypes
            .filter(
              (summary) =>
                summary.status === WorkItemTypeLifecycleStatus.Active &&
                summary.definition.capabilities?.showsInExplorerSidebar ===
                  true,
            )
            .map((summary) => ({
              key: summary.definition.key,
              label:
                getWorkItemTypePluralDisplayName(summary.definition) ??
                summary.definition.name,
              summary,
            }))
        : [],
    [isReady, workItemTypes],
  );

  return { isReady, isLoading, workItemSections };
}
