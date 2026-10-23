---
name: domain-event-family-update
description: Add or update a domain event family end-to-end across OpenAPI schemas, generated event models, core event typing, service emission, listeners, websocket bridge mapping, and tests in this repository. Use when introducing or changing events like `foo.created`, `foo.updated`, and `foo.deleted`.
---

# Domain Event Family Update

## Invariant

Keep one event contract source of truth: OpenAPI schemas -> generated models -> domain event typing -> emitted payloads -> listeners/bridge handling. Do not patch drift with local type widening or placeholder payload fields.

## Workflow

1. State root cause before edits:
   Identify the invariant that must hold, what breaks it, and which caller owns required payload fields.
2. Update OpenAPI first:
   Edit `../openapi/specs/schemas/common.yaml` for branded IDs and `../openapi/specs/schemas/events.yaml` for family union, envelope, snapshots/payload components, and concrete event schemas.
3. Register the family in API OpenAPI:
   Add the new family union to `DomainEvents` in `../openapi/specs/api/openapi.yaml`.
4. Regenerate generated models:
   Run `pnpm run generate:api`.
5. Update core event typing:
   Add event type constants in `src/core/events/types/event.types.ts`, extend `ServiceEventType`, and update unions/type guards in `src/core/events/types/domain-events.ts`.
6. Update outbox and ID extraction paths:
   Add event types to `src/core/events/outbox-event.types.ts` when outbox typing is used and update `src/core/events/utils/event-id.util.ts` so routing/logging can derive required IDs from payload shape.
7. Update service emission:
   Inject `DomainEventPublisher` in domain services, publish create/update/delete events with payloads that satisfy `ExecutionContext`, and use `publishInTransaction` for transactional writes.
8. Register listeners and optional websocket bridge:
   Wire handlers in `src/core/processing/core-processor.service.ts`; map websocket broadcasts in `src/core/websockets/websocket-bridge.service.ts` when realtime fanout is required.
9. Update tests:
   Add or extend tests to validate emitted event type/payload shape and utility coverage (for example, ID extraction).
10. Verify:
    Run targeted Jest suites for touched areas and always run `pnpm tsc --noEmit`.

## Hard Rules

- Edit OpenAPI before implementation when payload shape changes.
- Keep emitted/request payloads exact to generated models; do not widen generated DTOs with intersections or casts.
- Fail fast on missing required fields; do not invent defaults.
- Treat cross-service shape mismatches as integration failures.
- Do not edit `src/generated` by hand.

## Quick Commands

- Regenerate API models:
  `pnpm run generate:api`
- Find impacted event typing and handlers:
  `rg -n "event\\.types|domain-events|outbox-event|event-id|DomainEventPublisher|setupEventListeners|websocket-bridge" src`
- Run targeted tests:
  `pnpm jest src/core/events src/core/processing src/core/websockets`
- Final typecheck:
  `pnpm tsc --noEmit`

## Reference

- Use `references/checklist.md` for domain-event-family additions and wiring (`*.created`, `*.updated`, `*.deleted`).
- Use `references/entity-changes.md` when event work also changes backing entity shape across Prisma, OpenAPI, generated models, services, controllers, and tests.
