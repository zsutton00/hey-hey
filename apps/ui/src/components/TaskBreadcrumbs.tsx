import {
  getWorkItemTypeLabel,
  WORK_ITEM_TYPE_KEYS,
} from "../types/workItemTypes";
import React from "react";
import {
  FeatureHierarchyEntryDtoRelationshipEnum,
  FeatureHierarchyEntryDtoRelationshipTypeEnum,
  type FeatureHierarchyEntryDto,
  type PlanContextEntryDto,
  type TaskResponseDto,
} from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";
import type { BreadcrumbItem } from "@hey-hey/ui-common/utils";
import { PageBreadcrumbs } from "./Layout";

export interface BuildTaskBreadcrumbItemsParams {
  projectId: string;
  projectName?: string;
  task: TaskBreadcrumbWorkItem;
  parent?: TaskBreadcrumbWorkItem | null;
  /** Parent plan this task lives under. When provided, renders a plan segment after the project. */
  plan?: Pick<PlanContextEntryDto, "id" | "displayName"> | null;
  /** Resolved structural feature ancestors, root-first. */
  featureAncestors?: readonly BreadcrumbFeatureAncestor[];
  /** When provided, the task becomes a link and this renders as the current page label */
  childLabel?: string;
  /** Type for the child breadcrumb (e.g. "agent_session") */
  childType?: string;
  /** Display label override for the child breadcrumb's type (e.g. "coding session") */
  childTypeLabel?: string;
  /** Registry display name for the task's work-item type. */
  taskTypeName?: string;
  /** Registry display name for the parent task's work-item type. */
  parentTypeName?: string;
  /** Link for the task when childLabel is set. Defaults to the task's canonical path. */
  taskLinkTo?: string;
  /** When false, breadcrumb labels render without navigation targets. */
  linksEnabled?: boolean;
}

type TaskBreadcrumbWorkItem = Pick<TaskResponseDto, "id" | "name" | "type">;

export interface BreadcrumbFeatureAncestor {
  id: string;
  name: string;
}

export function getStructuralFeatureAncestors(
  featureHierarchy: readonly FeatureHierarchyEntryDto[] = []
): FeatureHierarchyEntryDto[] {
  return featureHierarchy
    .filter(
      (entry) =>
        entry.relationshipType ===
          FeatureHierarchyEntryDtoRelationshipTypeEnum.Structural &&
        entry.relationship === FeatureHierarchyEntryDtoRelationshipEnum.Ancestor
    )
    .sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));
}

export function getTaskBreadcrumbType(
  task: Pick<TaskBreadcrumbWorkItem, "type">
): string {
  switch (task.type) {
    case WORK_ITEM_TYPE_KEYS.Feature:
      return "feature";
    case WORK_ITEM_TYPE_KEYS.Bug:
      return "bug";
    case WORK_ITEM_TYPE_KEYS.Goal:
      return "goal";
    case WORK_ITEM_TYPE_KEYS.Workflow:
    case WORK_ITEM_TYPE_KEYS.Diagram:
      return "diagram";
    case WORK_ITEM_TYPE_KEYS.WorkflowStep:
    case WORK_ITEM_TYPE_KEYS.DiagramElement:
      return "diagram_element";
    case WORK_ITEM_TYPE_KEYS.Standard:
      return "task";
    default:
      return task.type?.toLowerCase() ?? "work_item";
  }
}

function getTaskBreadcrumbLabel(
  task: TaskBreadcrumbWorkItem,
  registryName?: string
): string {
  return registryName ?? getWorkItemTypeLabel(task.type) ?? "Work item";
}

export function buildTaskBreadcrumbItems({
  projectId,
  projectName,
  task,
  parent,
  plan,
  featureAncestors = [],
  childLabel,
  childType,
  childTypeLabel,
  taskTypeName,
  parentTypeName,
  taskLinkTo,
  linksEnabled = true,
}: BuildTaskBreadcrumbItemsParams): BreadcrumbItem[] {
  const taskType = getTaskBreadcrumbType(task);
  const parentType = parent ? getTaskBreadcrumbType(parent) : undefined;
  const isCurrentTask = !childLabel;
  const taskPath =
    taskLinkTo ?? WebPathService.task({ projectId, taskId: task.id });

  const items: BreadcrumbItem[] = [
    { label: "Projects", to: linksEnabled ? "/projects" : undefined },
    {
      label: projectName ?? "Project",
      to: linksEnabled ? `/projects/${projectId}` : undefined,
      type: projectName ? "project" : undefined,
      kind: "project",
    },
  ];

  for (const feature of featureAncestors) {
    items.push({
      label: feature.name,
      to: linksEnabled
        ? WebPathService.feature({ projectId, featureId: feature.id })
        : undefined,
      type: "feature",
      kind: "feature",
      entityId: feature.id,
    });
  }

  if (plan) {
    items.push({
      label: plan.displayName,
      to: linksEnabled
        ? WebPathService.plan({ projectId, planId: plan.id })
        : undefined,
      type: "plan",
      entityId: plan.id,
    });
  }

  if (parent && !featureAncestors.some((feature) => feature.id === parent.id)) {
    items.push({
      label: parent.name,
      to: linksEnabled
        ? WebPathService.task({ projectId, taskId: parent.id })
        : undefined,
      type: parentType,
      kind: parentType === "feature" ? "feature" : "entity",
      typeLabel: getTaskBreadcrumbLabel(parent, parentTypeName),
      entityId: parent.id,
    });
  }

  items.push({
    label: task.name || getTaskBreadcrumbLabel(task, taskTypeName),
    to: isCurrentTask || !linksEnabled ? undefined : taskPath,
    isCurrent: isCurrentTask,
    type: taskType,
    kind: taskType === "feature" && childLabel ? "feature" : "entity",
    typeLabel: getTaskBreadcrumbLabel(task, taskTypeName),
    entityId: task.id,
  });

  if (childLabel) {
    items.push({
      label: childLabel,
      isCurrent: true,
      type: childType,
      typeLabel: childTypeLabel,
    });
  }

  return items;
}

export type TaskBreadcrumbsProps = BuildTaskBreadcrumbItemsParams;

export const TaskBreadcrumbs: React.FC<TaskBreadcrumbsProps> = (props) => {
  const items = buildTaskBreadcrumbItems(props);
  return <PageBreadcrumbs items={items} />;
};
