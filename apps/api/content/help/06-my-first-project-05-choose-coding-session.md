---
id: dc290473-9d7a-43be-ae2b-e23370114a01
slug: choose-coding-session
title: Choose how the coding agent should work
parentId: e39a7dfd-9a36-466e-848a-23d9082404ea
ordering: 5
demos: []
---

When you launch a coding session, you choose how the agent should approach the task. The right option depends on how well-defined the work is and what kind of help you need.

## Work

**With Plan + Project Assistant** first researches the task's project context, then examines the relevant code and produces a reviewable implementation plan. Use it for substantial work when requirements, designs, previous decisions, or related features may affect the implementation and you want to approve the approach before proceeding.

**With Project Assistant** researches the surrounding project context and then begins an open, collaborative coding session. Use it when you want the agent to understand the larger product picture but expect the direction to develop through conversation.

**Task Only** starts from the selected task and your instructions without the Project Assistant research pass or a structured planning phase. Use it when the task already contains everything the agent needs and the desired change is precise.

A project-level plan and **With Plan + Project Assistant** are different things. A project-level plan organizes a larger delivery into a design, stages, and tasks. The coding option determines how the agent approaches one selected task.

## Debug

**Debug** is a collaborative investigation mode. Give the agent the symptoms, clues, experiments, and constraints you already know, then guide it as the evidence develops. The goal is to keep the investigation focused on the reported behavior rather than sending the agent into an open-ended search through the entire system.

**Research** runs the Project Assistant research phase without continuing into a normal coding session. It is useful when you want to inspect what Hey Hey understands about a task, what related project context it finds, and whether that context is suitable before deciding what to do next.

## Split

**Split by Function** decomposes work into focused tasks based on distinct responsibilities or functional areas.

**Split by Service** separates work that belongs in different codebases or services.

Hey Hey shows only the options compatible with the selected type of work. It does not automatically switch between them: your selection tells the agent what kind of session you want.

**Try it:** Before launching, decide whether the task needs project research, a reviewable coding plan, collaborative investigation, immediate execution, or decomposition.

**You're done when:** The selected option matches both the uncertainty of the task and the way you want to participate.
