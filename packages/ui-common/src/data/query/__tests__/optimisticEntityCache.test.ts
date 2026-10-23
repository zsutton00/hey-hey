import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  cancelEntityReads,
  changeCachedEntity,
} from "../optimisticEntityCache";
const scope = { lists: ["items", "list"], details: ["items", "detail"] };
const listKey = [...scope.lists, "project"];
const detailKey = [...scope.details, "first"];
const first = { id: "first", name: "First" };
const second = { id: "second", name: "Second" };
describe("optimistic entity cache", () => {
  it.each(["update", "remove"] as const)(
    "rolls back %s without losing a concurrent change to another entity or list order",
    (operation) => {
      const client = new QueryClient();
      client.setQueryData(listKey, [first, second]);
      client.setQueryData(detailKey, first);
      const rollback = changeCachedEntity<{ id: string; name: string }>(
        client,
        scope,
        "first",
        (item) => (operation === "remove" ? null : { ...item, name: "Changed" })
      );
      changeCachedEntity<{ id: string; name: string }>(
        client,
        scope,
        "second",
        (item) => ({ ...item, name: "Concurrent" })
      );
      rollback();
      expect(client.getQueryData(listKey)).toEqual([
        first,
        { ...second, name: "Concurrent" },
      ]);
      expect(client.getQueryData(detailKey)).toEqual(first);
      client.clear();
    }
  );
  it.each(["update", "remove"] as const)(
    "preserves a newer successful %s of the same entity when an earlier edit fails",
    (operation) => {
      const client = new QueryClient();
      client.setQueryData(listKey, [first, second]);
      client.setQueryData(detailKey, first);
      const rollback = changeCachedEntity<typeof first>(
        client, scope, first.id,
        (item) => ({ ...item, name: "Earlier optimistic edit" })
      );
      const successful = { ...first, name: "Newer saved edit" };
      changeCachedEntity<typeof first>(
        client, scope, first.id,
        () => operation === "remove" ? null : successful
      );
      rollback();
      expect(client.getQueryData(listKey)).toEqual(
        operation === "remove" ? [second] : [successful, second]
      );
      expect(client.getQueryData(detailKey)).toEqual(
        operation === "remove" ? null : successful
      );
      client.clear();
    }
  );
  it("does not restore a failed removal over newly fetched data", () => {
    const client = new QueryClient();
    client.setQueryData(listKey, [first, second]);
    client.setQueryData(detailKey, first);
    const rollback = changeCachedEntity<typeof first>(client, scope, first.id, () => null);
    const refreshed = { ...first, name: "Refreshed" };
    client.setQueryData(listKey, [refreshed, second]);
    client.setQueryData(detailKey, refreshed);
    rollback();
    expect(client.getQueryData(listKey)).toEqual([refreshed, second]);
    expect(client.getQueryData(detailKey)).toEqual(refreshed);
    client.clear();
  });
  it("preserves a newer saved edit even when its values match the earlier optimistic edit", () => {
    const client = new QueryClient();
    client.setQueryData(listKey, [first]);
    client.setQueryData(detailKey, first);
    const updated = { ...first, name: "Saved" };
    const rollback = changeCachedEntity<typeof first>(client, scope, first.id, () => updated);
    changeCachedEntity<typeof first>(client, scope, first.id, () => ({ ...updated }));
    rollback();
    expect(client.getQueryData(listKey)).toEqual([updated]);
    expect(client.getQueryData(detailKey)).toEqual(updated);
    client.clear();
  });
  it("cancels only the changed entity and lists containing it", async () => {
    const client = new QueryClient();
    client.setQueryData(listKey, [first]);
    const unrelatedKey = [...scope.lists, "other"];
    const relatedKey = [...scope.lists, "related"];
    client.setQueryData(unrelatedKey, [second]);
    client.setQueryData(relatedKey, [first, second]);
    let unrelatedSignal: AbortSignal | undefined;
    let relatedSignal: AbortSignal | undefined;
    let finishUnrelated!: (value: { id: string; name: string }[]) => void;
    const unrelatedRead = client.fetchQuery({
      queryKey: unrelatedKey,
      queryFn: ({ signal }) => {
        unrelatedSignal = signal;
        return new Promise<{ id: string; name: string }[]>((resolve) => {
          finishUnrelated = resolve;
        });
      },
    });
    const relatedRead = client.fetchQuery({
      queryKey: relatedKey,
      queryFn: ({ signal }) => {
        relatedSignal = signal;
        return new Promise<{ id: string; name: string }[]>(() => {});
      },
    });
    void relatedRead.catch(() => {});
    await cancelEntityReads(client, scope, "first", detailKey);
    expect(relatedSignal?.aborted).toBe(true);
    expect(unrelatedSignal?.aborted).toBe(false);
    finishUnrelated([second]);
    await unrelatedRead;
    client.clear();
  });
});
