import { render, renderHook, waitFor, act } from "@testing-library/react";
import { createElement, StrictMode, type PropsWithChildren } from "react";
import { vi } from "vitest";
import { useQuery } from "../useQuery";
import { QueryMountPolicyProvider } from "../queryMountPolicy";
import type {
  CollectionState,
  CollectionItem,
  DispatchFunction,
} from "../types";
import { CollectionMap } from "../CollectionMap";
import { ListQueryMap } from "../ListQueryMap";
import { QueryKey, QueryKeyField } from "../QueryKey";

// Mock data types for testing
interface TestData {
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

const createTestQueryKey = (key: string) => new TestQueryKey(key);

function forceRefetchOnMountWrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryMountPolicyProvider,
    { policy: "always-refetch" },
    children
  );
}

describe("useQuery (Phase 5 Simplified Implementation)", () => {
  let mockDispatch: vi.MockedFunction<DispatchFunction<TestData>>;
  let mockState: CollectionState<TestData>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    mockState = {
      staleTimeMs: 300_000,
      items: new CollectionMap(),
      singleQueries: new Map(),
      loading: new Set(),
      errors: new Map(),
      stale: new Set(),
      listQueries: new ListQueryMap(),
      fetched: new Set(),
      optimisticUpdates: new Map(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("App resume age and lifecycle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-27T00:01:00Z"));
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    });
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    function seed(kind: "single" | "list" | "empty", age: number) {
      const key = createTestQueryKey("resume-" + kind);
      const timestamp = new Date(Date.now() - age).toISOString();
      mockState.items.setByStorageId("item", {
        id: "item",
        data: { id: "item", name: "Cached" },
        lastFetched: timestamp,
        updatedAt: timestamp,
        queryKeys: [key.toKey()],
        fetchedCount: 1,
      });
      if (kind === "single") mockState.singleQueries.set(key.toKey(), "item");
      else {
        mockState.listQueries.setByKeyString(
          key.toKey(),
          kind === "empty" ? [] : ["item"]
        );
        mockState.listFetchTimes = new Map([[key.toKey(), timestamp]]);
      }
      return key;
    }
    for (const kind of ["single", "list", "empty"] as const) {
      it.each([299_999, 300_000, 300_001])(
        kind + ": strict threshold at %i ms",
        async (age) => {
          const queryKey = seed(kind, age);
          renderHook(() =>
            useQuery({
              queryKey,
              state: mockState,
              dispatch: mockDispatch,
              refetchOnMount: false,
              preferStale: true,
            })
          );
          expect(vi.getTimerCount()).toBe(0);
          await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
          });
          expect(mockDispatch).toHaveBeenCalledTimes(age > 300_000 ? 1 : 0);
          if (age > 300_000)
            expect(mockDispatch).toHaveBeenCalledWith(
              expect.objectContaining({ type: "REFETCH_QUERY", queryKey })
            );
        }
      );
    }
    it("keeps focus reads independent of a pending resume claim", async () => {
      const queryKey = seed("single", 300_001);
      let complete!: (value: TestData | null) => void;
      mockDispatch.mockReturnValueOnce(
        new Promise<TestData | null>((resolve) => {
          complete = resolve;
        })
      );
      renderHook(() =>
        useQuery({
          queryKey,
          state: mockState,
          dispatch: mockDispatch,
          refetchOnMount: false,
          refetchOnWindowFocus: true,
        })
      );
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
        window.dispatchEvent(new Event("focus"));
        window.dispatchEvent(new Event("pageshow"));
      });
      expect(mockDispatch).toHaveBeenCalledTimes(2);
      await act(async () => {
        complete(null);
      });
    });
    it.each([29_999, 30_000, 30_001])(
      "uses the explicit activity resume threshold at %i ms",
      async (age) => {
        const queryKey = seed("single", age);
        renderHook(() =>
          useQuery({
            queryKey,
            state: mockState,
            dispatch: mockDispatch,
            refetchOnMount: false,
            refetchOnStale: false,
            staleTimeMs: 30_000,
          })
        );
        await act(async () => {
          document.dispatchEvent(new Event("resume"));
        });
        const recoveryReads = mockDispatch.mock.calls.filter(
          ([action]) => action.type === "REFETCH_QUERY"
        );
        expect(recoveryReads).toHaveLength(age > 30_000 ? 1 : 0);
      }
    );
    it("ignores missing timestamps", async () => {
      const queryKey = createTestQueryKey("missing");
      renderHook(() =>
        useQuery({
          queryKey,
          state: mockState,
          dispatch: mockDispatch,
          refetchOnMount: false,
        })
      );
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
      expect(mockDispatch).not.toHaveBeenCalled();
    });
    it("ignores hidden signals and removes disabled listeners", async () => {
      const queryKey = seed("empty", 300_001);
      const { rerender } = renderHook(
        ({ enabled }) =>
          useQuery({
            queryKey,
            state: mockState,
            dispatch: mockDispatch,
            enabled,
            refetchOnMount: false,
          }),
        { initialProps: { enabled: true } }
      );
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
        window.dispatchEvent(new Event("pageshow"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      rerender({ enabled: false });
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(mockDispatch).not.toHaveBeenCalled();
    });
    it("removes old-key and unmounted listeners", async () => {
      const first = seed("single", 300_001);
      const second = seed("empty", 300_001);
      const { rerender, unmount } = renderHook(
        ({ queryKey }) =>
          useQuery({
            queryKey,
            state: mockState,
            dispatch: mockDispatch,
            refetchOnMount: false,
          }),
        { initialProps: { queryKey: first } }
      );
      rerender({ queryKey: second });
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
      });
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: second })
      );
      unmount();
      mockDispatch.mockClear();
      await act(async () => {
        document.dispatchEvent(new Event("resume"));
        window.dispatchEvent(new Event("pageshow"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe("Initial State", () => {
    it("should return correct initial state", () => {
      const queryKey = createTestQueryKey("test-key");
      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isStale).toBe(false);
      expect(typeof result.current.refetch).toBe("function");
      expect(typeof result.current.markStale).toBe("function");
    });
  });

  describe("Maximum cache age", () => {
    it("withholds an expired cached result as loading while the replacement read starts", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-03T00:01:00.000Z"));

      const queryKey = createTestQueryKey("expired-key");
      const queryKeyString = queryKey.toKey();
      mockState.items.setByStorageId("item-1", {
        id: "item-1",
        updatedAt: "2026-03-03T00:00:00.000Z",
        lastFetched: "2026-03-03T00:00:00.000Z",
        data: { id: "1", name: "expired" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          maxCacheAgeMs: 1000,
        })
      );

      expect(result.current.data).toBeNull();
      expect(result.current.isExpired).toBe(true);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isStale).toBe(true);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "MARK_STALE",
        queryKey,
      });

      vi.useRealTimers();
    });

    it("uses the list query timestamp so a successful empty result can expire", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-03T00:01:00.000Z"));

      const queryKey = createTestQueryKey("empty-list");
      const queryKeyString = queryKey.toKey();
      mockState.listQueries.setByKeyString(queryKeyString, []);
      mockState.listFetchTimes = new Map([
        [queryKeyString, "2026-03-03T00:00:00.000Z"],
      ]);
      mockState.fetched.add(queryKeyString);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          maxCacheAgeMs: 1000,
        })
      );

      expect(result.current.isExpired).toBe(true);
      expect(result.current.isLoading).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("Data Fetching", () => {
    it("should dispatch FETCH_QUERY when enabled and refetchOnMount is true", async () => {
      mockDispatch.mockResolvedValue({ id: "1", name: "test" });
      const queryKey = createTestQueryKey("test-key");

      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: true,
        })
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: "FETCH_QUERY",
          queryKey,
          signal: expect.any(AbortSignal),
        });
      });
    });

    it("forces one mount-policy read and keeps cached data visible", async () => {
      const queryKey = createTestQueryKey("detail-page-tab");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "cached" };
      const timestamp = new Date().toISOString();
      mockState.items.setByStorageId("item-1", {
        id: "1",
        updatedAt: timestamp,
        lastFetched: timestamp,
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);
      mockDispatch.mockImplementation(() => new Promise(() => {}));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey,
            dispatch: mockDispatch,
            state: mockState,
            refetchOnMount: false,
          }),
        { wrapper: forceRefetchOnMountWrapper }
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledTimes(1);
      });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "REFETCH_QUERY",
        queryKey,
        signal: expect.any(AbortSignal),
      });
      expect(result.current.data).toEqual(testData);
      expect(result.current.isLoading).toBe(false);
    });

    it("keeps expired cached data visible until the forced mount read settles", async () => {
      const queryKey = createTestQueryKey("expired-detail-page-tab");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "cached but old" };
      const timestamp = new Date(Date.now() - 5_000).toISOString();
      mockState.items.setByStorageId("item-1", {
        id: "1",
        updatedAt: timestamp,
        lastFetched: timestamp,
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);
      mockDispatch.mockImplementation(() => new Promise(() => {}));

      const { result, rerender } = renderHook(
        () =>
          useQuery({
            queryKey,
            dispatch: mockDispatch,
            state: mockState,
            maxCacheAgeMs: 1_000,
          }),
        { wrapper: forceRefetchOnMountWrapper }
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith(
          expect.objectContaining({ type: "REFETCH_QUERY", queryKey })
        );
      });
      rerender();
      expect(result.current.isExpired).toBe(true);
      expect(result.current.data).toEqual(testData);
      expect(result.current.isLoading).toBe(false);
    });

    it("does not issue a second mount read when forced-mount data is stale", async () => {
      const queryKey = createTestQueryKey("stale-forced-mount");
      mockState.stale.add(queryKey.toKey());
      mockDispatch.mockImplementation(() => new Promise(() => {}));

      renderHook(
        () =>
          useQuery({
            queryKey,
            dispatch: mockDispatch,
            state: mockState,
          }),
        { wrapper: forceRefetchOnMountWrapper }
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledTimes(1);
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "REFETCH_QUERY", queryKey })
      );
    });

    it("does not duplicate the forced mount read when Strict Mode replays effects", async () => {
      const queryKey = createTestQueryKey("strict-forced-mount");
      mockDispatch.mockImplementation(() => new Promise(() => {}));

      const strictWrapper = ({ children }: PropsWithChildren) =>
        createElement(
          StrictMode,
          null,
          createElement(
            QueryMountPolicyProvider,
            { policy: "always-refetch" },
            children
          )
        );

      renderHook(
        () =>
          useQuery({
            queryKey,
            dispatch: mockDispatch,
            state: mockState,
          }),
        { wrapper: strictWrapper }
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledTimes(1);
      });
      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: "REFETCH_QUERY", queryKey })
      );
    });

    it("refetches on mount each time a query consumer is remounted", async () => {
      const queryKey = createTestQueryKey("remounted-forced-mount");
      mockDispatch.mockResolvedValue({ id: "1", name: "latest" });

      const QueryProbe = () => {
        useQuery({ queryKey, dispatch: mockDispatch, state: mockState });
        return null;
      };
      const renderQueryConsumer = (isMounted: boolean) =>
        createElement(
          QueryMountPolicyProvider,
          { policy: "always-refetch" },
          isMounted ? createElement(QueryProbe) : null
        );
      const { rerender } = render(renderQueryConsumer(true));

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledTimes(1);
      });
      rerender(renderQueryConsumer(false));
      rerender(renderQueryConsumer(true));

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledTimes(2);
      });
      expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual([
        "REFETCH_QUERY",
        "REFETCH_QUERY",
      ]);
    });

    it("should pass staleTime override to FETCH_QUERY when configured", async () => {
      mockDispatch.mockResolvedValue({ id: "1", name: "test" });
      const queryKey = createTestQueryKey("test-key");

      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: true,
          staleTimeMs: 5000,
        })
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: "FETCH_QUERY",
          queryKey,
          signal: expect.any(AbortSignal),
          staleTimeMs: 5000,
        });
      });
    });

    it("should not dispatch when disabled", async () => {
      const queryKey = createTestQueryKey("test-key");
      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: false,
        })
      );

      // Wait a bit to ensure dispatch is not called
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should not dispatch when refetchOnMount is false", async () => {
      const queryKey = createTestQueryKey("test-key");
      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
        })
      );

      // Wait a bit to ensure dispatch is not called
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should not dispatch when preferStale is true and data exists", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: { id: "1", name: "cached" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          preferStale: true,
        })
      );

      expect(result.current.data).toEqual({ id: "1", name: "cached" });
      expect(result.current.isFetched).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should dispatch when preferStale is true but data is missing", async () => {
      const queryKey = createTestQueryKey("test-key");
      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          preferStale: true,
        })
      );

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: "FETCH_QUERY",
          queryKey,
          signal: expect.any(AbortSignal),
        });
      });
    });
  });

  describe("Data Extraction", () => {
    it("should return single item data when available", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "test" };
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.data).toEqual(testData);
    });

    it("should return array data when available", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData1 = { id: "1", name: "test1" };
      const testData2 = { id: "2", name: "test2" };

      const item1: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData1,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      const item2: CollectionItem<TestData> = {
        id: "item-2",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData2,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item1);
      mockState.items.setByStorageId("item-2", item2);
      mockState.listQueries.setByKeyString(queryKeyString, [
        "item-1",
        "item-2",
      ]);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.data).toEqual([testData1, testData2]);
    });

    it("should filter out missing items from arrays", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData1 = { id: "1", name: "test1" };

      const item1: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData1,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item1);
      // item-2 is missing but referenced in listQueries
      mockState.listQueries.setByKeyString(queryKeyString, [
        "item-1",
        "item-2",
      ]);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.data).toEqual([testData1]);
    });
  });

  describe("State Indicators", () => {
    it("treats available data as ready while the fetch success marker is pending", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "test" };
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.loading.add(queryKeyString);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
        })
      );

      expect(result.current.data).toEqual(testData);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(true);
    });

    it("should indicate loading state correctly", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      mockState.loading.add(queryKeyString);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.isLoading).toBe(true);
    });

    it("should indicate fetched state correctly", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      mockState.fetched.add(queryKeyString);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.isFetched).toBe(true);
    });

    it("should indicate stale state correctly", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      mockState.stale.add(queryKeyString);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.isStale).toBe(true);
    });

    it("should return error when present", () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testError = new Error("Test error");
      mockState.errors.set(queryKeyString, testError);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      expect(result.current.error).toBe(testError);
    });
  });

  describe("refetch Function", () => {
    it("should dispatch REFETCH_QUERY when refetch is called", async () => {
      mockDispatch.mockResolvedValue({ id: "1", name: "refetched" });
      const queryKey = createTestQueryKey("test-key");

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "REFETCH_QUERY",
        queryKey,
        signal: expect.any(AbortSignal),
      });
    });

    it("should return null when refetch is called but disabled", async () => {
      const queryKey = createTestQueryKey("test-key");
      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: false,
        })
      );

      const refetchResult = await act(async () => {
        return await result.current.refetch();
      });

      expect(refetchResult).toBeNull();
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should handle refetch errors gracefully", async () => {
      const queryKey = createTestQueryKey("test-key");
      const testError = new Error("Refetch failed");
      mockDispatch.mockRejectedValue(testError);

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      await expect(
        act(async () => {
          await result.current.refetch();
        })
      ).rejects.toThrow("Refetch failed");
    });

    it("should handle abort gracefully", async () => {
      const queryKey = createTestQueryKey("test-key");
      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      mockDispatch.mockRejectedValue(new Error("Fetch aborted"));

      const refetchResult = await act(async () => {
        return await result.current.refetch();
      });

      expect(refetchResult).toBeNull();
    });
  });

  describe("markStale Function", () => {
    it("should dispatch MARK_STALE when markStale is called", () => {
      const queryKey = createTestQueryKey("test-key");
      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
        })
      );

      act(() => {
        result.current.markStale();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "MARK_STALE",
        queryKey,
      });
    });
  });

  describe("Window Focus Refetch", () => {
    beforeEach(() => {
      // Mock window.addEventListener and removeEventListener
      vi.spyOn(window, "addEventListener");
      vi.spyOn(window, "removeEventListener");
    });

    it("should set up window focus listener when refetchOnWindowFocus is true", () => {
      const queryKey = createTestQueryKey("test-key");
      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnWindowFocus: true,
        })
      );

      expect(window.addEventListener).toHaveBeenCalledWith(
        "focus",
        expect.any(Function)
      );
    });

    it("should dispatch REFETCH_QUERY for a fresh query when the window regains focus", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "cached" };
      const timestamp = new Date().toISOString();

      mockState.items.setByStorageId("item-1", {
        id: "item-1",
        updatedAt: timestamp,
        lastFetched: timestamp,
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);
      mockDispatch.mockResolvedValue(testData);

      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          refetchOnWindowFocus: true,
        })
      );

      vi.clearAllMocks();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "REFETCH_QUERY",
        queryKey,
        signal: expect.any(AbortSignal),
      });
    });

    it("should bypass preferStale for an authoritative window focus refetch", async () => {
      const queryKey = createTestQueryKey("prefer-stale-focus-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "cached" };
      const timestamp = new Date().toISOString();

      mockState.items.setByStorageId("item-1", {
        id: "item-1",
        updatedAt: timestamp,
        lastFetched: timestamp,
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);
      mockDispatch.mockResolvedValue(testData);

      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          preferStale: true,
          refetchOnMount: false,
          refetchOnStale: false,
          refetchOnWindowFocus: true,
        })
      );

      vi.clearAllMocks();

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "REFETCH_QUERY",
        queryKey,
        signal: expect.any(AbortSignal),
      });
    });

    it("should dispatch one refetch for a focus event shared by consumers", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "cached" };
      const timestamp = new Date().toISOString();

      mockState.items.setByStorageId("item-1", {
        id: "item-1",
        updatedAt: timestamp,
        lastFetched: timestamp,
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);
      mockDispatch.mockResolvedValue(testData);
      const firstDispatch: DispatchFunction<TestData> = (action) =>
        mockDispatch(action);
      const secondDispatch: DispatchFunction<TestData> = (action) =>
        mockDispatch(action);

      renderHook(() => {
        useQuery({
          queryKey,
          dispatch: firstDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          refetchOnWindowFocus: true,
        });

        return useQuery({
          queryKey,
          dispatch: secondDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          refetchOnWindowFocus: true,
        });
      });

      vi.clearAllMocks();

      const focusEvent = new Event("focus");
      await act(async () => {
        window.dispatchEvent(focusEvent);
        await Promise.resolve();
      });

      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "REFETCH_QUERY",
        queryKey,
        signal: expect.any(AbortSignal),
      });

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      expect(mockDispatch).toHaveBeenCalledTimes(2);
    });

    it("should retain cached data while a focus refetch is pending", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "cached" };
      const timestamp = new Date().toISOString();
      let resolveRefetch!: (data: TestData) => void;
      const refetchPromise = new Promise<TestData>((resolve) => {
        resolveRefetch = resolve;
      });

      mockState.items.setByStorageId("item-1", {
        id: "item-1",
        updatedAt: timestamp,
        lastFetched: timestamp,
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      });
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);
      mockDispatch.mockImplementation((action) => {
        if (action.type === "REFETCH_QUERY") {
          return refetchPromise;
        }
        return undefined;
      });

      const { result } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          refetchOnWindowFocus: true,
        })
      );

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: "REFETCH_QUERY",
          queryKey,
          signal: expect.any(AbortSignal),
        });
      });
      expect(result.current.data).toEqual(testData);
      expect(result.current.isLoading).toBe(false);

      await act(async () => {
        resolveRefetch(testData);
        await refetchPromise;
      });
    });

    it("should not set up or dispatch window focus recovery when disabled", async () => {
      const queryKey = createTestQueryKey("test-key");
      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
        })
      );

      expect(window.addEventListener).not.toHaveBeenCalledWith(
        "focus",
        expect.any(Function)
      );

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await Promise.resolve();
      });

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should clean up window focus listener on unmount", () => {
      const queryKey = createTestQueryKey("test-key");
      const { unmount } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnWindowFocus: true,
        })
      );

      unmount();

      expect(window.removeEventListener).toHaveBeenCalledWith(
        "focus",
        expect.any(Function)
      );
    });
  });

  describe("Abort Controller Management", () => {
    it("should clean up abort controller on unmount", async () => {
      const queryKey = createTestQueryKey("test-key");
      let abortSpy: AbortController | undefined;

      mockDispatch.mockImplementation(async (action) => {
        if ("signal" in action && action.signal) {
          abortSpy = { signal: action.signal } as AbortController;
        }
        return null;
      });

      const { unmount } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: true,
        })
      );

      // Wait for initial dispatch
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalled();
      });

      unmount();

      // The abort controller should have been used
      expect(abortSpy).toBeDefined();
    });

    it("should track the latest query key across repeated refetches", async () => {
      const firstQueryKey = createTestQueryKey("first-key");
      const secondQueryKey = createTestQueryKey("second-key");
      const signals: AbortSignal[] = [];

      mockDispatch.mockImplementation((action) => {
        if ("signal" in action && action.signal) {
          signals.push(action.signal);
        }
        return undefined;
      });

      const { result, rerender } = renderHook(
        ({ activeQueryKey }: { activeQueryKey: TestQueryKey }) =>
          useQuery({
            queryKey: activeQueryKey,
            dispatch: mockDispatch,
            state: mockState,
            enabled: true,
            refetchOnMount: false,
            refetchOnStale: false,
          }),
        { initialProps: { activeQueryKey: firstQueryKey } }
      );

      await act(async () => {
        await result.current.refetch();
      });

      rerender({ activeQueryKey: secondQueryKey });

      await act(async () => {
        await result.current.refetch();
      });

      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);

      await act(async () => {
        await result.current.refetch();
      });

      expect(signals).toHaveLength(3);
      expect(signals[1].aborted).toBe(false);
      expect(signals[2].aborted).toBe(false);
    });
  });

  describe("Automatic Stale Data Refetch", () => {
    it("should automatically refetch when data becomes stale and refetchOnStale is true", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      // Setup: Start with fresh data
      const testData = { id: "1", name: "test" };
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);

      mockDispatch.mockResolvedValue(testData);

      const { result, rerender } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false, // Disable initial fetch to isolate auto-refetch
          refetchOnStale: true, // Enable auto-refetch on stale
        })
      );

      // Clear initial dispatch calls
      vi.clearAllMocks();

      // Action: Mark data as stale
      act(() => {
        mockState.stale.add(queryKeyString);
        rerender(); // Trigger re-render to detect stale state change
      });

      // Expect: Automatic REFETCH_QUERY should be dispatched
      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: "FETCH_QUERY", // Should trigger fetch when stale
          queryKey,
          signal: expect.any(AbortSignal),
        });
      });

      expect(result.current.isStale).toBe(true);
    });

    it("should not automatically refetch when refetchOnStale is false", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      // Setup: Same as above but with refetchOnStale disabled
      const testData = { id: "1", name: "test" };
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);

      const { rerender } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false, // Disabled - should NOT auto-refetch
        })
      );

      // Clear initial calls
      vi.clearAllMocks();

      // Action: Mark data as stale
      act(() => {
        mockState.stale.add(queryKeyString);
        rerender();
      });

      // Wait and verify NO automatic refetch occurs
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should not automatically refetch when preferStale is true", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const testData = { id: "1", name: "test" };
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: new Date().toISOString(),
        lastFetched: new Date().toISOString(),
        data: testData,
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");
      mockState.fetched.add(queryKeyString);

      const { rerender } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: true,
          preferStale: true,
        })
      );

      vi.clearAllMocks();

      act(() => {
        mockState.stale.add(queryKeyString);
        rerender();
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should respect enabled=false when auto-refetching stale data", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      // Setup: Stale data with refetchOnStale enabled but query disabled
      mockState.stale.add(queryKeyString);

      const { rerender } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: false, // Query disabled
          refetchOnMount: false,
          refetchOnStale: true, // Would normally trigger refetch, but enabled=false
        })
      );

      // Trigger stale detection
      rerender();

      // Wait and verify NO refetch occurs when disabled
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should handle multiple stale state changes without excessive refetches", async () => {
      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      // Test to ensure we don't get into infinite refetch loops
      mockDispatch.mockResolvedValue({ id: "1", name: "test" });

      const { rerender } = renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: true,
        })
      );

      // Mark as stale multiple times rapidly
      act(() => {
        mockState.stale.add(queryKeyString);
        rerender();
        rerender();
        rerender();
      });

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalled();
      });

      // Should only trigger one refetch despite multiple re-renders
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it("should mark query stale when staleTimeMs TTL expires", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-03-03T00:00:00.000Z"));

      const queryKey = createTestQueryKey("test-key");
      const queryKeyString = queryKey.toKey();
      const item: CollectionItem<TestData> = {
        id: "item-1",
        updatedAt: "2026-03-03T00:00:00.000Z",
        lastFetched: "2026-03-03T00:00:00.000Z",
        data: { id: "1", name: "cached" },
        queryKeys: [queryKeyString],
        fetchedCount: 1,
      };

      mockState.items.setByStorageId("item-1", item);
      mockState.singleQueries.set(queryKeyString, "item-1");

      renderHook(() =>
        useQuery({
          queryKey,
          dispatch: mockDispatch,
          state: mockState,
          enabled: true,
          refetchOnMount: false,
          refetchOnStale: false,
          staleTimeMs: 1000,
        })
      );

      vi.clearAllMocks();

      act(() => {
        vi.advanceTimersByTime(1001);
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: "MARK_STALE",
        queryKey,
      });

      vi.useRealTimers();
    });
  });
});
