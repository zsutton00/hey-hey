---
id: 42839587-1ffb-4c3f-ae18-a542dd8353bf
slug: grow-shared-understanding
title: Grow your project's shared understanding
parentId: e39a7dfd-9a36-466e-848a-23d9082404ea
ordering: 6
demos: []
---

As work progresses, your project becomes more than a feature tree and a list of tasks. It becomes a record of what you are building, how the pieces relate, and why important decisions were made.

Different kinds of information belong in different places:

- **Features** describe the capabilities the product delivers.
- **Tasks** describe the implementation work.
- **Design documents** preserve decisions that guide one or more pieces of work.
- **Diagrams** make structures, systems, and flows easier to understand.
- **Contracts** record deliberately guaranteed behavior at important boundaries.
- **Relationships** connect work across different branches of the project.

You do not need every kind of artifact for every change. A small, obvious change may need only a task. A new workflow may deserve a design document and diagram. An API or event carrying an intentional promise relied upon elsewhere may deserve a Contract.

Add structure when it preserves information that future teammates or agents would otherwise need to rediscover.

For example, a feature may be implemented by several tasks, governed by a design document, depend on a capability elsewhere in the tree, and provide a Contract consumed by another service. Recording those connections helps future conversations begin with the right context.

Hey Hey can help maintain this structure while you work. When an agent finds a missing requirement, a relevant design, previous work, or a consequential relationship, it can propose the appropriate update instead of leaving the discovery buried in a conversation.

**Try it:** Look at the work you just created and ask, "What would someone need to know six months from now to change this safely?"

**You're done when:** Important intent and dependencies have a durable home without making routine work unnecessarily complicated.
