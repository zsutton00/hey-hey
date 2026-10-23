import {
  WorkItemTypeRole,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";

import {
  getWorkItemTypePluralDisplayName,
  WORK_ITEM_TYPE_KEYS,
} from "./workItemTypes";

interface WorkItemRoleNavigationItem {
  key: string;
  label: string;
  role: WorkItemTypeRole;
}

export interface WorkItemRoleNavigationGroup {
  role: WorkItemTypeRole;
  label: string;
  items: WorkItemRoleNavigationItem[];
}

export const getWorkItemRoleNavigationTooltip = (
  items: readonly { label: string }[],
): string => `Types: ${items.map((item) => item.label).join(", ")}`;

/**
 * Keep role ordering and presentation shared by project and entity pages.
 * The definitions themselves remain the only source of visible type keys.
 */
const WORK_ITEM_ROLE_ORDER = Object.values(
  WorkItemTypeRole,
) as WorkItemTypeRole[];

const WORK_ITEM_ROLE_LABELS: Record<WorkItemTypeRole, string> = {
  [WorkItemTypeRole.WorkItem]: "Work Items",
  [WorkItemTypeRole.ProjectInfo]: "Project Info",
  [WorkItemTypeRole.Scheduled]: "Scheduled",
  [WorkItemTypeRole.Trigger]: "Triggers",
  [WorkItemTypeRole.Monitor]: "Monitors",
};

const getWorkItemRoleLabel = (role: WorkItemTypeRole): string =>
  WORK_ITEM_ROLE_LABELS[role];

/**
 * Projects the visible child type keys into role groups. The supplied map is
 * the active, project-resolved registry snapshot; absent keys are therefore
 * intentionally omitted rather than recovered from a compatibility list.
 */
export const buildWorkItemRoleNavigationGroups = (
  definitions: ReadonlyMap<string, WorkItemTypeDefinitionDto>,
  visibleTypeKeys: readonly string[],
): WorkItemRoleNavigationGroup[] => {
  const items = visibleTypeKeys.flatMap<WorkItemRoleNavigationItem>(
    (typeKey) => {
      const definition = definitions.get(typeKey);
      const label = getWorkItemTypePluralDisplayName(definition);
      if (!definition || definition.key !== typeKey || !label) return [];

      return [{ key: typeKey, label, role: definition.role }];
    },
  );

  return WORK_ITEM_ROLE_ORDER.flatMap((role) => {
    const roleItems = items.filter((item) => item.role === role);
    return roleItems.length > 0
      ? [{ role, label: getWorkItemRoleLabel(role), items: roleItems }]
      : [];
  });
};

const resolveWorkItemRoleNavigationGroup = (
  groups: readonly WorkItemRoleNavigationGroup[],
  role: string | null | undefined,
): WorkItemRoleNavigationGroup | undefined =>
  groups.find((group) => group.role === role);

export const resolveWorkItemRoleNavigationTypeKey = (
  groups: readonly WorkItemRoleNavigationGroup[],
  activeTab: string | null | undefined,
  activeType: string | null | undefined,
): string | undefined => {
  if (activeTab?.startsWith("children:")) {
    return activeTab.slice("children:".length);
  }

  const group = resolveWorkItemRoleNavigationGroup(groups, activeTab);
  if (!group) return undefined;

  const defaultTypeKey =
    group.role === WorkItemTypeRole.WorkItem
      ? group.items.find((item) => item.key === WORK_ITEM_TYPE_KEYS.Standard)
          ?.key
      : undefined;

  return (
    group.items.find((item) => item.key === activeType)?.key ??
    defaultTypeKey ??
    group.items[0]?.key
  );
};
