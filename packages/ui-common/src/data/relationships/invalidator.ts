import {
  type DataVariantKey,
  type EntityOperation,
  type QueryKeyPattern,
  getRelatedEntities,
} from "./config";
import {
  type InvalidationKey,
  type MarkStaleDispatch,
  routeMarkStale,
} from "./coordinator";
import type { QueryKey } from "@tanstack/react-query";

/** A value read from a source entity to scope a relationship's target key. */
export type QueryKeyValue = string | number | boolean | null | string[] | number[] | boolean[];

export interface ScopeKeyFilter {
  lookupField: string;
  lookupValue: QueryKeyValue | undefined;
  dataVariantKey?: DataVariantKey;
}

export interface ItemKeyParams {
  id: string;
  dataVariantKey?: DataVariantKey;
}

/**
 * Per-collection bridge between abstract `QueryKeyPattern`s and the concrete
 * TanStack key prefixes + dispatcher this collection owns. The hook that owns
 * a collection registers one of these so the invalidator can stay
 * collection-agnostic.
 */
export interface CollectionInvalidator<
  K extends InvalidationKey = QueryKey,
> {
  dispatch: MarkStaleDispatch<K>;
  /** Required when any pattern targeting this collection uses `invalidate` mode. */
  buildScopeKey?: (filter: ScopeKeyFilter) => K;
  /** Required when any pattern targeting this collection uses `cascade` mode. */
  buildItemKey?: (params: ItemKeyParams) => K;
}

/** Collections register TanStack key prefixes and invalidate them. */
export type InvalidationContext = Record<string, CollectionInvalidator>;

function isQueryKeyValue(value: unknown): value is QueryKeyValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(
      (v) =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
    );
  }
  return false;
}

function deriveLookupValues(
  sourceEntity: Record<string, unknown> | undefined,
  pattern: QueryKeyPattern
): (QueryKeyValue | undefined)[] {
  if (!sourceEntity) return [undefined];

  const collected: QueryKeyValue[] = [];
  const fieldsToWalk =
    pattern.sourceFields.length > 0
      ? pattern.sourceFields
      : [pattern.lookupField];

  for (const field of fieldsToWalk) {
    const raw = sourceEntity[field];
    if (raw === undefined || raw === null) continue;

    if (Array.isArray(raw)) {
      for (const element of raw) {
        if (isQueryKeyValue(element) && !Array.isArray(element)) {
          collected.push(element);
        }
      }
    } else if (isQueryKeyValue(raw)) {
      collected.push(raw);
    }
  }

  return collected.length === 0 ? [undefined] : collected;
}

function buildKeyForPattern(
  pattern: QueryKeyPattern,
  collection: CollectionInvalidator<InvalidationKey>,
  lookupValue: QueryKeyValue | undefined
): InvalidationKey | null {
  if (pattern.invalidationMode === "invalidate") {
    if (!collection.buildScopeKey) {
      throw new Error(
        `Collection "${pattern.collection}" has no buildScopeKey but pattern uses "invalidate" mode`
      );
    }
    return collection.buildScopeKey({
      lookupField: pattern.lookupField,
      lookupValue,
      dataVariantKey: pattern.dataVariantKey,
    });
  }

  if (!collection.buildItemKey) {
    throw new Error(
      `Collection "${pattern.collection}" has no buildItemKey but pattern uses "cascade" mode`
    );
  }
  if (lookupValue === undefined || lookupValue === null) return null;
  return collection.buildItemKey({
    id: String(lookupValue),
    dataVariantKey: pattern.dataVariantKey,
  });
}

/**
 * Translates the invalidation rules for `entityType`/`operation` into MARK_STALE
 * dispatches against the appropriate collections.
 *
 * - `invalidate` mode marks the collection's scope (list) key stale, optionally
 *   filtered by `lookupField` → value extracted from `sourceEntity`.
 * - `cascade` mode walks `relationshipPath` via `lookupField`/`sourceFields`
 *   from `sourceEntity` to derive each affected child's item key, then marks
 *   those keys stale.
 * - Cardinality `1:1` produces one MARK_STALE; `1:many` fans out across every
 *   value extracted from `sourceEntity`.
 * - Optional `dataVariantKey` is forwarded to the per-collection key builders
 *   so the dispatch targets the right cached variant.
 *
 * Throws if `loadConfig` has not been called (via `getRelatedEntities`) or if
 * a target collection lacks the key builder its pattern requires. Every
 * resulting dispatch is routed through the cross-hook coordinator seam.
 */
export function invalidateForEntity(
  entityType: string,
  operation: EntityOperation,
  sourceEntity: Record<string, unknown> | undefined,
  context: InvalidationContext
): void {
  const patterns = getRelatedEntities(entityType, operation);

  for (const pattern of patterns) {
    const collection = context[pattern.collection];
    if (!collection) {
      throw new Error(
        `No invalidator registered for collection "${pattern.collection}"`
      );
    }

    const allValues = deriveLookupValues(sourceEntity, pattern);
    const values =
      pattern.cardinality === "1:1" ? allValues.slice(0, 1) : allValues;

    for (const value of values) {
      const queryKey = buildKeyForPattern(pattern, collection, value);
      if (queryKey === null) continue;
      routeMarkStale({ type: "MARK_STALE", queryKey }, collection.dispatch);
    }
  }
}
