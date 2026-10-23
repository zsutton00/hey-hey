import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import type { ReactNode } from "react";
import { createCollection } from "../createCollection";
import { QueryKey, QueryKeyField } from "../QueryKey";
import { useQuery } from "../useQuery";
import type { FetcherResponse } from "../types";

interface Item {
  id: string;
  name: string;
}
class Key extends QueryKey<{ scope: QueryKeyField<string> }> {
  constructor() {
    super({ scope: new QueryKeyField("scope", "resume") });
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const oldData = { id: "one", name: "Before" };
const newData = { id: "one", name: "After" };
function signals() {
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("resume"));
  window.dispatchEvent(new Event("pageshow"));
}
async function tick() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
}
function setup(collectionStaleTimeMs?: number, queryStaleTimeMs?: number) {
  const fetcher = vi
    .fn<() => Promise<FetcherResponse<Item>>>()
    .mockResolvedValue({ data: oldData, isArray: false });
  const collection = createCollection<Item>({ name: "resume-test", fetcher, staleTimeMs: collectionStaleTimeMs });
  const store = createStore();
  const key = new Key();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const useTestQuery = () =>
    useQuery({
      queryKey: key,
      state: useAtomValue(collection.stateAtom),
      dispatch: useSetAtom(collection.actionsAtom),
      staleTimeMs: queryStaleTimeMs,
    });
  const first = renderHook(useTestQuery, { wrapper });
  const second = renderHook(useTestQuery, { wrapper });
  return { fetcher, collection, store, key, first, second };
}
describe("resume recovery through the collection queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T00:00:00Z"));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    [undefined, undefined, 30_001, false],
    [undefined, undefined, 300_000, false],
    [undefined, undefined, 300_001, true],
    [60_000, undefined, 60_001, true],
    [60_000, 30_000, 30_001, true],
    [30_000, 300_000, 60_001, false],
  ] as const)("uses collection %s / query %s freshness at age %i", async (collectionAge, queryAge, age, refresh) => {
    const { fetcher, first, store, collection, key } = setup(collectionAge, queryAge);
    const general = setup();
    await tick();
    // Move wall time without running timers, like a suspended browser.
    const state = store.get(collection.stateAtom);
    const fetchedAt = state.items.getByStorageId(state.singleQueries.get(key.toKey())!)!.lastFetched;
    vi.setSystemTime(new Date(fetchedAt).getTime() + age);
    act(signals);
    expect(first.result.current.data).toEqual(oldData);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(refresh ? 2 : 1);
    expect(general.fetcher).toHaveBeenCalledTimes(age > 300_000 ? 2 : 1);
  });

  it("keeps default freshness passive and refreshes an aged ordinary read", async () => {
    const { fetcher, collection, store, key } = setup();
    await tick();
    await act(async () => { await vi.advanceTimersByTimeAsync(300_001); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    let read!: Promise<unknown>;
    act(() => { read = store.set(collection.actionsAtom, { type: "FETCH_QUERY", queryKey: key }); });
    await tick();
    await read;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])("uses five-minute freshness for ordinary reads including empty lists: %s", async (empty) => {
    const { fetcher, collection, store, key } = setup();
    fetcher.mockResolvedValue({ data: empty ? [] : [oldData], isArray: true });
    await tick();
    const fetchedAt = store.get(collection.stateAtom).listFetchTimes!.get(key.toKey())!;
    vi.setSystemTime(new Date(fetchedAt).getTime() + 300_000);
    await act(async () => { await store.set(collection.actionsAtom, { type: "FETCH_QUERY", queryKey: key }); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    let read!: Promise<unknown>;
    act(() => { read = store.set(collection.actionsAtom, { type: "FETCH_QUERY", queryKey: key }); });
    await tick();
    await read;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("recovers a transport gap inside freshness without hiding cached content", async () => {
    const { fetcher, collection, store, first } = setup();
    await tick();
    const pending = deferred<FetcherResponse<Item>>();
    fetcher.mockReturnValueOnce(pending.promise);
    act(() => { store.set(collection.actionsAtom, { type: "MARK_ALL_STALE" }); });
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toEqual(oldData);
    expect(first.result.current.isLoading).toBe(false);
    expect(first.result.current.isFetching).toBe(true);
    await act(async () => pending.resolve({ data: newData, isArray: false }));
    expect(first.result.current.data).toEqual(newData);
  });

  it("preserves a later recovery read when the first fetch has not returned any data yet", async () => {
    const { fetcher, collection, store, first } = setup();
    const pending = deferred<FetcherResponse<Item>>();
    fetcher.mockReturnValueOnce(pending.promise).mockResolvedValue({ data: newData, isArray: false });
    await tick();
    act(() => { store.set(collection.actionsAtom, { type: "MARK_ALL_STALE" }); });
    await act(async () => pending.resolve({ data: oldData, isArray: false }));
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(first.result.current.data).toEqual(newData);
  });

  it("coalesces shared-key consumers with different freshness overrides", async () => {
    const { fetcher, collection, store, key } = setup();
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
    renderHook(() => useQuery({ queryKey: key, state: useAtomValue(collection.stateAtom), dispatch: useSetAtom(collection.actionsAtom), staleTimeMs: 30_000 }), { wrapper });
    await tick();
    vi.setSystemTime(Date.now() + 30_001);
    act(signals);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("coalesces shared consumers and distinct signals through settlement, retaining cached data", async () => {
    const { fetcher, first, second } = setup();
    await tick();
    vi.setSystemTime(Date.now() + 300_001);
    const pending = deferred<FetcherResponse<Item>>();
    fetcher.mockReturnValueOnce(pending.promise);
    act(signals);
    expect(first.result.current.isFetching).toBe(true);
    expect(first.result.current.data).toEqual(oldData);
    await tick();
    act(signals);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => {
      pending.resolve({ data: newData, isArray: false });
    });
    await tick();
    expect(first.result.current.data).toEqual(newData);
    expect(second.result.current.data).toEqual(newData);
    expect(first.result.current.isFetching).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("exposes failure and retries on a later resume", async () => {
    const { fetcher, first } = setup();
    await tick();
    vi.setSystemTime(Date.now() + 300_001);
    const error = new Error("Offline");
    fetcher.mockRejectedValueOnce(error);
    act(signals);
    await tick();
    expect(first.result.current.error).toEqual(error);
    expect(first.result.current.isFetching).toBe(false);
    fetcher.mockResolvedValue({ data: newData, isArray: false });
    act(signals);
    await tick();
    expect(first.result.current.error).toBeNull();
    expect(first.result.current.data).toEqual(newData);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(["resume", "realtime"] as const)(
    "preserves a later read for mid-flight %s demand",
    async (reason) => {
      const { fetcher, first, store, collection, key } = setup();
      await tick();
      vi.setSystemTime(Date.now() + 300_001);
      const pending = deferred<FetcherResponse<Item>>();
      fetcher
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValue({ data: newData, isArray: false });
      if (reason === "resume")
        act(() => {
          void first.result.current.refetch();
        });
      else act(signals);
      await tick();
      if (reason === "resume") act(signals);
      else
        act(() => {
          void store.set(collection.actionsAtom, {
            type: "MARK_STALE",
            queryKey: key,
          });
        });
      await act(async () => {
        pending.resolve({ data: oldData, isArray: false });
      });
      await tick();
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(first.result.current.data).toEqual(newData);
    }
  );
});
