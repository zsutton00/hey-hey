# Hey Hey CLI

Hey Hey is a shared place for you and your team to shape a project and build it together. Features, designs, mockups, decisions and tasks live in one workspace and stay connected as the project changes. Coding agents work from the same context you do.

This repository is the command-line tool, `heyhey`. It runs on your machine and connects your Hey Hey project to the coding agents you already use, such as Claude Code, so they start from the project's context instead of a blank prompt. Hey Hey keeps the plans, decisions and session history in the project.

The CLI is a Node.js and TypeScript program with a terminal interface built on Ink. It reaches Hey Hey through the API and shares code with the web app through UI Common.

## The rest of Hey Hey

- **UI**: the web app.
- **UI Common**: shared components, hooks and the API client used by the UI and the CLI.
- **API**: project data, business rules and the events the other services consume.
- **Graph service**: relationships between the things in a project.
- **Embeddings Service**: search by meaning across project content.
- **CLI** (this repository): connects the project to the coding agents you already use.

## Using Hey Hey

Hey Hey is hosted at [heyhey.dev](https://heyhey.dev).

## License

AGPL-3.0. Issues are welcome; we aren't accepting pull requests at this time.
