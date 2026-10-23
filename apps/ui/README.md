# Hey Hey UI

Hey Hey is a shared place for you and your team to shape a project and build it together. Features, designs, mockups, decisions and tasks live in one workspace and stay connected as the project changes. Coding agents work from the same context you do.

This repository is the web app: the part of Hey Hey that people actually work in. You browse and edit the project's features and documents, review changes agents propose, talk through work in conversations, and watch agent sessions as they run.

It is a React and TypeScript single-page app built with Vite and MUI. It talks only to the Hey Hey API, and it gets its shared components, hooks and API client from UI Common.

## The rest of Hey Hey

- **UI** (this repository): the web app.
- **UI Common**: shared components, hooks and the API client used by the UI and the CLI.
- **API**: project data, business rules and the events the other services consume.
- **Graph service**: relationships between the things in a project.
- **Embeddings Service**: search by meaning across project content.
- **CLI**: connects the project to the coding agents you already use.

## Using Hey Hey

Hey Hey is hosted at [heyhey.dev](https://heyhey.dev).

## License

AGPL-3.0. Issues are welcome; we aren't accepting pull requests at this time.
