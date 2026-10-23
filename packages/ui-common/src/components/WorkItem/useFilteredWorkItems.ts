import { useMemo } from "react";
import type { Priority, TaskPriority, WorkStatus } from "../../api";
import { WorkStatus as WorkStatusEnum } from "../../api";

type FilterableItem = {
  name?: string | null;
  tags?: (string | null | undefined)[] | null;
  status?: WorkStatus | string | null;
  priority?: Priority | TaskPriority | null;
  createdAt?: string | null;
};

const statusOrder = (
  [
    WorkStatusEnum.Active,
    WorkStatusEnum.Backlog,
    WorkStatusEnum.OnHold,
    WorkStatusEnum.Verifying,
    WorkStatusEnum.Completed,
    WorkStatusEnum.RefiningAcceptanceCriteria,
    WorkStatusEnum.RefiningDetails,
    WorkStatusEnum.RefiningDescription,
    WorkStatusEnum.GeneratingAcceptanceCriteria,
    WorkStatusEnum.GeneratingDetails,
    WorkStatusEnum.GeneratingDescriptionAndDetails,
    WorkStatusEnum.GeneratingAll,
    WorkStatusEnum.GeneratingDescription,
    WorkStatusEnum.Generated,
    WorkStatusEnum.Cancelled,
    WorkStatusEnum.Superseded,
  ] as WorkStatusEnum[]
).reduce(
  (
    acc: Record<WorkStatus | string, number>,
    s: WorkStatusEnum,
    idx: number
  ) => {
    acc[s] = idx;
    return acc;
  },
  {}
);

export function useFilteredWorkItems<T extends FilterableItem>(
  initiatives: T[],
  searchTerm: string,
  statusFilter: string,
  sortBy: string,
  _parentTaskId?: string | null
): T[] {
  return useMemo(() => {
    let filtered = initiatives;

    // Search filter
    if (searchTerm.trim()) {
      const lowerSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          (i.name || "").toLowerCase().includes(lowerSearch) ||
          (i.tags || []).some((tag) => tag?.toLowerCase().includes(lowerSearch))
      );
    }

    // Status filter
    if (statusFilter) {
      filtered = filtered.filter((i) => i.status === statusFilter);
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
          (a.name || "").localeCompare(b.name || "")
        );
      case "name-desc":
        return sorted.sort((a, b) =>
          (b.name || "").localeCompare(a.name || "")
        );
      case "created-desc":
        return sorted.sort(
          (a, b) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime()
        );
      case "created-asc":
        return sorted.sort(
          (a, b) =>
            new Date(a.createdAt || 0).getTime() -
            new Date(b.createdAt || 0).getTime()
        );
      case "status": {
        const getStatusRank = (status?: string | null) => {
          if (!status) return Number.MAX_SAFE_INTEGER;
          const directRank = statusOrder[status as WorkStatus];
          if (directRank !== undefined) return directRank;
          const upper = status.toUpperCase();
          // Allow partial matches for generated/refining/generating variants not explicitly listed
          if (upper.includes("ACCEPTANCE_CRITERIA")) return 1.5;
          if (upper.includes("DETAILS")) return 2.5;
          if (upper.includes("DESCRIPTION")) return 3.5;
          if (upper.startsWith("GENERATING_") || upper === "GENERATED")
            return 9.5;
          if (upper === "READY" || upper === "ACTIVE") return 0;
          if (upper === "COMPLETED") return 12;
          if (upper === "CANCELLED") return 13;
          if (upper === "SUPERSEDED") return 14;
          return Number.MAX_SAFE_INTEGER;
        };

        // Prioritize nearest-to-ready statuses first, then alphabetical for ties/unknowns
        return sorted.sort((a, b) => {
          const rankDifference =
            getStatusRank(a.status) - getStatusRank(b.status);
          if (rankDifference !== 0) return rankDifference;
          return (a.status || "").localeCompare(b.status || "");
        });
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
              Number.MAX_SAFE_INTEGER)
        );
      }
      default:
        return sorted;
    }
  }, [initiatives, searchTerm, statusFilter, sortBy]);
}
