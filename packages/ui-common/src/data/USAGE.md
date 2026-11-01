# Data Layer Usage Guide

The Data Layer is the front-end database for the web UI. Components read
entities through hooks such as `useServices`, `useWorkItem` or
`useConversation`; the layer behind those hooks owns fetching, caching,
realtime synchronization and invalidation. Every read runs on TanStack Query v5
through the single `QueryClient` the app mounts.

## Reading data

Call the hook. Hooks share one read per key, keep cached data visible while
they refresh, and stay current without any wiring at the call site.

```tsx
import { useServices } from "@hey-hey/ui-common/data";

const { services, isLoading, isReady, error } = useServices(organizationId, {
  projectId,
});
```

Every hook returns the same shape (`DataHookReturn` / `DataCollectionHookReturn`
in `core/types.ts`):

| Field        | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `data`       | The current result, or `null` / `[]` before a successful read        |
| `isLoading`  | A first read is in flight and there is nothing to show yet           |
| `isFetching` | Any read is in flight, including background refreshes                |
| `isFetched`  | A read has settled at least once                                     |
| `isReady`    | Safe to render data or an empty state: a read succeeded              |
| `error`      | Only set by an explicit failed read                                  |
| `isStale`    | The cached data is past its stale time                               |
| `refetch`    | Reads again now                                                      |
| `markStale`  | Invalidates this read; mounted consumers read again                  |

An unstarted or pending read is never an error, and "empty" means a successful
read returned nothing. Data past `maxCacheAgeMs` stays visible but is reported
as stale and fetching while its replacement is read.

### Hook options

Hooks accept `CollectionHookOptions` (`core/types.ts`):

- `enabled` — set `false` to skip the read until its inputs exist.
- `refetchOnMount` — read each time this hook mounts, even when cached data is
  fresh. Use it for a page's own entity, never for shared catalogs. Fetch
  policy belongs to the query: there is no provider that changes it for a
  subtree.
- `refetchOnWindowFocus` — read on resume even when fresh.
- `staleTimeMs` — override the five-minute default stale time.
- `maxCacheAgeMs` — re-read data older than this, keeping it visible but
  reported as stale and fetching until the read settles.

## Freshness

Data stays current through invalidation, not by re-reading on every mount:

- **Mounts** read only when the cache is empty or stale. Consumers mounting
  while a read is in flight join it.
- **Resume**: a mounted query re-reads when the page becomes visible again,
  if it is stale (`query/queryPolicy.ts`).
- **Realtime events** invalidate the affected key prefixes through
  `WebSocketHandler` (`websockets/handler.ts`). Where an event carries the full
  value, the handler writes it into the cache instead.
- **Reconnects** invalidate every Data Layer root
  (`invalidateAllDataLayerQueries`); only mounted queries re-read.
- **Mutations** update the cache optimistically where the hook supports it and
  invalidate what the change affects, including relationship-driven targets
  declared in `relationships/`.

An invalidation that arrives while a read is in flight always produces a later
read (`query/invalidateWithFollowUpRead.ts`), so a response from before the
change never stands. A 4xx response is a cached answer for the stale time and
is not retried.

## Adding a dataset

1. In `collections/<dataset>.ts`, add a key factory with one canonical key per
   dataset, nested under a root so prefixes can be invalidated:

   ```ts
   export const serviceKeys = {
     root: () => ["services"] as const,
     all: (organizationId: string) => ["services", organizationId] as const,
     list: (organizationId: string, filters: ServicesFilters = {}) =>
       [...serviceKeys.all(organizationId), "list", filters] as const,
   };
   ```

   Derive subsets of the same data with `select`, not a second key.

2. Add query options that spread `dataLayerQueryPolicy` and forward the
   request initiator and abort signal:

   ```ts
   export function servicesQueryOptions(organizationId: string, filters = {}) {
     return queryOptions({
       ...dataLayerQueryPolicy,
       queryKey: serviceKeys.list(organizationId, filters),
       queryFn: ({ signal }) =>
         fetchServices(organizationId, filters, {
           ...captureRequestOptions(),
           signal,
         }),
     });
   }
   ```

3. Write the hook in `hooks/` over `useDataLayerQuery`, which applies the hook
   options and returns the shared state shape:

   ```ts
   const { result, state } = useDataLayerQuery(queryOptions, {
     enabled: isEnabled,
     refetchOnMount,
     refetchOnWindowFocus,
     staleTimeMs,
     maxCacheAgeMs,
   });
   return { ...state, services: result.data ?? [], data: result.data ?? [] };
   ```

4. Register the root in `dataLayerQueryRoots` (`query/dataLayerInvalidation.ts`)
   so reconnects refresh it, and map the realtime events that change it to its
   key prefixes in `websockets/handler.ts`.

## Testing

Render hooks inside a `QueryClientProvider` with a fresh `QueryClient` per
test. To exercise realtime behavior, build a handler on the same client:

```ts
const queryClient = new QueryClient();
const handler = new WebSocketHandler(createStore(), undefined, queryClient);
handler.handleEvent(event);
```

`WebSocketHandler` requires the `QueryClient`; realtime events reach the cache
only through it.

## Correlated Activity Client API

Use `useCorrelatedActivity` to read paginated correlated activity data for
dropdowns and full activity pages.

```tsx
import { useCorrelatedActivity } from "@hey-hey/ui-common/data";
import { ActivityCorrelationActivityType } from "@hey-hey/ui-common/api";

const { records, pagination, isLoading, error } = useCorrelatedActivity(
  "org-1",
  {
    activityType: [ActivityCorrelationActivityType.Notification],
    limit: 25,
    offset: 0,
    view: "dropdown", // "dropdown" | "full"
    staleTimeMs: 15000,
  }
);
```

- Records are mapped to a stable UI model with `activityId`, `activityType`,
  `source`, `linkedEntities`, and preview variants.
- Duplicate entries are removed client-side and results are lightly
  prioritized for display.
- Transient upstream failures retry with backoff.
- You can plug in push-driven invalidation with `subscribeToUpdates`.
