import { WorkItemTypeRole } from "@hey-hey/ui-common/api";
import type {
  ProjectWorkspaceNavigation,
  ProjectWorkspaceNavigationItem,
} from "@hey-hey/ui-common/data";

export type ProjectDestination =
  | "overview"
  | "work"
  | "reviews"
  | "agents"
  | "knowledge"
  | "settings"
  | "admin"
  | "help";

export const PROJECT_DESTINATIONS: ReadonlyArray<{
  value: ProjectDestination;
  label: string;
}> = [
  { value: "overview", label: "Overview" },
  { value: "work", label: "Work" },
  { value: "reviews", label: "Reviews" },
  { value: "agents", label: "Agents" },
  { value: "knowledge", label: "Knowledge" },
  { value: "settings", label: "Settings" },
  { value: "admin", label: "Admin" },
  { value: "help", label: "Help" },
];

export type ProjectNavigationItem = ProjectWorkspaceNavigationItem;
export type ProjectNavigationGroup =
  ProjectWorkspaceNavigation["groups"][number];

const LEGACY_PROJECT_TAB_SELECTIONS: Readonly<
  Record<string, { destination: "work" | "knowledge"; key: string }>
> = {
  tasks: { destination: "work", key: "STANDARD" },
  bugs: { destination: "work", key: "BUG" },
  features: { destination: "knowledge", key: "FEATURE" },
  plans: { destination: "knowledge", key: "PLAN" },
  "knowledge-base": { destination: "knowledge", key: "DESIGN_DOC" },
  "design-docs": { destination: "knowledge", key: "DESIGN_DOC" },
};

const LEGACY_PROJECT_ROLE_DESTINATIONS: Readonly<
  Record<string, "work" | "knowledge">
> = {
  [WorkItemTypeRole.WorkItem]: "work",
  [WorkItemTypeRole.ProjectInfo]: "knowledge",
};

const getLegacyProjectTabSelection = (
  tabValue: string | null,
): { destination: "work" | "knowledge"; key: string } | undefined =>
  tabValue &&
  Object.prototype.hasOwnProperty.call(LEGACY_PROJECT_TAB_SELECTIONS, tabValue)
    ? LEGACY_PROJECT_TAB_SELECTIONS[tabValue]
    : undefined;

const getLegacyProjectRoleDestination = (
  tabValue: string | null,
): "work" | "knowledge" | undefined =>
  tabValue &&
  Object.prototype.hasOwnProperty.call(
    LEGACY_PROJECT_ROLE_DESTINATIONS,
    tabValue,
  )
    ? LEGACY_PROJECT_ROLE_DESTINATIONS[tabValue]
    : undefined;

export const resolveProjectDestination = (
  tabValue: string | null,
): ProjectDestination => {
  const legacySelection = getLegacyProjectTabSelection(tabValue);
  if (legacySelection) return legacySelection.destination;

  const legacyRoleDestination = getLegacyProjectRoleDestination(tabValue);
  if (legacyRoleDestination) return legacyRoleDestination;

  if (
    tabValue &&
    PROJECT_DESTINATIONS.some((destination) => destination.value === tabValue)
  ) {
    return tabValue as ProjectDestination;
  }

  return "overview";
};

export const getProjectNavigationItemKey = (
  item: ProjectNavigationItem,
): string =>
  item.kind === "registry-work-item"
    ? item.typeKey
    : item.kind === "plan"
      ? "PLAN"
      : item.entityType;

export const getProjectNavigationItemLabel = (
  item: ProjectNavigationItem,
): string => item.name;

export const resolveProjectNavigationItem = (
  groups: readonly ProjectNavigationGroup[],
  tabValue: string | null,
  typeValue: string | null,
): ProjectNavigationItem | undefined => {
  const legacySelection = getLegacyProjectTabSelection(tabValue);
  const destination =
    legacySelection?.destination ??
    getLegacyProjectRoleDestination(tabValue) ??
    resolveProjectDestination(tabValue);
  if (destination !== "work" && destination !== "knowledge") {
    return undefined;
  }

  const group = groups.find((candidate) => candidate.key === destination);
  const requestedKey = legacySelection?.key ?? typeValue ?? undefined;

  return (
    group?.items.find(
      (item) => getProjectNavigationItemKey(item) === requestedKey,
    ) ?? group?.items[0]
  );
};
