import type { QueryClient, QueryKey } from "@tanstack/react-query";

export interface EntityCacheScope {
  lists: QueryKey;
  details: QueryKey;
}

const entityWrites = new WeakMap<object, Map<string, symbol>>();

function claimEntityWrite(client: QueryClient, key: QueryKey, id: string) {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  if (!query) return null;
  let writes = entityWrites.get(query);
  if (!writes) {
    writes = new Map();
    entityWrites.set(query, writes);
  }
  const previous = writes.get(id);
  const token = Symbol();
  writes.set(id, token);
  return {
    isCurrent: () => writes.get(id) === token,
    release: () => {
      if (previous) writes.set(id, previous);
      else writes.delete(id);
    },
  };
}

/** These prefixes contain only list and detail query results respectively. */
export function changeCachedEntity<T extends { id: string }>(
  client: QueryClient,
  scope: EntityCacheScope,
  id: string,
  change: (entity: T) => T | null
): () => void {
  const lists = client.getQueriesData<T[]>({ queryKey: scope.lists });
  const details = client.getQueriesData<T | null>({ queryKey: scope.details });
  const ownership = new Map<QueryKey, ReturnType<typeof claimEntityWrite>>();
  for (const [key, items] of lists) {
    if (!items?.some((item) => item.id === id)) continue;
    ownership.set(key, claimEntityWrite(client, key, id));
    client.setQueryData<T[]>(
      key,
      items.flatMap((item) => {
        if (item.id !== id) return [item];
        const next = change(item);
        return next ? [next] : [];
      })
    );
  }
  for (const [key, item] of details) {
    if (item?.id === id) {
      ownership.set(key, claimEntityWrite(client, key, id));
      client.setQueryData(key, change(item));
    }
  }
  // Capture the stored references after TanStack's structural sharing, rather
  // than the objects returned by change. Other entities may change independently.
  const appliedLists = new Map(
    lists.map(([key]) => [
      key,
      client.getQueryData<T[]>(key)?.find((item) => item.id === id),
    ])
  );
  const appliedDetails = new Map(
    details.map(([key]) => [key, client.getQueryData<T | null>(key)])
  );
  let rolledBack = false;
  return () => {
    if (rolledBack) return;
    rolledBack = true;
    for (const [key, items] of lists) {
      if (!ownership.get(key)?.isCurrent()) continue;
      const previous = items?.find((item) => item.id === id);
      if (!previous) continue;
      client.setQueryData<T[]>(key, (current) => {
        if (!current) return current;
        if (current.find((item) => item.id === id) !== appliedLists.get(key)) {
          return current;
        }
        if (!current.some((item) => item.id === id)) {
          const restored = [...current];
          restored.splice(
            Math.min(
              items?.findIndex((item) => item.id === id) ?? current.length,
              current.length
            ),
            0,
            previous
          );
          return restored;
        }
        return current.map((item) => (item.id === id ? previous : item));
      });
    }
    for (const [key, item] of details) {
      if (!ownership.get(key)?.isCurrent()) continue;
      if (item?.id === id) {
        client.setQueryData<T | null>(key, (current) =>
          current === appliedDetails.get(key) ? item : current
        );
      }
    }
    for (const write of ownership.values()) {
      if (write?.isCurrent()) write.release();
    }
  };
}

export function replaceListEntity<T extends { id: string }>(
  client: QueryClient,
  key: QueryKey,
  id: string,
  replacement: T | null
): void {
  client.setQueryData<T[]>(key, (items) =>
    items?.flatMap((item) =>
      item.id === id ? (replacement ? [replacement] : []) : [item]
    )
  );
}

/** Cancel just the detail and already-loaded lists containing this entity. */
export async function cancelEntityReads<T extends { id: string }>(
  client: QueryClient,
  scope: EntityCacheScope,
  id: string,
  detailKey: QueryKey
): Promise<void> {
  const keys = client
    .getQueriesData<T[]>({ queryKey: scope.lists })
    .filter(([, items]) => items?.some((item) => item.id === id))
    .map(([key]) => key);
  await Promise.all(
    [detailKey, ...keys].map((queryKey) =>
      client.cancelQueries({ queryKey, exact: true })
    )
  );
}
