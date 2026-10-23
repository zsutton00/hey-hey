import type { WorkItemTypeDefinitionDto, WorkStatus } from "../../api";
import { getStatusLabel } from "../../utils/statusUtils";

export interface EntityCollectionStatusTab {
  id: string;
  label: string;
  /** Lifecycle statuses included by this tab; empty means every status. */
  statuses: WorkStatus[];
}

/**
 * Prefix of every reference-page query this page issues for a type; pass to
 * `queryClient.invalidateQueries({ queryKey })` after creating or removing items.
 */
export const entityCollectionQueryKeyPrefix = (
  organizationId: string,
  projectId: string,
  typeKey: string
) => ["work-item-reference-page", organizationId, projectId, typeKey] as const;

export const buildDefaultStatusTabs = (
  typeDefinition: WorkItemTypeDefinitionDto | undefined
): EntityCollectionStatusTab[] => {
  const statuses = typeDefinition?.allowedStatuses ?? [];
  const orderedStatuses = statuses.includes("ACTIVE")
    ? ["ACTIVE" as const, ...statuses.filter((status) => status !== "ACTIVE")]
    : statuses;

  return orderedStatuses.map((status) => ({
    id: status,
    label: getStatusLabel(status),
    statuses: [status],
  }));
};
