# CLI Development Guidelines

## Event Pipeline

```
provider → raw_events → normalizer → dispatcher → effects
```

Single normalization layer (`provider-event-normalization.ts`) produces canonical typed events. Nothing downstream may re-normalize, re-extract, or re-interpret raw fields — if the dispatcher or a handler needs data, add it to the normalizer's output. Handlers run side effects on typed data; they never parse raw events. Validate websocket/external payloads with zod before trusting their shape.

## Session / Run / Turn

Full ownership lives in the types; these are the invariants that are easy to break and invisible in a signature:

- **promptType belongs to the Turn**, not the Session or Run — it arrives with each trigger.
- **A Turn is immutable** once constructed and holds no reference to its Run. Run is the scheduler: it resolves Turn inputs, constructs the Turn, drains the queue on completion.
- **The provider session is Run-lived** — anything configured at session start must stay valid for the whole Run.
- **The submission-tool registry entry is mutable per Turn; the Run-scoped token is not.**
- When the workflow service is in play, the **server is authoritative about prompts**.

## External Data Assumptions (the rule code can't teach)

This CLI coordinates across systems it doesn't own — the platform API, the workflow service, SDK providers, the websocket layer. Every assumption about the shape, identity, ordering, or relationships of external data is a liability until verified. If "is X always true?" can't be answered from a spec, a typed contract, or a representative log, the honest answer is "I don't know" — instrument or check, don't encode a guess.

Real assumptions that each became an outage:

- "A trigger's `parentMessageId` always points to the most recent user message."
- "Every USER message has a non-null `parentMessageId`."
- "Only one message in a conversation has a null `parentMessageId`."
- "Two messages with the same `comment` text are the same logical message."
- "If a `triggersAgent` field is present, its payload is fully populated."
- "The `recentUserReplies` window derives from `createdAt` ordering plus a USER-type filter."

None were guarantees from the producing system. Push verification to the boundary (zod, OpenAPI-derived types, shape checks) before downstream code relies on it. A name on a field is not proof; one example session is not proof.
