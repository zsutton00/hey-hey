import type { SearchEntity } from "./types";

/**
 * Stably partitions search results so feature entities float to the top while
 * preserving the existing relative order within the feature group and within
 * the non-feature group. Keys on `type === 'feature'`, which
 * useMentionEntitySearch.resolveMentionType already sets for feature task-type
 * hits — no metadata lookup is needed at this layer.
 */
export const sortFeaturesFirst = (results: SearchEntity[]): SearchEntity[] => {
  const features: SearchEntity[] = [];
  const rest: SearchEntity[] = [];
  for (const entity of results) {
    if (entity.type === "feature") {
      features.push(entity);
    } else {
      rest.push(entity);
    }
  }
  return [...features, ...rest];
};
