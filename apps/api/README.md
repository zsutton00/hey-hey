# Hey Hey API

Hey Hey is a shared place for you and your team to shape a project and build it together. Features, designs, mockups, decisions and tasks live in one workspace and stay connected as the project changes. Coding agents work from the same context you do.

This repository is the core of Hey Hey. It owns the project data and the rules around it, and it is the one backend the web app and the CLI talk to. The other services never face users directly; the API coordinates them.

It is a NestJS service backed by PostgreSQL through Prisma. Longer-running work, such as generating plans or summarizing conversations, runs as Temporal workflows on a separate worker process. It also exposes an MCP server, so coding agents can read and update the project through the same rules as everything else.

## How it fits with the other services

When something in a project changes, the API records an event in an outbox and publishes it from there. The Graph service and the Embeddings Service ingest those events to keep their own views of the project up to date. They are derived from what the API publishes; the API remains the source of truth. When the web app or CLI needs a relationship query or a search, the request goes through the API, which asks those services on their behalf.

## The rest of Hey Hey

- **UI**: the web app.
- **UI Common**: shared components, hooks and the API client used by the UI and the CLI.
- **API** (this repository): project data, business rules and the events the other services consume.
- **Graph service**: relationships between the things in a project.
- **Embeddings Service**: search by meaning across project content.
- **CLI**: connects the project to the coding agents you already use.

## Using Hey Hey

Hey Hey is hosted at [heyhey.dev](https://heyhey.dev).

## License

AGPL-3.0. Issues are welcome; we aren't accepting pull requests at this time.
