Future revisions and proposal review
Added support for reviewing changes ahead of implementation, tracking completion conditions, and applying the reviewed result when ready. Expanded future revisions to complete Diagram graphs, elements, references and layout.
Added ready-to-apply revisions on Project Overview and completion/verification offers showing full changes. Added an Updates tab on Plans, clearer readiness stages and linked-work navigation.
Added three-way conflict review and manual or agent-assisted resolution. Saving a resolution updates the same proposal/future instead of creating a disconnected correction. Keep this with future-revision coverage rather than presenting it as an unrelated headline.
Fixed false overlap conflicts, inconsistent readiness decisions, grouped approval errors, Diagram publication failures and comparisons that mistook equivalent stored values for changes. Retry skips completed change-set operations, preserving newer user edits.
Fixed unreadable requirements comparisons, missing specialized previews, hidden proposal identity, broken conversation navigation and premature graph-loading errors. Updated proposals resurface at turn completion.
Existing task-linked futures remain supported. Default authoring uses futures for Plan-delivered knowledge changes; task execution ordinarily proposes ordinary updates, and conversations ask about now versus when work ships.

UX flows
Added support for linking multiple Mockups into one view documenting the flow between screens and the user action that triggers each transition.
Review a flow and newly proposed screens together, with per-screen annotations and approval/rejection. Accepted screens remain available; rejected screens block application of the journey. Further revision starts with the user's next comment.
Render both proposed and already saved flows as screen journeys. Connected screens sit beside each other; screens use their declared presentation dimensions and can open at full size.
Fixed same-group screen references, missing previews, incorrect screen sizing, misleading approval controls and fulfillment warnings that treated screens as implementation steps. No claim is made here that arrow-key walkthrough navigation or clickable controls inside screens is delivered.

Implementation planning
Updated existing implementation planning for conversational iteration over complete Markdown plan versions, with explicit approval of the exact version to implement.
Save a plan and its complete discrepancy list together. Show discrepancies beneath their plan, preserve version-specific decisions, and defer remediations until the user chooses.
Fixed approval/replies lost after refresh, forgotten model selections and implementation stalling after a provider switch.
Fixed deferred planning tools being inaccessible and turns silently completing with no saved plan. Preserve approved handoffs and surface missing-plan failures.

Hints and retained knowledge
Replaced agents' use of legacy Service-scoped implementation hints with project-scoped graph hints. Hints preserve corrections, direction and gotchas and connect to multiple relevant entities through weighted connections.
Agents retrieve hints connected to their focused work and can retire obsolete hints. Read restrictions apply to retrieval; coding-plan helpers receive read-only access.
Project Admin lists hints with full text, connected items and strengths. Archived Services and their legacy implementation hints remain browsable. Stored legacy records are retained.

Agent evaluations
Improved evaluations to exercise named real handlers using the same preparation as ordinary sessions, with an independent Project Assistant on/off choice.
Run attempts as ordinary inert sessions: outputs remain evaluation evidence and do not become ordinary project knowledge or apply live changes. Keep grading material out of evaluated agents' search and graph paths.
Added per-case results, attempt conversations, retained outputs, execution details, target/judge provider-session identifiers and per-attempt costs. Token measurements distinguish fresh input, cache categories and output after settlement.
Fixed missing Eval navigation, rejected valid model configurations, invalid attempt conversations, stalled execution and opening evidence accidentally starting a run.
These are evaluation improvements, not the introduction of evaluations as a new capability.

Demo workspace
Include the availability of the demo as release context, as requested by the user. The selected code baseline already contains demo functionality, so availability as a newly deployed offering is user-supplied context rather than an introduction proved by this diff.
Added setup progress and recovery after refresh, retry on setup failure, and readiness checks covering all expected copied Feature connections.
Fixed clone failures caused by operational identifiers and orphan session conversations, corrected clone event identity, and directed ready visitors to the project's Welcome page.
Replaced the obstructive top notice with a smaller bottom banner and fixed demo logout/real sign-in state interfering with normal browser use and CLI pairing.

Dialogs
Added a shared dialog shell and minimization. Supported dialogs retain drafts, selections, attachments and review context across in-app page navigation.
Minimize is limited to supported shared-host dialogs. This is not a promise that every dialog survives navigation, and browser refresh persistence is outside the change.

Navigation and smaller interface fixes
Fixed Open Items selection when removing other items, sessions jumping out of their parent branch during activation, and hover previews opening late or sticking.
Improved session labels using conversation titles and parent names. Triage must establish a generic session's purpose before recommending its removal.
Fixed iPhone Safari layout/touch-target displacement, desktop type-navigation overflow, wasted width in expanded previews and unnecessarily compact Discuss selectors.
Fixed previous-turn tool calls flashing during follow-up startup, restored file links from changed-file diffs to the configured editor, and kept attachment chips beside message authors.
Show browser annotation comments beside their targets by default; repositioned the annotation toolbar. Clarified activity chart colors and Welcome step actions.
Usage/Costs views load the routing session rather than hydrating every project session.

Agent behavior and work-item tools
Added default session roles to Agent Modes and type-owned guidance for implementation, research, planning and review; retired standalone semantic guidance in favor of those role instructions.
Fixed Agent Mode and refiner conversations switching to a generic coding agent after the first turn. Preserve the owning agent, mode and accepted runtime across replies and handoffs.
Fixed missing changed-file reporting in Agent Mode sessions. Completion requires reporting when files changed; discussion-only turns do not need an empty file report.
Review is read-only and judges delivery against governing Feature requirements and Contracts. Completion can raise specific concerns when implementation diverges from governing Mockups or Diagrams.
Honor explicit edit instructions within admitted scope without repeatedly requesting permission. Need-style discussion still does not authorize repository edits.
Allow registered work-item type keys in context/full-entity reads, including custom types; support Message and Conversation context seeds. Correct Diagram authoring guidance.
Allow all agent-settable statuses declared by the type, remove the legacy batch edit_tasks tool, and guide agents to consolidate changes to one entity into one update per round.
Fixed clearing assignees and returning successful archive mutation results. Fixed indefinitely retried workspace input without a Service.
Show terminal/startup failure reasons in conversations, avoid presenting pending Service approval as failure, and distinguish cancellation from real provider errors.

Authorization and pairing
Bind direct commands and protected reads to the exact inputs the user approved. Align supported coding-session launch payloads with controller validation and add schema-compatibility build checks.
Fix Agent fix startup by binding the selected machine before launch; preserve the browser's eligibility on previously paired machines when adding another controller.
Protect Embeddings diagnostics with scoped credentials and check current project access before private retrieval. Search applies trusted project scope before ranking/pagination.
Improve authorization-mismatch diagnostics. Authentication declaration/generation changes support these boundaries; deployment was not tested in this investigation.

Repository import
Add a post-import conversation to enrich reviewed Features with user-confirmed intent, with usable reply fields for follow-up questions.
Fix reviewed candidates being rejected by CLI validation and workflow handoffs being treated as prompts that still needed an answer.
Improve repository-analysis instructions so Feature descriptions explain the capability and its boundaries instead of repeating one-line labels.

Project Assistant and context gathering
Make the Jev option control all CLI uses of Jev.
Gather paragraph-level relevance excerpts while preserving canonical identities and access to full entities. Narrow a loaded neighborhood against the user's request; on failed judgment use the original context.
Persist exact provider input, gathering requests, answers and traces for diagnosis. Internal converter/bootstrap refactors support the same flow.
Some implementing items remain Active; code inclusion is established, but a completed task status or production effectiveness is not claimed.

Reports
Deliver report evidence outside the starting prompt and require every shard page to be read before submission. No sampling or omission merely to fit prompt limits.
Add saved creation-time usage measurements and a usage bar to terminal reports. Improve change-walkthrough visual hierarchy and source links.
Evidence-volume handling is represented in the release even though its task remains Active. This inventory does not claim it solves release-note discovery, grouping or scope selection.

Search
Return matching passage spans together with their exact source text through search and unified search, allowing callers to locate the relevant portions of a result.
Format Feature requirements as readable searchable content instead of raw requirements JSON. Verify section ingestion/update/deletion behavior.
