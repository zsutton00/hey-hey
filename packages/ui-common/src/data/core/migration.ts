import type { CollectionItem, QueryKey } from "./types";
import { CollectionMap } from "./CollectionMap";
import { ListQueryMap } from "./ListQueryMap";
import { logger } from "../../utils/logger";

const toKeyString = (queryKey: QueryKey) => queryKey.toKey();

/**
 * Migration utility to ensure CollectionItem has queryKeys field
 * For backward compatibility with existing code
 */
export function ensureQueryKeys<T>(
  item: Partial<CollectionItem<T>> &
    Pick<CollectionItem<T>, "id" | "data" | "updatedAt" | "lastFetched">,
  queryKey?: QueryKey
): CollectionItem<T> {
  const queryKeyString = queryKey ? toKeyString(queryKey) : undefined;
  // If queryKeys already exists, return the original item (reference equality)
  if (item.queryKeys && Array.isArray(item.queryKeys)) {
    return item as CollectionItem<T>;
  }

  // Otherwise, create a new object with queryKeys
  return {
    ...item,
    queryKeys: queryKeyString ? [queryKeyString] : [],
    fetchedCount: item.fetchedCount ?? 0,
  };
}

/**
 * Runtime migration utility that works during normal collection operations
 * This is the key to Phase 5.2 - gradual migration as items are accessed
 */
export function ensureQueryKeysOnAccess<T>(
  item: CollectionItem<T> | undefined,
  queryKey: QueryKey
): CollectionItem<T> | undefined {
  if (!item) return undefined;

  const queryKeyString = toKeyString(queryKey);
  // If item already has queryKeys field, ensure this queryKey is included
  if (item.queryKeys && Array.isArray(item.queryKeys)) {
    if (!item.queryKeys.includes(queryKeyString)) {
      return {
        ...item,
        queryKeys: [...item.queryKeys, queryKeyString],
        fetchedCount: item.fetchedCount ?? 0,
      };
    }
    return item; // Already has the queryKey
  }

  // Item exists but lacks queryKeys field - migrate it
  logger.debug(
    "data_core",
    "[ensureQueryKeysOnAccess] Adding queryKeys to existing item",
    { itemId: item.id }
  );
  return {
    ...item,
    queryKeys: [queryKeyString],
    fetchedCount: item.fetchedCount ?? 0,
  };
}

/**
 * Migration utility for arrays of items
 */
export function ensureQueryKeysForItems<T>(
  items: Array<
    Partial<CollectionItem<T>> &
      Pick<CollectionItem<T>, "id" | "data" | "updatedAt" | "lastFetched">
  >,
  queryKey?: QueryKey
): CollectionItem<T>[] {
  return items.map((item) => ensureQueryKeys(item, queryKey));
}

/**
 * Runtime migration for arrays of existing items during list query access
 * Phase 5.2: Gradual migration strategy
 */
export function ensureQueryKeysForListAccess<T>(
  items: CollectionItem<T>[],
  queryKey: QueryKey
): { items: CollectionItem<T>[]; migrationNeeded: boolean } {
  const queryKeyString = toKeyString(queryKey);
  let migrationNeeded = false;
  const migratedItems = items.map((item) => {
    // Check if item needs migration
    if (!item.queryKeys || !Array.isArray(item.queryKeys)) {
      migrationNeeded = true;
      logger.debug(
        "data_core",
        "[ensureQueryKeysOnListAccess] Adding queryKeys to existing list item",
        { itemId: item.id }
      );
      return {
        ...item,
        queryKeys: [queryKeyString],
        fetchedCount: item.fetchedCount ?? 0,
      };
    }

    // Item has queryKeys, ensure this queryKey is included
    if (!item.queryKeys.includes(queryKeyString)) {
      migrationNeeded = true;
      return {
        ...item,
        queryKeys: [...item.queryKeys, queryKeyString],
        fetchedCount: item.fetchedCount ?? 0,
      };
    }

    return item; // No migration needed
  });

  return { items: migratedItems, migrationNeeded };
}

/**
 * Create a migration-aware item getter that applies runtime migration
 * This is the core of Phase 5.2 - transparent migration during access
 */
export function createMigratingItemGetter<T>(
  items: CollectionMap<T>,
  dispatch: (action: { type: string; [key: string]: unknown }) => void
) {
  return (id: string, queryKey?: QueryKey): CollectionItem<T> | undefined => {
    const item = queryKey
      ? items.get(id, queryKey)
      : items.getAllByEntityId(id)[0];
    if (!item) return undefined;

    // If no queryKey provided, just return the item (used for debugging/internal access)
    if (!queryKey) return item;

    // Apply runtime migration if needed
    const migratedItem = ensureQueryKeysOnAccess(item, queryKey);

    // If migration occurred, update the collection state
    if (migratedItem && migratedItem !== item) {
      dispatch({
        type: "MIGRATE_ITEM_QUERY_KEYS",
        itemId: id,
        migratedItem,
      });
    }

    return migratedItem;
  };
}

/**
 * Create a migration-aware list getter for handling list queries with migration
 */
export function createMigratingListGetter<T>(
  items: CollectionMap<T>,
  listQueries: ListQueryMap,
  dispatch: (action: { type: string; [key: string]: unknown }) => void
) {
  return (queryKey: QueryKey): CollectionItem<T>[] | undefined => {
    const queryKeyString = toKeyString(queryKey);
    const itemIds = listQueries.getByKeyString(queryKeyString);
    if (!itemIds) return undefined;

    const itemList = itemIds
      .map((id) => items.getByStorageId(id))
      .filter((item): item is CollectionItem<T> => item !== undefined);

    if (itemList.length === 0) return [];

    // Apply runtime migration to the list
    const { items: migratedItems, migrationNeeded } =
      ensureQueryKeysForListAccess(itemList, queryKey);

    // If migration occurred, update all affected items in the collection
    if (migrationNeeded) {
      migratedItems.forEach((migratedItem) => {
        const storageId = queryKey.getId(migratedItem.id);
        const originalItem = items.getByStorageId(storageId);
        if (originalItem && originalItem !== migratedItem) {
          dispatch({
            type: "MIGRATE_ITEM_QUERY_KEYS",
            itemId: storageId,
            migratedItem,
          });
        }
      });
    }

    return migratedItems;
  };
}

/**
 * Type guard to check if an item has queryKeys field
 */
export function hasQueryKeysField<T>(item: unknown): item is CollectionItem<T> {
  return (
    typeof item === "object" &&
    item !== null &&
    "queryKeys" in item &&
    Array.isArray((item as CollectionItem<T>).queryKeys)
  );
}

/**
 * Migration utility to ensure CollectionState items all have queryKeys
 * For graceful deployment with existing data
 */
export function migrateCollectionState<T>(
  items: CollectionMap<T>
): CollectionMap<T> {
  const migratedItems = new CollectionMap<T>();

  items.forEach((item, id) => {
    const migratedItem = ensureQueryKeys(item);
    migratedItems.setByStorageId(id, migratedItem);
  });

  return migratedItems;
}

/**
 * Validation utility to check collection state consistency
 * Returns validation results with errors if any
 */
export function validateCollectionState<T>(
  items: CollectionMap<T>,
  listQueries: ListQueryMap,
  singleQueries: Map<string, string>
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check that all items have queryKeys field
  items.forEach((item, id) => {
    if (!hasQueryKeysField(item)) {
      errors.push(`Item ${id} is missing queryKeys field`);
    }
  });

  // Check that all items referenced in queries exist
  listQueries.forEach((itemIds, queryKey) => {
    itemIds.forEach((itemId) => {
      if (!items.hasByStorageId(itemId)) {
        errors.push(
          `List query ${queryKey} references non-existent item ${itemId}`
        );
      }
    });
  });

  singleQueries.forEach((itemId, queryKey) => {
    if (!items.hasByStorageId(itemId)) {
      errors.push(
        `Single query ${queryKey} references non-existent item ${itemId}`
      );
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Runtime migration that can be called during collection initialization
 * Ensures backward compatibility with existing persisted data
 */
export function performRuntimeMigration<T>(
  items: CollectionMap<T>,
  listQueries: ListQueryMap,
  singleQueries: Map<string, string>
): {
  items: CollectionMap<T>;
  migrationPerformed: boolean;
  validationResult: ReturnType<typeof validateCollectionState>;
} {
  let migrationPerformed = false;
  let migratedItems = items;

  // Check if any items need migration
  const needsMigration = items
    .values()
    .some((item) => !hasQueryKeysField(item));

  if (needsMigration) {
    logger.info(
      "data_core",
      "[inspectCollectionMigrationState] Migrating collection items to include queryKeys field"
    );
    migratedItems = migrateCollectionState(items);
    migrationPerformed = true;
  }

  // Validate the final state
  const validationResult = validateCollectionState(
    migratedItems,
    listQueries,
    singleQueries
  );

  if (!validationResult.isValid) {
    logger.warn(
      "data_core",
      "[inspectCollectionMigrationState] Collection state validation failed",
      { errors: validationResult.errors }
    );
  } else if (migrationPerformed) {
    logger.info(
      "data_core",
      "[inspectCollectionMigrationState] Collection migration completed successfully"
    );
  }

  return {
    items: migratedItems,
    migrationPerformed,
    validationResult,
  };
}

/**
 * Debug utility to inspect collection state and identify migration needs
 */
export function inspectCollectionMigrationState<T>(
  items: CollectionMap<T>,
  listQueries: ListQueryMap,
  singleQueries: Map<string, string>
): {
  totalItems: number;
  itemsWithQueryKeys: number;
  itemsNeedingMigration: number;
  queryKeyDistribution: Record<string, number>;
  orphanedItems: string[];
  missingItems: string[];
} {
  const totalItems = items.size();
  let itemsWithQueryKeys = 0;
  let itemsNeedingMigration = 0;
  const queryKeyDistribution: Record<string, number> = {};
  const orphanedItems: string[] = [];
  const referencedItemIds = new Set<string>();

  // Collect all referenced item IDs
  listQueries.forEach((itemIds) => {
    itemIds.forEach((id) => referencedItemIds.add(id));
  });
  singleQueries.forEach((itemId) => {
    referencedItemIds.add(itemId);
  });

  // Analyze items
  items.forEach((item, id) => {
    if (hasQueryKeysField(item)) {
      itemsWithQueryKeys++;
      if (item.queryKeys.length === 0) {
        itemsNeedingMigration++;
      }
      item.queryKeys.forEach((queryKey) => {
        queryKeyDistribution[queryKey] =
          (queryKeyDistribution[queryKey] || 0) + 1;
      });
    } else {
      itemsNeedingMigration++;
    }

    // Check if item is orphaned (exists but not referenced by any query)
    if (!referencedItemIds.has(id)) {
      orphanedItems.push(id);
    }
  });

  // Find missing items (referenced by queries but don't exist in items)
  const missingItems: string[] = [];
  referencedItemIds.forEach((id) => {
    if (!items.hasByStorageId(id)) {
      missingItems.push(id);
    }
  });

  return {
    totalItems,
    itemsWithQueryKeys,
    itemsNeedingMigration,
    queryKeyDistribution,
    orphanedItems,
    missingItems,
  };
}
