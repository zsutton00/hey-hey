import { atom } from "jotai/vanilla";
import { atomFamily } from "jotai/utils";
import logger from "../../utils/logger";
import {
  handleBatchRefetch,
  handleFetchQuery,
  handleRefetchQuery,
  type AsyncActionData,
  type StateUpdate,
} from "./asyncActions";
import { createFetchQueue, FETCH_COALESCING_WINDOW_MS } from "./fetchQueue";
import { performRuntimeMigration } from "./migration";
import {
  mergeItemWithFreshData,
  removeQueryKeyFromAllItems,
} from "./queryKeyUtils";
import { logQueryRegistryEvent } from "../debug/queryRegistry";
import { DEFAULT_STALE_TIME_MS, isDataStale, type StaleTimeConfig } from "./staleTime";
import { CollectionMap } from "./CollectionMap";
import { ListQueryMap } from "./ListQueryMap";
import type {
  CollectionAction,
  CollectionItem,
  CollectionState,
  CreateCollectionOptions,
  QueryKey,
} from "./types";

export function createCollection<T, C = unknown>(
  options: CreateCollectionOptions<T, C>
) {
  const {
    name,
    fetcher,
    staleTimeMs = DEFAULT_STALE_TIME_MS,
    listScopes,
  } = options;

  logger.info("data_core", `[createCollection] creating collection ${name}`);

  const staleTimeConfig: StaleTimeConfig = { staleTimeMs };

  // Fixed-window fetch queue: coalesces bursty requests per query key into a
  // single network call after the uniform experiment window. A request
  // that lands while a fetch is in flight is served by a fresh follow-up
  // cycle rather than being suppressed.
  const fetchQueue = createFetchQueue<AsyncActionData<T>>(
    FETCH_COALESCING_WINDOW_MS
  );
  const toKeyString = (queryKey: QueryKey) => queryKey.toKey();
  const getStorageId = (queryKey: QueryKey, entityId: string) =>
    queryKey.getId(entityId);

  const findItemsByEntityId = (
    items: CollectionMap<T>,
    entityId: string
  ): Array<{ storageId: string; item: CollectionItem<T> }> =>
    items.getStorageIdsByEntityId(entityId).flatMap((storageId) => {
      const item = items.getByStorageId(storageId);
      return item ? [{ storageId, item }] : [];
    });

  // Helper function to initialize state with migration support
  const initializeState = (): CollectionState<T> => {
    const initialState: CollectionState<T> = {
      staleTimeMs,
      items: new CollectionMap(),
      listQueries: new ListQueryMap(),
      listFetchTimes: new Map(),
      singleQueries: new Map(),
      stale: new Set(),
      loading: new Set(),
      fetched: new Set(),
      errors: new Map(),
      optimisticUpdates: new Map(),
    };

    // Perform migration check (in real usage, this would be loaded from persistence)
    // For now, this is a no-op since we're starting with empty state
    const migrationResult = performRuntimeMigration(
      initialState.items,
      initialState.listQueries,
      initialState.singleQueries
    );

    if (migrationResult.migrationPerformed) {
      return {
        ...initialState,
        items: migrationResult.items,
      };
    }

    return initialState;
  };

  // Core state atom
  const stateAtom = atom<CollectionState<T>>(initializeState());

  /**
   * Unified function to handle adding a fetched item to state
   * Used by both SET_ITEM and SET_ITEMS to ensure consistent behavior
   */
  function addFetchedItemToState<T>(
    item: CollectionItem<T>,
    queryKey: QueryKey,
    state: CollectionState<T>
  ): Partial<CollectionState<T>> {
    const newItems = new CollectionMap(state.items);
    const newSingleQueries = new Map(state.singleQueries);
    const newStale = new Set(state.stale);
    const newErrors = new Map(state.errors);
    const queryKeyString = queryKey.toKey();

    const storageId = getStorageId(queryKey, item.id);
    const existingItem = state.items.getByStorageId(storageId);

    // Merge queryKeys - this item was fetched by this query
    const updatedItem = existingItem
      ? {
          ...item,
          queryKeys: [
            ...(existingItem.queryKeys || []),
            ...(item.queryKeys || []),
            queryKeyString,
          ].filter((key, index, arr) => arr.indexOf(key) === index),
        }
      : {
          ...item,
          queryKeys: [...(item.queryKeys || []), queryKeyString],
        };

    newItems.setByStorageId(storageId, updatedItem);

    // Track this query's item (for single queries)
    newSingleQueries.set(queryKeyString, storageId);

    // Remove from stale and errors for THIS query only
    newStale.delete(queryKeyString);
    newErrors.delete(queryKeyString);

    return {
      items: newItems,
      singleQueries: newSingleQueries,
      stale: newStale,
      errors: newErrors,
    };
  }

  // Actions atom - now supports async actions
  const actionsAtom = atom(
    null,
    async (get, set, action: CollectionAction<T, C>) => {
      const state = get(stateAtom);

      // Handle async actions
      if (
        action.type === "FETCH_QUERY" ||
        action.type === "REFETCH_QUERY" ||
        action.type === "BATCH_REFETCH"
      ) {
        let result: unknown;

        // Reads a fresh state snapshot. Passed (not a captured snapshot) so
        // the fetch fired at window end observes post-burst cached state.
        const getState = () => get(stateAtom);

        // Create dispatch function that applies updates immediately
        const dispatch = (update: StateUpdate) => {
          const currentState = get(stateAtom);
          const newState = applyStateUpdate(currentState, update);
          set(stateAtom, newState);
        };

        switch (action.type) {
          case "FETCH_QUERY": {
            result = await handleFetchQuery(
              action.queryKey,
              getState,
              fetcher,
              staleTimeConfig,
              fetchQueue,
              dispatch,
              action.signal,
              action.staleTimeMs,
              action.initiator
            );
            break;
          }

          case "REFETCH_QUERY": {
            logger.info("data_core", "[REFETCH_QUERY] Starting refetch", {
              queryKey: toKeyString(action.queryKey),
            });
            result = await handleRefetchQuery(
              action.queryKey,
              getState,
              fetcher,
              fetchQueue,
              dispatch,
              action.signal,
              action.initiator
            );
            break;
          }

          case "BATCH_REFETCH": {
            result = await handleBatchRefetch(
              action.queryKeys,
              getState,
              fetcher,
              fetchQueue,
              dispatch,
              action.signal,
              action.initiator
            );
            break;
          }
        }

        // Phase 3: No more stateUpdate processing - dispatch happens immediately in async functions
        logger.info(
          "data_core",
          `🔄 [COLLECTION:${name}] Async operation completed with immediate dispatch`
        );

        return result;
      }
      // Handle synchronous actions (existing code)

      switch (action.type) {
        case "MARK_STALE": {
          // Add detailed logging to track what's marking queries as stale
          const queryKeyString = toKeyString(action.queryKey);
          logger.info("data_core", "[MARK_STALE] Query marked as stale", {
            queryKey: queryKeyString,
            wasAlreadyStale: state.stale.has(queryKeyString),
          });

          const newStale = new Set(state.stale);
          newStale.add(queryKeyString);
          set(stateAtom, { ...state, stale: newStale });
          break;
        }

        case "MARK_STALE_BY_KEY_STRINGS": {
          const newStale = new Set(state.stale);
          for (const qs of action.queryKeyStrings) {
            newStale.add(qs);
          }
          logger.info("data_core", "[MARK_STALE_BY_KEY_STRINGS] Marked stale", {
            queryKeys: action.queryKeyStrings,
          });
          set(stateAtom, { ...state, stale: newStale });
          break;
        }

        case "MARK_ALL_STALE": {
          // Recovery also covers reads that started before the gap but have
          // not produced a query mapping yet. Preserve pending invalidations.
          const newStale = new Set([...state.stale, ...state.loading]);
          // Mark all queries as stale
          state.listQueries.forEach((_, key) => newStale.add(key));
          state.singleQueries.forEach((_, key) => newStale.add(key));
          logger.info(
            "data_core",
            `[MARK_ALL_STALE] Marked all ${newStale.size} registered queries as stale`,
            { queryKeys: Array.from(newStale) }
          );
          set(stateAtom, { ...state, stale: newStale });
          break;
        }

        case "SET_ITEMS": {
          let updatedState = { ...state };
          const queryKeyString = toKeyString(action.queryKey);
          const previousIds =
            state.listQueries.getByKeyString(queryKeyString) ?? [];

          // Process each item through the same logic as SET_ITEM
          action.items.forEach((item) => {
            const updates = addFetchedItemToState(
              item,
              action.queryKey,
              updatedState
            );
            updatedState = { ...updatedState, ...updates };
          });

          // Track this as a list query
          const itemIds = action.items.map((item) =>
            getStorageId(action.queryKey, item.id)
          );
          const newListQueries = new ListQueryMap(updatedState.listQueries);
          newListQueries.setByKeyString(queryKeyString, itemIds);

          // Stamp list freshness on the query itself so an empty result is as
          // fresh as a populated one (see shouldSkipFetchForQuery).
          const newListFetchTimes = new Map(updatedState.listFetchTimes);
          newListFetchTimes.set(queryKeyString, new Date().toISOString());

          logQueryRegistryEvent({
            collection: name,
            kind: "list_query_set",
            queryKey: queryKeyString,
            detail: {
              previousIds,
              nextIds: itemIds,
            },
          });

          set(stateAtom, {
            ...updatedState,
            listQueries: newListQueries,
            listFetchTimes: newListFetchTimes,
          });

          break;
        }

        case "ADD_ITEM": {
          // This is a NEW item being added to the collection (not fetched)
          const newItems = new CollectionMap(state.items);
          const newStale = new Set(state.stale);
          const existingItem = newItems.getByStorageId(action.item.id);

          // Add the item to the collection
          newItems.setByStorageId(action.item.id, {
            ...action.item,
            queryKeys: action.item.queryKeys || [],
          });

          logQueryRegistryEvent({
            collection: name,
            kind: "item_set",
            itemId: action.item.id,
            storageId: action.item.id,
            detail: {
              previousItem: existingItem ?? null,
              nextItem: newItems.getByStorageId(action.item.id) ?? null,
            },
          });

          // CRITICAL: Mark ALL queries as stale because this is a new item
          // We don't know which queries should include it
          state.fetched.forEach((queryKey) => {
            newStale.add(queryKey);
          });
          state.listQueries.forEach((_, queryKey) => {
            newStale.add(queryKey);
          });

          logger.info(
            "data_core",
            `[ADD_ITEM] New item ${action.item.id} added. Marked ${newStale.size} queries as stale`,
            {
              itemId: action.item.id,
              staleQueries: Array.from(newStale),
            }
          );

          set(stateAtom, {
            ...state,
            items: newItems,
            stale: newStale,
          });
          break;
        }

        case "NEW_ITEM": {
          const newStale = new Set(state.stale);
          const newItems = new CollectionMap(state.items);

          if (action.item) {
            newItems.setByStorageId(action.item.id, {
              ...action.item,
              queryKeys: action.item.queryKeys || [],
            });
          }

          const scopeQueryKeys = listScopes?.(action.context) ?? [];
          scopeQueryKeys.forEach((queryKey) => {
            newStale.add(queryKey.toKey());
          });

          set(stateAtom, {
            ...state,
            items: newItems,
            stale: newStale,
          });
          break;
        }

        case "SET_ITEM": {
          const updates = addFetchedItemToState(
            action.item,
            action.queryKey,
            state
          );
          const queryKeyString = toKeyString(action.queryKey);
          const previousStorageId = state.singleQueries.get(queryKeyString);

          // Also update any list queries that contain this item
          const storageId = getStorageId(action.queryKey, action.item.id);
          const newListQueries = new ListQueryMap(state.listQueries);
          const newStale = new Set(updates.stale!);
          newListQueries.forEach((ids, key) => {
            if (ids.includes(storageId)) {
              newStale.delete(key);
            }
          });

          // QueryKeys debug logging
          const updatedItem = updates.items!.getByStorageId(storageId)!;
          logger.info(
            "data_core",
            `🔄 [COLLECTION:${name}] Item ${
              action.item.id
            } now tracked by queries: ${updatedItem.queryKeys.join(", ")}`
          );

          logQueryRegistryEvent({
            collection: name,
            kind: "single_query_set",
            queryKey: queryKeyString,
            itemId: action.item.id,
            storageId,
            detail: {
              previousStorageId,
              previousItem: state.items.getByStorageId(storageId) ?? null,
              nextItem: updatedItem,
              singleQueriesBefore: previousStorageId ?? null,
              singleQueriesAfter:
                updates.singleQueries?.get(queryKeyString) ?? null,
            },
          });

          set(stateAtom, {
            ...state,
            ...updates,
            listQueries: newListQueries,
            stale: newStale,
          });

          break;
        }

        case "SET_LOADING": {
          const queryKeyString = toKeyString(action.queryKey);

          const newLoading = new Set(state.loading);
          if (action.isLoading) {
            newLoading.add(queryKeyString);
          } else {
            newLoading.delete(queryKeyString);
          }
          set(stateAtom, { ...state, loading: newLoading });
          break;
        }

        case "SET_FETCHED": {
          const newFetched = new Set(state.fetched);
          const queryKeyString = toKeyString(action.queryKey);
          newFetched.add(queryKeyString);
          set(stateAtom, { ...state, fetched: newFetched });
          break;
        }

        case "SET_ERROR": {
          const queryKeyString = toKeyString(action.queryKey);

          const newErrors = new Map(state.errors);
          if (action.error) {
            newErrors.set(queryKeyString, action.error);
          } else {
            newErrors.delete(queryKeyString);
          }
          set(stateAtom, { ...state, errors: newErrors });

          break;
        }

        case "OPTIMISTIC_UPDATE": {
          const matchingItems = findItemsByEntityId(state.items, action.id);
          if (matchingItems.length === 0) {
            return;
          }

          const newItems = new CollectionMap(state.items);
          const newOptimistic = new Map(state.optimisticUpdates);

          matchingItems.forEach(({ storageId, item }) => {
            // Store original for rollback (only if not already optimistic)
            if (!newOptimistic.has(storageId)) {
              newOptimistic.set(storageId, {
                previous: item,
                timestamp: Date.now(),
              });
            }

            // Apply update
            const updated = action.updater(item);
            newItems.setByStorageId(storageId, updated);
          });

          set(stateAtom, {
            ...state,
            items: newItems,
            optimisticUpdates: newOptimistic,
          });
          break;
        }

        case "ROLLBACK_OPTIMISTIC": {
          const newItems = new CollectionMap(state.items);
          const newOptimistic = new Map(state.optimisticUpdates);

          newOptimistic.forEach((optimistic, storageId) => {
            if (optimistic.previous.id !== action.id) {
              return;
            }

            // Restore original
            newItems.setByStorageId(storageId, optimistic.previous);
            newOptimistic.delete(storageId);
          });

          set(stateAtom, {
            ...state,
            items: newItems,
            optimisticUpdates: newOptimistic,
          });
          break;
        }

        case "COMMIT_OPTIMISTIC": {
          const newOptimistic = new Map(state.optimisticUpdates);
          newOptimistic.forEach((optimistic, storageId) => {
            if (optimistic.previous.id === action.id) {
              newOptimistic.delete(storageId);
            }
          });
          set(stateAtom, { ...state, optimisticUpdates: newOptimistic });
          break;
        }

        case "MARK_ITEM_STALE": {
          const matchingItems = findItemsByEntityId(state.items, action.itemId);
          if (matchingItems.length === 0) {
            logger.warn(
              "data_core",
              `⚠️ [COLLECTION:${name}] Item ${action.itemId} has no queryKeys - cannot mark stale`,
              action
            );
            return;
          }

          const newStale = new Set(state.stale);
          matchingItems.forEach(({ item }) => {
            if (!item.queryKeys?.length) {
              return;
            }
            item.queryKeys.forEach((queryKey) => {
              newStale.add(queryKey);
            });
          });

          set(stateAtom, { ...state, stale: newStale });
          break;
        }

        case "MARK_ITEMS_STALE": {
          const newStale = new Set(state.stale);
          let totalQueriesMarkedStale = 0;

          action.itemIds.forEach((itemId) => {
            const matchingItems = findItemsByEntityId(state.items, itemId);
            matchingItems.forEach(({ item }) => {
              if (!item.queryKeys?.length) {
                return;
              }
              item.queryKeys.forEach((queryKey) => {
                if (!newStale.has(queryKey)) {
                  newStale.add(queryKey);
                  totalQueriesMarkedStale++;
                }
              });
            });
          });

          logger.info(
            "data_core",
            `[MARK_ITEMS_STALE] Marked ${totalQueriesMarkedStale} queries as stale for ${action.itemIds.length} items`,
            { itemIds: action.itemIds }
          );

          set(stateAtom, { ...state, stale: newStale });
          break;
        }

        case "CLEAR_QUERY_FROM_ITEMS": {
          const queryKeyString = toKeyString(action.queryKey);
          const affectedItems = state.items
            .entries()
            .filter(([, item]) => item.queryKeys?.includes(queryKeyString))
            .map(([storageId, item]) => ({
              storageId,
              beforeQueryKeys: item.queryKeys ?? [],
              afterQueryKeys: (item.queryKeys ?? []).filter(
                (key) => key !== queryKeyString
              ),
            }));
          logQueryRegistryEvent({
            collection: name,
            kind: "query_key_removed_from_item",
            queryKey: queryKeyString,
            detail: {
              affectedItems,
            },
          });
          const updatedItems = removeQueryKeyFromAllItems(
            state.items,
            queryKeyString
          );
          set(stateAtom, { ...state, items: updatedItems });

          break;
        }

        case "DELETE_ITEM": {
          const newItems = new CollectionMap(state.items);
          const newListQueries = new ListQueryMap(state.listQueries);
          const newSingleQueries = new Map(state.singleQueries);

          const matchingItems = findItemsByEntityId(state.items, action.id);
          const storageIds = matchingItems.map(({ storageId }) => storageId);
          const removedSingleKeys: string[] = [];
          const listQueryUpdates: Array<{
            queryKey: string;
            previousIds: string[];
            nextIds: string[];
            removedIds: string[];
          }> = [];

          // Remove items
          storageIds.forEach((storageId) => {
            newItems.deleteByStorageId(storageId);
          });

          // Update list queries
          newListQueries.forEach((ids, key) => {
            const filtered = ids.filter((id) => !storageIds.includes(id));
            if (filtered.length !== ids.length) {
              newListQueries.setByKeyString(key, filtered);
              listQueryUpdates.push({
                queryKey: key,
                previousIds: ids,
                nextIds: filtered,
                removedIds: ids.filter((id) => storageIds.includes(id)),
              });
            }
          });

          // Remove single queries for this item
          Array.from(newSingleQueries.entries()).forEach(([key, id]) => {
            if (storageIds.includes(id)) {
              newSingleQueries.delete(key);
              removedSingleKeys.push(key);
            }
          });

          logQueryRegistryEvent({
            collection: name,
            kind: "item_deleted",
            itemId: action.id,
            detail: {
              storageIds,
              removedSingleKeys,
              listQueryUpdates,
            },
          });

          set(stateAtom, {
            ...state,
            items: newItems,
            listQueries: newListQueries,
            singleQueries: newSingleQueries,
          });

          break;
        }

        case "CLEAR_QUERY": {
          const queryKeyString = toKeyString(action.queryKey);
          const newListQueries = new ListQueryMap(state.listQueries);
          const newListFetchTimes = new Map(state.listFetchTimes);
          const newSingleQueries = new Map(state.singleQueries);
          const newStale = new Set(state.stale);
          const newLoading = new Set(state.loading);
          const newErrors = new Map(state.errors);

          const listQueryBefore =
            newListQueries.getByKeyString(queryKeyString) ?? null;
          const singleQueryBefore =
            newSingleQueries.get(queryKeyString) ?? null;
          newListQueries.deleteByKeyString(queryKeyString);
          newListFetchTimes.delete(queryKeyString);
          newSingleQueries.delete(queryKeyString);
          newStale.delete(queryKeyString);
          newLoading.delete(queryKeyString);
          newErrors.delete(queryKeyString);

          if (listQueryBefore) {
            logQueryRegistryEvent({
              collection: name,
              kind: "list_query_deleted",
              queryKey: queryKeyString,
              detail: {
                previousIds: listQueryBefore,
              },
            });
          }
          if (singleQueryBefore) {
            logQueryRegistryEvent({
              collection: name,
              kind: "single_query_deleted",
              queryKey: queryKeyString,
              detail: {
                previousStorageId: singleQueryBefore,
              },
            });
          }

          set(stateAtom, {
            ...state,
            listQueries: newListQueries,
            listFetchTimes: newListFetchTimes,
            singleQueries: newSingleQueries,
            stale: newStale,
            loading: newLoading,
            errors: newErrors,
          });

          break;
        }

        case "MIGRATE_STATE": {
          // Perform migration on current state (useful for persisted state restoration)
          const migrationResult = performRuntimeMigration(
            state.items,
            state.listQueries,
            state.singleQueries
          );

          if (migrationResult.migrationPerformed) {
            set(stateAtom, {
              ...state,
              items: migrationResult.items,
            });
          } else if (!migrationResult.validationResult.isValid) {
            logger.warn(
              "data_core",
              `[${name}] Collection state validation failed`,
              { errors: migrationResult.validationResult.errors }
            );
          }
          break;
        }

        case "MIGRATE_ITEM_QUERY_KEYS": {
          // Runtime migration of individual item during access (Phase 5.2)
          const newItems = new CollectionMap(state.items);
          newItems.setByStorageId(action.itemId, action.migratedItem);
          set(stateAtom, { ...state, items: newItems });
          break;
        }
      }
    }
  );

  /**
   * Helper to apply state updates from async actions
   */
  function applyStateUpdate<T>(
    state: CollectionState<T>,
    update: StateUpdate
  ): CollectionState<T> {
    logger.info("data_core", "[applyStateUpdate] starting", {
      state,
      update,
    });
    switch (update.type) {
      case "SET_LOADING": {
        const { queryKey, isLoading } = update.payload as {
          queryKey: QueryKey;
          isLoading: boolean;
        };
        const queryKeyString = toKeyString(queryKey);
        const newLoading = new Set(state.loading);
        if (isLoading) {
          newLoading.add(queryKeyString);
        } else {
          newLoading.delete(queryKeyString);
        }
        return { ...state, loading: newLoading };
      }

      case "MARK_STALE": {
        const { queryKey } = update.payload as { queryKey: QueryKey };
        const queryKeyString = toKeyString(queryKey);
        const newStale = new Set(state.stale);
        newStale.add(queryKeyString);
        return { ...state, stale: newStale };
      }

      case "SET_ITEMS": {
        const { items, queryKey } = update.payload as {
          items: CollectionItem<T>[];
          queryKey: QueryKey;
        };
        const queryKeyString = toKeyString(queryKey);
        const previousIds =
          state.listQueries.getByKeyString(queryKeyString) ?? [];
        const newItems = new CollectionMap(state.items);
        const newListQueries = new ListQueryMap(state.listQueries);
        const newListFetchTimes = new Map(state.listFetchTimes);
        const newStale = new Set(state.stale);
        const newErrors = new Map(state.errors);

        // Add/update items with queryKey tracking
        const itemIds: string[] = [];
        items.forEach((item) => {
          const storageId = getStorageId(queryKey, item.id);
          const existingItem = newItems.getByStorageId(storageId);
          const updatedItem = existingItem
            ? mergeItemWithFreshData(existingItem, item, queryKeyString)
            : { ...item, queryKeys: [queryKeyString] };
          newItems.setByStorageId(storageId, updatedItem);
          itemIds.push(storageId);
        });

        // Track this query's items
        newListQueries.setByKeyString(queryKeyString, itemIds);

        // Stamp list freshness on the query itself so an empty result is as
        // fresh as a populated one (see shouldSkipFetchForQuery).
        newListFetchTimes.set(queryKeyString, new Date().toISOString());

        logQueryRegistryEvent({
          collection: name,
          kind: "list_query_set",
          queryKey: queryKeyString,
          detail: {
            previousIds,
            nextIds: itemIds,
          },
        });

        // Remove from stale and errors
        newStale.delete(queryKeyString);
        newErrors.delete(queryKeyString);

        const nextState = {
          ...state,
          items: newItems,
          listQueries: newListQueries,
          listFetchTimes: newListFetchTimes,
          stale: newStale,
          errors: newErrors,
        };

        return nextState;
      }

      case "ADD_ITEM": {
        const { item } = update.payload as {
          item: CollectionItem<T>;
        };
        const newItems = new CollectionMap(state.items);
        const newStale = new Set(state.stale);
        const existingItem = newItems.getByStorageId(item.id);

        // Add the item to the collection
        newItems.setByStorageId(item.id, {
          ...item,
          queryKeys: item.queryKeys || [],
        });

        logQueryRegistryEvent({
          collection: name,
          kind: "item_set",
          itemId: item.id,
          storageId: item.id,
          detail: {
            previousItem: existingItem ?? null,
            nextItem: newItems.getByStorageId(item.id) ?? null,
          },
        });

        // CRITICAL: Mark ALL queries as stale because this is a new item
        state.fetched.forEach((queryKey) => {
          newStale.add(queryKey);
        });
        state.listQueries.forEach((_, queryKey) => {
          newStale.add(queryKey);
        });

        return {
          ...state,
          items: newItems,
          stale: newStale,
        };
      }

      case "SET_ITEM": {
        const { item, queryKey } = update.payload as {
          item: CollectionItem<T>;
          queryKey: QueryKey;
        };
        const queryKeyString = toKeyString(queryKey);
        const storageId = getStorageId(queryKey, item.id);
        const newItems = new CollectionMap(state.items);
        const newSingleQueries = new Map(state.singleQueries);
        const newStale = new Set(state.stale);
        const newErrors = new Map(state.errors);
        const previousStorageId = state.singleQueries.get(queryKeyString);

        // Add/update item with queryKey tracking
        const existingItem = newItems.getByStorageId(storageId);
        const updatedItem = existingItem
          ? {
              ...item,
              queryKeys: [
                ...(existingItem.queryKeys || []),
                queryKeyString,
              ].filter((key, index, arr) => arr.indexOf(key) === index), // Remove duplicates
            }
          : { ...item, queryKeys: [queryKeyString] };
        newItems.setByStorageId(storageId, updatedItem);

        // Track this query's item
        newSingleQueries.set(queryKeyString, storageId);

        logQueryRegistryEvent({
          collection: name,
          kind: "single_query_set",
          queryKey: queryKeyString,
          itemId: item.id,
          storageId,
          detail: {
            previousStorageId,
            previousItem: existingItem ?? null,
            nextItem: updatedItem,
            singleQueriesBefore: previousStorageId ?? null,
            singleQueriesAfter: newSingleQueries.get(queryKeyString) ?? null,
          },
        });

        // Remove from stale and errors
        newStale.delete(queryKeyString);
        newErrors.delete(queryKeyString);

        // Also update any list queries that contain this item
        const newListQueries = new ListQueryMap(state.listQueries);
        newListQueries.forEach((ids, key) => {
          if (ids.includes(storageId)) {
            newStale.delete(key);
          }
        });

        const nextState = {
          ...state,
          items: newItems,
          singleQueries: newSingleQueries,
          listQueries: newListQueries,
          stale: newStale,
          errors: newErrors,
        };

        return nextState;
      }

      case "CLEAR_QUERY": {
        const { queryKey } = update.payload as { queryKey: QueryKey };
        const queryKeyString = toKeyString(queryKey);
        const newListQueries = new ListQueryMap(state.listQueries);
        const newListFetchTimes = new Map(state.listFetchTimes);
        const newSingleQueries = new Map(state.singleQueries);
        const newStale = new Set(state.stale);
        const newLoading = new Set(state.loading);
        const newErrors = new Map(state.errors);

        newListQueries.deleteByKeyString(queryKeyString);
        newListFetchTimes.delete(queryKeyString);
        newSingleQueries.delete(queryKeyString);
        newStale.delete(queryKeyString);
        newLoading.delete(queryKeyString);
        newErrors.delete(queryKeyString);

        return {
          ...state,
          listQueries: newListQueries,
          listFetchTimes: newListFetchTimes,
          singleQueries: newSingleQueries,
          stale: newStale,
          loading: newLoading,
          errors: newErrors,
        };
      }

      case "SET_FETCH_SUCCESS": {
        const { queryKey } = update.payload as { queryKey: QueryKey };
        const queryKeyString = toKeyString(queryKey);
        const newLoading = new Set(state.loading);
        newLoading.delete(queryKeyString);

        const newFetched = new Set(state.fetched);
        newFetched.add(queryKeyString);

        const newStale = new Set(state.stale);
        newStale.delete(queryKeyString);

        const newErrors = new Map(state.errors);
        newErrors.delete(queryKeyString);

        const nextState = {
          ...state,
          loading: newLoading,
          fetched: newFetched,
          stale: newStale,
          errors: newErrors,
        };

        return nextState;
      }

      case "SET_FETCH_ERROR": {
        const { queryKey, error } = update.payload as {
          queryKey: QueryKey;
          error: Error;
        };
        const queryKeyString = toKeyString(queryKey);
        const newLoading = new Set(state.loading);
        newLoading.delete(queryKeyString);

        const newErrors = new Map(state.errors);
        newErrors.set(queryKeyString, error);

        const newFetched = new Set(state.fetched);
        newFetched.add(queryKeyString);

        const nextState = {
          ...state,
          loading: newLoading,
          errors: newErrors,
          fetched: newFetched,
        };

        return nextState;
      }

      default:
        return state;
    }
  }

  // Query atom family for auto-fetching
  const queryAtomFamily = atomFamily((queryKey: QueryKey) => {
    const serializedKey = queryKey.toKey();

    return atom(async (get, { signal: _signal }) => {
      const state = get(stateAtom);
      const _dispatch = (_action: CollectionAction<T>) => {
        // We need access to set function, this is handled by the hook
        logger.warn(
          "data_core",
          "[createCollection] Direct dispatch from queryAtom not supported"
        );
      };
      // Suppress unused parameter warning - this is a placeholder function
      void _dispatch;

      // Check if stale or never loaded
      const isStale = state.stale.has(serializedKey);
      const hasListData = state.listQueries.hasByKeyString(serializedKey);
      const hasSingleData = state.singleQueries.has(serializedKey);
      const hasData = hasListData || hasSingleData;
      const isLoading = state.loading.has(serializedKey);

      if ((!hasData || isStale) && !isLoading) {
        // Fetch will be triggered by the hook
        return null;
      }

      // Return current data
      if (hasListData) {
        const ids = state.listQueries.getByKeyString(serializedKey)!;
        return ids.map((id) => state.items.getByStorageId(id)!).filter(Boolean);
      } else if (hasSingleData) {
        const id = state.singleQueries.get(serializedKey)!;
        return state.items.getByStorageId(id) || null;
      }

      return null;
    });
  });

  // Updated fetch function with centralized logic

  return {
    name,
    stateAtom,
    actionsAtom,
    queryAtomFamily,
    staleTimeMs,
    isStale: (item: CollectionItem<T> | undefined, customStaleTime?: number) =>
      isDataStale(item, customStaleTime ?? staleTimeMs),
    // Exposed for test isolation: drops pending fetch windows between tests.
    _fetchQueue: fetchQueue,
  };
}
