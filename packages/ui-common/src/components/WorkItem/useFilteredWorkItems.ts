import type { TaskResponseDto } from "../../api/api";
import { useMemo } from "react";
import type { Priority, TaskPriority } from "../../api";
import { WorkStatus as WorkStatusEnum } from "../../api";
import {
  getWorkItemStatusOrder,
  matchesWorkItemStatusFilter,
  type WorkItemStatusVocabulary,
} from "../../utils/workItemStatusVocabulary";

type FilterableItem = {
  name?: string | null;
  tags?: (string | null | undefined)[] | null;
  type?: string | null;
  status?: TaskResponseDto["status"] | string | null;
  priority?: Priority | TaskPriority | null;
  createdAt?: string | null;
};

export function useFilteredWorkItems<T extends FilterableItem>(
  initiatives: T[],
  searchTerm: string,
  statusFilter: string,
  sortBy: string,
  vocabularies: ReadonlyMap<string, WorkItemStatusVocabulary>,
): T[] {
  return useMemo(() => {
    let filtered = initiatives;

    // Search filter
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          (i.name || "").toLowerCase().includes(lowerSearch) ||
          (i.tags || []).some((tag) =>
            tag?.toLowerCase().includes(lowerSearch),
          ),
      );
    }

    // Status filter
    if (statusFilter) {
      filtered = filtered.filter((i) =>
        matchesWorkItemStatusFilter(i, statusFilter),
      );
    } else {
      // No explicit status filter: keep superseded items out of default views.
      // They remain reachable by explicitly selecting the SUPERSEDED filter.
      filtered = filtered.filter((i) => i.status !== WorkStatusEnum.Superseded);
    }

    // Sort
    const sorted = [...filtered];
    switch (sortBy) {
      case "name-asc":
        return sorted.sort((a, b) =>
          (a.name || "").localeCompare(b.name || ""),
        );
      case "name-desc":
        return sorted.sort((a, b) =>
          (b.name || "").localeCompare(a.name || ""),
        );
      case "created-desc":
        return sorted.sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
      case "created-asc":
        return sorted.sort(
          (a, b) =>
            new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime(),
        );
      case "status": {
        // Each item ranks by its own type's order; equal names from different
        // types carry no shared meaning, so ties fall back to type, then name.
        const rank = (item: T): number =>
          item.status
            ? getWorkItemStatusOrder(
                item.status,
                vocabularies.get(item.type ?? ""),
              )
            : Number.MAX_SAFE_INTEGER;

        return sorted.sort(
          (a, b) =>
            rank(a) - rank(b) ||
            (a.type ?? "").localeCompare(b.type ?? "") ||
            (a.status ?? "").localeCompare(b.status ?? ""),
        );
      }
      case "priority": {
        const priorityOrder: Record<Priority | TaskPriority, number> = {
          HIGH: 0,
          MEDIUM: 1,
          LOW: 2,
          CRITICAL: 0,
        };
        return sorted.sort(
          (a, b) =>
            (priorityOrder[a.priority as Priority | TaskPriority] ??
              Number.MAX_SAFE_INTEGER) -
            (priorityOrder[b.priority as Priority | TaskPriority] ??
              Number.MAX_SAFE_INTEGER),
        );
      }
      default:
        return sorted;
    }
  }, [initiatives, searchTerm, statusFilter, sortBy, vocabularies]);
}
