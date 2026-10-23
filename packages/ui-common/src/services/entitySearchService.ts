import { EntityType, type EntitySearchResult } from "../api/api";
import { getApiRuntime } from "../clients";
import type { SearchEntity } from "../components/SmarterTextAreaCard/types";

/**
 * Service for searching entities across the organization
 */
export class EntitySearchService {
  constructor(private organizationId: string) {}

  /**
   * Search for entities by query string
   * Supports fuzzy matching across task names, initiative names, and other entity types
   *
   * @param query - Search query string (partial match)
   * @param entityTypes - Filter by entity types (comma-separated, e.g. 'task,initiative') or 'all' for all types
   * @param limit - Maximum number of results (default: 10)
   * @returns Promise of SearchEntity results
   */
  async searchEntities(
    query: string,
    entityTypes: string = "all",
    limit: number = 10
  ): Promise<SearchEntity[]> {
    try {
      const requestedTypes =
        entityTypes === "all"
          ? undefined
          : entityTypes
              .split(",")
              .map((type) => type.trim().toUpperCase())
              .filter((type): type is EntityType =>
                Object.values(EntityType).includes(type as EntityType)
              );
      const response = await getApiRuntime().clients.search.searchEntities({
        organizationId: this.organizationId,
        query,
        limit,
        entityTypes: requestedTypes,
      });

      if (!response.data?.success || !response.data?.data) {
        return [];
      }

      // Map API response to SearchEntity type
      const results = response.data.data.map(
        (result: EntitySearchResult): SearchEntity => ({
          id: result.entityId,
          type: result.entityType.toString().toLowerCase(),
          name: result.entityName,
          description: undefined, // API doesn't include description, could add later
        })
      );

      return results;
    } catch (error) {
      console.error("Entity search failed:", error);
      return [];
    }
  }
}
