import type { TaskResponseDto } from "../../api/api";
import { getWorkItemTypeStatusNames } from "../../utils/statusUtils";
import type { WorkItemTypeDefinitionDto } from "../../api";
import { getWorkItemStatusLabel } from "../../utils/workItemStatusVocabulary";

/**
 * Tab ids are selection identities, not status names. Status tabs carry a
 * prefix so no saved status name (even one spelled like this id) can select
 * the unfiltered tab.
 */
export const ALL_STATUSES_TAB_ID = "all";
export const statusTabId = (status: string) => `status:${status}`;

export interface EntityCollectionStatusTab {
  id: string;
  label: string;
  /** Lifecycle statuses included by this tab; empty means every status. */
  statuses: TaskResponseDto["status"][];
}

/**
 * Prefix of every reference-page query this page issues for a type; pass to
 * `queryClient.invalidateQueries({ queryKey })` after creating or removing items.
 */
export const entityCollectionQueryKeyPrefix = (
  organizationId: string,
  projectId: string,
  typeKey: string,
) => ["work-item-reference-page", organizationId, projectId, typeKey] as const;

/** Legacy types list their ACTIVE lifecycle first; custom types keep their configured order. */
const LEGACY_LEADING_STATUS = "ACTIVE";

export const buildDefaultStatusTabs = (
  typeDefinition: WorkItemTypeDefinitionDto | undefined,
): EntityCollectionStatusTab[] => {
  if (!typeDefinition) {
    return [];
  }

  const statuses = getWorkItemTypeStatusNames(typeDefinition);
  const orderedStatuses = statuses.includes(LEGACY_LEADING_STATUS)
    ? [
        LEGACY_LEADING_STATUS,
        ...statuses.filter((status) => status !== LEGACY_LEADING_STATUS),
      ]
    : statuses;

  const statusTabs = orderedStatuses.map((status) => ({
    id: statusTabId(status),
    label: getWorkItemStatusLabel(status, typeDefinition),
    statuses: [status],
  }));

  // Items keeping a status the type no longer defines match no status tab, so
  // the unfiltered view is what keeps them discoverable.
  return [
    ...statusTabs,
    { id: ALL_STATUSES_TAB_ID, label: "All", statuses: [] },
  ];
};
