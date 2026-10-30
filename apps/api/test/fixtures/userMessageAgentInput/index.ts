/**
 * Per-arm fixture table for the `UserMessageData.agentInput` wire-discriminator
 * contract (@[feature:3e746c36-29f4-411e-814b-aaa79ce14f3e|CLI Run Input Dispatch]).
 *
 * One entry per `promptType` arm of the `UserMessageAgentInput` union (the
 * arms enumerated in `openapi/specs/schemas/conversations.yaml` →
 * `UserMessageAgentInput.oneOf`).
 *
 * SOURCE OF TRUTH. This module is the canonical fixture set; it is consumed by:
 *   - the API inbound contract test
 *     (`src/controllers/__tests__/user-message-agent-input.contract.integration.test.ts`),
 *     which posts each `body` through the inbound boundary and asserts the
 *     persisted row + stamped trigger envelope; and
 *   - the paired CLI dispatcher round-trip test (sibling task), which consumes
 *     the serialized JSON artifact at
 *     `openapi/specs/fixtures/user-message-agent-input.fixtures.json` so the two
 *     sides dispatch off byte-identical bodies and cannot drift.
 *
 * Each `agentInput` is statically typed against its specific generated union
 * member (`UserMessageDataStartupSession`, …). That typing is the drift guard:
 * a spec change that adds or renames a per-arm required field breaks
 * compilation here, forcing the fixture — and therefore both round-trip tests —
 * back into lockstep with the contract.
 */
import {
  UserMessageData,
  UserMessageDataGoalPm,
  UserMessageDataOpenItemsTriage,
  UserMessageDataVerifyFeature,
  UserMessageDataTaskMonitor,
  UserMessageDataPlanShapingStepReview,
  UserMessageDataAgentSearch,
  UserMessageDataChildTaskUpdates,
  UserMessageDataCodeReview,
  UserMessageDataCodingFreeform,
  UserMessageDataCommit,
  UserMessageDataDailySession,
  UserMessageDataDesignDocRefiner,
  UserMessageDataEntityConversation,
  UserMessageDataFeatureRefiner,
  UserMessageDataFeatureSyncAnalyze,
  UserMessageDataFeatureSyncIterate,
  UserMessageDataFeatureTreeConversation,
  UserMessageDataFinalAssessment,
  UserMessageDataFreeForm,
  UserMessageDataImplement,
  UserMessageDataPlanExecution,
  UserMessageDataPlanShapingFeatureSyncAnalyze,
  UserMessageDataPlanShapingFeatureSyncIterate,
  UserMessageDataPlanShapingFinalize,
  UserMessageDataPlanShapingPhaseBreakdown,
  UserMessageDataPlanShapingProposedStages,
  UserMessageDataPlanShapingRefineStage,
  UserMessageDataPlanShapingVisualPreview,
  UserMessageDataProposalRefiner,
  UserMessageDataReportUpdate,
  UserMessageDataRollupProposal,
  UserMessageDataSetSplitting,
  UserMessageDataStartupSession,
  UserMessageDataTaskRefiner,
  UserMessageDataValidationWalkthrough,
  UserMessageDataVerificationPlan,
  UserMessageDataWorkflowDefined,
  LocalPromptStartupInput,
  JourneyStep,
  PlanShapingVisualPreviewEntry,
  WorkflowName,
} from 'src/generated';

/** Distinct per-arm user text so the round-trip assertion can prove it survives. */
const msg = (promptTypeOrWorkflow: string): string =>
  `agent-input fixture: ${promptTypeOrWorkflow}`;

// Minimal-but-type-valid instances for the object-typed required fields. Their
// internal shape is owned by other contracts (the CLI startup payload, the
// journey-map schema); this table only needs a structurally valid value so the
// arm compiles and serializes — the inbound boundary never reads these fields.
const MINIMAL_STARTUP_INPUT: LocalPromptStartupInput = {
  task: { taskType: 'STANDARD', description: 'fixture task' },
  adjacentScopeTasks: [],
  evidenceItems: [],
};

const MINIMAL_JOURNEY_STEP: JourneyStep = {
  id: 'fixture-journey-step',
  stageId: 'fixture-stage',
  title: 'Fixture journey step',
  description: 'Fixture journey step description',
  isUserInteractive: false,
  implementationNotes: [],
};

/**
 * One inbound-contract fixture: a USER message body whose `agentInput` selects a
 * single dispatch target, paired with the assertions the inbound boundary must
 * satisfy for it.
 */
export interface AgentInputFixture {
  /** Stable identifier used in test titles so a single-arm regression is named. */
  readonly id: string;
  /** Which side of the `promptType` xor `workflowName` discriminator this arm exercises. */
  readonly kind: 'promptType' | 'workflowName';
  /** The wire `promptType` for a `promptType` arm; absent for the workflow arm. */
  readonly promptType?: string;
  /** The wire `workflowName` for the workflow arm; absent for `promptType` arms. */
  readonly workflowName?: WorkflowName;
  /** The inbound `UserMessageData` posted through the boundary. */
  readonly body: UserMessageData;
  /**
   * Expected `triggersAgent.payload.handlerPromptType` once stamped. For a
   * `promptType` arm this equals the wire `promptType`. For the `workflowName`
   * arm it is classification-dependent (resolved server-side), so it is left
   * null here and supplied per-state by the API test.
   */
  readonly expectedHandlerPromptType: string | null;
  /** Expected `triggersAgent.payload.userMessage` (round-tripped via the extractor). */
  readonly expectedUserMessage: string;
}

/**
 * Build a `promptType`-arm fixture: the arm's typed `agentInput` carries a
 * distinct `userMessage`, and the stamp's `handlerPromptType` must equal the
 * wire `promptType`.
 */
const promptArm = (
  promptType: string,
  agentInput: UserMessageData['agentInput'],
): AgentInputFixture => ({
  id: promptType,
  kind: 'promptType',
  promptType,
  body: { agentInput },
  expectedHandlerPromptType: promptType,
  expectedUserMessage: msg(promptType),
});

// ───────────────────────────────────────────────────────────────────────────
// Direct `promptType` arms from UserMessageAgentInput.
// ───────────────────────────────────────────────────────────────────────────

const startupSession: UserMessageDataStartupSession = {
  promptType: 'startup_session',
  userMessage: msg('startup_session'),
  startupInput: MINIMAL_STARTUP_INPUT,
};

const planExecution: UserMessageDataPlanExecution = {
  promptType: 'plan_execution',
  userMessage: msg('plan_execution'),
  plan: { id: 'fixture-plan' },
  review: { status: 'fixture-review' },
};

const finalAssessment: UserMessageDataFinalAssessment = {
  promptType: 'final_assessment',
  userMessage: msg('final_assessment'),
};

const verificationPlan: UserMessageDataVerificationPlan = {
  promptType: 'verification_plan',
  userMessage: msg('verification_plan'),
};

const childTaskUpdates: UserMessageDataChildTaskUpdates = {
  promptType: 'child_task_updates',
  userMessage: msg('child_task_updates'),
};

const entityConversation: UserMessageDataEntityConversation = {
  promptType: 'entity_conversation',
  userMessage: msg('entity_conversation'),
  entity: { id: 'fixture-entity' },
};

const setSplitting: UserMessageDataSetSplitting = {
  promptType: 'set_splitting',
  userMessage: msg('set_splitting'),
  startupInput: { task: 'fixture' },
  splitMode: 'by_service',
};

const freeForm: UserMessageDataFreeForm = {
  promptType: 'free_form',
  userMessage: msg('free_form'),
  startupInput: { task: 'fixture' },
};

const dailySession: UserMessageDataDailySession = {
  promptType: 'daily_session',
  userMessage: msg('daily_session'),
  payloadVersion: 1,
};

const rollupProposal: UserMessageDataRollupProposal = {
  promptType: 'rollup_proposal',
  userMessage: msg('rollup_proposal'),
};

const taskRefiner: UserMessageDataTaskRefiner = {
  promptType: 'task_refiner',
  userMessage: msg('task_refiner'),
  payloadVersion: 1,
  task: { id: 'fixture-task' },
};

const featureRefiner: UserMessageDataFeatureRefiner = {
  promptType: 'feature_refiner',
  userMessage: msg('feature_refiner'),
  payloadVersion: 1,
  feature: { id: 'fixture-feature' },
};

const designDocRefiner: UserMessageDataDesignDocRefiner = {
  promptType: 'design_doc_refiner',
  userMessage: msg('design_doc_refiner'),
  payloadVersion: 1,
  designDoc: { id: 'fixture-design-doc' },
};

const proposalRefiner: UserMessageDataProposalRefiner = {
  promptType: 'proposal_refiner',
  userMessage: msg('proposal_refiner'),
  payloadVersion: 1,
  proposal: { id: 'fixture-proposal' },
};

const commit: UserMessageDataCommit = {
  promptType: 'commit',
  userMessage: msg('commit'),
};

const agentSearch: UserMessageDataAgentSearch = {
  promptType: 'agent_search',
  userMessage: msg('agent_search'),
  payloadVersion: 1,
};

const reportUpdate: UserMessageDataReportUpdate = {
  promptType: 'report_update',
  userMessage: msg('report_update'),
  payloadVersion: 1,
  reportId: 'fixture-report',
  reportType: 'fixture-report-type',
  text: 'fixture report text',
  entities: [],
  changedEntities: [],
};

const codeReview: UserMessageDataCodeReview = {
  promptType: 'code_review',
  userMessage: msg('code_review'),
};

const featureSyncAnalyze: UserMessageDataFeatureSyncAnalyze = {
  promptType: 'feature_sync_analyze',
  userMessage: msg('feature_sync_analyze'),
  taskId: 'fixture-task',
};

const featureSyncIterate: UserMessageDataFeatureSyncIterate = {
  promptType: 'feature_sync_iterate',
  userMessage: msg('feature_sync_iterate'),
  discrepancies: [],
};

const planShapingFeatureSyncAnalyze: UserMessageDataPlanShapingFeatureSyncAnalyze =
  {
    promptType: 'plan_shaping_feature_sync_analyze',
    userMessage: msg('plan_shaping_feature_sync_analyze'),
    planId: 'fixture-plan',
    designDocId: 'fixture-design-doc',
  };

const planShapingFeatureSyncIterate: UserMessageDataPlanShapingFeatureSyncIterate =
  {
    promptType: 'plan_shaping_feature_sync_iterate',
    planId: 'fixture-plan',
    designDocId: 'fixture-design-doc',
    userMessage: msg('plan_shaping_feature_sync_iterate'),
    discrepancies: [
      { id: 'fs-1', summary: 'Fixture gap', rationale: 'Fixture rationale' },
    ],
    decisions: [{ itemId: 'fs-1', choice: 'accept' }],
  };

const planShapingProposedStages: UserMessageDataPlanShapingProposedStages = {
  promptType: 'plan_shaping_proposed_stages',
  userMessage: msg('plan_shaping_proposed_stages'),
  designDocId: 'fixture-design-doc',
  planId: 'fixture-plan',
};

const planShapingRefineStage: UserMessageDataPlanShapingRefineStage = {
  promptType: 'plan_shaping_refine_stage',
  userMessage: msg('plan_shaping_refine_stage'),
  planId: 'fixture-plan',
  stageId: 'fixture-stage',
  validation: 'off',
};

const planShapingPhaseBreakdown: UserMessageDataPlanShapingPhaseBreakdown = {
  promptType: 'plan_shaping_phase_breakdown',
  userMessage: msg('plan_shaping_phase_breakdown'),
  journeyStep: MINIMAL_JOURNEY_STEP,
  stageIdx: 0,
  phaseIdx: 0,
  phasesInStage: 1,
  totalPhases: 1,
  designDocId: 'fixture-design-doc',
  planId: 'fixture-plan',
  approvedVisuals: [],
};

const planShapingVisualPreview: UserMessageDataPlanShapingVisualPreview = {
  promptType: 'plan_shaping_visual_preview',
  userMessage: msg('plan_shaping_visual_preview'),
  designDocId: 'fixture-design-doc',
  planId: 'fixture-plan',
  featureId: 'fixture-feature',
  refinementRound: 0,
  entries: [
    {
      proposalId: 'fixture-visual-proposal',
      artifactFamily: 'mockup',
      presentationOrder: 0,
      status: 'DRAFT',
    } satisfies PlanShapingVisualPreviewEntry,
  ],
};

const planShapingFinalize: UserMessageDataPlanShapingFinalize = {
  promptType: 'plan_shaping_finalize',
  userMessage: msg('plan_shaping_finalize'),
};

const implement: UserMessageDataImplement = {
  promptType: 'implement',
  userMessage: msg('implement'),
};

const validationWalkthrough: UserMessageDataValidationWalkthrough = {
  promptType: 'validation_walkthrough',
  userMessage: msg('validation_walkthrough'),
  scope: 'task',
  entityId: 'fixture-entity',
};

const codingFreeform: UserMessageDataCodingFreeform = {
  promptType: 'coding_freeform',
  userMessage: msg('coding_freeform'),
};

const workflowDefined: UserMessageDataWorkflowDefined = {
  promptType: 'workflow-defined',
  userMessage: msg('workflow-defined'),
};

const featureTreeConversation: UserMessageDataFeatureTreeConversation = {
  promptType: 'feature_tree_conversation',
  userMessage: msg('feature_tree_conversation'),
  projectId: 'fixture-project',
};

const goalPm: UserMessageDataGoalPm = {
  promptType: 'goal_pm',
  userMessage: msg('goal_pm'),
  entity: { entityType: 'TASK', entityId: 'fixture-goal', taskType: 'GOAL' },
};

const openItemsTriage: UserMessageDataOpenItemsTriage = {
  promptType: 'open_items_triage',
  userMessage: msg('open_items_triage'),
  projectId: 'fixture-project',
  requestKind: 'freshPass',
  mode: 'tidyUp',
};

const verifyFeature: UserMessageDataVerifyFeature = {
  promptType: 'verify_feature',
  userMessage: msg('verify_feature'),
  concern: 'fixture-concern',
  parentAgentSessionId: '00000000-0000-4000-8000-000000000001',
};

const taskMonitor: UserMessageDataTaskMonitor = {
  promptType: 'task_monitor',
  userMessage: msg('task_monitor'),
  monitorId: 'fixture-monitor',
  cause: 'CONTINUE',
  correlationId: 'fixture-correlation',
};

const planShapingStepReview: UserMessageDataPlanShapingStepReview = {
  promptType: 'plan_shaping_step_review',
  userMessage: msg('plan_shaping_step_review'),
  steps: [],
  stageIdx: 0,
  totalStages: 1,
  designDocId: 'fixture-design-doc',
  planId: 'fixture-plan',
  approvedVisuals: [],
};

/** One fixture for every generated direct `promptType` arm. */
export const PROMPT_TYPE_FIXTURES: readonly AgentInputFixture[] = [
  promptArm('goal_pm', goalPm),
  promptArm('open_items_triage', openItemsTriage),
  promptArm('verify_feature', verifyFeature),
  promptArm('task_monitor', taskMonitor),
  promptArm('plan_shaping_step_review', planShapingStepReview),
  promptArm('startup_session', startupSession),
  promptArm('plan_execution', planExecution),
  promptArm('final_assessment', finalAssessment),
  promptArm('verification_plan', verificationPlan),
  promptArm('child_task_updates', childTaskUpdates),
  promptArm('entity_conversation', entityConversation),
  promptArm('set_splitting', setSplitting),
  promptArm('free_form', freeForm),
  promptArm('daily_session', dailySession),
  promptArm('rollup_proposal', rollupProposal),
  promptArm('task_refiner', taskRefiner),
  promptArm('feature_refiner', featureRefiner),
  promptArm('design_doc_refiner', designDocRefiner),
  promptArm('proposal_refiner', proposalRefiner),
  promptArm('commit', commit),
  promptArm('agent_search', agentSearch),
  promptArm('report_update', reportUpdate),
  promptArm('code_review', codeReview),
  promptArm('feature_sync_analyze', featureSyncAnalyze),
  promptArm('feature_sync_iterate', featureSyncIterate),
  promptArm('plan_shaping_feature_sync_analyze', planShapingFeatureSyncAnalyze),
  promptArm('plan_shaping_feature_sync_iterate', planShapingFeatureSyncIterate),
  promptArm('plan_shaping_proposed_stages', planShapingProposedStages),
  promptArm('plan_shaping_refine_stage', planShapingRefineStage),
  promptArm('plan_shaping_phase_breakdown', planShapingPhaseBreakdown),
  promptArm('plan_shaping_visual_preview', planShapingVisualPreview),
  promptArm('plan_shaping_finalize', planShapingFinalize),
  promptArm('implement', implement),
  promptArm('validation_walkthrough', validationWalkthrough),
  promptArm('coding_freeform', codingFreeform),
  promptArm('workflow-defined', workflowDefined),
  promptArm('feature_tree_conversation', featureTreeConversation),
];

/** The full per-arm contract table for direct prompt inputs. */
export const AGENT_INPUT_FIXTURES: readonly AgentInputFixture[] = [
  ...PROMPT_TYPE_FIXTURES,
];
