import {
  EntityType,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "../api";

export interface ProjectWorkspaceRegistryItem {
  readonly kind: "registry-work-item";
  readonly typeKey: string;
  readonly name: string;
}

export interface ProjectWorkspaceDesignDocItem {
  readonly kind: "design-doc";
  readonly entityType: typeof EntityType.DesignDoc;
  readonly name: "Design Docs";
}

export interface ProjectWorkspacePlanItem {
  readonly kind: "plan";
  readonly entityType: typeof EntityType.Task;
  readonly name: "Plans";
}

export type ProjectWorkspaceNavigationItem =
  | ProjectWorkspaceRegistryItem
  | ProjectWorkspaceDesignDocItem
  | ProjectWorkspacePlanItem;

export interface ProjectWorkspaceWorkGroup {
  readonly key: "work";
  readonly label: "Work";
  readonly items: readonly ProjectWorkspaceRegistryItem[];
}

export interface ProjectWorkspaceKnowledgeGroup {
  readonly key: "knowledge";
  readonly label: "Knowledge";
  readonly items: readonly (
    | ProjectWorkspaceRegistryItem
    | ProjectWorkspaceDesignDocItem
    | ProjectWorkspacePlanItem
  )[];
}

export interface ProjectWorkspaceNavigation {
  readonly groups: readonly [
    ProjectWorkspaceWorkGroup,
    ProjectWorkspaceKnowledgeGroup
  ];
}

const DESIGN_DOC_ITEM: ProjectWorkspaceDesignDocItem = {
  kind: "design-doc",
  entityType: EntityType.DesignDoc,
  name: "Design Docs",
};

const PLAN_ITEM: ProjectWorkspacePlanItem = {
  kind: "plan",
  entityType: EntityType.Task,
  name: "Plans",
};

const toRegistryItem = (
  summary: WorkItemTypeSummaryDto
): ProjectWorkspaceRegistryItem => ({
  kind: "registry-work-item",
  typeKey: summary.definition.key,
  name: summary.definition.name,
});

const isActiveForProject = (
  summary: WorkItemTypeSummaryDto,
  projectId: string
): boolean =>
  summary.projectId === projectId &&
  summary.status === WorkItemTypeLifecycleStatus.Active;

const selectNavigationGroup = (
  role: WorkItemTypeSummaryDto["definition"]["role"]
): "work" | "knowledge" | null => {
  switch (role) {
    case WorkItemTypeRole.WorkItem:
      return "work";
    case WorkItemTypeRole.ProjectInfo:
      return "knowledge";
    case WorkItemTypeRole.Scheduled:
    case WorkItemTypeRole.Trigger:
    case WorkItemTypeRole.Monitor:
      return null;
    default: {
      const unhandledRole: never = role;
      return unhandledRole;
    }
  }
};

/**
 * Projects the resolved registry snapshot into the two project navigation
 * groups. Registry-backed items retain the order supplied by the authoritative
 * snapshot; the two explicit non-registry adapters follow Knowledge items.
 */
export function buildProjectWorkspaceNavigation(
  summaries: readonly WorkItemTypeSummaryDto[],
  projectId: string
): ProjectWorkspaceNavigation {
  const work: ProjectWorkspaceRegistryItem[] = [];
  const knowledge: ProjectWorkspaceRegistryItem[] = [];

  for (const summary of summaries) {
    if (!isActiveForProject(summary, projectId)) continue;
    if (summary.definition.key === EntityType.Initiative) continue;

    const group = selectNavigationGroup(summary.definition.role);
    if (group === "work") {
      work.push(toRegistryItem(summary));
    } else if (group === "knowledge") {
      knowledge.push(toRegistryItem(summary));
    }
  }

  return {
    groups: [
      { key: "work", label: "Work", items: work },
      {
        key: "knowledge",
        label: "Knowledge",
        items: [...knowledge, DESIGN_DOC_ITEM, PLAN_ITEM],
      },
    ],
  };
}
