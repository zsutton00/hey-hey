import {
  TargetEntityType,
  type DiagramElementMetadata,
  type ProjectedWorkItem,
} from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";

export type GraphWorkItem = Omit<WorkItemResponseDto, "sections"> & {
  sections?: WorkItemResponseDto["sections"] | ProjectedWorkItem["sections"];
};

export const parseJsonSection = (
  sections: GraphWorkItem["sections"],
  key: string,
): unknown => {
  const section = sections?.find((section) => section.key === key);
  if (!section) return null;
  const value: unknown =
    "materializedMarkdown" in section
      ? section.materializedMarkdown
      : section.content;
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

export const getDiagramElementMetadata = (
  workItem: Pick<GraphWorkItem, "sections">,
): DiagramElementMetadata | null =>
  (() => {
    const value = parseJsonSection(workItem.sections, "diagramElementMetadata");
    if (
      typeof value !== "object" ||
      value === null ||
      !("role" in value) ||
      typeof value.role !== "string"
    )
      return null;
    const canonicalReference =
      "canonicalReference" in value &&
      typeof value.canonicalReference === "object" &&
      value.canonicalReference !== null &&
      "entityId" in value.canonicalReference &&
      typeof value.canonicalReference.entityId === "string" &&
      "entityType" in value.canonicalReference &&
      (value.canonicalReference.entityType === TargetEntityType.Task ||
        value.canonicalReference.entityType === TargetEntityType.Service)
        ? {
            entityId: value.canonicalReference.entityId,
            entityType: value.canonicalReference.entityType,
          }
        : undefined;
    return {
      role: value.role,
      ...(canonicalReference ? { canonicalReference } : {}),
    };
  })();

export const UX_FLOW_START_ROLE = "UI_START";

/**
 * Id of the screen marked as the flow's start, or null when none is marked.
 * Authoring allows one start, but stored data may hold several; the first by
 * name then id wins, matching the order the journey layout uses.
 */
export const findUxFlowStartScreenId = (
  steps: readonly (Pick<GraphWorkItem, "id" | "name" | "sections"> & object)[],
): string | null => {
  const starts = steps.filter(
    (step) => getDiagramElementMetadata(step)?.role === UX_FLOW_START_ROLE,
  );
  const compareText = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  starts.sort(
    (left, right) =>
      compareText(left.name, right.name) || compareText(left.id, right.id),
  );

  return starts[0]?.id ?? null;
};
