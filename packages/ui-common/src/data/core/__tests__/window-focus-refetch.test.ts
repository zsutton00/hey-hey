import { renderHook, act, waitFor } from "@testing-library/react";
import { createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createCollection } from "../createCollection";
import { QueryKey, QueryKeyField } from "../QueryKey";
import type { CollectionItem, FetcherResponse } from "../types";
import { useQuery } from "../useQuery";

interface TestItem {
  id: string;
  name: string;
}

type TestQueryFields = {
  key: QueryKeyField<string>;
};

class TestQueryKey extends QueryKey<TestQueryFields> {
  constructor(key: string) {
    super({ key: new QueryKeyField("key", key) });
  }
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("useQuery window focus refetch integration", () => {
  it("updates the canonical cache while preserving data and queue guarantees", async () => {
    const store = createStore();
    const queryKey = new TestQueryKey("window-focus-item");
    const queryKeyString = queryKey.toKey();
    const fetchResponses: Array<Deferred<FetcherResponse<TestItem>>> = [];
    let activeFetches = 0;
    let maxConcurrentFetches = 0;

    const fetcher = vi.fn(async (): Promise<FetcherResponse<TestItem>> => {
      activeFetches += 1;
      maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches);

      const response = createDeferred<FetcherResponse<TestItem>>();
      fetchResponses.push(response);
      return response.promise.then(
        (value) => {
          activeFetches -= 1;
          return value;
        },
        (error: unknown) => {
          activeFetches -= 1;
          throw error;
        }
      );
    });

    const collection = createCollection<TestItem>({
      name: "window-focus-refetch",
      fetcher,
      staleTimeMs: 30000,
    });

    const cachedData: TestItem = { id: "item-1", name: "cached" };
    const cachedItem: CollectionItem<TestItem> = {
      id: cachedData.id,
      updatedAt: "2026-09-03T00:00:00.000Z",
      lastFetched: "2026-09-03T00:00:00.000Z",
      data: cachedData,
      queryKeys: [queryKeyString],
      fetchedCount: 1,
    };

    await act(async () => {
      await store.set(collection.actionsAtom, {
        type: "SET_ITEM",
        item: cachedItem,
        queryKey,
      });
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(Provider, { store }, children);

    const { result } = renderHook(
      () => {
        const state = useAtomValue(collection.stateAtom);
        const dispatch = useSetAtom(collection.actionsAtom);

        return useQuery({
          queryKey,
          dispatch,
          state,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          refetchOnWindowFocus: true,
        });
      },
      { wrapper }
    );

    expect(result.current.data).toEqual(cachedData);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    expect(result.current.data).toEqual(cachedData);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(maxConcurrentFetches).toBe(1);

    // A focus event during the active fetch must park one follow-up cycle,
    // while another event coalesces into that same queued cycle.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(maxConcurrentFetches).toBe(1);

    const firstServerData: TestItem = { id: "item-1", name: "server-1" };
    await act(async () => {
      fetchResponses[0].resolve({ data: firstServerData, isArray: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(firstServerData);
    });
    expect(
      store.get(collection.stateAtom).items.getByStorageId(cachedData.id)?.data
    ).toEqual(firstServerData);

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(result.current.isFetching).toBe(true);
    });
    expect(result.current.data).toEqual(firstServerData);
    expect(activeFetches).toBe(1);
    expect(maxConcurrentFetches).toBe(1);

    const secondServerData: TestItem = { id: "item-1", name: "server-2" };
    await act(async () => {
      fetchResponses[1].resolve({ data: secondServerData, isArray: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(secondServerData);
    });
    expect(
      store.get(collection.stateAtom).items.getByStorageId(cachedData.id)?.data
    ).toEqual(secondServerData);
    expect(result.current.isFetching).toBe(false);
    expect(activeFetches).toBe(0);
    expect(maxConcurrentFetches).toBe(1);
  });

  it("coalesces one focus read across mounted consumers sharing a query", async () => {
    const store = createStore();
    const queryKey = new TestQueryKey("shared-focus-query");
    const queryKeyString = queryKey.toKey();
    const fetchResponses: Array<Deferred<FetcherResponse<TestItem>>> = [];

    const fetcher = vi.fn(async (): Promise<FetcherResponse<TestItem>> => {
      const response = createDeferred<FetcherResponse<TestItem>>();
      fetchResponses.push(response);
      return response.promise;
    });

    const collection = createCollection<TestItem>({
      name: "shared-focus-refetch",
      fetcher,
      staleTimeMs: 30000,
    });

    const cachedData: TestItem = { id: "item-1", name: "cached" };
    await act(async () => {
      await store.set(collection.actionsAtom, {
        type: "SET_ITEM",
        item: {
          id: cachedData.id,
          updatedAt: "2026-09-03T00:00:00.000Z",
          lastFetched: "2026-09-03T00:00:00.000Z",
          data: cachedData,
          queryKeys: [queryKeyString],
          fetchedCount: 1,
        },
        queryKey,
      });
    });

    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(Provider, { store }, children);

    const { result } = renderHook(
      () => {
        const state = useAtomValue(collection.stateAtom);
        const dispatch = useSetAtom(collection.actionsAtom);
        const first = useQuery({
          queryKey,
          dispatch,
          state,
          enabled: true,
          refetchOnMount: false,
          refetchOnWindowFocus: true,
        });
        const second = useQuery({
          queryKey,
          dispatch,
          state,
          enabled: true,
          refetchOnMount: false,
          refetchOnWindowFocus: true,
        });

        return { first, second };
      },
      { wrapper }
    );

    expect(result.current.first.data).toEqual(cachedData);
    expect(result.current.second.data).toEqual(cachedData);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    expect(result.current.first.data).toEqual(cachedData);
    expect(result.current.second.data).toEqual(cachedData);
    expect(result.current.first.isFetching).toBe(true);
    expect(result.current.second.isFetching).toBe(true);

    const serverData: TestItem = { id: "item-1", name: "server" };
    await act(async () => {
      fetchResponses[0].resolve({ data: serverData, isArray: false });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.first.data).toEqual(serverData);
      expect(result.current.second.data).toEqual(serverData);
    });
    expect(
      store.get(collection.stateAtom).items.getByStorageId(cachedData.id)?.data
    ).toEqual(serverData);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
