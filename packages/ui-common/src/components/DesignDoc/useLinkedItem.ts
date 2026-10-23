import { useMemo } from "react";
import type { WorkItemSelectorValue } from "../Selectors";
import type { LinkedItemMode } from "./types";

export const useLinkedItem = (
  currentOrgId: string | null,
  resolvedSelectorMode: LinkedItemMode,
  itemSelection:
    | WorkItemSelectorValue
    | string
    | { type: string; id: string }
    | null
) => {
  return useMemo(() => {
    if (!currentOrgId) {
      return null;
    }

    if (resolvedSelectorMode === "design-doc") {
      if (
        itemSelection &&
        typeof itemSelection === "object" &&
        itemSelection !== null &&
        "type" in itemSelection &&
        "id" in itemSelection
      ) {
        return itemSelection as { type: string; id: string };
      }
      return null;
    }

    if (resolvedSelectorMode === "workItem") {
      if (
        itemSelection &&
        typeof itemSelection === "object" &&
        itemSelection !== null &&
        "type" in itemSelection &&
        "id" in itemSelection
      ) {
        return itemSelection as WorkItemSelectorValue;
      }
      return null;
    }

    if (
      (resolvedSelectorMode === "task" ||
        resolvedSelectorMode === "initiative") &&
      typeof itemSelection === "string" &&
      itemSelection
    ) {
      return {
        type: resolvedSelectorMode,
        id: itemSelection,
      } as WorkItemSelectorValue;
    }

    return null;
  }, [currentOrgId, resolvedSelectorMode, itemSelection]);
};
