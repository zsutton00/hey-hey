import type { ExplorerNode, ExplorerSection } from "./types";

const normalizeQuery = (query: string): string =>
  query.trim().toLocaleLowerCase();

/**
 * Apply the Explorer search query to each already-resolved section projection.
 * The section registry and collection projections remain the source of truth;
 * search only derives a view over their rendered rows.
 */
export const filterExplorerSections = (
  sections: ExplorerSection[],
  query: string,
): ExplorerSection[] => {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return sections;

  return sections.map((section) => {
    const nodes = section.nodes.filter((node) =>
      node.name.toLocaleLowerCase().includes(normalizedQuery),
    );

    return {
      ...section,
      nodes,
      count: section.count === undefined ? undefined : nodes.length,
    };
  });
};

/**
 * Flatten the section-aware search projection for the tree's existing row
 * rendering contract while retaining each row's owning section key.
 */
export const flattenExplorerSections = (
  sections: ExplorerSection[],
): ExplorerNode[] => sections.flatMap((section) => section.nodes);
