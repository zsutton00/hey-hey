---
id: 10000000-0000-4000-8000-000000000011
slug: restart-and-replay-behavior
title: Restart and replay behavior
parentId: 10000000-0000-4000-8000-000000000001
ordering: 10
demos: []
---
Restarting Agent Bridge does not reopen an authorization. The CLI keeps controller state, grants, revocations, and consumed authorization identifiers in durable local state, protected by the operating-system credential store and an integrity check. A consumed identifier remains unavailable through restart, and an expired or already-used assertion needs a new browser approval. If durable state cannot be loaded or verified, the CLI fails closed until the exact local machine can be repaired or re-enrolled.
