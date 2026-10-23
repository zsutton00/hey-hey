---
id: 11bdf6b3-1441-428a-955d-e9362b18e4bc
slug: shape-feature-tree
title: Shape your feature tree
parentId: e39a7dfd-9a36-466e-848a-23d9082404ea
ordering: 2
demos: []
---

Features describe **what your product delivers**. Tasks describe **how that capability is implemented**.

The highest levels of your feature tree should be product concepts that a user of the product can recognize: Account Management, Reporting, Team Collaboration, Billing, or Search. As you move down the tree, features become narrower and more specific, but they should still describe delivered capabilities.

For example:

- Reporting
  - Activity Reporting
    - Searchable Activity

Compare that with:

- Reporting
  - Build Activity API
  - Add database indexes

The first tree describes the product at increasing levels of specificity. The second mixes product structure with implementation work. Building an API or adding an index may be necessary, but those belong in tasks beneath the capability they implement.

A useful test is to ask:

- Would a user of the product recognize this as a capability or outcome? It is probably a feature.
- Does it primarily describe code to write, infrastructure to configure, or a technical action to perform? It is probably a task.

The feature level also influences where supporting material belongs. A design document should live near the feature whose decisions it governs. A diagram should be attached at the level whose structure or behavior it explains. Broad artifacts belong higher in the tree; focused implementation designs belong closer to the relevant leaf feature or task.

You do not need to determine that placement alone. Start a conversation from the relevant feature and explain what the artifact covers. Hey Hey can inspect the surrounding hierarchy and related work, then help you decide whether the artifact belongs on the current feature, one of its descendants, or a concrete implementation task.

Add detail when it helps people make decisions, organize work, or preserve an important distinction.

**Try it:** Find one feature and ask whether each child describes a narrower capability or an implementation action. Move implementation work into tasks.

**You're done when:** The branch reads as a hierarchy of delivered capabilities, with implementation captured separately.
