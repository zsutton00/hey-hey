---
id: 10000000-0000-4000-8000-000000000016
slug: create-a-service
title: Add your first service
parentId: null
ordering: 3
demos:
  - id: 20000000-0000-4000-8000-000000000002
    kind: preset
    ordering: 1
    caption: "Add a service to point Hey Hey at a codebase — give it a name and a type. You'll connect it to a folder on your machine later, when you start an agent session."
    presetKey: create-a-service
---
A service is the unit of work Hey Hey is pointed at: most often a codebase, with a type, language, and framework, though the concept is broader than code. It's usually the first thing you set up in a new project — before any code is written, you decide what you're working against, so a service can start as just a name and a type. Tasks, design docs, and agent sessions are all scoped to a service, which is how the platform organizes work by codebase ownership. The directory on disk where the code actually lives is bound later, during agent-session setup, so creating a service here is a lightweight first step, not a registration of an existing repository.
