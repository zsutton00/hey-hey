# Hey Hey UI Common

Hey Hey is a shared place for you and your team to shape a project and build it together. Features, designs, mockups, decisions and tasks live in one workspace and stay connected as the project changes. Coding agents work from the same context you do.

This repository is the code the web app and the CLI share, so the two present the project the same way. It holds React components, hooks, the client for the Hey Hey API, and translations. It has no app of its own; it is a library the other two build on.

It is a TypeScript package using React and MUI, with data fetching through TanStack Query.

## The rest of Hey Hey

- **UI**: the web app.
- **UI Common** (this repository): shared components, hooks and the API client used by the UI and the CLI.
- **API**: project data, business rules and the events the other services consume.
- **Graph service**: relationships between the things in a project.
- **Embeddings Service**: search by meaning across project content.
- **CLI**: connects the project to the coding agents you already use.

## Using Hey Hey

Hey Hey is hosted at [heyhey.dev](https://heyhey.dev).

## License

AGPL-3.0. Issues are welcome; we aren't accepting pull requests at this time.
