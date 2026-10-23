# Query Key Refactor Plan

This document captures the concrete, actionable steps to wire the new
`QueryKey` subclasses into the data layer. It assumes the `QueryKey` classes
already exist in `src/data/collections/*.ts` and that `null` is serialized in
`QueryKey.toKey()`.

Core concept:
- `QueryKeyField` affects `toKey()` but does not affect `getId()`.
- `DataVariantQueryKeyField` affects `toKey()` and also affects `getId()`.
- Data variants are only the fields that change the *payload* of a single item
  (e.g. include counts, include messages, include section keys).

## 1) Core data layer changes

These changes make `QueryKey` objects the primary inputs, while internal maps
continue to key by the string from `queryKey.toKey()`.

### `src/data/core/types.ts`
- Update `fetcher` signatures to accept `QueryKey` objects instead of strings.
  - Example: `fetcher: (queryKey: QueryKey) => Promise<FetcherResponse<T>>`
- Update action types or payloads that currently take `queryKey: string` to
  accept `queryKey: QueryKey` at the call sites, but store `queryKey.toKey()` in
  state maps.

### `src/data/core/useQuery.ts`
- Accept `queryKey: QueryKey` as the required input.
- Derive `const queryKeyString = queryKey.toKey()` and use it for:
  - request de-duping
  - stale/loading/error/fetched maps
  - list/single query maps
- Pass the `QueryKey` object to `fetcher` (not the string).

### `src/data/core/createCollection.ts`
- Change the internal reducer/actions so maps remain keyed by the string
  `queryKey.toKey()`, but do not accept string query keys from the outside.
- When writing single items, use `queryKey.getId(item.id)` to avoid collisions
  between different data variants.
- When storing queryKeys on items, store `queryKey.toKey()` (string).

### `src/data/core/CollectionMap.ts`
- Update `get(id, queryKey)` and `getByStorageId` to require a `QueryKey`.
- Use `queryKey.getId(id)` for item lookup.
- Do not accept raw string keys in public methods.

### Supporting core utilities
- `src/data/core/asyncActions.ts`, `fetchUtils.ts`, `loadingStates.ts`,
  `staleTime.ts`:
  - Keep internal maps keyed by `queryKey.toKey()`.
  - If any APIs accept raw `queryKey: string`, switch to `QueryKey` at the
    boundary and immediately derive `queryKeyString`.

## 2) Collection refactor pattern

Apply to each collection:
- `fetcher` signature takes a `QueryKey` object.
- Replace string prefix checks with `instanceof` checks against the `QueryKey`
  subclasses for that collection.
- Replace `parse*QueryKey` or positional parsing with direct field access on
  the `QueryKey` instance.
- `listScopes` returns an array of `QueryKey` objects, not strings.
- When returning single items (or parsed items), use `queryKey.getId(id)` for
  storage keys if the payload can vary.

### Accessing fields
If the `QueryKey` classes don’t expose fields, add a method:
- `getFields(): F` or individual accessors
so collection fetchers can access typed values without parsing strings.

## 3) Hook refactor pattern

Apply to each hook:
- Replace `build*QueryKey(...)` calls with `*QueryKey.fromFields(...)`.
- Pass explicit `null` for all optional/variant fields.
- Remove `DISABLED_QUERY_KEY` string constants; replace with a "noop" typed
  key like `ServicesQueryKey.fromFields({ organizationId: "__noop__", ... })`.
- Pass the `QueryKey` object directly into `useQuery`.
- Any direct collection access (like `collection.get(id, queryKey)`) must use
  the same `QueryKey` object instance (or one with the same `toKey()`).

## 4) Per-collection wiring checklist

This section lists the precise wiring changes for each collection.

### Artifacts (`src/data/collections/artifacts.ts`)
- Use `ArtifactQueryKey` and `ArtifactsQueryKey`.
- Remove `queryKey.startsWith("artifact:")` and `queryKey.split(":")` logic.
- Fetcher branches on `instanceof ArtifactQueryKey` vs `ArtifactsQueryKey`.
- `ArtifactsQueryKey` fields:
  - identity: `organizationId`, `projectId`
  - list-only: `type`, `status`, `sourceType`, `sourceId`, `tags`, `category`,
    `parentId`, `publicOnly` (no payload variance).

### Attention Events (`src/data/collections/attentionEvents.ts`)
- Use `AttentionEventsQueryKey` only.
- Treat `limit`, `offset`, `sort`, `includeEntity`, `since` as list-only.

### Coding Prompts (`src/data/collections/codingPrompts.ts`)
- Use `CodingPromptQueryKey` for single, `CodingPromptsQueryKey` for list.
- Treat `codingSessionId`, `acceptedBy` as list-only.

### Coding Sessions (`src/data/collections/codingSessions.ts`)
- Use `CodingSessionQueryKey` for single, `CodingSessionsQueryKey` for list.
- Treat `userId`, `conversationId`, `initiativeId`, `taskId`, `designDocId` as
  list-only.

### Conversations (`src/data/collections/conversations.ts`)
- Use `ConversationQueryKey`, `ConversationsQueryKey`, `WorkflowConversationsQueryKey`.
- Payload-variant fields:
  - `includeSuggestionDecisions` (single + list)
  - `includeMessages` (list)
- List-only fields:
  - `workflowName`, `search`, `workflowAboutId`, `workflowAboutType`, `statuses`
  - `sortBy`, `sortOrder`, `status`, `page`, `limit` for workflow list

### Design Docs (`src/data/collections/designDocs.ts`)
- Use `DesignDocQueryKey` (single) and `DesignDocsQueryKey` (list).
- Payload-variant fields:
  - `includeSectionKeys`
- List-only fields:
  - `status`, `projectId`, `tags`, `page`, `limit`

### Design Doc Links (`src/data/collections/designDocLinks.ts`)
- Use `DesignDocLinksQueryKey`.
- Payload-variant fields:
  - `includeDetails`
- Identity/list-only fields:
  - `type`, `designDocId`, `initiativeId`, `taskId`

### Edit History (`src/data/collections/editHistory.ts`)
- Use `EditHistoryQueryKey`.
- Payload-variant fields:
  - `entityType` (initiative vs task)

### Implementation Hints (`src/data/collections/implementationHints.ts`)
- Use `ImplementationHintQueryKey` (single) and `ImplementationHintsQueryKey` (list).
- List-only fields:
  - `serviceId`, `codingSessionId`, `codingPromptId`
- Drop legacy positional `serviceId` in parsing (already agreed).

### Initiatives (`src/data/collections/initiatives.ts`)
- Use `InitiativeQueryKey` (single) and `InitiativesQueryKey` (list).
- Payload-variant fields:
  - `includeDesignDocCounts` (single + list)
  - `includeSectionKeys` (list)
- List-only fields:
  - `projectId`, `conversationId`, `status`

### Integrations (`src/data/collections/integrations.ts`)
- Use `IntegrationQueryKey` (single) and `IntegrationsQueryKey` (list).
- List-only fields:
  - `type`, `state`, `connectionStatus`, `page`, `limit`, `sortBy`, `sortOrder`

### Messages (`src/data/collections/messages.ts`)
- Use `MessageQueryKey` (single only).

### Plan Steps (`src/data/collections/planSteps.ts`)
- Use `PlanStepsQueryKey`.
- Payload-variant fields:
  - `includeEntities`

### Plans (`src/data/collections/plans.ts`)
- Use `PlanQueryKey` (single).
- Payload-variant fields:
  - `includeConversations`

### Project Counts (`src/data/collections/projectCounts.ts`)
- Use `ProjectCountsQueryKey` (single only).

### Projects (`src/data/collections/projects.ts`)
- Use `ProjectQueryKey` (single) and `ProjectsQueryKey` (list).
- Update `createProjectQueryAtoms` to key by `queryKey.toKey()` or take
  `QueryKey` and derive the string internally.

### Services (`src/data/collections/services.ts`)
- Use `ServiceQueryKey` (single) and `ServicesQueryKey` (list).
- List-only fields:
  - `projectId`, `status`

### Tasks (`src/data/collections/tasks.ts`)
- Use `TaskQueryKey` (single only).

### Topology Category Summaries (`src/data/collections/topologyCategorySummaries.ts`)
- Use `TopologyCategorySummariesQueryKey` (list).
- List-only fields: `category`

### Topology Entity Summaries (`src/data/collections/topologyEntitySummaries.ts`)
- Use `TopologyEntitySummariesQueryKey` (list).
- List-only fields: `category`, `subfacetId`, `since`, `limitPerSubfacet`

### Topology Subfacets (`src/data/collections/topologySubfacets.ts`)
- Use `TopologySubfacetsQueryKey` (list).
- List-only fields: `category`, `status`

### Users (`src/data/collections/users.ts`)
- Use `UsersQueryKey` (list only).

### User Workflows (`src/data/collections/workflowExecutions.ts`)
- Use `UserWorkflowsQueryKey` (list only).
- List-only fields: `limit`, `nextPageToken`, `workflowType`, `sourceConversationId`

### Work Items (`src/data/collections/workItems.ts`)
- Use:
  - `WorkItemInitiativeQueryKey` (single initiative)
  - `WorkItemTaskQueryKey` (single task)
  - `WorkItemsInitiativesQueryKey` (list)
  - `WorkItemsTasksQueryKey` (list)
  - `TaskHierarchyQueryKey`
- Payload-variant fields:
  - `includeSectionKeys` (list)
  - `includeDesignDocCounts`, `includeCodingSessionCounts` (task hierarchy)
- List-only fields:
  - `projectId`, `conversationId`, `status`, `parentTaskId`
- Task list requires `initiativeId` (already agreed).

## 5) Hook updates (by area)

### Replace string builders with typed keys
- `build*QueryKey` → `*QueryKey.fromFields(...)`
- Pass explicit `null` for absent variant fields.

### Replace disabled keys
- Replace `DISABLED_QUERY_KEY` string usage with a typed "noop" key:
  `CollectionQueryKey.fromFields({ organizationId: "__noop__", ... })`

### Use typed keys everywhere
- `useQuery({ queryKey })` expects `QueryKey`, not string.
- For `collection.get(id, queryKey)`, always pass the matching `QueryKey`.

## 6) Test migration

### General
- Replace string query key expectations with:
  - `queryKey` is instance of `*QueryKey` and/or
  - `queryKey.toKey()` matches expected serialization
- Remove mocks of `build*QueryKey`. If needed, mock `*QueryKey.fromFields` or
  assert on `useQuery` args.

### QueryKey tracking tests
- When asserting `item.queryKeys`, expect `queryKey.toKey()` strings.
- Where multiple queries track the same item, ensure variant fields are only
  present when payload changes.

## 7) Cleanup phase

- Delete legacy string builders/parsers once usage is gone.
- Update documentation (`src/data/USAGE.md`) to reflect typed QueryKey usage.
- Remove any compatibility shims; no wrappers around `QueryKey`.

## 8) Execution order (recommended)

1. Core refactor (`QueryKey` object support in `useQuery`, `createCollection`, maps).
2. Update collections in batches (start with low-risk: users, projectCounts, tasks).
3. Update hooks for those collections.
4. Expand to complex collections (workItems, conversations, designDocs).
5. Migrate tests, then remove old string builders/parsers.
