---
id: f0f98b0f-13bf-4859-a4c6-f010bba5fa5d
slug: ask-effectively
title: Ask Hey Hey effectively
parentId: e39a7dfd-9a36-466e-848a-23d9082404ea
ordering: 7
demos: []
---

You can always talk to Hey Hey in plain English. You do not need to learn a special command language before asking a useful question.

The amount of context you provide should match the request.

Use a direct or Quick Question when the request is self-contained, such as rewriting a paragraph, making a small change to a single file, or working with information you have already included in the prompt.

Use Ask with Context when the answer depends on your project. This lets Project Assistant research the relevant part of the graph before the main agent responds. It is the better choice when you are discussing:

- Feature requirements.
- Existing design decisions.
- Related or previous work.
- Dependencies between entities.
- Where new work belongs.
- Whether the project already covers an idea.

You can also reference specific project entities with slash commands. Plain language asks the agent to discover what you probably mean. Explicit references tell it exactly which feature, task, plan, service, or design document matters.

For example, "How does search work?" may require discovery. Referencing the specific Search feature makes the intended scope unambiguous.

Adding references requires a little extra effort from you to search for the entity or type its reference. That effort can make the resulting conversation faster and more precise, especially in a mature project with similar names or closely related areas.

Use `/skills` to access skills supplied by your native agent provider. Skills add specialized instructions or workflows for particular kinds of work. Native provider skills are currently available for Codex sessions.

A useful rule is:

- Start with plain English when the intended context is obvious.
- Add explicit references when precision matters.
- Use Ask with Context when the project's recorded knowledge should influence the answer.
- Use `/skills` when a specialized provider workflow fits the job.

**Try it:** Make one small, self-contained request directly. Then open a feature and ask a question whose answer depends on its requirements or previous work.

**You're done when:** You can intentionally choose between a quick request, a project-grounded conversation, and a specialized skill.

Your first successful cycle does not end when the code is written. Review what changed, update the product model when your understanding changed, and preserve decisions that future work will depend on.

Start with an initial map. Improve one feature. Turn intent into work. Choose the right execution path. Preserve what you learn. Repeat.
