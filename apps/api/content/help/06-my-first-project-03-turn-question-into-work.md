---
id: 367d1a1f-612a-4310-b616-90da0930ca7b
slug: turn-question-into-work
title: Turn a question into work
parentId: e39a7dfd-9a36-466e-848a-23d9082404ea
ordering: 3
demos: []
---

You do not need a finished specification before starting a useful conversation.

Open the feature you want to improve and describe the outcome, constraint, or problem in plain language. Because the conversation begins from that feature, Hey Hey can use its requirements, design decisions, related work, and position in the project while helping you think.

For example, imagine your project has a Team Invitations feature:

> When a new teammate accepts an invitation, they should join the correct workspace and see who invited them. Help me define the expected behavior and the work needed to support it.

This gives the agent a concrete outcome without prescribing the implementation. Hey Hey can inspect previous tasks, proposals, designs, and relationships around Team Invitations. That history may explain when an existing behavior was introduced, why it works the way it does, and what other parts of the product depend on it.

The conversation can then help determine whether the feature needs clarification, whether a design decision is missing, and which implementation tasks are required. The result might include:

- A proposed update to the feature's requirements.
- A design document for an unresolved product or technical decision.
- One or more tasks describing the implementation work.
- Connections to related features or existing work elsewhere in the project.

These changes are proposed for review. You remain responsible for deciding whether they accurately reflect the product and whether the work should proceed.

## Additional work-item types

As the conversation develops, Hey Hey may suggest a more specialized kind of record. A defect may belong in a Bug. A durable engineering expectation may belong in a Standard. A customer insight may belong in a Research Finding.

A Contract records one deliberately guaranteed promise at a concrete boundary, such as what another system can rely on when it calls an operation or consumes an event. Contracts should not be inferred merely because two parts of the project interact. They are useful when the promise itself is intentional, durable, and important enough that breaking it should be surfaced.

You do not need to choose the work-item type before beginning the conversation. The agent can help identify the appropriate shape from the evidence it finds.

This is the smallest complete Hey Hey workflow: begin with product intent, discuss it in context, record the conclusion, and produce executable work.

**Try it:** Open a feature where you already want a specific change. State who needs it, what should become possible, and any constraint you already know.

**You're done when:** The intended product behavior is clear and the implementation work needed to deliver it has been proposed for review.
