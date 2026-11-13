# Changelog

## v1.3.0

### Reviews and approvals

- Added project approval rules with reviewable conditions, approval counts, and explanations of the rule applied to each proposal.
- Added separate settings for project rules and built-in rules, with changes saved together after confirmation.
- Fixed approval settings failing to refresh and rules becoming unusable after a work-item type was retired.
- Fixed grouped proposals bypassing reserved-entity validation.

### Evaluations

- Added ordered, fixed user messages to Eval Cases so evaluations can exercise a conversation and judge its final turn.
- Added editing and reviewing individual Eval Case inputs and viewing the messages saved with an evaluation run.
- Updated existing Eval Case requests to migrate to the new input format.

### Previews and navigation

- Added larger previews of recent reports on the project overview.
- Added before-and-after mockup comparisons and highlighted changed screens and transitions in UX-flow reviews.
- Updated UX-flow layouts to start from the designated starting screen.
- Added a Sessions navigation link and nested child sessions beneath their parent session.
- Fixed expanded task previews to close with Escape and allow page scrolling.
- Fixed mention-preview card text becoming unreadable in dark mode.

### Local setup

- Added automatic download and checksum verification of the local search model during setup, removing the need to configure a model directory.

### Agent conversations

- Added question rounds with a separate answer for each question.
- Updated automated notices to appear distinctly from agent replies.
- Fixed session-start loading flashes and isolated failures when rendering a session's latest message.
- Updated CLI startup failures to report their cause.

### Upgrade and availability

- Updated database migrations for approval policies, Eval Case inputs, and UX-flow starting screens. Apply the release's Flyway migrations before starting the updated API.
- Updated the CLI source. Install a published CLI with `npm install -g @hey-hey/cli`; its release manifest identifies the selected container images.
- Source and artifact publication do not establish that the hosted application has been upgraded.

## v1.2.1

### Fixes

- Fixed running the CLI from a worktree rejecting sessions whose Service uses another checkout.
- Fixed CLI version bumps rejecting an already verified image manifest during packaging and release.
- Fixed local workspace sessions failing to recover through passkey sign-in.
- Fixed local web setup competing for port 3000 by using port 3850 for the web app.
- Fixed machine live-update subscriptions being rejected when only some requested projects were accessible.
- Fixed interrupted event delivery leaving outbox work claimed indefinitely by adding expiring claims.
- Fixed verification views losing the started session state when returning to the page.
- Fixed invalid Plans becoming difficult to manage, missing plan configuration, and database types used when adopting tasks.
- Fixed reviewed plan approval errors hiding the rule that failed.
- Fixed workflow descriptions selecting the wrong section.
- Fixed feature verification overlooking unresolved planning findings.
- Updated CLI startup and runtime diagnostics to include failure causes and development attempt logs to identify the agent session.

### Plans and previews

- Added creating a reviewed Plan from existing tasks, with task adoption applied together on approval.
- Updated implementation plans to explain intended behavior changes and group stages and design documents more clearly.
- Added UX flow previews as screen journeys and direct navigation to flows containing a single screen.

### Local setup

- Removed the project limit for local installations.
- Added a lower-cost model preselection to local welcome setup.

### Release artifacts

- Fixed release-branch builds to publish Linux AMD64 and ARM64 images and a complete CLI image manifest.
- Updated local setup documentation. Install the published CLI with `npm install -g @hey-hey/cli`; its release manifest pins the matching images.

## v1.2.0

### Local setup and graph search

- Added the graph search service, a local graph and vector-embedding store that runs memory-efficiently on your machine. Local installs need it to run.
- Added single-passkey local pairing. Setup works by name only and opens the browser with access already granted.
- Added a choice of pairing duration, including until revoked.
- Implemented local onboarding through the coding agent you already use.
- Added a local passkey login for the local app.
- Added a local source development mode.
- Added account passkey enrollment and enforcement at sign-in.
- Updated project access checks to run once per request and before every search.

### Search and context

- Added exact-match search mode.
- Added matching paragraphs to search results. This is hosted-only and relies on multivector search.
- Added a lightweight lookup of an item's title, status and type, to reduce token cost for title lookups.
- Added a cap and grouping by relationship to related items in context.
- Removed Jev context gathering and conflict judgments.
- Updated work-item creation to require a prior search.
- Fixed archived items appearing in agent context.
- Fixed graph search accepting searches without current project access.
- Fixed graph search allowing deletion of platform-owned edges.

### Evaluations

- Added naming and renaming of evaluation runs.
- Added repeated runs of a case, with results for each repeat.
- Implemented isolated workspaces for coding evals, and saved the diff the judge reviewed.
- Added each attempt's tool calls, provider sessions and full session transcripts.
- Fixed eval attempts reading items connected to their own case through search or context.

### Reports and uncertainties

- Added structured uncertainties that agents can raise. Reports show them separately from open questions.
- Added a project report history page and API.
- Added usage to feature sync reports.
- Improved report text readability.

### Proposals and diagrams

- Implemented carrying relationships over when one item replaces another.
- Added explicit transition roles to diagrams, and laid out journeys by those roles.
- Added opening a UX flow from a Mockup screen, and showing a Mockup's flow under it.
- Updated Mockup proposals to lead with the screen.
- Fixed validation and approval of Mockup work items.

### Plans

- Fixed plan stages not completing when their tasks are superseded.
- Fixed plan views showing the wrong task statuses.
- Fixed tasks created from a plan leaving that plan.

### Agents and sessions

- Added grouped permission requests on one card.
- Fixed a monitored run waiting forever on an unanswered permission prompt.
- Added review and correction of session hints, and retrieval of hints by the session that wrote them.
- Added changed files to entity conversations.
- Added filters, and the names of connected items, to the hints admin page.
- Added the terminal title being set while a run is in progress.

### Releases and infrastructure

- Implemented CLI releases that publish with a pinned image manifest.
- Updated the shared database to PostgreSQL 17.
- Updated image builds to run from any branch.
- Added a comparison of work-item type overrides with their canonical definitions.

### Fixes

- Fixed retries of an applied change set so they skip checkpoints that already completed.
- Fixed grouped feature updates conflicting with themselves.
- Fixed reply composers not clearing after a reply is sent.
- Added an empty state for empty feature requirements.
- Fixed chart labels being clipped.
- Fixed local handoff tokens being exchanged more than once.

## v1.1.0

### Future revisions and proposal review

- Added reviewing changes ahead of implementation, with completion conditions and applying the reviewed result when ready.
- Added full Diagram graphs, elements, references and layout to future revisions.
- Added ready-to-apply revisions on Project Overview, and completion and verification offers that show the full change.
- Added an Updates tab on Plans, clearer readiness stages and linked-work navigation.
- Added three-way conflict review with manual or agent-assisted resolution. Saving a resolution updates the same proposal or future.
- Updated authoring to use futures for knowledge changes delivered by a Plan. Task execution proposes ordinary updates, and conversations ask whether a change goes live now or when the work ships.
- Fixed false overlap conflicts, inconsistent readiness decisions, grouped approval errors and Diagram publication failures.
- Fixed comparisons that treated equivalent stored values as changes.
- Fixed retries re-running completed change-set operations, which could overwrite newer user edits.
- Fixed unreadable requirements comparisons, missing specialized previews, hidden proposal identity and broken conversation navigation.
- Fixed premature graph-loading errors. Updated proposals now resurface when a turn completes.

### UX flows

- Added linking multiple Mockups into one flow that documents each screen transition and the action that triggers it.
- Added reviewing a flow together with newly proposed screens, with per-screen annotations and approval or rejection.
- Added rendering of proposed and saved flows as screen journeys, using each screen's declared size, with a full-size view.
- Fixed same-group screen references, missing previews, incorrect screen sizing and misleading approval controls.
- Fixed fulfillment warnings that treated screens as implementation steps.

### Implementation planning

- Updated planning to iterate conversationally over complete Markdown plan versions, with explicit approval of the exact version to implement.
- Added saving a plan with its complete discrepancy list, shown beneath the plan, with remediations deferred until you choose.
- Fixed approvals and replies lost after a refresh, forgotten model selections and stalls after a provider switch.
- Fixed deferred planning tools being unavailable, and turns that finished without a saved plan.

### Hints

- Replaced Service-scoped implementation hints with project-scoped graph hints that connect to several items with weighted connections.
- Added agents retrieving hints for their focused work and retiring obsolete ones.
- Added a Project Admin hints list with full text, connected items and strengths.

### Agent evaluations

- Updated evaluations to run named real handlers with the same preparation as ordinary sessions, with an independent Project Assistant on/off choice.
- Updated attempts to run as inert sessions, with grading material kept out of evaluated agents' search and graph reads.
- Added per-case results, attempt conversations, retained outputs, execution details, target and judge provider-session IDs, and per-attempt costs.
- Added settled token usage by cache category.
- Fixed missing Eval navigation, rejected valid model configurations, invalid attempt conversations, stalled execution and opening evidence starting a run.

### Demo workspace

- Added setup progress and recovery after a refresh, retry on failure, and readiness checks covering all copied Feature connections.
- Updated the demo notice to a smaller bottom banner and sent ready visitors to the project's Welcome page.
- Fixed clone failures from operational identifiers and orphan session conversations, and wrong clone event identity.
- Fixed demo logout and real sign-in state interfering with normal browser use and CLI pairing.

### Dialogs

- Added a shared dialog shell with minimizing. Supported dialogs keep drafts, selections, attachments and review context across in-app navigation.

### Navigation and interface

- Fixed Open Items selection when removing other items, sessions jumping out of their parent branch, and hover previews opening late or sticking.
- Updated session labels to use conversation titles and parent names.
- Fixed iPhone Safari layout and touch targets, desktop type-navigation overflow, wasted width in expanded previews and compact Discuss selectors.
- Fixed previous-turn tool calls flashing at follow-up startup, and restored file links from changed-file diffs to the configured editor.
- Fixed attachment chips sitting away from message authors.
- Added annotation comments shown beside their targets by default, and moved the annotation toolbar.
- Updated activity chart colors and Welcome step actions for clarity.
- Updated Usage and Costs views to load only the routing session.

### Agent behavior and work-item tools

- Added default session roles to Agent Modes, and type-owned guidance for implementation, research, planning and review, replacing standalone semantic guidance.
- Fixed Agent Mode and refiner conversations switching to a generic coding agent after the first turn.
- Fixed missing changed-file reporting in Agent Mode sessions.
- Updated review to be read-only and judge delivery against governing Feature requirements and Contracts.
- Updated agents to honor explicit edit instructions within admitted scope without repeated permission requests.
- Added registered and custom work-item type keys to context and full-entity reads, and Message and Conversation context seeds.
- Updated agents to set any status the type allows, and removed the batch `edit_tasks` tool.
- Fixed clearing assignees, archive mutation results and endlessly retried workspace input without a Service.
- Added terminal and startup failure reasons in conversations, and distinguished cancellation from provider errors.

### Authorization and pairing

- Updated direct commands and protected reads to bind to the exact inputs you approved.
- Added scoped credentials on Embeddings diagnostics, and a current-project-access check before private retrieval.
- Updated search to apply project scope before ranking and pagination.
- Fixed Agent fix startup by binding the selected machine before launch.
- Fixed adding a controller removing the browser's eligibility on previously paired machines.
- Added clearer authorization-mismatch diagnostics.

### Repository import

- Added a post-import conversation that enriches reviewed Features with confirmed intent.
- Fixed reviewed candidates being rejected by CLI validation, and handoffs being treated as unanswered prompts.
- Updated repository analysis so Feature descriptions explain the capability and its boundaries.

### Project Assistant and context

- Added a Jev setting that controls every CLI use of Jev.
- Added paragraph-level relevance excerpts that keep canonical identities and full-entity access.
- Added narrowing of a loaded neighborhood to the request, falling back to the original context if judgment fails.
- Added saved provider input, gathering requests, answers and traces for diagnosis.

### Reports

- Updated report evidence to be read as shards outside the prompt, with every page required before submission.
- Added saved creation-time usage and a usage bar on terminal reports.
- Updated change-walkthrough hierarchy and source links.

### Search

- Added matching passage spans and source text to search and unified search.
- Updated Feature requirements to index as readable text instead of raw JSON.
