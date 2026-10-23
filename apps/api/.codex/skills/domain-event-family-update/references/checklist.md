## How to add a new domain event family

Use this checklist when introducing a new set of domain events (for example, `foo.created`, `foo.updated`). Adapt names and paths as needed.

1) OpenAPI contract
- Add branded IDs to `../openapi/specs/schemas/common.yaml` (for example, `FooId` with `x-typescript-type` and `x-brand`).
- In `../openapi/specs/schemas/events.yaml`, add:
  - A union for the new family (for example, `FooEvents` with `oneOf` members).
  - An envelope schema (for example, `FooEventEnvelope` with `aggregateId`, `payload`, and related fields).
  - Snapshot or payload components if needed (for example, `FooSnapshot`).
  - Concrete event schemas (`foo.created`, `foo.updated`, `foo.deleted`) including `ExecutionContext` in payload.
- Add the new union to the `DomainEvents` `oneOf` list in `../openapi/specs/api/openapi.yaml`.
- Regenerate models with `pnpm run generate:api`.

2) Core event typing
- Add event type constants to `src/core/events/types/event.types.ts` (for example, `FOO: { CREATED, UPDATED, DELETED }`) and include new types in `ServiceEventType`.
- Import generated event models and extend unions and type guards in `src/core/events/types/domain-events.ts` (add `FooEvents` and `isFoo...` helpers).
- If outbox typing is used, add the new event in `src/core/events/outbox-event.types.ts`.
- Update ID extraction helpers (for example, `src/core/events/utils/event-id.util.ts`) so routing and logging can derive `projectId` and `conversationId` from the new payload shape.

3) Service emission
- In the relevant domain service, inject `DomainEventPublisher` and publish events on create, update, and delete.
- Build payloads that satisfy `ExecutionContext` (include `organizationId`, `projectId`, and related fields); fetch related entities if needed to populate `projectId`.
- For transactional mutations, use `publishInTransaction` so event persistence is atomic with the write.

4) Event listeners
- If the event should be handled in-process, register a handler in `src/core/processing/core-processor.service.ts` via `setupEventListeners`.
- The `EventRouter` subscribes on first registration.

5) Optional realtime bridge
- If the event should be broadcast over websockets, map it in `src/core/websockets/websocket-bridge.service.ts`.
- Ensure the router subscribes to the new type; `EventRouter` auto-subscribes once the type constant is registered.

6) Tests
- Add or extend unit tests to assert publisher calls with correct event types and payloads.
- Add schema, type guard, and ID extraction coverage for the new family when applicable.

7) Regenerate and verify
- After schema changes, rerun `pnpm run generate:api` (do not edit `src/generated` manually).
- Run targeted tests (for example, `pnpm jest <service>`).
- Run `pnpm tsc --noEmit`.
