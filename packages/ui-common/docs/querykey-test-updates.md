# Services QueryKey Migration (Collection + Hook + Tests)

This document shows the end-to-end migration steps using `services` as the
example: collection updates, hook updates, and test updates.

## Context for a fresh session

Goal: replace ad-hoc string query keys with typed, field-derived `QueryKey`
subclasses that encode data variants and prevent list/single collisions. No
string factories or compatibility wrappers.

Constraints:
- `fromFields` uses required fields only; explicit `null` represents "unset".
- Optional sort is supported via `DataVariantQueryKeyField`.
- `QueryKey.toKey()` is stable; `getId(entityId)` incorporates data variants.
- `CollectionMap.get(id, queryKey)` and `getByStorageId` are the new access paths.
- Invalidation must target all variants (safe over-invalidation is OK).

Checklist:
1) Update core QueryKey types to allow `null` in field values.
2) Update `createCollection` and `useQuery` to accept QueryKey objects.
3) Add per-collection `*QueryKey` subclasses (list + single variants).
4) Migrate hooks to use `fromFields(...)` with explicit `null`s.
5) Run a bulk test rewrite script; fix the remaining failures.

Discovery note: inventory all existing string query key builders/parsers and map
each to a typed field set with explicit data-variant fields.

## Before/after example (services)

```ts
// Before (string factories, brittle variants)
// src/data/collections/services.ts
const queryKey = buildServicesQueryKey(organizationId, filters);
// ...later
const item = serviceCollection.get(serviceId, queryKey);
```

```ts
// After (typed, field-derived QueryKey)
// src/data/collections/services.ts
import {
  QueryKey,
  QueryKeyField,
  DataVariantQueryKeyField,
} from "../core/QueryKey";

type ServiceQueryFields = {
  organizationId: QueryKeyField<string>;
  serviceId: QueryKeyField<string>;
  includeMessages: DataVariantQueryKeyField<boolean>;
};

export class ServiceQueryKey extends QueryKey<ServiceQueryFields> {
  static fromFields(fields: {
    organizationId: string;
    serviceId: string;
    includeMessages: boolean;
  }) {
    return new ServiceQueryKey({
      organizationId: new QueryKeyField("organizationId", fields.organizationId),
      serviceId: new QueryKeyField("serviceId", fields.serviceId),
      includeMessages: new DataVariantQueryKeyField(
        "includeMessages",
        fields.includeMessages
      ),
    });
  }
}

type ServicesQueryFields = {
  organizationId: QueryKeyField<string>;
  projectId: DataVariantQueryKeyField<string | null>;
  status: DataVariantQueryKeyField<"ACTIVE" | "ARCHIVED" | "DEPRECATED" | null>;
  sort: DataVariantQueryKeyField<"name" | "updatedAt" | null>;
};

export class ServicesQueryKey extends QueryKey<ServicesQueryFields> {
  static fromFields(fields: {
    organizationId: string;
    projectId: string | null;
    status: "ACTIVE" | "ARCHIVED" | "DEPRECATED" | null;
    sort: "name" | "updatedAt" | null;
  }) {
    return new ServicesQueryKey({
      organizationId: new QueryKeyField("organizationId", fields.organizationId),
      projectId: new DataVariantQueryKeyField("projectId", fields.projectId),
      status: new DataVariantQueryKeyField("status", fields.status),
      sort: new DataVariantQueryKeyField("sort", fields.sort),
    });
  }
}
```

```ts
// src/data/hooks/useServices.ts
const queryKey = ServicesQueryKey.fromFields({
  organizationId,
  projectId: filters.projectId ?? null,
  status: filters.status ?? null,
  sort: filters.sort ?? null,
});

useQuery({
  collection: serviceCollection,
  queryKey,
});

// Single-item access uses the variant-aware storage id
const singleKey = ServiceQueryKey.fromFields({
  organizationId,
  serviceId,
  includeMessages: false,
});

const item = serviceCollection.get(serviceId, singleKey);
// internally uses singleKey.getId(serviceId) so variants don’t collide
```

## 1) Collection changes (services)

- Remove string factories:
  - Delete `buildServicesQueryKey`, `buildServiceQueryKey`, and their parsing helpers.
  - Stop relying on prefixes like `services:` and `service:`.
- Add typed QueryKey subclasses for list and single variants.
  - `ServicesQueryKey` should include all data-variant fields as
    `DataVariantQueryKeyField` (e.g., `projectId`, `status`, optional `sort`).
  - `ServiceQueryKey` should include data variants that change the single item
    payload (e.g., `includeMessages` if applicable).
  - Use `fromFields` with required fields only and explicit `null` for "unset".
- Update the collection `fetcher` to accept a `QueryKey` instance instead of a string.
  - Replace `queryKey.startsWith(...)` branching with `instanceof` checks on
    `ServiceQueryKey` / `ServicesQueryKey`.
  - Extract typed values from the QueryKey instance (via fields or accessor).
  - Use `queryKey.getId(id)` for storage keys when needed.

## 2) Hook changes (useServices)

- Replace the string constant `DISABLED_QUERY_KEY`.
  - Use a `ServicesQueryKey.fromFields({ organizationId: "__noop__", ... })`
    or a dedicated "noop" builder if standardized.
- Replace string key building with typed keys:
  - `buildServicesQueryKey(...)` → `ServicesQueryKey.fromFields(...)`.
  - Use explicit `null` for absent `projectId` and `status`.
- Pass the `QueryKey` instance into `useQuery`.
  - `queryKey` should be a `ServicesQueryKey`, not a string.

## 3) Test changes (useServices.test.tsx)

- Replace `buildServicesQueryKey` mocks with `ServicesQueryKey`.
  - Remove `buildServicesQueryKeyMock` and its `vi.hoisted` block.
  - Update `vi.mock("../../collections/services", ...)` to export
    `ServicesQueryKey` (and any required atoms).
- Update expectations that currently assert string keys.
  - `queryKey: "services:__noop__"` becomes a `ServicesQueryKey` instance.
  - Use explicit `null` in `fromFields` (no optionals).
- Replace factory-call expectations:
  - `expect(buildServicesQueryKeyMock).toHaveBeenCalledWith(...)` becomes
    `expect(ServicesQueryKey.fromFields).toHaveBeenCalledWith(...)` if mocked.
  - Or assert on `useQuery` call args:
    - `queryKey` is a `ServicesQueryKey`
    - `queryKey.toKey()` matches expected serialization.

## Example rewrites (tests)

- Filters test:
  - Before: `expect(buildServicesQueryKeyMock).toHaveBeenCalledWith("org-1", { projectId: "project-1", status: undefined })`
  - After: `expect(ServicesQueryKey.fromFields).toHaveBeenCalledWith({ organizationId: "org-1", projectId: "project-1", status: null, sort: null })`

- Missing org test:
  - Before: `queryKey: "services:__noop__"`
  - After: `queryKey: ServicesQueryKey.fromFields({ organizationId: "__noop__", projectId: null, status: null, sort: null })`
