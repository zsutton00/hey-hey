import type { EntityActivation } from "../contexts/EntityActivationContext";
import type { NavigationLineage } from "../types/userTracking";
import type { OpenItemGoalTrackedWorkFilter } from "../api";

export interface OpenItemsRow extends Omit<EntityActivation, "lineage"> {
  lineage?: NavigationLineage;
  whyOpen?: string;
  pinned?: boolean;
  firstAddedOrder?: number;
  groupId?: string;
  /** Present on canonical rows; absent on legacy browser migration rows. */
  goalTrackedWorkFilter?: OpenItemGoalTrackedWorkFilter;
  goalCollapsed?: boolean;
}

export interface OpenItemsGroupRow {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
}

export interface OpenItemsBrowserRecord {
  version: 1;
  items: OpenItemsRow[];
  groups: OpenItemsGroupRow[];
  sortDirection?: "oldest" | "newest";
  disclosure?: {
    version: 1;
    sectionExpanded: boolean;
    collapsedBranchKeys: string[];
  };
}
