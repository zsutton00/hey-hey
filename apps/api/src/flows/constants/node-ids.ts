/**
 * Central location for all flow node ID constants
 * These constants are used by both Injectable node classes and flow templates
 */

// Initiative Refinement Node IDs
export const INITIATIVE_REFINEMENT_NODES = {
  WELCOME: 'initiative-refinement-welcome',
  AGENT_EDITOR: 'initiative-refinement-agent-editor',
  AGENT_NEXT_LEVEL: 'initiative-refinement-agent-next-level',
  FINALIZE_ACTION: 'initiative-refinement-finalize',
  RECOVERY: 'initiative-refinement-recovery',
  PROMPT_INPUT: 'initiative-prompt-input',
  END: 'initiative-refinement-end',
} as const;

// Task Refinement Node IDs
export const TASK_REFINEMENT_NODES = {
  WELCOME: 'task-refinement-welcome',
  AGENT_EDITOR: 'task-refinement-agent-editor',
  AGENT_NEXT_LEVEL: 'task-refinement-agent-next-level',
  FINALIZE_ACTION: 'task-refinement-finalize-action',
  PROMPT_INPUT: 'task-refinement-prompt-input',
  RECOVERY: 'task-refinement-recovery',
  END: 'task-refinement-end',
} as const;

// Onboarding Node IDs
export const ONBOARDING_NODES = {
  WELCOME: 'onboarding-welcome',
  REPOSITORY_GROUNDING_INTENT: 'onboarding-repository-grounding-intent',
  CLARIFY_CONCEPT: 'onboarding-clarify-concept',
  ANALYZE_PROJECT_CONCEPT: 'onboarding-analyze-project-concept',
  RECOVERY: 'onboarding-recovery',
  END: 'onboarding-end',
  FINALIZE: 'onboarding-finalize',
  /** @deprecated Persisted pre-cutover import identity; use REPOSITORY_IMPORT_NODES. */
  REPOSITORY_GROUNDING_PREREQUISITES:
    'onboarding-repository-grounding-prerequisites',
  /** @deprecated */
  REPOSITORY_GROUNDING_CONFIGURATION:
    'onboarding-repository-grounding-configuration',
  /** @deprecated */
  REPOSITORY_GROUNDING_START: 'onboarding-repository-grounding-start',
  /** @deprecated */
  REPOSITORY_GROUNDING_ANALYSIS: 'onboarding-repository-grounding-analysis',
  /** @deprecated */
  REPOSITORY_FEATURE_ENRICHMENT: 'onboarding-repository-feature-enrichment',
  /** @deprecated */
  REPOSITORY_FEATURE_ENRICHMENT_QUESTIONS:
    'onboarding-repository-feature-enrichment-questions',
  /** @deprecated */
  REPOSITORY_FEATURE_ENRICHMENT_RECOVERY:
    'onboarding-repository-feature-enrichment-recovery',
  /** @deprecated */
  REPOSITORY_GROUNDING_RECOVERY: 'onboarding-repository-grounding-recovery',
  /** @deprecated */
  REPOSITORY_PLACEMENT_STRATEGY: 'onboarding-repository-placement-strategy',
  /** @deprecated */
  REPOSITORY_PLACEMENT_AGENT: 'onboarding-repository-placement-agent',
  /** @deprecated */
  REPOSITORY_PLACEMENT_REVIEW: 'onboarding-repository-placement-review',
} as const;

// Values intentionally preserve the pre-cutover node identities so persisted
// onboarding imports can resume without rewriting durable execution state.
export const REPOSITORY_IMPORT_NODES = {
  PREREQUISITES: 'onboarding-repository-grounding-prerequisites',
  CONFIGURATION: 'onboarding-repository-grounding-configuration',
  START: 'onboarding-repository-grounding-start',
  ANALYSIS: 'onboarding-repository-grounding-analysis',
  ENRICHMENT_CHOICE: 'repository-import-enrichment-choice',
  ENRICHMENT: 'onboarding-repository-feature-enrichment',
  ENRICHMENT_QUESTIONS: 'onboarding-repository-feature-enrichment-questions',
  ENRICHMENT_RECOVERY: 'onboarding-repository-feature-enrichment-recovery',
  RECOVERY: 'onboarding-repository-grounding-recovery',
  GENERATE_FEATURES: 'repository-import-generate-features',
  PLACEMENT_STRATEGY: 'onboarding-repository-placement-strategy',
  PLACEMENT_AGENT: 'onboarding-repository-placement-agent',
  PLACEMENT_REVIEW: 'onboarding-repository-placement-review',
  FINALIZE: 'repository-import-finalize',
  FIRST_WORK_QUESTION: 'repository-import-first-work-question',
  FIRST_WORK: 'repository-import-first-work',
  FIRST_WORK_FOLLOW_UP: 'repository-import-first-work-follow-up',
  FIRST_WORK_RECOVERY: 'repository-import-first-work-recovery',
  END: 'repository-import-end',
} as const;

export const WORK_TRACKER_IMPORT_NODES = {
  CONFIGURATION: 'work-tracker-import-configuration',
  CONNECT: 'work-tracker-import-connect',
  CONNECT_CONFIRM: 'work-tracker-import-connect-confirm',
  START: 'work-tracker-import-start',
  IMPORT: 'work-tracker-import-import',
  GENERATE_FEATURES: 'work-tracker-import-generate-features',
  PLACEMENT_STRATEGY: 'work-tracker-import-placement-strategy',
  FINALIZE: 'work-tracker-import-finalize',
  END: 'work-tracker-import-end',
} as const;

// Shared Node IDs (used across multiple flows)
export const SHARED_NODES = {
  TECHNICAL_DISCOVERY: 'shared-technical-discovery',
  TECHNICAL_DISCOVERY_MATURE: 'shared-technical-discovery-mature',
  ASSESS_IMPLEMENTATION: 'shared-assess-implementation',
  INTEGRATION_DISCOVERY: 'shared-integration-discovery',
  BUSINESS_DISCOVERY: 'shared-business-discovery',
  ANALYZE_PROJECT: 'shared-analyze-project',
  PROJECT_MEMBERS: 'shared-project-members',
  ADDRESS_CONCERNS: 'shared-address-concerns',
  POLITE_REDIRECT: 'shared-polite-redirect',
  SELECT_ONBOARDING_OUTCOME: 'shared-select-onboarding-outcome',
  GENERATE_PLANS: 'shared-generate-plans',
  CREATE_PLANS: 'shared-create-plans',
  GENERATE_INITIATIVES: 'shared-generate-initiatives',
  GENERATE_FEATURES: 'shared-generate-features',
  SETUP_INTEGRATIONS: 'shared-setup-integrations',
  GENERATE_ARTIFACTS: 'shared-generate-artifacts',
  SUGGESTED_ACTIONS_GENERATE_TASK: 'shared-suggested-actions-generate-task',
} as const;

// Task Generation Node IDs
export const TASK_GENERATION_NODES = {
  WELCOME: 'task-generation-welcome',
  STUBS: 'task-generation-stubs',
  GENERATE: 'task-generation-generate',
  CONVERSATION: 'task-generation-conversation',
  RECOVERY: 'task-generation-recovery',
  END: 'task-generation-end',
} as const;

export const TASK_DEPENDENCY_INFERENCE_NODES = {
  GENERATE: 'task-dependency-inference-generate',
} as const;

// Task Prioritization Node IDs
export const TASK_PRIORITIZATION_NODES = {
  WELCOME: 'task-prioritization-welcome',
  GENERATE: 'task-prioritization-generate',
  END: 'task-prioritization-end',
} as const;

// ADR Refinement Node IDs (for progressive refinement workflow)
export const ADR_REFINEMENT_NODES = {
  WELCOME: 'adr-refinement-welcome',
  AGENT_ANALYSIS: 'adr-refinement-agent-analysis',
  AGENT_NEXT_LEVEL: 'adr-refinement-agent-next-level',
  STARTING_AGENT: 'adr-refinement-starting-agent',
  FINALIZE_ACTION: 'adr-refinement-finalize-action',
  PROMPT_NEXT_INPUT: 'adr-refinement-prompt-next-input',
  RECOVERY: 'adr-refinement-recovery',
  END: 'adr-refinement-end',
} as const;

export const BRAINSTORM_REFINEMENT_NODES = {
  WELCOME: 'brainstorm-refinement-welcome',
  AGENT_ANALYSIS: 'brainstorm-refinement-agent-analysis',
  FINALIZE_ACTION: 'brainstorm-refinement-finalize-action',
  RECOVERY: 'brainstorm-refinement-recovery',
  END: 'brainstorm-refinement-end',
} as const;

export const DECISION_REFINEMENT_NODES = {
  WELCOME: 'decision-refinement-welcome',
  AGENT_ANALYSIS: 'decision-refinement-agent-analysis',
  FINALIZE_ACTION: 'decision-refinement-finalize-action',
  RECOVERY: 'decision-refinement-recovery',
  END: 'decision-refinement-end',
} as const;

// Coding Prompt Research Node IDs
export const CODING_PROMPT_RESEARCH_NODES = {
  AGENT: 'coding-prompt-research-agent',
  END: 'coding-prompt-research-end',
} as const;

// Entity Conversation Node IDs
export const ENTITY_CONVERSATION_NODES = {
  WELCOME: 'entity-conversation-welcome',
  AGENT: 'entity-conversation-agent',
  RECOVERY: 'entity-conversation-recovery',
  END: 'entity-conversation-end',
} as const;

// Project Conversation Node IDs
export const PROJECT_CONVERSATION_NODES = {
  WELCOME: 'project-conversation-welcome',
  AGENT: 'project-conversation-agent',
  RECOVERY: 'project-conversation-recovery',
  END: 'project-conversation-end',
} as const;

// Plan Generation Node IDs
export const PLAN_GENERATION_NODES = {
  WELCOME: 'plan-generation-welcome',
  SCOPE_CONSTRAINTS: 'plan-generation-scope-constraints',
  PLAN_APPROVAL: 'plan-generation-plan-approval',
  PLAN_DOCUMENT_GENERATION: 'plan-generation-plan-document-generation',
  USER_SERVICES_SELECT: 'plan-generation-user-services-select',
  DISCOVER_GAPS_SERVICES: 'plan-generation-discover-gaps-services',
  DISCOVER_GAPS_DESIGN_DOCS: 'plan-generation-discover-gaps-design-docs',
  DISCOVER_GAPS_TASKS: 'plan-generation-discover-gaps-tasks',
  PROPOSE_STAGES: 'plan-generation-propose-stages',
  PROPOSE_STEPS: 'plan-generation-propose-steps',
  CREATE_PLAN: 'plan-generation-create-plan',
  WAIT_EXECUTION_GUIDANCE: 'plan-generation-wait-execution-guidance',
  EXECUTION_GUIDANCE: 'plan-generation-execution-guidance',
  EXECUTION_GUIDANCE_UPDATE: 'plan-generation-execution-guidance-update',
  END: 'plan-generation-end',
} as const;

// Plan Update Node IDs
export const PLAN_UPDATE_NODES = {
  WELCOME: 'plan-update-welcome',
  COORDINATOR: 'plan-update-coordinator',
  PROPOSE_STEPS_UPDATE: 'plan-update-propose-steps-update',
  APPLY_UPDATE: 'plan-update-apply-update',
  SUMMARY: 'plan-update-summary',
  END: 'plan-update-end',
} as const;

// ADR (Architecture Decision Record) Node IDs
export const ADR_NODES = {
  RECOVERY: 'adr_recovery',
  CLASSIFY: 'adr_classify',
  QUESTIONS: 'adr_questions',
  GENERATE: 'adr_generate',
  CONVERSATION: 'adr_conversation',
  END: 'adr_end',
} as const;

// RFC (Request for Comments) Node IDs
export const RFC_NODES = {
  RECOVERY: 'rfc_recovery',
  CLASSIFY: 'rfc_classify',
  QUESTIONS: 'rfc_questions',
  GENERATE: 'rfc_generate',
  CONVERSATION: 'rfc_conversation',
  END: 'rfc_end',
} as const;

// Topology summarization nodes
export const TOPOLOGY_NODES = {
  SUBFACET: 'subfacet-topology',
  CATEGORY: 'category-topology',
  CONSOLIDATION: 'subfacet-consolidation',
  CATEGORY_CONSOLIDATION: 'category-consolidation',
  SUBFACET_SUMMARIZATION: 'subfacet-summarization',
} as const;

// Entity summarization nodes
export const ENTITY_SUMMARIZATION_NODES = {
  SUMMARIZE: 'entity-summarization-summarize',
} as const;

export const SUGGESTED_TASK_NODES = {
  GENERATE: 'create-suggested-task-generate',
} as const;

export const SUGGESTED_DESIGN_DOC_NODES = {
  GENERATE: 'create-suggested-design-doc-generate',
} as const;

// Daily Session Node IDs
export const DAILY_SESSION_NODES = {
  WELCOME: 'daily-session-welcome',
  AGENT: 'daily-session-agent',
  RECOVERY: 'daily-session-recovery',
  END: 'daily-session-end',
} as const;

// Feature Sync Node IDs — initial feature-sync stage that runs at the
// start of a coding session. Consumes EXTERNAL_AGENT nodes for the analyze
// and iterate phases, with a QUESTIONS node in between for user review.
//
// `OPENER` is a hidden gate that pauses the workflow until the user
// submits the first message from the agent setup page. Its text is
// captured onto flow context and folded into the subsequent `analyze`
// trigger. The node renders no visible conversation message — its
// SYSTEM message is filtered out on the UI side.
export const FEATURE_SYNC_NODES = {
  OPENER: 'feature-sync-opener',
  ANALYZE: 'feature-sync-analyze',
  ITERATE: 'feature-sync-iterate',
  IMPLEMENTATION_READINESS_REVIEW:
    'feature-sync-implementation-readiness-review',
  CODING_PLAN: 'feature-sync-coding-plan',
  IMPLEMENT: 'feature-sync-implement',
  END: 'feature-sync-end',
} as const;

// Plan Shaping Node IDs — post-design-doc plan-shaping nodes used by the
// plan-from-design-doc workflow. Each node reads and writes platform
// proposals directly (plan stages, plan steps) rather than stashing
// LLM-generated content on the flow context, so FlowContext stays
// routing-only.
//
// The opening node is PROPOSED_STAGES. The conversation's Run is bound up
// front by the `startConversationRun` materialize-only (workflow) arm —
// which fires no agent turn — so the first SYSTEM trigger lands in a live
// Run with no in-graph gate. Run-binding is a conversation-lifecycle
// concern, not a workflow-graph one.
//
// Happy path: PROPOSED_STAGES → PROPOSED_STAGES_FEEDBACK → VISUAL_PREVIEW
// → VISUAL_PREVIEW_FEEDBACK → PHASE_BREAKDOWN* → STEP_REVIEW* → FINALIZE.
// The FEEDBACK gates are user-driven QUESTIONS surfaces:
// PROPOSED_STAGES_FEEDBACK loops back into PROPOSED_STAGES or records
// readiness and advances to VISUAL_PREVIEW; VISUAL_PREVIEW_FEEDBACK loops
// back into VISUAL_PREVIEW or, on explicit approval of the complete visual
// set, enters the per-step PHASE_BREAKDOWN loop, then the per-stage
// STEP_REVIEW tightening sweep. Materialization runs exactly once on
// STEP_REVIEW's loop-exit branch.
export const PLAN_SHAPING_NODES = {
  FEATURE_SYNC_ANALYZE: 'plan-shaping-feature-sync-analyze',
  FEATURE_SYNC_REVIEW: 'plan-shaping-feature-sync-review',
  FEATURE_SYNC_ITERATE: 'plan-shaping-feature-sync-iterate',
  PROPOSED_STAGES: 'plan-shaping-proposed-stages',
  PROPOSED_STAGES_FEEDBACK: 'plan-shaping-proposed-stages-feedback',
  VISUAL_PREVIEW: 'plan-shaping-visual-preview',
  VISUAL_PREVIEW_FEEDBACK: 'plan-shaping-visual-preview-feedback',
  PHASE_BREAKDOWN: 'plan-shaping-phase-breakdown',
  STEP_REVIEW: 'plan-shaping-step-review',
  EXECUTION_GUIDANCE_TRIGGER: 'plan-shaping-execution-guidance-trigger',
  EXECUTION_GUIDANCE_WAIT: 'plan-shaping-execution-guidance-wait',
  FINALIZE: 'plan-shaping-finalize',
} as const;

// Plan-shaping node ids removed when plan generation became visual-only.
// Templates are resolved live from current code, so a conversation parked
// on one of these ids would otherwise fail node lookup; each one resumes at
// VISUAL_PREVIEW instead.
export const RETIRED_PLAN_SHAPING_NODE_REDIRECTS: Readonly<
  Record<string, string>
> = {
  'plan-shaping-fidelity-choice': PLAN_SHAPING_NODES.VISUAL_PREVIEW,
  'plan-shaping-proposed-steps-granular': PLAN_SHAPING_NODES.VISUAL_PREVIEW,
  'plan-shaping-proposed-steps-theme': PLAN_SHAPING_NODES.VISUAL_PREVIEW,
  'plan-shaping-proposed-steps-feedback': PLAN_SHAPING_NODES.VISUAL_PREVIEW,
  'plan-shaping-journey-map': PLAN_SHAPING_NODES.VISUAL_PREVIEW,
  'plan-shaping-journey-map-feedback': PLAN_SHAPING_NODES.VISUAL_PREVIEW,
};

// Refine-Stage Node IDs — post-plan-shaping subgraph that runs when the
// user opens a stage in REFINING status from the plan UI. Expands the
// stage's existing theme PlanStep rows into concrete PlanStep proposals
// via the plan-shaping MCP tools, lets the user review/approve them, and
// finally deletes the prior theme rows and flips the stage out of
// REFINING so the step-derived stage sync can recompute the destination
// status from the newly-approved concrete steps.
//
// Happy path: VALIDATION_CHOICE → STEP_CREATION → STEPS_FEEDBACK →
// FINALIZE. STEPS_FEEDBACK loops back into STEP_CREATION on
// Continue-Revising (with carried feedback threaded onto the next
// trigger) and self-loops with an inline blocking message on the
// empty-step-set case.
export const REFINE_STAGE_NODES = {
  VALIDATION_CHOICE: 'refine-stage-validation-choice',
  STEP_CREATION: 'refine-stage-step-creation',
  STEPS_FEEDBACK: 'refine-stage-steps-feedback',
  FINALIZE: 'refine-stage-finalize',
} as const;
