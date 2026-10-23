/**
 * English translations - Single source of truth with full navigation
 *
 * This TypeScript file uses key constants to enable:
 * - Command+click any key to navigate to its definition
 * - Find all references to see where keys are used across the codebase
 * - Type safety and autocomplete
 * - Refactoring safety - rename keys and all usages update
 *
 * Usage: Command+click on KEYS.onboarding.subtitle below to navigate!
 */

import { KEYS } from "../keys";
import { compose, patterns } from "../compose";

export const en = {
  "demo.start.checking": "Checking for your demo…",
  "demo.start.resumeError":
    "We couldn't check for your demo. Please try again.",
  "demo.start.retry": "Try again",
  "demo.consent.title": "Your own private demo",
  "demo.consent.intro":
    "Explore and edit a temporary copy of an already-set-up project. Your changes stay in your copy.",
  "demo.consent.inactivity":
    "Your demo stays active while you use it and expires after two hours of inactivity.",
  "demo.consent.agents":
    "Browse straight away. To run agents, pair your own CLI and use your model provider.",
  "demo.consent.accept":
    "I accept the <terms>demo terms</terms> and <agentBridge>Agent Bridge acknowledgment</agentBridge>",
  "demo.consent.botCheck": "Bot check",
  "demo.consent.botCheckUnavailable":
    "The bot check couldn't be loaded, so a demo can't be started right now. Please try again later.",
  "demo.consent.start": "Start my demo",
  "demo.consent.starting": "Setting up your demo…",
  "demo.consent.error.RATE_LIMITED":
    "You've started several demos recently. Please wait a little and try again.",
  "demo.consent.error.BOT_CHECK_FAILED":
    "We couldn't verify the bot check. Please complete it again.",
  "demo.consent.error.PROVISIONING_FAILED":
    "We couldn't set up your demo. Please try again.",
  "demo.consent.error.STALE_TERMS_VERSION":
    "The demo terms have been updated. Reload this page to review and accept them.",
  "demo.consent.error.UNKNOWN":
    "Something went wrong starting your demo. Please try again.",
  "demo.unavailable.title": "Demo unavailable right now",
  "demo.unavailable.body":
    "We're not starting new demos at the moment. Please try again later.",
  "demo.unavailable.alternative":
    "Want to use Hey Hey with your own project? You can request beta access.",
  "demo.unavailable.requestAccess": "Request beta access",
  "demo.expired.title": "Your demo has expired",
  "demo.expired.body":
    "Demos stay active while you use them and expire after two hours of inactivity.",
  "demo.expired.note":
    "Access to this demo has ended, including its paired CLI. Temporary demo data is removed when the demo ends.",
  "demo.expired.startNew": "Start a new demo",
  "demo.backHome": "Back to home",

  "demo.banner.title": "Temporary private demo",
  "demo.banner.policy":
    "Stays active during use · expires after {{duration}} of inactivity",
  "demo.banner.timeoutHours_one": "{{count}} hour",
  "demo.banner.timeoutHours_other": "{{count}} hours",
  "demo.banner.timeoutMinutes_one": "{{count}} minute",
  "demo.banner.timeoutMinutes_other": "{{count}} minutes",
  "demo.banner.expiry": "Current expiry: {{time}} · server reported",
  "demo.banner.pairCli": "Pair CLI",
  "demo.banner.repository": "Example repository",
  "demo.banner.cloneLabel": "Clone the example repository",
  "demo.banner.copyClone": "Copy clone command",
  "demo.banner.copied": "Copied",

  "triage.generating": "Preparing triage suggestions…",
  "triage.resultsError": "Unable to load suggestions.",
  "triage.empty": "No suggestions yet. Run triage to review your Open Items.",
  "triage.followUp": "Follow-up message",
  "triage.followUpPlaceholder":
    "Ask a question or describe what you want to keep…",
  "triage.runError": "Triage could not finish. Run Again to retry.",
  "triage.waitingCollection":
    "Open Items must finish loading before suggestions can be applied.",
  "triage.recoverPromotion": "Recover promotion",
  "triage.recoverMissingGroup":
    "This group is no longer available. Confirm to recover the earlier promotion attempt.",

  "triage.createdGoal": "Created Goal",
  "triage.createdGroup": "Created group",

  "triage.open": "Triage Open Items",
  "triage.title": "Open Items triage",
  "triage.runAgain": "Run Again",
  "triage.apply": "Apply",
  "triage.applyAll": "Apply all selected",
  "triage.retry": "Retry unfinished work",
  "triage.select": "Select suggestion",
  "triage.unavailable": "Suggestions are unavailable.",
  "triage.sessionError": "Unable to open triage.",
  "triage.conversationError": "The triage conversation is unavailable.",
  "triage.sessionCouldNotOpen": "Session could not be opened",
  "triage.opening": "Opening triage…",
  "triage.close": "Close triage",
  "triage.applyWithConfirmation": "Apply…",
  "triage.applyNote":
    "Each suggestion is applied independently. Promotion asks you to confirm its name and optional date.",
  "triage.kind.removeOpenItems": "Remove from Open Items",
  "triage.kind.reopenItems": "Reopen in Open Items",
  "triage.kind.groupOpenItems": "Group Open Items",
  "triage.kind.trackOnGoal": "Track on Goal",
  "triage.kind.promoteGroupToGoal": "Promote group to Goal",
  "triage.state.pending": "Applying…",
  "triage.state.success": "Applied",
  "triage.state.failure": "Some work could not be applied",
  "triage.state.cancelled": "Promotion cancelled",
  "triage.evidence.attention": "Attention",
  "triage.evidence.edge": "Relationship",
  "triage.evidence.sourceConversation": "Source conversation",
  "triage.evidence.coAttention": "Viewed together",
  "triage.evidence.title": "Title",
  "triage.help.lead": "Run an agent to tidy up your Open Items.",
  "triage.help.removes": "Removes items you no longer need",
  "triage.help.groups": "Groups related items together",
  "triage.help.tracks": "Tracks ongoing work on a Goal",
  "triage.run": "Run",
  "triage.discard.message":
    "Closing triage will discard these results. You won’t be able to return to them. Changes you’ve already applied will remain.",
  "triage.discard.keep": "Keep reviewing",
  "triage.discard.confirm": "Discard and close",
  "triage.cancel.message":
    "Triage is still running. Closing will cancel this run, and you won’t be able to return to it. Changes you’ve already applied will remain.",
  "triage.cancel.keep": "Keep running",
  "triage.cancel.confirm": "Cancel and close",
  "triage.cancel.stopping": "Cancelling the run…",
  "triage.cancel.failed": "The run could not be cancelled",
  "triage.cancel.retry": "Try again",

  // Common translations - command+click KEYS.common.thinking to navigate!
  [KEYS.common.thinking]: "Thinking...",
  [KEYS.common.processing]: "Pondering...",
  [KEYS.common.loading]: "Loading...",
  [KEYS.common.analyzing]: "Analyzing...",
  [KEYS.common.error]: "Error",
  [KEYS.common.success]: "Success",
  [KEYS.common.cancel]: "Cancel",
  [KEYS.common.save]: "Save",
  [KEYS.common.delete]: "Delete",
  [KEYS.common.edit]: "Edit",
  [KEYS.common.close]: "Close",
  [KEYS.common.fileLimit]: "File limit reached",
  [KEYS.common.attachFiles]: "Attach files",
  [KEYS.common.attachedFiles]: "{{count}} files attached (max {{max}})",
  [KEYS.common.dragMoreFiles]:
    "Drag more files here or click the attachment button",
  [KEYS.common.create]: "Create",
  [KEYS.common.back]: "Back",
  [KEYS.common.next]: "Next",
  [KEYS.common.submit]: "Submit",
  [KEYS.common.refresh]: "Refresh",
  [KEYS.common.search]: "Search",
  [KEYS.common.yes]: "Yes",
  [KEYS.common.no]: "No",
  [KEYS.common.unknown]: "Unknown",
  [KEYS.common.retry]: "Retry",
  [KEYS.common.retrying]: "Retrying...",
  [KEYS.common.noItemsFound]: "No items found",
  [KEYS.common.notAvailable]: "Not available",
  [KEYS.common.active]: "Active",
  [KEYS.common.expand]: "Expand",
  [KEYS.common.hide]: "Hide",

  // Coding session translations
  [KEYS.codingSession.machineNoneConnected]:
    "No CLI is connected. Install and pair a CLI to start a coding session.",
  [KEYS.codingSession.dispatchUnacknowledged]:
    "The start-run was accepted but no connected CLI acknowledged it. Make sure a CLI is running and paired, then try again.",

  // Features translations
  [KEYS.features.featureTree]: "Feature Tree",

  // Navigation translations - command+click to navigate!
  [KEYS.navigation.home]: "Home",
  [KEYS.navigation.contact]: "Contact",
  [KEYS.navigation.projects]: compose("{{term.Projects}}"),
  [KEYS.navigation.playground]: "Playground",
  [KEYS.navigation.initiatives]: compose("{{term.Initiatives}}"),
  [KEYS.navigation.artifacts]: compose("{{term.Artifacts}}"),
  [KEYS.navigation.integrations]: compose("{{term.Integrations}}"),
  [KEYS.navigation.myProjects]: compose("My {{term.Projects}}"),
  [KEYS.navigation.welcome]: "Welcome, {{name}}",
  [KEYS.navigation.llmTracking]: "LLM Tracking",
  [KEYS.navigation.settings]: "Settings",

  // LLM Tracking - app-specific feature
  [KEYS.llmTracking.title]: "LLM Tracking",
  [KEYS.llmTracking.subtitle]: "Monitor and debug LLM prompts and responses",
  [KEYS.llmTracking.search]: "Search prompts and responses...",
  [KEYS.llmTracking.noRecords]: "No LLM records found",
  [KEYS.llmTracking.adjustSearch]: "Try adjusting your search or filters",
  [KEYS.llmTracking.viewDetails]: "View Details",

  // LLM Tracking Details
  [KEYS.llmTracking.details.title]: "LLM Request Details",
  [KEYS.llmTracking.details.prompt]: "Prompt",
  [KEYS.llmTracking.details.response]: "Response",
  [KEYS.llmTracking.details.metadata]: "Metadata",
  [KEYS.llmTracking.details.usage]: "Token Usage",

  // LLM Tracking Filters
  [KEYS.llmTracking.filters.provider]: "Provider",
  [KEYS.llmTracking.filters.success]: "Status",
  [KEYS.llmTracking.filters.allProviders]: "All Providers",
  [KEYS.llmTracking.filters.allStatuses]: "All Statuses",
  [KEYS.llmTracking.filters.successful]: "Successful",
  [KEYS.llmTracking.filters.failed]: "Failed",
  [KEYS.llmTracking.filters.projectId]: "Project ID",
  [KEYS.llmTracking.filters.conversationId]: "Conversation ID",
  [KEYS.llmTracking.filters.workflowId]: "Workflow ID",
  [KEYS.llmTracking.filters.nodeId]: "Node ID",

  // LLM Tracking Metadata
  [KEYS.llmTracking.metadata.provider]: "Provider",
  [KEYS.llmTracking.metadata.model]: "Model",
  [KEYS.llmTracking.metadata.temperature]: "Temperature",
  [KEYS.llmTracking.metadata.maxTokens]: "Max Tokens",
  [KEYS.llmTracking.metadata.stream]: "Streaming",
  [KEYS.llmTracking.metadata.success]: "Success",
  [KEYS.llmTracking.metadata.duration]: "Duration",
  [KEYS.llmTracking.metadata.error]: "Error",
  [KEYS.llmTracking.metadata.createdAt]: "Created At",
  [KEYS.llmTracking.metadata.projectId]: "Project ID",
  [KEYS.llmTracking.metadata.conversationId]: "Conversation ID",
  [KEYS.llmTracking.metadata.workflowId]: "Workflow ID",
  [KEYS.llmTracking.metadata.nodeId]: "Node ID",
  [KEYS.llmTracking.metadata.nodeType]: "Node Type",

  // LLM Tracking Usage
  [KEYS.llmTracking.usage.promptTokens]: "Prompt Tokens",
  [KEYS.llmTracking.usage.completionTokens]: "Completion Tokens",
  [KEYS.llmTracking.usage.totalTokens]: "Total Tokens",

  // Project translations - command+click to navigate!
  [KEYS.projects.title]: compose("{{term.Projects}}"),
  [KEYS.projects.create]: patterns.newEntity("project"),
  [KEYS.projects.edit]: patterns.editEntity("project"),
  [KEYS.projects.delete]: patterns.deleteEntity("project"),
  [KEYS.projects.noProjects]: patterns.noEntitiesFound("projects"),
  [KEYS.projects.createFirst]: patterns.createFirstEntity("project"),
  [KEYS.projects.deleteConfirm.title]: "Delete Project",
  [KEYS.projects.deleteConfirm.message]:
    "Are you sure you want to delete the project '{{name}}'? This action cannot be undone.",
  [KEYS.projects.deleteConfirm.confirmButton]: "Delete Project",

  // Organization translations - command+click to navigate!
  [KEYS.organizations.createNew]: "Create New Organization",
  [KEYS.organizations.dialog.createTitle]: "Create New Organization",

  // Initiative translations - command+click KEYS.initiatives.subtitle to navigate!
  [KEYS.initiatives.title]: compose("{{term.Initiatives}}"),
  [KEYS.initiatives.subtitle]: compose(
    "Manage your organization's {{term.initiatives}} and track their progress",
  ),
  [KEYS.initiatives.create]: patterns.newEntity("initiative"),
  [KEYS.initiatives.edit]: patterns.editEntity("initiative"),
  [KEYS.initiatives.viewTasks]: compose("{{term.View}} {{term.Tasks}}"),
  [KEYS.initiatives.noInitiatives]: patterns.noEntitiesFound("initiatives"),
  [KEYS.initiatives.createFirst]: patterns.createFirstEntity("initiative"),
  [KEYS.initiatives.tags]: "Tags",
  [KEYS.initiatives.estimatedEffort]: "Estimated Effort",
  [KEYS.initiatives.assumptions]: "Key Assumptions",
  [KEYS.initiatives.dependencies]: "Dependencies",
  [KEYS.initiatives.systemSuggestions]: "AI Suggestions",
  [KEYS.initiatives.summary]: "Summary",
  [KEYS.initiatives.totalCount]: compose(
    "Total: {{count}} {{term.initiatives}}",
  ),
  [KEYS.initiatives.detectedIntent]: "Detected Intent",
  [KEYS.initiatives.reasoning]: "AI Reasoning",
  [KEYS.initiatives.approve]: "Approve & Continue",
  [KEYS.initiatives.form.title]: patterns.entityName("initiative"),
  [KEYS.initiatives.form.description]: "Description",
  [KEYS.initiatives.form.status]: "Status",
  [KEYS.initiatives.form.priority]: "Priority",
  [KEYS.initiatives.form.tags]: "Tags",
  [KEYS.initiatives.form.tagsPlaceholder]: compose(
    "Add tags to categorize this {{term.initiative}}...",
  ),
  [KEYS.initiatives.newInitiativeDialog.title]: compose(
    "{{term.Create}} New {{term.Initiative}}",
  ),
  [KEYS.initiatives.newInitiativeDialog.namePlaceholder]:
    patterns.enterEntityName("initiative"),
  [KEYS.initiatives.newInitiativeDialog.descriptionPlaceholder]:
    patterns.describeEntity("initiative"),
  [KEYS.initiatives.newInitiativeDialog.nameRequired]:
    patterns.entityNameRequired("initiative"),
  [KEYS.initiatives.newInitiativeDialog.nameTooShort]:
    patterns.entityNameTooShort("initiative"),
  [KEYS.initiatives.newInitiativeDialog.nameTooLong]:
    patterns.entityNameTooLong("initiative"),
  [KEYS.initiatives.newInitiativeDialog.descriptionTooLong]:
    "Description must be less than 500 characters",
  [KEYS.initiatives.newInitiativeDialog.creating]:
    patterns.creatingEntity("initiative"),
  [KEYS.initiatives.textArea.placeholder]: compose(
    "Describe your {{term.initiative}} in detail. You can edit this text directly or use the conversation below to refine it.",
  ),
  [KEYS.initiatives.textArea.updating]: "Updating...",
  [KEYS.initiatives.textArea.submitHint]:
    "Press Cmd+Enter to continue or use the conversation below",
  [KEYS.initiatives.conversation.placeholder]:
    "Ask me to refine the initiative, add details, or make it more specific...",
  [KEYS.initiatives.conversation.thinking]: "Thinking...",
  [KEYS.initiatives.conversation.updatingContent]: "Updating content",
  [KEYS.initiatives.conversation.hint]:
    "Press Enter to send, Shift+Enter for new line",
  [KEYS.initiatives.editor.content]: compose("{{term.Initiative}} Content"),
  [KEYS.initiatives.editor.conversationDivider]: "Refine with conversation",
  [KEYS.initiatives.editor.systemMessage]: "System suggestion",
  [KEYS.initiatives.editor.contextualInsights]: "Context detected",
  [KEYS.initiatives.editor.readyForNextLevel]: "Ready to add more details",
  [KEYS.initiatives.editor.errorUpdating]: "Failed to update initiative",
  [KEYS.initiatives.editor.errorRefining]: "Failed to refine initiative",
  [KEYS.initiatives.editor.unsavedChanges]: "You have unsaved changes",
  [KEYS.initiatives.editor.saveOnly]: "Save without Feedback",
  [KEYS.initiatives.editor.saveAndGetFeedback]: "Save",
  [KEYS.initiatives.editor.saving]: "Saving...",
  [KEYS.initiatives.editor.gettingFeedback]: "Getting feedback...",
  [KEYS.initiatives.status.planning]: "Planning",
  [KEYS.initiatives.status.active]: "Active",
  [KEYS.initiatives.status.onHold]: "On Hold",
  [KEYS.initiatives.status.completed]: "Completed",
  [KEYS.initiatives.status.cancelled]: "Cancelled",
  [KEYS.initiatives.priority.low]: "Low",
  [KEYS.initiatives.priority.medium]: "Medium",
  [KEYS.initiatives.priority.high]: "High",
  [KEYS.initiatives.filters.search]: "Search",
  [KEYS.initiatives.filters.searchPlaceholder]: "Search by name or tag",
  [KEYS.initiatives.filters.status]: "Status",
  [KEYS.initiatives.filters.statusAll]: "All statuses",
  [KEYS.initiatives.filters.sort]: "Sort by",
  [KEYS.initiatives.filters.sortNameAsc]: "Name (A-Z)",
  [KEYS.initiatives.filters.sortNameDesc]: "Name (Z-A)",
  [KEYS.initiatives.filters.sortCreatedDesc]: "Newest first",
  [KEYS.initiatives.filters.sortCreatedAsc]: "Oldest first",
  [KEYS.initiatives.filters.sortStatus]: "Status",
  [KEYS.initiatives.filters.sortPriority]: "Priority",

  // Initiative intro tooltips and guidance
  [KEYS.initiatives.intro.tooltip.generated]:
    "We've generated an initiative for you. We can complete it in steps",
  [KEYS.initiatives.intro.tooltip.location]:
    "You are here: Description. You can edit it directly or talk to me below",
  [KEYS.initiatives.intro.tooltip.nextSteps]:
    "Next we'll work on details. You can click \"Proceed to details\" or just tell me you're ready",
  [KEYS.initiatives.intro.tooltip.editingSaving]:
    "When you make edits click either save to get my feedback or save without feedback to make updates without me",
  [KEYS.initiatives.intro.guide.generated]: compose(
    "{{term.Initiative}} Generated",
  ),
  [KEYS.initiatives.intro.guide.currentStep]: "Current Step",
  [KEYS.initiatives.intro.guide.nextSteps]: "Next Steps",
  [KEYS.initiatives.intro.guide.editing]: "Editing & Saving",
  [KEYS.initiatives.intro.hoverHelp]:
    "The tooltips above provide contextual guidance for each step of the process",
  [KEYS.initiatives.dialog.createTitle]: compose(
    "Create New {{term.Initiative}}",
  ),
  [KEYS.initiatives.dialog.editTitle]: compose("Edit {{term.Initiative}}"),

  // Work Item translations
  [KEYS.workItems.editor.setReady]: "Set Ready",
  [KEYS.workItems.editor.completeRefinementHint]:
    "Complete Refinement to Set Ready",
  [KEYS.workItems.editor.createDesignDoc]: "Create Design Doc",
  [KEYS.workItems.editor.chooseCompletionStatus]: "Mark as complete",
  [KEYS.workItems.actions.setReady]: "Set Ready",
  [KEYS.workItems.actions.setReadyTitle]: "Mark as Ready",
  [KEYS.workItems.actions.setBacklogDescription]:
    "Move this task to the backlog. Optionally assign it to a team member and link it to one or more services.",
  [KEYS.workItems.actions.setReadyDescription]:
    "Mark this work item as ready to begin. The status will change from 'Refining Acceptance Criteria' to 'Ready'.",
  [KEYS.workItems.actions.confirmSetReady]: "Confirm",
  [KEYS.workItems.actions.setActive]: "To Active",
  [KEYS.workItems.actions.setActiveTitle]: "Start Task",
  [KEYS.workItems.actions.setActiveDescription]:
    "Mark this task as active. Optionally assign it to a team member and link it to one or more services.",
  [KEYS.workItems.actions.setComplete]: "Complete",
  [KEYS.workItems.actions.setCompleteTitle]: "Complete Task",
  [KEYS.workItems.status.current]: "Current Status",
  [KEYS.workItems.status.newStatus]: "New Status",
  [KEYS.workItems.status.ready]: "Ready",
  [KEYS.workItems.status.refiningAcceptanceCriteria]:
    "Refining Acceptance Criteria",

  // Onboarding translations - command+click KEYS.onboarding.subtitle to navigate!
  [KEYS.onboarding.title]: "Onboarding",
  [KEYS.onboarding.subtitle]:
    "Our AI will help you break down your project into actionable steps",
  [KEYS.onboarding.loadingInitiative]: patterns.loadingEntity("initiative"),

  // Tasks translations - command+click to navigate!
  [KEYS.tasks.title]: compose("{{term.Tasks}}"),
  [KEYS.tasks.subtitle]: compose(
    "Managing {{term.tasks}} for: {{initiativeTitle}}",
  ),
  [KEYS.tasks.create]: patterns.newEntity("task"),
  [KEYS.tasks.edit]: patterns.editEntity("task"),
  [KEYS.tasks.delete]: patterns.deleteEntity("task"),
  [KEYS.tasks.deleteConfirm]:
    'Are you sure you want to delete the task "{{title}}"? This action cannot be undone.',
  [KEYS.tasks.noTasks]: patterns.noEntitiesFound("tasks"),
  [KEYS.tasks.createFirst]: patterns.createFirstEntity("task"),
  [KEYS.tasks.newTask]: compose("New {{term.Task}}"),
  [KEYS.tasks.loading]: patterns.loadingEntity("tasks"),
  [KEYS.tasks.dialog.createTitle]: patterns.newEntity("task"),
  [KEYS.tasks.dialog.editTitle]: patterns.editEntity("task"),
  [KEYS.tasks.dialog.deleteTitle]: patterns.deleteEntity("task"),
  [KEYS.tasks.dialog.nameRequired]: "Task name is required",
  [KEYS.tasks.dialog.nameTooShort]: "Task name must be at least 3 characters",
  [KEYS.tasks.dialog.nameTooLong]: "Task name must be 100 characters or less",
  [KEYS.tasks.dialog.descriptionTooLong]:
    "Description must be 1000 characters or less",
  [KEYS.tasks.dialog.detailsTooLong]: "Details must be 1000 characters or less",
  [KEYS.tasks.dialog.acceptanceCriteriaTooLong]:
    "Acceptance criteria must be 1000 characters or less",
  [KEYS.tasks.dialog.namePlaceholder]: "Enter a clear, actionable task name...",
  [KEYS.tasks.dialog.descriptionPlaceholder]:
    "Provide a brief description of what needs to be done...",
  [KEYS.tasks.dialog.detailsLabel]: "Technical Details",
  [KEYS.tasks.dialog.detailsPlaceholder]:
    "Add technical specifications, requirements, or implementation notes...",
  [KEYS.tasks.dialog.acceptanceCriteriaLabel]: "Acceptance Criteria",
  [KEYS.tasks.dialog.acceptanceCriteriaPlaceholder]:
    "Define specific conditions that must be met for this task to be considered complete...",
  [KEYS.tasks.dialog.creating]: "Creating...",
  [KEYS.tasks.form.title]: "Title",
  [KEYS.tasks.form.description]: "Description",
  [KEYS.tasks.form.status]: "Status",
  [KEYS.tasks.form.type]: "Type",
  [KEYS.tasks.form.priority]: "Priority",
  [KEYS.tasks.form.tags]: "Tags",
  [KEYS.tasks.form.tagsPlaceholder]: "Add tags to categorize this task...",
  [KEYS.tasks.status.todo]: "To Do",
  [KEYS.tasks.status.inProgress]: "In Progress",
  [KEYS.tasks.status.done]: "Done",
  [KEYS.tasks.status.blocked]: "Blocked",
  [KEYS.tasks.priority.low]: "Low",
  [KEYS.tasks.priority.medium]: "Medium",
  [KEYS.tasks.priority.high]: "High",
  [KEYS.tasks.type.task]: "Task",
  [KEYS.tasks.type.bug]: "Bug",
  [KEYS.tasks.type.feature]: "Feature",
  [KEYS.tasks.type.improvement]: "Improvement",
  [KEYS.tasks.assistant.title]: compose(
    "{{term.Task}} Generation {{term.Assistant}}",
  ),
  [KEYS.tasks.assistant.button]: compose(
    "Generate {{term.Tasks}} {{term.Assistant}}",
  ),
  [KEYS.tasks.assistant.description]: compose(
    "The AI assistant will help you generate {{term.tasks}} for:",
  ),
  [KEYS.tasks.assistant.explanation]: compose(
    "The assistant will analyze your {{term.initiative}} and suggest relevant {{term.tasks}} to help you achieve your goals. You can review and modify the suggestions before adding them to your {{term.project}}.",
  ),
  [KEYS.tasks.assistant.startButton]: compose("Start {{term.Assistant}}"),
  [KEYS.tasks.assistant.starting]: compose("Starting {{term.Assistant}}..."),
  [KEYS.tasks.assistant.cancel]: "Cancel",
  [KEYS.tasks.assistant.emptyMessage]: compose(
    "Add a {{term.task}} or start a discussion to help generate {{term.tasks}}.",
  ),
  [KEYS.tasks.assistant.error]: compose(
    "Failed to start {{term.task}} generation {{term.assistant}}",
  ),

  // Goals dialog
  [KEYS.goals.dialog.createTitle]: "Create Goal",
  [KEYS.goals.date.noTargetDate]: "No target date",
  [KEYS.goals.dialog.dueDateLabel]: "Target date (optional)",
  [KEYS.goals.dialog.dueDateRequired]: "Due date is required",
  [KEYS.goals.dialog.dueDatePlaceholder]: "YYYY-MM-DD",
  [KEYS.goals.dialog.createButton]: "Create Goal",

  // Reports
  [KEYS.reports.createGoalFromThis]: "Create a goal from this",
  [KEYS.reports.createGoalFromThisAriaLabel]: "Create a goal from this report",

  // Artifacts translations - command+click to navigate!
  [KEYS.artifacts.title]: compose("{{term.Artifacts}}"),
  [KEYS.artifacts.subtitle]:
    "Browse and search through stored artifacts ({{count}} total)",
  [KEYS.artifacts.search]: compose("Search {{term.artifacts}}"),
  [KEYS.artifacts.noArtifacts]: patterns.noEntitiesFound("artifacts"),
  [KEYS.artifacts.adjustSearch]: "Try adjusting your search terms",
  [KEYS.artifacts.noArtifactsYet]: compose(
    "No {{term.artifacts}} have been created yet",
  ),
  [KEYS.artifacts.defaultTitle]: "Artifact",
  [KEYS.artifacts.filters.type]: "Type",
  [KEYS.artifacts.filters.status]: "Status",
  [KEYS.artifacts.filters.category]: "Category",
  [KEYS.artifacts.filters.allTypes]: "All Types",
  [KEYS.artifacts.filters.allStatuses]: "All Statuses",
  [KEYS.artifacts.types.qaPair]: "Q&A Pair",
  [KEYS.artifacts.types.document]: "Document",
  [KEYS.artifacts.types.codeSnippet]: "Code Snippet",
  [KEYS.artifacts.types.conversationSummary]: "Conversation Summary",
  [KEYS.artifacts.types.projectInsight]: "Project Insight",
  [KEYS.artifacts.status.active]: "Active",
  [KEYS.artifacts.status.archived]: "Archived",
  [KEYS.artifacts.status.draft]: "Draft",
  [KEYS.artifacts.metadata.source]: "Source: {{sourceType}}",
  [KEYS.artifacts.metadata.public]: "Public: {{isPublic}}",

  // Conversation translations
  [KEYS.conversation.defaultTitle]: "Conversation",
  [KEYS.conversation.failed]: "Operation failed",
  [KEYS.conversation.completed]: "Completed successfully",

  // Integrations translations - command+click to navigate!
  [KEYS.integrations.title]: compose("{{term.Integrations}}"),
  [KEYS.integrations.loadingIntegrations]:
    patterns.loadingEntity("integrations"),
  [KEYS.integrations.allConfigured]: compose(
    "All available {{term.integrations}} have been configured.",
  ),
  [KEYS.integrations.noIntegrations]: compose(
    "No {{term.integrations}} available at this time.",
  ),
  [KEYS.integrations.addNew]: compose("Add New {{term.Integration}}"),
  [KEYS.integrations.dialog.add]: "Add",
  [KEYS.integrations.dialog.edit]: "Edit",
  [KEYS.integrations.dialog.createIntegration]: "Create Integration",
  [KEYS.integrations.dialog.updateIntegration]: "Update Integration",
  [KEYS.integrations.dialog.selectType]: "Select Integration Type",
  [KEYS.integrations.dialog.integrationType]: "Integration Type",
  [KEYS.integrations.dialog.chooseService]: "Choose the service to integrate",
  [KEYS.integrations.dialog.cannotBeChanged]: "(cannot be changed)",
  [KEYS.integrations.dialog.integrationTypes.github]: "GitHub",
  [KEYS.integrations.dialog.integrationTypes.jira]: "Jira",
  [KEYS.integrations.dialog.placeholders.githubRepo]: "My GitHub Repository",
  [KEYS.integrations.dialog.placeholders.jiraProject]: "My Jira Project",
  [KEYS.integrations.github.configuration]: "GitHub Configuration",
  [KEYS.integrations.github.personalAccessToken]:
    "GitHub Personal Access Token",
  [KEYS.integrations.github.tokenHelp]:
    "Your PAT needs these scopes: repo (for private repos) and admin:org_hook (for organization webhooks).",
  [KEYS.integrations.github.createToken]: "Create a new token",
  [KEYS.integrations.github.targetType]: "Target Type",
  [KEYS.integrations.github.singleRepository]: "Single Repository",
  [KEYS.integrations.github.entireOrganization]: "Entire Organization",
  [KEYS.integrations.github.repositoryUrl]: "Repository URL",
  [KEYS.integrations.github.repositoryUrlPlaceholder]:
    "https://github.com/owner/repository",
  [KEYS.integrations.github.repositoryUrlHelp]:
    "Full URL to the GitHub repository. If blank, the integration will be created for all user repositories.",
  [KEYS.integrations.github.organizationName]: "Organization Name",
  [KEYS.integrations.github.organizationNamePlaceholder]: "my-org",
  [KEYS.integrations.github.organizationNameHelp]:
    "GitHub organization name (not the full URL)",
  [KEYS.integrations.github.selectRepository]: "Search and select a repository",
  [KEYS.integrations.github.noRepositoriesFound]:
    "No repositories match your search",
  [KEYS.integrations.github.noRepositoriesAvailable]:
    "No repositories available",
  [KEYS.integrations.github.repositoriesCount]:
    "{{count}} repositories available",
  [KEYS.integrations.github.loadingRepositories]: "Loading repositories...",
  [KEYS.integrations.github.primaryRepository]: "Primary Repository",
  [KEYS.integrations.github.selectPrimaryRepository]:
    "Select the primary repository for this service",
  [KEYS.integrations.github.repositorySelected]: "Repository selected",
  [KEYS.integrations.github.repositorySelectionHelp]:
    "Select the GitHub repository that this service is associated with. This will be used for tracking code changes and development activity.",
  [KEYS.integrations.github.connectGitHub]: "Connect GitHub Account",
  [KEYS.integrations.github.connecting]: "Connecting...",
  [KEYS.integrations.github.oauthRedirectInfo]:
    "You will be redirected to GitHub to authorize access. After authorization, you'll be redirected back to complete the setup.",
  [KEYS.integrations.github.oauthFlowDescription]:
    "Click the button below to connect your GitHub account. You'll be securely redirected to GitHub to authorize access.",
  [KEYS.integrations.github.connectionStatus]: "Connection Status",
  [KEYS.integrations.github.connectedOrganization]: "Connected Organization",
  [KEYS.integrations.github.grantedScopes]: "Granted Scopes",
  [KEYS.integrations.github.accessToken]: "Access Token",
  [KEYS.integrations.github.expired]: "Expired",
  [KEYS.integrations.github.expiresAt]: "Expires: {{date}}",
  [KEYS.integrations.github.lastSync]: "Last Sync",
  [KEYS.integrations.github.disconnect]: "Disconnect",
  [KEYS.integrations.github.disconnecting]: "Disconnecting...",
  [KEYS.integrations.github.reconnect]: "Reconnect",
  [KEYS.integrations.github.disconnectConfirmTitle]:
    "Disconnect GitHub Account?",
  [KEYS.integrations.github.disconnectConfirmMessage]:
    "This will clear the OAuth tokens and disconnect your GitHub account. You can reconnect at any time. Webhooks and repository data will be preserved.",
  [KEYS.integrations.github.tokenExpiredWarning]:
    "Your GitHub token has expired. Please reconnect your account to continue using this integration.",
  [KEYS.integrations.jira.configuration]: "Jira Configuration",
  [KEYS.integrations.jira.instanceType]: "Instance Type",
  [KEYS.integrations.jira.jiraCloud]: "Jira Cloud",
  [KEYS.integrations.jira.jiraServerDataCenter]: "Jira Server/Data Center",
  [KEYS.integrations.jira.jiraCloudUrl]: "Jira Cloud URL",
  [KEYS.integrations.jira.jiraServerUrl]: "Jira Server URL",
  [KEYS.integrations.jira.jiraCloudUrlPlaceholder]:
    "https://your-domain.atlassian.net",
  [KEYS.integrations.jira.jiraServerUrlPlaceholder]:
    "https://your-jira-server.com",
  [KEYS.integrations.jira.jiraCloudUrlHelp]:
    "Your Atlassian Cloud instance URL",
  [KEYS.integrations.jira.jiraServerUrlHelp]:
    "Your on-premises Jira server URL",
  [KEYS.integrations.jira.emailAddress]: "Email Address",
  [KEYS.integrations.jira.emailPlaceholder]: "your-email@company.com",
  [KEYS.integrations.jira.emailHelp]:
    "The email address associated with your Jira account",
  [KEYS.integrations.jira.apiToken]: "API Token",
  [KEYS.integrations.jira.passwordApiToken]: "Password/API Token",
  [KEYS.integrations.jira.apiTokenHelp]:
    "Create an API token in your Atlassian Account Settings",
  [KEYS.integrations.jira.serverPasswordHelp]:
    "Your Jira password or API token (recommended)",
  [KEYS.integrations.jira.projectKey]: "Project Key (Optional)",
  [KEYS.integrations.jira.projectKeyPlaceholder]: "PROJ",
  [KEYS.integrations.jira.projectKeyHelp]:
    "Specify a project key to limit integration to a specific project, or leave blank for all projects",
  [KEYS.integrations.jira.serverAlert]:
    "For Jira Server/Data Center instances, ensure your server is accessible from our service and that you have the necessary permissions to create and manage issues.",
  [KEYS.integrations.forms.name]: "Name",
  [KEYS.integrations.forms.description]: "Description",
  [KEYS.integrations.forms.testConnection]: "Test Connection",
  [KEYS.integrations.forms.testingConnection]: "Testing Connection...",
  [KEYS.integrations.forms.fillRequiredFields]:
    "Please fill in all required fields first.",
  [KEYS.integrations.forms.orgIdNotAvailable]:
    "Organization ID not available. Please refresh and try again.",
  [KEYS.integrations.forms.connectionTestSuccess]:
    "Connection test successful!",
  [KEYS.integrations.forms.connectionTestFailed]: "Connection test failed",
  [KEYS.integrations.forms.connectionNotImplemented]:
    "Connection testing is not implemented for {{type}} yet.",
  [KEYS.integrations.forms.noHelpAvailable]:
    "No help available for this integration type.",

  // Auth translations - command+click to navigate!
  [KEYS.auth.login]: "Login",
  [KEYS.auth.logout]: "Logout",
  [KEYS.auth.welcome]: "Welcome back!",
  [KEYS.auth.signIn]: "Sign In",
  [KEYS.auth.changePassword]: "Change Password",
  [KEYS.auth.currentPassword]: "Current Password",
  [KEYS.auth.newPassword]: "New Password",
  [KEYS.auth.confirmPassword]: "Confirm New Password",
  [KEYS.auth.passwordChanged]: "Password changed successfully",
  [KEYS.auth.passwordChangeFailed]: "Unable to change password",
  [KEYS.auth.mustChangePassword]:
    "You must set a new password before continuing",
  [KEYS.auth.setNewPassword]: "Set New Password",

  // Beta onboarding translations
  [KEYS.betaOnboarding.title]: "Beta User Onboarding",
  [KEYS.betaOnboarding.emailLabel]: "Email Address",
  [KEYS.betaOnboarding.nameLabel]: "Full Name",
  [KEYS.betaOnboarding.organizationNameLabel]: "Organization Name",
  [KEYS.betaOnboarding.submit]: "Create Beta User",
  [KEYS.betaOnboarding.successMessage]: "Beta user created successfully",
  [KEYS.betaOnboarding.accessDenied]:
    "Access denied. Admin privileges required.",

  // Forms translations - command+click to navigate!
  [KEYS.forms.required]: "This field is required",
  [KEYS.forms.invalidEmail]: "Please enter a valid email address",
  [KEYS.forms.passwordTooShort]: "Password must be at least 8 characters",
  [KEYS.forms.passwordMismatch]: "Passwords do not match",

  // Alerts translations - command+click to navigate!
  [KEYS.alerts.deleteSuccess]: "Successfully deleted",
  [KEYS.alerts.createSuccess]: "Successfully created",
  [KEYS.alerts.updateSuccess]: "Successfully updated",
  [KEYS.alerts.saveSuccess]: "Successfully saved",
  [KEYS.alerts.errorOccurred]: "An error occurred",
  [KEYS.alerts.tryAgain]: "Please try again",

  // Complete onboarding translations - command+click to navigate!
  [KEYS.completeOnboarding.title]: "Complete Project Setup",
  [KEYS.completeOnboarding.description]:
    "Ready to activate your project? Click the button below to complete onboarding and start building!",
  [KEYS.completeOnboarding.button.complete]: "Complete Onboarding",
  [KEYS.completeOnboarding.button.completing]: "Completing...",
  [KEYS.completeOnboarding.completed.title]: "🎉 Onboarding Complete!",
  [KEYS.completeOnboarding.completed.subtitle]:
    "Your project is now active and ready for action.",
  [KEYS.completeOnboarding.featureTree.title]: "Your Project",
  [KEYS.completeOnboarding.featureTree.description]:
    "A preview of the features and work we'll start tackling together.",
  [KEYS.completeOnboarding.featureTree.empty]:
    "No features yet — they'll appear here as your project takes shape.",
  [KEYS.completeOnboarding.featureTree.tasksPlaceholder]: "Task",
  [KEYS.completeOnboarding.errors.missingRequirements]:
    "Missing required information. Please check your session and try again.",
  [KEYS.completeOnboarding.errors.updateFailed]:
    "Failed to complete onboarding. Please try again.",
  [KEYS.completeOnboarding.notPermitted]:
    "Only a project owner or architect can complete onboarding.",

  // Team Members translations - command+click to navigate!
  [KEYS.teamMembers.selectedMembers]: "Selected Members",
  [KEYS.teamMembers.suggestedUsers]: "Suggested Users",
  [KEYS.teamMembers.acceptAll]: "Accept All",
  [KEYS.teamMembers.rejectAll]: "Reject All",
  [KEYS.teamMembers.invalidEmail]: "Please enter a valid email address",
  [KEYS.teamMembers.emailExists]: "This email is already added",
  [KEYS.teamMembers.pressEnterToAdd]: "Press Enter to add",
  [KEYS.teamMembers.addManualEmail]: "Add email manually",
  [KEYS.teamMembers.emailAddress]: "Email Address",
  [KEYS.teamMembers.emailPlaceholder]: "email@example.com",
  [KEYS.teamMembers.enterValidEmail]: "Please enter a valid email address",
  [KEYS.teamMembers.addButton]: "Add",

  // Conversation translations - command+click to navigate!
  [KEYS.conversation.sending]: "Sending your message...",
  [KEYS.conversation.sent]: "Message sent! Processing your request...",
  [KEYS.conversation.systemMessageFailed]:
    "Something went wrong processing your request. Please try again.",
  [KEYS.conversation.suggestedAction.initiativeLabel]: "Initiative",
  [KEYS.conversation.suggestedAction.initiativePlaceholder]:
    "Select an initiative",
  [KEYS.conversation.suggestedAction.parentTaskLabel]: "Parent task (optional)",
  [KEYS.conversation.suggestedAction.parentTaskPlaceholder]:
    "Select a parent task",
  [KEYS.conversation.suggestedAction.notesLabel]:
    "Additional context (optional)",
  [KEYS.conversation.suggestedAction.notesPlaceholder]:
    "Add any extra details for this task",
  [KEYS.conversation.suggestedAction.cancel]: "Cancel",
  [KEYS.conversation.suggestedAction.create]: "Create",
  [KEYS.conversation.suggestedAction.generated]: "Generated",
  [KEYS.conversation.suggestedAction.rejected]: "Rejected",

  // Conversation tabs
  [KEYS.conversation.tabs.active]: "Active",
  [KEYS.conversation.tabs.history]: "History",

  // Conversation history
  [KEYS.conversation.history.empty]: "No History",
  [KEYS.conversation.history.noOtherConversations]:
    "There are no other conversations for this item.",
  [KEYS.conversation.history.untitled]: "Untitled Conversation",
  [KEYS.conversation.history.message]: "message",
  [KEYS.conversation.history.messages]: "messages",
  [KEYS.conversation.history.created]: "Created",
  [KEYS.conversation.history.updated]: "Updated",

  [KEYS.conversation.analysis.title]: "Analysis Results",
  [KEYS.conversation.analysis.recommendations]: "Recommendations",
  [KEYS.conversation.analysis.challenges]: "Potential Challenges",
  [KEYS.conversation.analysis.mitigation]: "Mitigation",
  [KEYS.conversation.analysis.technologies]: "Identified Technologies",
  [KEYS.conversation.analysis.complexity]: "Integration Complexity",
  [KEYS.conversation.analysis.reasoning]: "Reasoning",
  [KEYS.conversation.analysis.next]: "Next",

  // Version conflict translations
  [KEYS.conversation.versionConflict.title]: "Conversation Updated",
  [KEYS.conversation.versionConflict.description]:
    "This conversation was updated by another user while you were composing your message.",
  [KEYS.conversation.versionConflict.expectedVersion]:
    "Your version: {{version}}",
  [KEYS.conversation.versionConflict.currentVersion]:
    "Latest version: {{version}}",
  [KEYS.conversation.versionConflict.explanationSingle]:
    "One new update was made to this conversation while you were typing.",
  [KEYS.conversation.versionConflict.explanationMultiple]:
    "{{count}} updates were made to this conversation while you were typing.",
  [KEYS.conversation.versionConflict.explanationGeneric]:
    "The conversation was updated while you were typing your message.",
  [KEYS.conversation.versionConflict.latestChanges]: "Recent changes",
  [KEYS.conversation.versionConflict.lastUpdate]: "Last updated",
  [KEYS.conversation.versionConflict.messageCount]: "Messages",
  [KEYS.conversation.versionConflict.conversationTitle]: "Title",
  [KEYS.conversation.versionConflict.resolutionTitle]: "What happens next?",
  [KEYS.conversation.versionConflict.resolutionInstructions]:
    "Your message will be submitted with the latest conversation state to ensure consistency.",
  [KEYS.conversation.versionConflict.retryWithLatest]:
    "Submit with Latest Changes",
  [KEYS.conversation.versionConflict.retrying]: "Submitting...",

  // Workflow translations - command+click to navigate!
  [KEYS.workflow.templates.title]: "Workflow Templates",
  [KEYS.workflow.templates.searchPlaceholder]: "Search templates...",
  [KEYS.workflow.templates.sortBy]: "Sort by",
  [KEYS.workflow.templates.order]: "Order",
  [KEYS.workflow.templates.filters]: "Filters",
  [KEYS.workflow.templates.activeFilters]: "Active filters",
  [KEYS.workflow.templates.filterByStatus]: "Filter by status",
  [KEYS.workflow.templates.noResults]: "No workflows found",
  [KEYS.workflow.templates.tryAdjustingFilters]: "Try adjusting your filters",

  [KEYS.workflow.fields.name]: "Name",
  [KEYS.workflow.fields.created]: "Created",
  [KEYS.workflow.fields.updated]: "Updated",
  [KEYS.workflow.fields.executions]: "Executions",
  [KEYS.workflow.fields.search]: "Search",
  [KEYS.workflow.fields.nodes]: "Nodes",
  [KEYS.workflow.fields.lastExecuted]: "Last executed",

  [KEYS.workflow.sort.ascending]: "Ascending",
  [KEYS.workflow.sort.descending]: "Descending",

  [KEYS.workflow.diagram.noNodes]: "No workflow nodes found",
  [KEYS.workflow.diagram.simulationMode]: "Simulation mode",
  [KEYS.workflow.diagram.loadingStructure]: "Loading workflow structure...",

  [KEYS.workflow.status.current]: "Current",

  [KEYS.workflow.node.hasConfiguration]: "Has configuration",

  [KEYS.workflow.errors.loadTemplate]:
    "Failed to load workflow template: {{error}}",
  [KEYS.workflow.errors.loadTemplates]:
    "Failed to load workflow templates: {{error}}",

  [KEYS.workflow.actions.back]: "Back",
  [KEYS.workflow.actions.refresh]: "Refresh",
  [KEYS.workflow.actions.execute]: "Execute",
  [KEYS.workflow.actions.simulate]: "Simulate",
  [KEYS.workflow.actions.edit]: "Edit",
  [KEYS.workflow.actions.share]: "Share",
  [KEYS.workflow.actions.export]: "Export",
  [KEYS.workflow.actions.clearFilters]: "Clear filters",
  [KEYS.workflow.actions.view]: "View",
  [KEYS.workflow.actions.details]: "Details",

  [KEYS.workflow.tabs.overview]: "Overview",
  [KEYS.workflow.tabs.diagram]: "Diagram",
  [KEYS.workflow.tabs.simulation]: "Simulation",
  [KEYS.workflow.tabs.executions]: "Executions",
  [KEYS.workflow.tabs.analytics]: "Analytics",
  [KEYS.workflow.tabs.raw]: "Raw",

  [KEYS.workflow.simulation.loadingStructure]: "Loading workflow structure...",

  [KEYS.workflow.never]: "Never",

  // Workflow admin UI translations - command+click to navigate!
  [KEYS.workflow.monitoring.title]: "Workflow Monitoring",
  [KEYS.workflow.monitoring.executionStatus]: "Execution Status",
  [KEYS.workflow.monitoring.performance]: "Performance",
  [KEYS.workflow.monitoring.agentExecutions]: "Agent Executions",
  [KEYS.workflow.monitoring.systemHealth]: "System Health",
  [KEYS.workflow.monitoring.activeAlerts]: "Active Alerts",
  [KEYS.workflow.monitoring.duration]: "Duration",
  [KEYS.workflow.monitoring.inProgress]: "In progress",
  [KEYS.workflow.monitoring.averageStepDuration]: "Average step duration",
  [KEYS.workflow.monitoring.successRate]: "Success rate",
  [KEYS.workflow.monitoring.memory]: "Memory",
  [KEYS.workflow.monitoring.healthStatus.healthy]: "Healthy",
  [KEYS.workflow.monitoring.healthStatus.degraded]: "Degraded",
  [KEYS.workflow.monitoring.healthStatus.unhealthy]: "Unhealthy",

  [KEYS.workflow.context.title]: "Context Management",
  [KEYS.workflow.context.versions]: "Context Versions",
  [KEYS.workflow.context.sharedContexts]: "Shared Contexts",
  [KEYS.workflow.context.createSnapshot]: "Create Snapshot",
  [KEYS.workflow.context.rollback]: "Rollback",
  [KEYS.workflow.context.version]: "v{{version}}",
  [KEYS.workflow.context.reason]: "{{reason}}",
  [KEYS.workflow.context.manualSnapshot]: "Manual snapshot",
  [KEYS.workflow.context.userRequestedRollback]: "User-requested rollback",
  [KEYS.workflow.context.manual]: "manual",
  [KEYS.workflow.context.checkpoint]: "checkpoint",

  [KEYS.workflow.agents.title]: "Agent Coordination",
  [KEYS.workflow.agents.poolStatus]: "Agent Pool Status",
  [KEYS.workflow.agents.activeAgents]: "Active Agents",
  [KEYS.workflow.agents.tasksProcessed]: "Tasks Processed",
  [KEYS.workflow.agents.coordinationEvents]: "Coordination Events",
  [KEYS.workflow.agents.agentRegistered]: "Agent Registered",
  [KEYS.workflow.agents.agentDisconnected]: "Agent Disconnected",
  [KEYS.workflow.agents.taskAssigned]: "Task Assigned",
  [KEYS.workflow.agents.taskCompleted]: "Task Completed",
  [KEYS.workflow.agents.taskFailed]: "Task Failed",
  [KEYS.workflow.agents.status.idle]: "Idle",
  [KEYS.workflow.agents.status.busy]: "Busy",
  [KEYS.workflow.agents.status.error]: "Error",
  [KEYS.workflow.agents.status.offline]: "Offline",

  [KEYS.workflow.timeline.title]: "Workflow Timeline",
  [KEYS.workflow.timeline.loading]: "Loading timeline...",
  [KEYS.workflow.timeline.error]: "Failed to load timeline",
  [KEYS.workflow.timeline.noData]: "No timeline data available",
  [KEYS.workflow.timeline.noWorkflowId]: "No workflow ID provided",
  [KEYS.workflow.timeline.noNodes]: "No workflow nodes found",
  [KEYS.workflow.timeline.noSteps]: "No steps recorded for this node",
  [KEYS.workflow.timeline.noOrphans]: "No orphaned events",
  [KEYS.workflow.timeline.timelineTab]: "Timeline",
  [KEYS.workflow.timeline.orphanedTab]: "Orphaned",
  [KEYS.workflow.timeline.showDebugLogs]: "Debug logs",
  [KEYS.workflow.timeline.node]: "node",
  [KEYS.workflow.timeline.step]: "step",
  [KEYS.workflow.timeline.steps]: "steps",
  [KEYS.workflow.timeline.event]: "event",
  [KEYS.workflow.timeline.events]: "events",
  [KEYS.workflow.timeline.duration]: "Duration",
  [KEYS.workflow.timeline.started]: "Started",
  [KEYS.workflow.timeline.ended]: "Ended",
  [KEYS.workflow.timeline.status]: "Status",
  [KEYS.workflow.timeline.timestamp]: "Timestamp",
  [KEYS.workflow.timeline.logger]: "Logger",
  [KEYS.workflow.timeline.message]: "Message",
  [KEYS.workflow.timeline.metadata]: "Metadata",
  [KEYS.workflow.timeline.runId]: "Run ID",
  [KEYS.workflow.timeline.runIds]: "Run IDs",
  [KEYS.workflow.timeline.nodeId]: "Node ID",
  [KEYS.workflow.timeline.stepName]: "Step Name",
  [KEYS.workflow.timeline.confidence]: "Confidence",
  [KEYS.workflow.timeline.orphanEvents]: "Unassigned Events",
  [KEYS.workflow.timeline.globalOrphans]: "Unassigned Events (Global)",
  [KEYS.workflow.timeline.firstNode]: "Start",
  [KEYS.workflow.timeline.eventDetails]: "Event Details",
  [KEYS.workflow.timeline.copyEvent]: "Copy Event",
  [KEYS.workflow.timeline.zoomIn]: "Zoom In",
  [KEYS.workflow.timeline.zoomOut]: "Zoom Out",
  [KEYS.workflow.timeline.resetZoom]: "Reset Zoom",
  [KEYS.workflow.timeline.refresh]: "Refresh",
  [KEYS.workflow.timeline.viewTimeline]: "View Timeline",
  [KEYS.workflow.timeline.stats.total]: "Total Entries",
  [KEYS.workflow.timeline.stats.assigned]: "Assigned",
  [KEYS.workflow.timeline.stats.orphaned]: "Orphaned",

  // Walkthrough translations
  [KEYS.walkthrough.welcome.title]: compose(
    "Welcome to {{term.Initiative}} Editor",
  ),
  [KEYS.walkthrough.welcome.content]:
    "This is a collaborative editor that reveals sections progressively. Start with a high-level description, then expand into details and acceptance criteria as you refine your initiative.",

  [KEYS.walkthrough.description.title]: "Start with Description",
  [KEYS.walkthrough.description.content]:
    "Begin by writing a clear, high-level description of your initiative. Focus on what you want to achieve rather than how. You can edit this text directly and save your changes at any time.",

  [KEYS.walkthrough.skeleton.title]: "Progressive Section Reveal",
  [KEYS.walkthrough.skeleton.content]:
    "Notice how the Details and Acceptance Criteria sections appear as placeholder skeletons. This incremental approach helps you focus on one aspect at a time.",

  [KEYS.walkthrough.reveal.title]: "Reveal Sections",
  [KEYS.walkthrough.reveal.content]:
    "Click the reveal buttons to generate content for the next sections using AI assistance, or expand them manually when you're ready. The system will use your description as context to suggest relevant details.",

  [KEYS.walkthrough.chat.title]: "Chat for Assistance",
  [KEYS.walkthrough.chat.content]:
    "Use the conversation panel to ask questions, request changes, or get suggestions from the AI. Your changes are collaborative - you can accept, modify, or reject AI suggestions while maintaining full control.",

  [KEYS.walkthrough.save.title]: "Save Your Progress",
  [KEYS.walkthrough.save.content]:
    "Save your work silently to preserve changes, or save with feedback to get AI suggestions for improvements. Your edit history is preserved, so you can always revert changes if needed.",

  [KEYS.walkthrough.navigation.previous]: "Previous",
  [KEYS.walkthrough.navigation.next]: "Next",
  [KEYS.walkthrough.navigation.skip]: "Skip Tour",
  [KEYS.walkthrough.navigation.finish]: "Get Started",

  // Design Doc Editor Walkthrough translations
  [KEYS.walkthrough.designDocEditor.welcome.title]:
    "Welcome to Design Doc Editor",
  [KEYS.walkthrough.designDocEditor.welcome.content]:
    "This is a collaborative editor for creating structured design documents. The editor guides you through a progressive disclosure approach, revealing sections as you work through your document.",

  [KEYS.walkthrough.designDocEditor.editorSections.title]: "Editor Sections",
  [KEYS.walkthrough.designDocEditor.editorSections.content]:
    "The main editor area contains your document sections. Each section can be edited directly, with real-time collaboration support and AI assistance available throughout the process.",

  [KEYS.walkthrough.designDocEditor.statusChip.title]: "Status Indicator",
  [KEYS.walkthrough.designDocEditor.statusChip.content]:
    "The status chip shows the current state of your design document. Different statuses unlock different sections and workflows.",

  [KEYS.walkthrough.designDocEditor.skeletonSections.title]: "Locked Sections",
  [KEYS.walkthrough.designDocEditor.skeletonSections.content]:
    "Sections appear as skeletons until they're revealed. This progressive approach helps you focus on one aspect at a time and ensures each section builds on the previous one.",

  [KEYS.walkthrough.designDocEditor.revealButtons.title]: "Reveal Next Section",
  [KEYS.walkthrough.designDocEditor.revealButtons.content]:
    "Use the reveal buttons to unlock the next section when you're ready. The AI will use your previous work as context to help generate content for the new section.",

  [KEYS.walkthrough.designDocEditor.conversationViewer.title]:
    "AI Conversation",
  [KEYS.walkthrough.designDocEditor.conversationViewer.content]:
    "The conversation panel provides AI assistance throughout your work. Ask questions, request changes, or get suggestions. The AI has full context of your document and can help refine your content.",

  // Project Landing translations
  [KEYS.projectLanding.title]: "Project Landing",
  [KEYS.projectLanding.subtitle]: "Project overview dashboard",
  [KEYS.projectLanding.overview]: "Project Overview",
  [KEYS.projectLanding.description]: compose(
    "Monitor {{term.initiatives}}, integrations, and project resources from a unified dashboard",
  ),
  [KEYS.projectLanding.refreshAll]: "Refresh All Sections",
  [KEYS.projectLanding.customizeLayout]: "Customize Layout",
  [KEYS.projectLanding.exitCustomization]: "Exit Customization",
  [KEYS.projectLanding.viewMode]: "View Mode",

  // Persona translations
  [KEYS.projectLanding.personas.developer]: "Developer",
  [KEYS.projectLanding.personas.productManager]: "Product Manager",
  [KEYS.projectLanding.personas.designer]: "Designer",
  [KEYS.projectLanding.personas.developerDesc]:
    "Focus on technical integrations, code artifacts, and development workflows",
  [KEYS.projectLanding.personas.productManagerDesc]:
    "Focus on initiatives, progress tracking, and strategic overview",
  [KEYS.projectLanding.personas.designerDesc]:
    "Focus on design documents, artifacts, and creative resources",

  // Section translations
  [KEYS.projectLanding.sections.tasks.title]: compose("{{term.Tasks}}"),
  [KEYS.projectLanding.sections.tasks.description]:
    "Active work items across all initiatives",
  [KEYS.projectLanding.sections.tasks.noTasks]: compose(
    "No {{term.tasks}} found",
  ),
  [KEYS.projectLanding.sections.tasks.createFirst]:
    patterns.createFirstEntity("task"),

  [KEYS.projectLanding.sections.initiatives.title]: compose(
    "{{term.Initiatives}}",
  ),
  [KEYS.projectLanding.sections.initiatives.description]: compose(
    "Track project {{term.initiatives}} and progress",
  ),
  [KEYS.projectLanding.sections.initiatives.progressOverview]:
    "Progress Overview",
  [KEYS.projectLanding.sections.initiatives.total]: "Total",
  [KEYS.projectLanding.sections.initiatives.active]: "Active",
  [KEYS.projectLanding.sections.initiatives.done]: "Done",
  [KEYS.projectLanding.sections.initiatives.viewMore]:
    "View {{count}} more initiatives",
  [KEYS.projectLanding.sections.initiatives.noInitiatives]: compose(
    "No {{term.initiatives}} yet",
  ),
  [KEYS.projectLanding.sections.initiatives.createFirst]:
    patterns.createFirstEntity("initiative"),

  [KEYS.projectLanding.sections.integrations.title]: compose(
    "{{term.Integrations}}",
  ),
  [KEYS.projectLanding.sections.integrations.description]:
    "Manage external service connections",
  [KEYS.projectLanding.sections.integrations.connectionHealth]:
    "Connection Health",
  [KEYS.projectLanding.sections.integrations.total]: "Total",
  [KEYS.projectLanding.sections.integrations.active]: "Active",
  [KEYS.projectLanding.sections.integrations.issues]: "Issues",
  [KEYS.projectLanding.sections.integrations.needAttention]:
    "{{count}} integration{{plural}} need attention",
  [KEYS.projectLanding.sections.integrations.lastSync]: "Last sync: {{time}}",
  [KEYS.projectLanding.sections.integrations.viewMore]:
    "View {{count}} more integrations",
  [KEYS.projectLanding.sections.integrations.noIntegrations]: compose(
    "No {{term.integrations}} yet",
  ),
  [KEYS.projectLanding.sections.integrations.connectServices]:
    "Connect external services to sync data",

  [KEYS.projectLanding.sections.designDocuments.title]: "Documents & Files",
  [KEYS.projectLanding.sections.designDocuments.description]:
    "Access design docs and project files",
  [KEYS.projectLanding.sections.designDocuments.storageUsage]: "Storage Usage",
  [KEYS.projectLanding.sections.designDocuments.categories]: "Categories",
  [KEYS.projectLanding.sections.designDocuments.recentItems]: "Recent Items",
  [KEYS.projectLanding.sections.designDocuments.viewMore]:
    "View {{count}} more items",
  [KEYS.projectLanding.sections.designDocuments.noDocuments]:
    "No documents yet",
  [KEYS.projectLanding.sections.designDocuments.uploadToStart]:
    "Upload files or create artifacts to get started",
  [KEYS.projectLanding.sections.designDocuments.upload]: "Upload",
  [KEYS.projectLanding.sections.designDocuments.browseAll]: "Browse All",

  // Action translations
  [KEYS.projectLanding.actions.viewAll]: "View All",
  [KEYS.projectLanding.actions.manage]: "Manage",
  [KEYS.projectLanding.actions.add]: "Add",
  [KEYS.projectLanding.actions.upload]: "Upload",
  [KEYS.projectLanding.actions.browse]: "Browse",

  // Error translations
  [KEYS.projectLanding.errors.projectNotFound]:
    "Project or organization not found. Please check the URL and try again.",
  [KEYS.projectLanding.errors.loadingFailed]:
    "Failed to load project data. Please refresh the page and try again.",

  // Design Doc Help translations
  [KEYS.designDoc.help.dialog.title]: "Design Document Help",
  [KEYS.designDoc.help.restartWalkthrough]: "Restart Walkthrough",
  [KEYS.designDoc.help.tabs.ariaLabel]: "Help content tabs",
  [KEYS.designDoc.help.tabs.general]: "General",
  [KEYS.designDoc.help.tabs.templateSpecific]: "Template Specific",
  [KEYS.designDoc.help.noTemplateHelp]:
    "No specific help available for {{template}} template.",

  // General Design Doc Help
  [KEYS.designDoc.help.general.overview.title]: "What is a Design Document?",
  [KEYS.designDoc.help.general.overview.content]:
    "Design documents are structured templates for capturing important technical decisions, system designs, and architectural choices. They provide a collaborative space for thinking through complex problems with AI assistance.",

  [KEYS.designDoc.help.general.features.title]: "Key Features",
  [KEYS.designDoc.help.general.features.progressiveDisclosure]:
    "Progressive Disclosure - Sections are revealed incrementally, helping you focus on one aspect at a time",
  [KEYS.designDoc.help.general.features.collaboration]:
    "Real-time Collaboration - Multiple users can edit the same document simultaneously with conflict-free merging",
  [KEYS.designDoc.help.general.features.aiAssistance]:
    "AI Assistance - Get suggestions, improvements, and context-aware help throughout your document",
  [KEYS.designDoc.help.general.features.versionHistory]:
    "Version History - Track changes over time and see what was modified and when",

  [KEYS.designDoc.help.general.workflow.title]: "How to Use",
  [KEYS.designDoc.help.general.workflow.step1]:
    "Start with the first section and provide your initial thoughts",
  [KEYS.designDoc.help.general.workflow.step2]:
    "Use the AI conversation panel to refine your content and ask questions",
  [KEYS.designDoc.help.general.workflow.step3]:
    "Click reveal buttons to unlock subsequent sections when ready",
  [KEYS.designDoc.help.general.workflow.step4]:
    "Continue iterating with AI assistance until your document is complete",

  // ADR-Specific Help
  [KEYS.designDoc.help.adr.concept.title]: "What is an ADR?",
  [KEYS.designDoc.help.adr.concept.description]:
    "Architecture Decision Records (ADRs) document important architectural decisions made during a project. They capture not just the decision itself, but the context that led to it and the consequences that follow.",
  [KEYS.designDoc.help.adr.concept.purpose]:
    "ADRs help teams understand why certain choices were made, prevent revisiting old debates, and onboard new team members by preserving architectural context.",

  [KEYS.designDoc.help.adr.structure.title]: "Three-Level Structure",
  [KEYS.designDoc.help.adr.structure.description]:
    "ADRs use a progressive three-level approach to guide you through documenting your decision:",

  [KEYS.designDoc.help.adr.structure.context.title]: "1. Context",
  [KEYS.designDoc.help.adr.structure.context.description]:
    "Describe the situation, problem, or forces that necessitate this decision. What challenges are you facing? What constraints exist?",
  [KEYS.designDoc.help.adr.structure.context.status]: "Status: Draft",

  [KEYS.designDoc.help.adr.structure.decision.title]: "2. Decision",
  [KEYS.designDoc.help.adr.structure.decision.description]:
    "State the decision you've made clearly. What specific approach or solution have you chosen? What alternatives did you consider?",
  [KEYS.designDoc.help.adr.structure.decision.status]: "Status: Proposed",

  [KEYS.designDoc.help.adr.structure.consequences.title]: "3. Consequences",
  [KEYS.designDoc.help.adr.structure.consequences.description]:
    "Document the positive and negative impacts of this decision. What becomes easier? What becomes harder? What trade-offs are you making?",
  [KEYS.designDoc.help.adr.structure.consequences.status]:
    "Status: Accepted/Rejected/Deprecated/Superseded",

  [KEYS.designDoc.help.adr.tips.title]: "Tips for Effective ADRs",
  [KEYS.designDoc.help.adr.tips.progressive]:
    "Work through sections in order - each section builds on the previous one and provides context for the next",
  [KEYS.designDoc.help.adr.tips.aiAssistance]:
    "Use AI assistance to explore alternatives, challenge assumptions, and refine your thinking",
  [KEYS.designDoc.help.adr.tips.collaboration]:
    "Collaborate with your team - ADRs benefit from multiple perspectives and domain expertise",
  [KEYS.designDoc.help.adr.tips.specific]:
    "Be specific and concrete - vague decisions are hard to evaluate and harder to reverse",
  [KEYS.designDoc.help.adr.tips.alternatives]:
    "Document alternatives considered - this prevents revisiting old debates and shows you did your homework",
  [KEYS.designDoc.help.adr.tips.tradeoffs]:
    "Be honest about trade-offs - every decision has downsides, and acknowledging them builds trust",
  [KEYS.designDoc.help.adr.tips.revealButton]:
    "Don't rush to reveal sections - take time to fully develop each level before moving forward",

  // ADR Task Generation
  [KEYS.adr.taskGeneration.title]: "Create tasks for ADR",

  // Attention Events
  [KEYS.attentionEvents.title]: "Recent Activity",
  [KEYS.attentionEvents.subtitle]:
    "Entities you've recently viewed or focused on",
  [KEYS.attentionEvents.empty]: "No recent activity to display",
  [KEYS.attentionEvents.error]: "Failed to load attention events",
  [KEYS.attentionEvents.sort.recent]: "Most Recent",
  [KEYS.attentionEvents.sort.active]: "Most Active",
  [KEYS.attentionEvents.sort.mixed]: "Mixed",
  [KEYS.attentionEvents.duration.minutes]: "{{count}} min",
  [KEYS.attentionEvents.duration.seconds]: "{{count}} sec",

  // Explorer - VSCode-style sidebar navigation
  [KEYS.explorer.loading]: "Loading entities...",
  [KEYS.explorer.error]: "Failed to load entities",
  [KEYS.explorer.noResults]: "No matching entities found",
  [KEYS.explorer.searchPlaceholder]: "Search entities...",
  [KEYS.explorer.clearSearch]: "Clear search",
  [KEYS.explorer.advancedSearch]: "Advanced search",
  [KEYS.explorer.results]: "{{count}} results",
  [KEYS.explorer.entityType]: "Entity Type",
  [KEYS.explorer.status]: "Status",
  [KEYS.explorer.tags]: "Tags",
  [KEYS.explorer.addTag]: "Add tag...",
  [KEYS.explorer.modifiedWithin]: "Modified Within",
  [KEYS.explorer.anyTime]: "Any time",
  [KEYS.explorer.clearAll]: "Clear All",
  [KEYS.explorer.close]: "Close",
  [KEYS.explorer.treeAriaLabel]: "Entity explorer tree",

  [KEYS.goalPmAction.optionContinue]: "Continue in {{title}}",
  [KEYS.goalPmAction.optionCreateConversation]:
    "Create new conversation: {{title}}",
  [KEYS.goalPmAction.optionTrack]: "Track {{title}}",
  [KEYS.goalPmAction.optionReviewTask]: "Review proposed task: {{title}}",
  [KEYS.goalPmAction.optionReviewProposal]: "Review proposal: {{title}}",
  [KEYS.goalPmAction.selected]: "Selected: {{title}}.",
  [KEYS.goalPmAction.pending]: "Request completion is pending.",
  [KEYS.goalPmAction.completed]: "Completed.",
  [KEYS.goalPmAction.legacy]:
    "Historical choice saved without an execution result. It cannot be replayed.",
  [KEYS.goalPmAction.retry]: "Retry pending request",
  [KEYS.goalPmAction.applying]: "Applying choice…",
  [KEYS.goalPmAction.card.newConversationType]: "New Conversation",
  [KEYS.goalPmAction.card.newConversationAction]: "Start Conversation",
  [KEYS.goalPmAction.card.existingConversationType]: "Existing Conversation",
  [KEYS.goalPmAction.card.existingConversationAction]: "Continue Conversation",
  [KEYS.goalPmAction.card.refineSearchType]: "Refine Search",
  [KEYS.goalPmAction.card.refineSearchAction]: "Refine Search",
  [KEYS.goalPmAction.card.existingWorkType]: "Existing Work",
  [KEYS.goalPmAction.card.existingWorkAction]: "Track Work",
  [KEYS.goalPmAction.card.newTaskType]: "New Task",
  [KEYS.goalPmAction.card.newTaskAction]: "Review Proposed Task",
  [KEYS.goalPmAction.card.proposalType]: "Proposal",
  [KEYS.goalPmAction.card.proposalAction]: "Review Proposal",
  [KEYS.goalPmAction.card.created]: "Created",
  [KEYS.goalPmAction.card.openConversation]: "Open conversation",
  [KEYS.services.lifecycle.archive]: "Archive",
  [KEYS.services.lifecycle.archiveAria]: "Archive service {{name}}",
  [KEYS.services.lifecycle.archiveConfirmTitle]: "Archive {{name}}?",
  [KEYS.services.lifecycle.archiveConfirmBody]:
    "{{name}} will be hidden from active service selection. You can delete it afterwards from the Archived tab.",
  [KEYS.services.lifecycle.archiveConfirm]: "Archive service",
  [KEYS.services.lifecycle.delete]: "Delete",
  [KEYS.services.lifecycle.deleteAria]: "Delete service {{name}}",
  [KEYS.services.lifecycle.deleteConfirmTitle]:
    "Delete {{name}} from this project?",
  [KEYS.services.lifecycle.deleteConfirmBody]:
    "This removes the service {{name}} from this project. No files or directories are deleted.",
  [KEYS.services.lifecycle.deleteConfirm]: "Delete from project",
  [KEYS.services.lifecycle.cancel]: "Cancel",
  [KEYS.services.lifecycle.activeTab]: "Services",
  [KEYS.services.lifecycle.archivedTab]: "Archived",
  [KEYS.services.lifecycle.archivedBadge]: "Archived",
  [KEYS.services.lifecycle.archivedEmpty]: "No archived services",
  [KEYS.services.lifecycle.error]: "Couldn't complete the action: {{message}}",
  "eval.page.cases.title": "Cases",
  "eval.page.cases.empty":
    "No approved cases yet. Ask the agent to draft some, then approve them in the conversation.",
  "eval.page.cases.hiddenNote":
    "The agent being evaluated never sees a case's expected or forbidden behavior.",
  "eval.page.tabs.eval": "Eval",
  "eval.page.tabs.runs": "Runs",
  "eval.page.tabs.conversations": "Conversations",
  "eval.page.tabs.admin": "Admin",
  "eval.page.tabs.dataDebug": "Data debug",
  "eval.page.run": "Run",
  "eval.page.runs.new": "New run",
  "eval.page.runs.empty": "No runs yet.",
  "eval.page.runs.error": "Couldn't load runs.",
  "eval.page.runs.columns.run": "Run",
  "eval.page.runs.columns.status": "Status",
  "eval.page.runs.columns.casesBySetups": "Cases × setups",
  "eval.page.runs.columns.started": "Started",
  "eval.page.runs.status.QUEUED": "Queued",
  "eval.page.runs.status.RUNNING": "Running",
  "eval.page.runs.status.FINISHED": "Finished",
  "eval.page.runs.status.STOPPED": "Stopped",
  "eval.page.delete": "Delete",
  "eval.run.cases_one": "{{count}} case",
  "eval.run.cases_other": "{{count}} cases",
  "eval.run.configurations_one": "{{count}} configuration",
  "eval.run.configurations_other": "{{count}} configurations",
  "eval.run.attempts_one": "{{count}} attempt",
  "eval.run.attempts_other": "{{count}} attempts",
  "eval.run.missingContext":
    "An organization, project and Eval are needed to open this run.",
  "eval.run.evalLoadError": "Couldn't load this Eval.",
  "eval.run.setup.crumb": "New run",
  "eval.run.setup.title": "New run",
  "eval.run.setup.configurations": "Configurations",
  "eval.run.setup.noConfigurations":
    "Add the model and reasoning setups you want to compare.",
  "eval.run.setup.addConfiguration": "Add configuration",
  "eval.run.setup.removeConfiguration": "Remove {{setup}}",
  "eval.run.setup.judge": "Judge",
  "eval.run.setup.judgeHint":
    "Scores each attempt against the case's expectations and rubric. Recorded with this run.",
  "eval.run.setup.judgeIncomplete":
    "Choose a provider, model and reasoning effort for the judge.",
  "eval.run.setup.cases": "Approved cases in this run",
  "eval.run.setup.noCases":
    "This Eval has no approved cases yet. Approve cases on the Eval before running it.",
  "eval.run.setup.casesError": "Couldn't load the approved cases.",
  "eval.run.setup.attemptCount":
    "{{cases}} × {{configurations}} = {{attempts}}, each in a fresh session.",
  "eval.run.setup.runsOn": "Runs on",
  "eval.run.setup.liveProjectNote":
    "Runs against the project as it is now. The cases, items, and settings used are saved with the run; the rest of the project is not.",
  "eval.run.setup.inertOutputNote":
    "Outputs from this run are evaluation evidence: you can open and read them, but they can't be approved or applied and don't appear in project search.",
  "eval.run.setup.run": "Run",
  "eval.run.setup.launchError": "The run couldn't be recorded: {{message}}",
  "eval.run.setup.dialog.title": "Add configuration",
  "eval.run.setup.dialog.incomplete":
    "Choose a provider, a model, and a reasoning level if the model offers one.",
  "eval.run.setup.dialog.duplicate":
    "This configuration is already in the run.",
  "eval.run.setup.dialog.add": "Add",
  "eval.run.setup.dialog.cancel": "Cancel",
  "eval.run.settings.title": "Run settings",
  "eval.run.settings.concurrency": "Attempts at once",
  "eval.run.settings.timeLimit": "Time limit per attempt",
  "eval.run.settings.tokenLimit": "Token limit per attempt",
  "eval.run.settings.noLimit": "No limit",
  "eval.run.settings.minutes_one": "{{count}} minute",
  "eval.run.settings.minutes_other": "{{count}} minutes",
  "eval.run.settings.tokens": "{{value}} tokens",
  "eval.run.settings.custom": "Custom…",
  "eval.run.settings.customMinutes": "Minutes",
  "eval.run.settings.customTokens": "Tokens",
  "eval.run.settings.limitsNote":
    "Attempts run until they finish unless you set a limit here. Any limit is saved with the run and shown on every attempt it stops.",
  "eval.run.page.attempts": "Attempts",
  "eval.run.page.progressSummary":
    "{{cases}} × {{configurations}} · {{ended}} of {{total}} ended",
  "eval.run.page.backgroundHint":
    "You can leave this page; the run keeps going.",
  "eval.run.page.stop": "Stop run",
  "eval.run.page.settingsSummary":
    "{{concurrency}} at once · Time limit: {{time}} · Token limit: {{tokens}}",
  "eval.run.page.timeLimitValue": "{{value}} per attempt",
  "eval.run.page.tokenLimitValue": "{{value}} tokens per attempt",
  "eval.run.page.limitNone": "none",
  "eval.run.page.notStarted":
    "This run hasn't started yet. Choose a machine and start it; it runs exactly what was recorded.",
  "eval.run.page.start": "Start run",
  "eval.run.page.startAccepted":
    "The run was handed to your machine and will begin shortly. If it doesn't, start it again.",
  "eval.run.page.stopError": "The run couldn't be stopped: {{message}}",
  "eval.run.page.loadError": "Couldn't load this run: {{message}}",
  "eval.run.page.notFound": "This run doesn't exist.",
  "eval.run.page.case": "Case",
  "eval.run.cell.queued": "Waiting",
  "eval.run.cell.running": "Running · {{elapsed}}",
  "eval.run.cell.phase.preparing": "preparing context",
  "eval.run.cell.phase.judging": "judging",
  "eval.run.cell.finished": "Finished · {{elapsed}}",
  "eval.run.cell.stopped.USER": "Stopped · the run was stopped",
  "eval.run.cell.stopped.TIME_LIMIT": "Stopped · reached {{limit}} time limit",
  "eval.run.cell.stopped.TOKEN_LIMIT":
    "Stopped · reached {{limit}} token limit",
  "eval.run.cell.recordedLimit": "its",
  "eval.run.cell.partialOutput": "Partial output · {{outputs}}",
  "eval.run.cell.error": "Error · {{message}}",
  "eval.run.cell.errorNoMessage": "Error · no message was reported",
  "eval.run.cell.openSession": "Open session",
  "eval.run.cell.elapsedUnavailable": "time unavailable",
  "eval.run.cell.outputsUnavailable": "outputs unavailable",
  "eval.run.cell.noOutput": "no output",
  "eval.run.cell.missing": "Not recorded",
  "eval.run.cell.proposals_one": "{{count}} proposal",
  "eval.run.cell.proposals_other": "{{count}} proposals",
  "eval.run.cell.reports_one": "{{count}} report",
  "eval.run.cell.reports_other": "{{count}} reports",
  "eval.run.progress.title": "Progress",
  "eval.run.progress.empty": "No attempts have started yet.",
  "eval.run.progress.started": "{{setup}} on “{{case}}” started.",
  "eval.run.progress.finished": "{{setup}} on “{{case}}” finished.",
  "eval.run.progress.error":
    "{{setup}} on “{{case}}” ended with an error: {{message}}. Other attempts continue.",
  "eval.run.progress.errorNoMessage":
    "{{setup}} on “{{case}}” ended with an error. Other attempts continue.",
  "eval.run.progress.stopped.USER":
    "{{setup}} on “{{case}}” stopped: the run was stopped.",
  "eval.run.progress.stopped.TIME_LIMIT":
    "{{setup}} on “{{case}}” stopped: reached {{limit}} time limit.",
  "eval.run.progress.stopped.TOKEN_LIMIT":
    "{{setup}} on “{{case}}” stopped: reached {{limit}} token limit.",
  "eval.output.badge": "Evaluation output · can't be approved",
  "eval.run.page.viewResults": "View results",
  "eval.page.runs.results": "Results",
  "eval.results.crumb": "Results",
  "eval.results.title": "Compare setups",
  "eval.results.notFinished":
    "This run hasn't finished yet. Results appear here once every attempt has ended.",
  "eval.results.backToRun": "Back to run",
  "eval.results.notReported": "not reported",
  "eval.results.partial": "{{value}} ({{reported}} of {{total}} reported)",
  "eval.results.averagesNote":
    "Time, tokens and tool calls are averages per attempt, with preparing context shown before the handler's own work.",
  "eval.results.observationNote":
    "These are observations on your current project and cases, not a general ranking of models.",
  "eval.results.columns.setup": "Setup",
  "eval.results.columns.recognition": "Noticed the need",
  "eval.results.columns.quality": "Quality",
  "eval.results.columns.checks": "Checks",
  "eval.results.columns.elapsed": "Elapsed (prep / handler)",
  "eval.results.columns.tokens": "Tokens (prep / handler)",
  "eval.results.columns.toolCalls": "Tool calls (prep / handler)",
  "eval.results.errors_one": "{{count}} error",
  "eval.results.errors_other": "{{count}} errors",
  "eval.results.overhead":
    "Judge: {{judge}} · Coordinator: {{coordinator}} (not included above)",
  "eval.results.overheadMeasures":
    "{{elapsed}} · {{tokens}} tokens · {{toolCalls}} tool calls",
  "eval.results.attempts.title": "Attempts",
  "eval.results.attempts.case": "Case",
  "eval.results.attempts.setup": "Setup",
  "eval.results.attempts.status": "Status",
  "eval.results.attempts.open": "Open",
  "eval.results.attempts.status.QUEUED": "Waiting",
  "eval.results.attempts.status.PREPARING": "Preparing",
  "eval.results.attempts.status.RUNNING": "Running",
  "eval.results.attempts.status.JUDGING": "Judging",
  "eval.results.attempts.status.COMPLETED": "Finished",
  "eval.results.attempts.status.ERROR": "Error",
  "eval.results.attempts.status.STOPPED": "Stopped",
  "eval.results.attempt.heading": "{{setup}} — {{case}}",
  "eval.results.attempt.unknownCase": "Unrecorded case",
  "eval.results.attempt.openSession": "Open session",
  "eval.results.attempt.produced": "What this attempt produced",
  "eval.results.attempt.savedNote":
    "Shown read-only, as saved when the attempt ran.",
  "eval.results.attempt.openProposal": "Open in proposal view",
  "eval.results.attempt.openLiveItem": "Open the live item",
  "eval.results.attempt.noOutput":
    "This attempt produced no proposals or reports.",
  "eval.results.attempt.outputsUnavailable":
    "This attempt's outputs couldn't be read.",
  "eval.results.attempt.noConversation":
    "This attempt didn't record a session, so there is no output to show.",
  "eval.results.assessment.title": "Automated assessment",
  "eval.results.assessment.pending": "The judge hasn't assessed this attempt.",
  "eval.results.assessment.checks": "Checks",
  "eval.results.assessment.noChecks": "This case has no checks.",
  "eval.results.assessment.passed": "Passed",
  "eval.results.assessment.failed": "Failed",
  "eval.results.assessment.rubric": "Rubric",
  "eval.results.assessment.recognition": "Noticed the need",
  "eval.results.assessment.recognized": "Yes",
  "eval.results.assessment.notRecognized": "No",
  "eval.results.assessment.unscored": "not scored",
  "eval.results.review.title": "Your review",
  "eval.results.review.score": "Score out of 5",
  "eval.results.review.scoreValue": "{{score}} / 5",
  "eval.results.review.comment": "Comment",
  "eval.results.review.challenge":
    "I think this case's expectations need changing",
  "eval.results.review.challenged": "Flagged this case's expectations",
  "eval.results.review.save": "Save review",
  "eval.results.review.saveError": "Your review couldn't be saved: {{message}}",
  "eval.results.review.note":
    "Your review is kept alongside the automated assessment and does not replace it.",
  "eval.results.review.summary": "Scored {{score}} / 5",
  "eval.results.review.previous": "Earlier reviews",
  "admin.title": "Admin",
  "admin.accessPending": "Checking admin access",
  "admin.tabs.organizations": "Organizations",
  "admin.tabs.betaAccess": "Beta access",
  "admin.tabs.demo": "Demo",
  "admin.demo.title": "Demo sandbox",
  "admin.demo.loadError": "The demo settings couldn't be loaded.",
  "admin.demo.noTemplate":
    "No template is set, so starting a demo will fail until one is.",
  "admin.demo.activeNow": "Active now",
  "admin.demo.activeNowNote":
    "Counts active sandboxes only. Sandboxes still being set up also count toward the cap.",
  "admin.demo.limits.title": "Limits",
  "admin.demo.limits.activeCap": "Active-sandbox cap",
  "admin.demo.limits.perIpLimit": "Sandboxes per address",
  "admin.demo.limits.perIpWindowSeconds": "Per-address window (seconds)",
  "admin.demo.limits.save": "Save limits",
  "admin.demo.limits.invalid":
    "Enter a cap of 0 or more, and a per-address limit and window of at least 1.",
  "admin.demo.saveError": "The change couldn't be saved.",
  "admin.demo.template.title": "Template",
  "admin.demo.template.current": "Current template",
  "admin.demo.template.none": "No template set",
  "admin.demo.template.project": "Template project",
  "admin.demo.template.repository": "Public GitHub repository",
  "admin.demo.template.repositoryHelp":
    "For example https://github.com/owner/repository",
  "admin.demo.template.save": "Set template",
} as const;
