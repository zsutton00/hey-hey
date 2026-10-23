import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createCollection } from "../createCollection";
import { useAtomValue, useSetAtom } from "jotai";
import { QueryKey, QueryKeyField } from "../QueryKey";

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

const createTestQueryKey = (key: string) => new TestQueryKey(key);

describe("Request Deduplication", () => {
  let mockFetcher: ReturnType<typeof vi.fn>;
  let testCollection: ReturnType<typeof createCollection<TestItem>>;

  beforeEach(() => {
    mockFetcher = vi.fn();
    testCollection = createCollection<TestItem>({
      name: "test",
      fetcher: mockFetcher,
      staleTimeMs: 30000,
    });
  });

  it("should coalesce simultaneous identical queries into a single network request", async () => {
    // Setup: Mock fetcher returns after 100ms delay
    mockFetcher.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        data: { id: "test-1", name: "Test Item" },
        isArray: false,
      };
    });

    const queryKey = createTestQueryKey("test:org:item-1");
    const { stateAtom, actionsAtom } = testCollection;

    // Simulate two components making the same request simultaneously
    const TestHook = () => {
      const state = useAtomValue(stateAtom);
      const dispatch = useSetAtom(actionsAtom);
      return { state, dispatch };
    };

    const { result: result1 } = renderHook(() => TestHook());
    const { result: result2 } = renderHook(() => TestHook());

    // Both dispatch FETCH_QUERY at the exact same time
    const promise1 = result1.current.dispatch({
      type: "FETCH_QUERY",
      queryKey,
    });
    const promise2 = result2.current.dispatch({
      type: "FETCH_QUERY",
      queryKey,
    });

    // Wait for both to complete
    await Promise.all([promise1, promise2]);

    // CRITICAL: Fetcher should only be called ONCE, not twice
    expect(mockFetcher).toHaveBeenCalledTimes(1);
    expect(mockFetcher).toHaveBeenCalledWith(queryKey, expect.anything(), {});
  });

  it("should make separate requests for different queryKeys", async () => {
    mockFetcher
      .mockResolvedValueOnce({
        data: { id: "item-1", name: "Item 1" },
        isArray: false,
      })
      .mockResolvedValueOnce({
        data: { id: "item-2", name: "Item 2" },
        isArray: false,
      });

    const { stateAtom, actionsAtom } = testCollection;
    const TestHook = () => {
      const state = useAtomValue(stateAtom);
      const dispatch = useSetAtom(actionsAtom);
      return { state, dispatch };
    };

    const { result } = renderHook(() => TestHook());

    // Dispatch two different queries simultaneously
    await Promise.all([
      result.current.dispatch({
        type: "FETCH_QUERY",
        queryKey: createTestQueryKey("test:org:item-1"),
      }),
      result.current.dispatch({
        type: "FETCH_QUERY",
        queryKey: createTestQueryKey("test:org:item-2"),
      }),
    ]);

    // Should make 2 separate requests for different keys
    expect(mockFetcher).toHaveBeenCalledTimes(2);
  });
});
