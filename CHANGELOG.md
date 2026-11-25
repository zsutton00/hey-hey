# Changelog

## v1.5.1

### Local setup and repository import

- Added repository import in local Hey Hey using a provider connected through the CLI. Review and revise the proposed feature outline before approving it.
- Fixed local repository import so you can still approve the saved outline if a revision fails.
- Fixed local upgrades that encountered a migration older than one already installed.
- Removed the unavailable Plan option from local coding session setup.

### Coding sessions and Changes

- Fixed the branch and worktree picker layout in the Discuss dialog.
- Updated session details to show each service alongside the branch it used.
- Fixed grouping on the Changes page so filtered records appear only under matching branches or worktrees.

### Reviews and onboarding

- Fixed Task Monitors losing track of readiness reviews while they were still in progress.
- Fixed proposal review so an unreadable item no longer prevents other proposal cards from loading.
- Fixed newly started hosted onboarding conversations so the person who started them can open and resume them. Previously locked conversations remain affected.

### Getting the release

- CLI 4.6.1 is distributed through `npm install -g @hey-hey/cli@4.6.1`. For local use, `heyhey local` offers the matching set of application images. Hosted availability follows a separate deployment.

## v1.5.0

### Google Antigravity and Gemini

- Added Google Antigravity as a provider for chat and coding sessions. Choose Gemini models and thinking levels and run with your own Google sign-in and Gemini subscription through the Antigravity CLI (`agy`).
- Added multi-turn sessions with resume, cancel, plan mode, questions, and tool approvals. The session shows context, token usage and quota where Antigravity reports them.
- Added precise tool and file-change tracking for supported Antigravity tools when enabled. Antigravity sessions use the same workspace write restrictions as other coding providers.

### Agent sessions and Service workspaces

- Added a **Work in** picker for each Service. Use its current folder, pick an existing worktree or branch, or create a new worktree. A single session can use different locations for different Services.
- Added the workspace choice to Discuss and to requests for additional Service access. Session details show the location actually used for each Service.
- Added branch and worktree information to the Changes page for each recorded edit, based on where the edit happened.
- Added **Compact** to the Context modal for the current Run on supported providers. Follow-up messages wait while compaction completes.

### Private conversations

- Updated how private conversations and coding sessions appear to teammates. Conversations are private by default, so only the creator can read the transcript or find its messages in search. Teammates can still see session details and reports they have access to. Message previews follow the same privacy rules.

### Additional changes

- Added automatic permission decisions for monitored coding sessions on Claude, Codex, and OpenCode. The monitor can also decide Service access and Review file-scope requests. Requests that need a person can be answered from the Task Monitor workspace or the coding session.
- Updated plan-stage automation to open directly in the Task Monitor workspace. Apply launch settings in bulk to tasks that have yet to start, and choose separate providers and models for coordination and review.
- Added live Task Monitor status to Open Items, with monitors grouped under their plans.
- Fixed launching automation again on the same plan and retrying when an agent misses a plan-stage submission.
- Updated web work item and conversation reads to use GraphQL. Open views share live updates and conversation history loads in pages. Existing REST integrations and writes remain supported.
- Updated plan shaping so the visual design agent proposes Mockups and Diagrams, revises or drops them as the conversation changes, and asks you to confirm the complete set before tasks are drafted.
- Added a **Parts of the system** section to change walkthroughs. Reviewers can see what each part does, how it connects to the others, and jump to linked Diagram elements.
- Added cancellation for approved future revisions that have yet to be applied. Non-overlapping edits can be merged and reviewed on the same proposal before Apply.
- Fixed Plan completion so you can review applicable future revisions before leaving for the project review. Fixed commit reports appearing separately from their completion messages.
- Updated Feature Sync to propose required updates to project knowledge for review, including Contract edits. Agents now raise discrepancies in project knowledge as uncertainties you can act on.
- Added Explorer tabs to Search. Browse the feature tree, filter within a work item type, and return to the tab you last used.
- Updated Open Items triage to show a before-and-after preview with available suggestions selected. Change the selection to see the impact, then apply the selected suggestions in one step.
- Updated work item statuses to show the exact saved name. Each status carries one meaning chosen from Completed, Cancelled, In progress, or your own description. New items start in the first status configured for their type.
- Fixed diagram fitting and saved positions, improved light-mode input contrast, and stabilized artifact previews.
- Updated the API database schema for Service work locations and status meanings. Apply the release's Flyway migrations before starting the updated API.
- Updated the CLI to 4.6.0. After publication, install it with `npm install -g @hey-hey/cli@4.6.0`. The package's release manifest pins the images used by `heyhey local`.

Hosted availability follows a separate deployment schedule.

## v1.4.0

### Work item types and statuses

- Added custom statuses owned by each work item type, with a status editor in type settings.
- Added Bugs as allowed items inside plan stages and Task Monitor task kinds.
- Updated work item lists, filters and status controls to show each type's own statuses, including retained statuses that have since been removed.
- Updated goal progress to follow what each status means instead of its name.
- Updated status filters to match exactly and to keep the All tab selection.
- Fixed one malformed work item type breaking the others.

### Task Monitor

- Added monitor kinds, each with its own declared policy, and a choice of launch method per kind.
- Updated the Task Monitor workspace to adapt to live execution state, with lifecycle controls moved into an action capsule.
- Updated Task Monitor runs to use each provider's auto mode.
- Updated monitor completion to separate finishing an operation from finishing an item, and recovery now honors a finished operation.
- Fixed Task Monitor judgments being reported as failures.

### Open Items and uncertainties

- Added a preview of the changes an Open Items triage would make before you apply it, and suggestions that stay pending.
- Added a Discuss action on uncertainty cards, which carries the uncertainty's context into the discussion.

### Agent sessions and reviews

- Added a Feature Sync session role.
- Added change walkthroughs that orient reviewers, with Markdown rendered in their reports.
- Added previews for pending attachment chips.
- Updated Claude permission prompts with clearer context and options.
- Fixed a successful submission being reported as failed when the conversation refresh afterwards fails.
- Fixed file changes not being tracked in repositories with no commits.
- Fixed entity conversations being unable to look up Service IDs.
- Fixed context reads not resuming when a Claude session ends.
- Fixed replies after continuing a session going to the wrong computer.
- Fixed review guidance for planned changes and for Feature Sync analysis.
- Fixed hints appearing in graph search traversal.
- Fixed top-level item edits not allowing self-approval.

### Interface

- Updated card title contrast.
- Updated the sign-up, request-access, password and sign-in screens to use the branded frame.
- Fixed a removed-status warning to appear beneath the status control.
- Removed the session picker.

### API behavior

- Updated API errors for missing records, inconsistent server state, idempotency-key reuse and rate limiting to return accurate HTTP statuses (404, 500, 429) instead of 409.

### Upgrade and release artifacts

- Updated the API database schema for per-type statuses, monitor kinds and session role guidance. Apply the release's Flyway migrations before starting the updated API.
- Updated the CLI source to version 4.5.0. After publication, install it with `npm install -g @hey-hey/cli@4.5.0`; its release manifest pins the selected container images.
- Source and artifact publication do not establish that the hosted application has been upgraded.

## v1.3.3

### Agent sessions and change history

- Added a Changes view under Agents to browse recorded file edits across sessions, filter them, and inspect recorded before-and-after versions.
- Added links between commits and the agent change records they include, making committed and uncommitted work easier to distinguish.
- Added optional precise file change tracking for coding sessions, with bounded capture to prevent shell commands from stalling.
- Added support for continuing eligible agent sessions on another paired computer, including checking the destination before continuing.
- Added live Task Monitor execution state with an indication when the displayed state may be out of date.
- Added a Commit action to entity conversations when they have reported file changes.
- Updated the Changes page to load session filters on demand and stay responsive in larger projects.
- Fixed a committed file reappearing as another session's uncommitted change when a different session edits it.
- Fixed coding plan sessions resuming across replies and file links opening in the session's worktree.

### Coding evaluations

- Added optional targets to coding Eval Cases to identify a path and whether the output is new or changes existing work.
- Added downloadable patches and checkout instructions to reproduce a coding attempt's saved output locally; binary changes are not included in the patch.
- Fixed coding evaluation diff cards overlapping in results.

### Local setup

- Added download progress during local setup and troubleshooting guidance when startup fails.
- Added persistent startup diagnostics and bounded container evidence to help diagnose local setup failures.
- Added diagnosis and recovery for inaccessible Docker model mounts.
- Added a way for developers to run and repeat first-time local setup from source without a prior installation.
- Fixed first-time local setup so it opens separately from the main application.
- Fixed local credential checks when the D-Bus client is unavailable.

### Interface and agent improvements

- Updated the home, sign-in, onboarding, and review surfaces with a more consistent layout.
- Updated project navigation and clarified proposal conflict resolution choices.
- Fixed research uncertainties appearing in the wrong place, future-revision proposal links, and navigation after archiving work items.
- Fixed agent sessions without a bound computer being rejected during start authorization.
- Fixed prompt templates using outdated stored revisions and improved Project Assistant uncertainty reporting.

### Upgrade and release artifacts

- Updated the API database schema for change-record indexing, work-item execution state, agent session continuation, and coding Eval Case targets. Apply the release's Flyway migrations before starting the updated API; the Eval migration preserves existing checklist kinds as targets.
- Updated the CLI source to version 4.4.2. After publication, install it with `npm install -g @hey-hey/cli@4.4.2`; its release manifest pins the selected container images.
- Source and artifact publication do not establish that the hosted application has been upgraded.

## v1.3.2

### Open Items and evaluations

- Added renaming agent sessions from their Open Items row, with the updated title shown on session pages.
- Added nesting started evaluation sessions beneath their Eval, with their current run status.
- Updated Open Items to keep the 100 most recently activated entries while preserving pinned, noted, and grouped entries.
- Fixed the Eval collection tab to use its plural name.
- Fixed Eval Cases referencing custom work-item types being recorded with the wrong entity type.

### Agent sessions and local setup

- Fixed local pairing, credentials, and CLI state interfering with hosted installations.
- Fixed sessions returning to a worktree after its checked-out branch was changed.
- Fixed monitored Claude permission requests without an expiry being rejected.
- Fixed agent commits leaving out staged deletions and improved diagnostics for Git failures.

### Plans and previews

- Fixed Plans created from existing tasks starting in the wrong state.
- Fixed feature authoring accepting three or more requirements without named groups.
- Fixed UX-flow layouts and walkthroughs to begin at the designated starting screen.
- Fixed closing triage results to keep the discard warning in the same dialog.
- Fixed diagram links and spacing in contextual cards.

### Upgrade and release artifacts

- Updated Open Items storage to track activation time. Apply the release's Flyway migrations before starting the updated API. The migration removes the oldest unprotected entries from collections above 100; it preserves pinned, noted, and grouped entries, including protected collections above the limit.
- Fixed release branches using hyphens to build the complete Linux AMD64 and ARM64 image bundle and pass CLI publication validation.
- Updated the CLI source for version 4.4.1. Install the published package with `npm install -g @hey-hey/cli@4.4.1`; its release manifest pins the selected container images.
- Source and artifact publication do not establish that the hosted application has been upgraded.

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
