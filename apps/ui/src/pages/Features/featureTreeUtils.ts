import type { FeatureHierarchyNode } from "@hey-hey/ui-common/data";

export const sortByName = (nodes: FeatureHierarchyNode[]): FeatureHierarchyNode[] =>
  [...nodes].sort((a, b) =>
    a.feature.name.localeCompare(b.feature.name, undefined, {
      sensitivity: "base",
    }),
  );
