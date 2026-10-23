# Query Objects vs Query Keys

## Problem
The current implementation blends request construction with collection state. Query keys are used both as identifiers and as implicit definitions of what to fetch. That mixes concerns and makes it harder to reason about fetching logic vs cached data.

## Proposed Change
Treat query keys as full **Query objects**, not just strings. In this model, a Query object encapsulates:

- The params (filters, ids, scopes)
- The request/fetch function that matches those params
- A stable identity for caching (the previous "key" can be derived when needed)

In other words: drop the idea that the key is the primary artifact. The Query object *is* the primary artifact.

## Why This Helps
- **Separation of concerns**: collections store data + query metadata; requests live in Query objects.
- **Clarity**: query definition and request logic are explicit and colocated.
- **Evolution**: adding params or changing fetch behavior is localized to the Query object.
- **Type safety**: a Query object can enforce shape and intent more clearly than a string key.

## Practical Notes
- A string key can still be derived from the Query object when needed for caching or indexing.
- Existing APIs that take keys can be migrated to accept Query objects first, then map to keys internally.
- Tests can assert behavior at the Query object level (params + fetch), not just key formatting.

## Exploratory Note: DataVariant Fields and Invariants
Some DataVariant query params only toggle specific fields. For example, a query with
`includeConversation=true` shares all fields with the `false` variant except
`conversations`. That suggests a potential optimization: store the invariant portion
once and manage variant-specific fields separately. If Queries are first-class objects,
they can explicitly declare which fields are variant-dependent vs invariant, enabling:

- More efficient caching (avoid duplicating invariant data across variants).
- Clearer invalidation rules (changes to invariant fields update all variants).
- Simpler merge logic (variant-specific data overlays onto a shared base).

This is exploratory, but the Query object model makes it much easier to represent and
evolve this distinction.

## Summary
Query keys already behave like structured objects. Making that explicit by promoting them to Query objects simplifies the design, removes hidden coupling, and makes the codebase easier to evolve.
