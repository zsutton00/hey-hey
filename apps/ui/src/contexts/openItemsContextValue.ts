import type { EntityActivation } from "@hey-hey/ui-common/context";
import type {
  OpenItemGoalTrackedWorkFilter,
  PromoteGroupToGoalRequest,
  PromoteGroupToGoalResult,
} from "@hey-hey/ui-common/api";
import { createContext } from "react";
import type {
  OpenItem,
  OpenItemGroup,
  OpenItemIdentity,
  OpenItemsSortDirection,
} from "./openItemsModel";

export interface OpenItemsContextValue {
  promoteGroupToGoal: (
    request: PromoteGroupToGoalRequest,
  ) => Promise<PromoteGroupToGoalResult>;
  setGoalFilter: (
    goalId: string,
    filter: OpenItemGoalTrackedWorkFilter,
  ) => Promise<boolean>;
  setGoalExpanded: (goalId: string, expanded: boolean) => Promise<boolean>;
  isLoading: boolean;
  isFetching: boolean;
  stale: boolean;
  offline: boolean;
  pending: number;
  queued: number;
  error: Error | null;
  refresh: () => Promise<boolean>;
  retry: () => Promise<boolean>;
  items: OpenItem[];
  groups: OpenItemGroup[];
  disclosure: OpenItemsDisclosureState;
  sortDirection: OpenItemsSortDirection;
  setSortDirection: (sortDirection: OpenItemsSortDirection) => void;
  setSectionExpanded: (expanded: boolean) => void;
  setBranchExpanded: (itemKey: string, expanded: boolean) => void;
  activate: (activation: EntityActivation) => Promise<boolean>;
  remove: (
    entityId: string,
    entityType: OpenItem["entityType"],
  ) => Promise<boolean>;
  removeItems: (
    identities: readonly OpenItemIdentity[],
    includeDescendants: boolean,
  ) => Promise<boolean>;
  removeOthers: (identity: OpenItemIdentity) => Promise<boolean>;
  removeAllAbove: (identity: OpenItemIdentity) => Promise<boolean>;
  removeAllBelow: (identity: OpenItemIdentity) => Promise<boolean>;
  removeAll: () => Promise<boolean>;
  setWhyOpen: (
    entityId: string,
    entityType: OpenItem["entityType"],
    note: string,
  ) => Promise<boolean>;
  pin: (
    entityId: string,
    entityType: OpenItem["entityType"],
  ) => Promise<boolean>;
  unpin: (
    entityId: string,
    entityType: OpenItem["entityType"],
  ) => Promise<boolean>;
  createGroup: (
    name: string,
    identities: readonly OpenItemIdentity[],
  ) => Promise<boolean>;
  assignToGroup: (
    groupId: string,
    identities: readonly OpenItemIdentity[],
  ) => Promise<boolean>;
  ungroup: (identities: readonly OpenItemIdentity[]) => Promise<boolean>;
  renameGroup: (groupId: string, name: string) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<boolean>;
  setGroupExpanded: (groupId: string, expanded: boolean) => Promise<boolean>;
  moveItem: (
    identity: OpenItemIdentity,
    direction: "up" | "down",
  ) => Promise<boolean>;
  moveGroup: (groupId: string, direction: "up" | "down") => Promise<boolean>;
}

interface OpenItemsDisclosureState {
  sectionExpanded: boolean;
  collapsedBranchKeys: ReadonlySet<string>;
}

// Keep the context identity outside the Fast Refresh boundary that exports the
// provider and hooks. Otherwise a hot update can briefly pair a new consumer
// context with the previous provider and strand the router on its error page.
export const OpenItemsContext = createContext<OpenItemsContextValue | null>(
  null,
);
