import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchQueue, FETCH_COALESCING_WINDOW_MS } from "../fetchQueue";
import { QueryKey, QueryKeyField } from "../QueryKey";

type TestQueryFields = {
  key: QueryKeyField<string>;
};

class TestQueryKey extends QueryKey<TestQueryFields> {
  constructor(key: string) {
    super({ key: new QueryKeyField("key", key) });
  }
}

const key = (value: string) => new TestQueryKey(value);

describe("createFetchQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits the fixed window before fetching an idle key", async () => {
    const queue = createFetchQueue<number>(FETCH_COALESCING_WINDOW_MS);
    const runFetch = vi.fn().mockResolvedValue(1);

    const promise = queue.enqueue(key("a"), runFetch);

    await vi.advanceTimersByTimeAsync(FETCH_COALESCING_WINDOW_MS - 1);
    expect(runFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runFetch).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toBe(1);
  });

  it("coalesces simultaneous mounts with a measured 50 ms latency", async () => {
    const queue = createFetchQueue<number>(FETCH_COALESCING_WINDOW_MS);
    const runFetch = vi.fn().mockResolvedValue(7);

    const promises = Array.from({ length: 10 }, () =>
      queue.enqueue(key("a"), runFetch)
    );

    await vi.advanceTimersByTimeAsync(FETCH_COALESCING_WINDOW_MS);

    // Before: one request at ~0 ms. After: one request at 50 ms. Request count
    // stays at one while the measured cold-read latency increases by 50 ms.
    expect(runFetch).toHaveBeenCalledTimes(1);
    for (const promise of promises) {
      await expect(promise).resolves.toBe(7);
    }
  });

  it("coalesces a burst of idle-key invalidations into one request trace", async () => {
    const queue = createFetchQueue<number>(FETCH_COALESCING_WINDOW_MS);
    const requestTrace: number[] = [];
    const runFetch = vi.fn(async () => {
      requestTrace.push(Date.now());
      return 1;
    });

    vi.setSystemTime(0);
    const first = queue.enqueue(key("a"), runFetch);
    await vi.advanceTimersByTimeAsync(20);
    const second = queue.enqueue(key("a"), runFetch);
    await vi.advanceTimersByTimeAsync(29);
    const third = queue.enqueue(key("a"), runFetch);

    expect(requestTrace).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    // Before: requests at ~0, 20, and 49 ms after each completed idle cycle.
    // After: one request at 50 ms, reducing this trace from three requests to
    // one with 1-50 ms of added latency across the three demand points.
    expect(requestTrace).toEqual([FETCH_COALESCING_WINDOW_MS]);
    await expect(Promise.all([first, second, third])).resolves.toEqual([
      1, 1, 1,
    ]);
  });

  it("delays a follow-up cycle by the same fixed window", async () => {
    const queue = createFetchQueue<number>(100);
    let inFlight = 0;
    let maxConcurrent = 0;
    let resolveFirst!: () => void;

    const firstFetch = vi.fn(() => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      return new Promise<number>((resolve) => {
        resolveFirst = () => {
          inFlight -= 1;
          resolve(1);
        };
      });
    });
    const secondFetch = vi.fn(() => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      inFlight -= 1;
      return Promise.resolve(2);
    });

    const first = queue.enqueue(key("a"), firstFetch);
    await vi.advanceTimersByTimeAsync(100);
    expect(firstFetch).toHaveBeenCalledTimes(1);

    // Request lands while the first fetch is still in flight: it must NOT be
    // satisfied by the already-running fetch.
    const second = queue.enqueue(key("a"), secondFetch);
    expect(secondFetch).not.toHaveBeenCalled();

    resolveFirst();
    await expect(first).resolves.toBe(1);

    // The follow-up cycle waits the same fixed window before fetching.
    await vi.advanceTimersByTimeAsync(99);
    expect(secondFetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe(2);
    expect(secondFetch).toHaveBeenCalledTimes(1);

    // Never two concurrent in-flight fetches for one key.
    expect(maxConcurrent).toBe(1);
  });

  it("fetches different keys independently", async () => {
    const queue = createFetchQueue<string>(1000);
    const fetchA = vi.fn().mockResolvedValue("a");
    const fetchB = vi.fn().mockResolvedValue("b");

    const promiseA = queue.enqueue(key("a"), fetchA);
    const promiseB = queue.enqueue(key("b"), fetchB);

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promiseA).resolves.toBe("a");
    await expect(promiseB).resolves.toBe("b");
    expect(fetchA).toHaveBeenCalledTimes(1);
    expect(fetchB).toHaveBeenCalledTimes(1);
  });

  it("rejects every awaiting caller when the fetch fails", async () => {
    const queue = createFetchQueue<number>(1000);
    const runFetch = vi.fn().mockRejectedValue(new Error("boom"));

    const first = queue.enqueue(key("a"), runFetch);
    const second = queue.enqueue(key("a"), runFetch);
    const firstSettled = expect(first).rejects.toThrow("boom");
    const secondSettled = expect(second).rejects.toThrow("boom");

    await vi.advanceTimersByTimeAsync(1000);
    await firstSettled;
    await secondSettled;
    expect(runFetch).toHaveBeenCalledTimes(1);
  });

  it("reset() cancels pending windows", async () => {
    const queue = createFetchQueue<number>(1000);
    const runFetch = vi.fn().mockResolvedValue(1);

    void queue.enqueue(key("a"), runFetch);
    queue.reset();

    await vi.advanceTimersByTimeAsync(2000);
    expect(runFetch).not.toHaveBeenCalled();
  });
});
