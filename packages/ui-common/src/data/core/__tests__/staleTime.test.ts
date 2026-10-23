import {
  DEFAULT_STALE_TIME_MS,
  resolveStaleTimeMs,
  isDataStale,
  isTimestampStale,
  shouldSkipFetch,
  shouldSkipFetchForTimestamp,
  type StaleTimeConfig,
} from "../staleTime";
import type { CollectionItem } from "../types";

describe("effective query freshness", () => {
  it("uses five minutes generally and gives explicit query overrides precedence", () => {
    expect(DEFAULT_STALE_TIME_MS).toBe(300_000);
    expect(resolveStaleTimeMs(DEFAULT_STALE_TIME_MS)).toBe(300_000);
    expect(resolveStaleTimeMs(60_000, 30_000)).toBe(30_000);
    expect(resolveStaleTimeMs(30_000, 300_000)).toBe(300_000);
    expect(resolveStaleTimeMs(300_000, 0)).toBe(0);
  });
});

describe("isDataStale", () => {
  it("returns true when item is undefined", () => {
    expect(isDataStale(undefined, 30000)).toBe(true);
  });

  it("returns false when data is fresh", () => {
    const item: CollectionItem<{ id: string; name: string }> = {
      id: "1",
      lastFetched: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { id: "1", name: "test" },
      queryKeys: [],
      fetchedCount: 1,
    };
    expect(isDataStale(item, 30000)).toBe(false);
  });

  it("returns true when data is stale", () => {
    const oldTime = new Date(Date.now() - 60000).toISOString();
    const item: CollectionItem<{ id: string; name: string }> = {
      id: "1",
      lastFetched: oldTime,
      updatedAt: oldTime,
      data: { id: "1", name: "test" },
      queryKeys: [],
      fetchedCount: 1,
    };
    expect(isDataStale(item, 30000)).toBe(true);
  });
});

describe("isTimestampStale", () => {
  it("returns true when the timestamp is missing", () => {
    expect(isTimestampStale(undefined, 30000)).toBe(true);
  });

  it("returns false for a fresh timestamp", () => {
    expect(isTimestampStale(new Date().toISOString(), 30000)).toBe(false);
  });

  it("returns true for an aged timestamp", () => {
    const oldTime = new Date(Date.now() - 60000).toISOString();
    expect(isTimestampStale(oldTime, 30000)).toBe(true);
  });
});

describe("shouldSkipFetchForTimestamp", () => {
  const config: StaleTimeConfig = { staleTimeMs: 30000 };

  it("skips when the list fetch time is still fresh (even with zero items)", () => {
    expect(shouldSkipFetchForTimestamp(new Date().toISOString(), config)).toBe(
      true
    );
  });

  it("does not skip when the list fetch time has aged out", () => {
    const oldTime = new Date(Date.now() - 60000).toISOString();
    expect(shouldSkipFetchForTimestamp(oldTime, config)).toBe(false);
  });

  it("does not skip when the list was never fetched", () => {
    expect(shouldSkipFetchForTimestamp(undefined, config)).toBe(false);
  });
});

describe("shouldSkipFetch", () => {
  const config: StaleTimeConfig = { staleTimeMs: 30000 };

  it("skips the fetch when cached data is still fresh", () => {
    const freshItem: CollectionItem<{ id: string }> = {
      id: "1",
      lastFetched: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      data: { id: "1" },
      queryKeys: [],
      fetchedCount: 1,
    };

    expect(shouldSkipFetch(freshItem, config)).toBe(true);
  });

  it("does not skip the fetch when cached data is stale", () => {
    const oldTime = new Date(Date.now() - 60000).toISOString();
    const staleItem: CollectionItem<{ id: string }> = {
      id: "1",
      lastFetched: oldTime,
      updatedAt: oldTime,
      data: { id: "1" },
      queryKeys: [],
      fetchedCount: 1,
    };

    expect(shouldSkipFetch(staleItem, config)).toBe(false);
  });

  it("does not skip the fetch when there is no cached item", () => {
    // Dedupe timing no longer suppresses fetches — the trailing-window queue
    // owns request coalescing, so only genuine freshness skips a fetch.
    expect(shouldSkipFetch(undefined, config)).toBe(false);
  });
});
