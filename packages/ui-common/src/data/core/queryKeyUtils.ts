import type { CollectionItem } from "./types";
import { CollectionMap } from "./CollectionMap";

/**
 * Adds a query key to an item's queryKeys array, avoiding duplicates
 */
export function addQueryKeyToItem<T>(
  item: CollectionItem<T>,
  queryKey: string
): CollectionItem<T> {
  if (!queryKey) return item;

  const existingQueryKeys = item.queryKeys || [];
  if (existingQueryKeys.includes(queryKey)) {
    return item; // No change needed
  }

  return {
    ...item,
    queryKeys: [...existingQueryKeys, queryKey],
  };
}

/**
 * Merges fresh data with existing item while preserving queryKeys from both
 * This is used when API returns updated data and we need to preserve query tracking
 */
export function mergeItemWithFreshData<T>(
  existingItem: CollectionItem<T>,
  freshData: CollectionItem<T>,
  queryKey: string
): CollectionItem<T> {
  if (!queryKey) return freshData;

  const existingQueryKeys = existingItem.queryKeys || [];
  const freshQueryKeys = freshData.queryKeys || [];

  // Merge queryKeys, adding the new queryKey and avoiding duplicates
  const mergedQueryKeys = mergeQueryKeys(existingQueryKeys, [
    ...freshQueryKeys,
    queryKey,
  ]);

  return {
    ...freshData,
    // A lighter read can omit optional fields that a fuller read already
    // populated. Keep those fields while allowing every defined fresh field
    // to replace the cached value.
    data: mergeDefinedObjectProperties(existingItem.data, freshData.data),
    fetchedCount: freshData.fetchedCount ?? 1,
    queryKeys: mergedQueryKeys, // But preserve query tracking history
  };
}

function mergeDefinedObjectProperties<T>(existingData: T, freshData: T): T {
  if (!isObjectRecord(existingData) || !isObjectRecord(freshData)) {
    return freshData;
  }

  const omittedExistingKeys = Object.keys(existingData).filter(
    (key) => freshData[key] === undefined
  );

  if (omittedExistingKeys.length === 0) {
    return freshData;
  }

  const mergedData: Record<string, unknown> = { ...existingData };
  for (const [key, value] of Object.entries(freshData)) {
    if (value !== undefined) {
      mergedData[key] = value;
    }
  }

  return mergedData as T;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Removes a query key from an item's queryKeys array
 */
export function removeQueryKeyFromItem<T>(
  item: CollectionItem<T>,
  queryKey: string
): CollectionItem<T> {
  if (!queryKey || !item.queryKeys) return item;

  const filteredQueryKeys = item.queryKeys.filter((key) => key !== queryKey);

  // If no change, return original item (reference equality optimization)
  if (filteredQueryKeys.length === item.queryKeys.length) {
    return item;
  }

  return {
    ...item,
    queryKeys: filteredQueryKeys,
  };
}

/**
 * Checks if an item has a specific query key
 */
export function hasQueryKey<T>(
  item: CollectionItem<T>,
  queryKey: string
): boolean {
  if (!queryKey || !item.queryKeys) return false;
  return item.queryKeys.includes(queryKey);
}

/**
 * Merges two arrays of query keys, removing duplicates
 * New keys are added at the end
 */
export function mergeQueryKeys(
  existing: string[],
  newKeys: string[]
): string[] {
  if (!existing.length) return [...newKeys];
  if (!newKeys.length) return [...existing];

  const merged = [...existing];

  for (const newKey of newKeys) {
    if (!merged.includes(newKey)) {
      merged.push(newKey);
    }
  }

  return merged;
}

/**
 * Finds all items that have a query key matching the given pattern
 */
export function findItemsByQueryKeyPattern<T>(
  items: CollectionMap<T>,
  pattern: string | RegExp
): CollectionItem<T>[] {
  const results: CollectionItem<T>[] = [];

  const matchFn =
    typeof pattern === "string"
      ? (key: string) => key === pattern
      : (key: string) => pattern.test(key);

  items.forEach((item) => {
    if (item.queryKeys?.some(matchFn)) {
      results.push(item);
    }
  });

  return results;
}

/**
 * Gets all unique query keys across a collection of items
 */
export function getAllQueryKeys<T>(items: CollectionMap<T>): string[] {
  const allKeys = new Set<string>();

  items.forEach((item) => {
    if (item.queryKeys) {
      item.queryKeys.forEach((key) => allKeys.add(key));
    }
  });

  return Array.from(allKeys);
}

/**
 * Removes a query key from all items that have it
 * Returns a new map with updated items
 */
export function removeQueryKeyFromAllItems<T>(
  items: CollectionMap<T>,
  queryKey: string
): CollectionMap<T> {
  const updatedItems = new CollectionMap<T>();

  items.forEach((item, id) => {
    const updatedItem = removeQueryKeyFromItem(item, queryKey);
    updatedItems.setByStorageId(id, updatedItem);
  });

  return updatedItems;
}
