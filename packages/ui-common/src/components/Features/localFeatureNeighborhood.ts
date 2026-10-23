import type { FeatureHierarchyNode } from "../../data/hooks/useFeatureHierarchy";

export interface LocalFeatureNeighborhoodSelection {
  featureIds: string[];
  parentFeatureId?: string;
}

/** The focused feature and only its immediate structural neighbors. */
export function selectLocalFeatureNeighborhood(
  focusedFeatureId: string,
  nodes: ReadonlyMap<string, FeatureHierarchyNode>
): LocalFeatureNeighborhoodSelection {
  const focused = nodes.get(focusedFeatureId);
  if (!focused) return { featureIds: [] };
  const parentId = focused.feature.parentTaskId;
  const parent = parentId ? nodes.get(parentId) : undefined;
  return {
    featureIds: [
      ...(parent ? [parent.feature.id] : []),
      focusedFeatureId,
      ...focused.children.map((child) => child.feature.id),
    ],
    ...(parent ? { parentFeatureId: parent.feature.id } : {}),
  };
}
