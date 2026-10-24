import type { ResponseBehavior } from "../../Conversation/Components/conversationFormTypes";
import type { SaveStatus } from "../../SmartTextAreaCard";
import type { LatestTurnToolCallsState } from "../../AgentSession/runtime/hooks/useLatestTurnToolCalls";
import type { FormValue } from "../types";
import type {
  MessageResponseDto,
  PlanApprovalPayload,
  ReportDto,
  SystemMessageData,
  PlanGapAddedEntity as ApiPlanGapAddedEntity,
  PlanGapCoverageReview as ApiPlanGapCoverageReview,
  PlanGapCoverageReviewActionEnum,
  PlanGapClarifyingAnswer as ApiPlanGapClarifyingAnswer,
  PlanGapDiscoveryPayload,
  PlanGapDiscoveryUserMessage as ApiPlanGapDiscoveryUserMessage,
  PlanGapReview as ApiPlanGapReview,
  PlanGapReviewActionEnum,
  OnboardingPlanCandidateReviewPayload,
  QuestionsSystemMessageData,
  SecondaryActionConfig,
  SecondaryActionHandler,
  SuggestionDecisionMetadata,
  UIElement,
  UIElementPayload,
  UserMessageData,
  PlanStageProposalStageFeedbackActionEnum,
  PlanShapingProposedStagesFeedbackApprovedSubmission,
  PlanShapingProposedStagesFeedbackRefineSubmission,
  PlanShapingProposedStagesFeedbackUserSubmission,
  RefineStageStepsFeedbackApprovedSubmission,
  RefineStageStepsFeedbackRefineSubmission,
  RefineStageStepsFeedbackUserSubmission,
  PlanShapingFeatureSyncReviewDismissedWorkflowAnswer,
  PlanShapingFeatureSyncReviewRefineWorkflowAnswer,
  PlanShapingVisualPreviewFeedbackApprovedSubmission,
  PlanShapingVisualPreviewFeedbackRefineSubmission,
  RepositoryPlacementReviewPayload,
  RepositoryPlacementReviewSubmission,
} from "../../../api";
import { WorkflowReviewAction } from "../../../api";
import type { BuildUserMessageDataInput } from "../../AgentSession/runtime/hooks/directTriggerInput";
import type { ConversationMessage } from "../../../types/conversation";
import type { UIAction } from "../../../types/userTracking";
import type { UITrackingData } from "../../../contexts";
import type { SuggestionDecisionStatus } from "../../Conversation/hooks/useSuggestionDecisions";
import type { ReactNode } from "react";
import type { MessageInteractionContext } from "../../Conversation/hooks/proposalsAcceptedTypes";
import type { RepositoryGroundingSubmission } from "./repositoryGroundingUtils";
import type {
  GoalPmRoutingSelectionPayload,
  GoalPmRoutingCreation,
  GoalPmRoutingEnactmentResponse,
} from "../../../api";

export type RepositoryPlacementReviewValue =
  RepositoryPlacementReviewSubmission;

export const createRepositoryPlacementReviewValue = (
  payload: RepositoryPlacementReviewPayload,
): RepositoryPlacementReviewValue =>
  normalizeRepositoryPlacementReviewValue(payload, undefined);

export const normalizeRepositoryPlacementReviewValue = (
  payload: RepositoryPlacementReviewPayload,
  value: unknown,
): RepositoryPlacementReviewValue => {
  const existingOverrides = isRepositoryPlacementReviewValue(value)
    ? new Map(
        value.payload.overrides.map((override) => [override.rootKey, override]),
      )
    : new Map<string, never>();

  return {
    action: "APPROVED",
    payload: {
      overrides: payload.roots.map(({ root, selectedParent }) => ({
        rootKey: root.rootKey,
        target: existingOverrides.get(root.rootKey)?.target ?? selectedParent,
      })),
    },
  };
};

export const isRepositoryPlacementReviewValue = (
  value: unknown,
): value is RepositoryPlacementReviewValue => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    action?: unknown;
    payload?: { overrides?: unknown };
  };
  if (
    candidate.action !== "APPROVED" ||
    !Array.isArray(candidate.payload?.overrides) ||
    candidate.payload.overrides.length === 0
  ) {
    return false;
  }

  const rootKeys = new Set<string>();
  return candidate.payload.overrides.every((override: unknown) => {
    if (typeof override !== "object" || override === null) return false;
    const item = override as {
      rootKey?: unknown;
      target?: { kind?: unknown; featureId?: unknown };
    };
    if (
      typeof item.rootKey !== "string" ||
      item.rootKey.length === 0 ||
      rootKeys.has(item.rootKey)
    ) {
      return false;
    }
    rootKeys.add(item.rootKey);
    return (
      item.target?.kind === "PROJECT_ROOT" ||
      (item.target?.kind === "EXISTING_FEATURE" &&
        typeof item.target.featureId === "string" &&
        item.target.featureId.length > 0)
    );
  });
};

export interface FieldConfig {
  field: string;
  description: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  selectOptions?: UIElement["options"];
  multiple?: boolean;
  validation?: {
    min?: number;
    max?: number;
  };
  min?: number;
  max?: number;
  secondaryAction?: SecondaryActionConfig;
  payload?: UIElementPayload;
}

export type FieldComponentContext = {
  conversationId: string;
  projectId: string;
  organizationId: string;
  agentSessionId?: string;
  workflowAboutId?: string;
  workflowAboutType?: string;
  messageId?: string;
  parentMessageId?: string;
  planId?: string;
  stepId?: string;
  messageCreatedAt?: string;
  messageData?: SystemMessageData;
  parentMessageData?: SystemMessageData;
  /** True when this message is the last one in the conversation timeline. */
  isLastInTimeline?: boolean;
  /** Latest persisted planning context, independent of later narrative messages. */
  codingPlanVersionMessageId?: string | null;
  /** The current Turn's tool calls, polled once by the conversation. */
  latestTurnToolCalls?: LatestTurnToolCallsState;
  /** Focuses the shared conversation composer without submitting a message. */
  onFocusComposer?: () => void;
  interaction: MessageInteractionContext;
  /** Proposal IDs of the conversation's current visual-preview round, if any. */
  currentVisualPreviewProposalIds?: string[];
  onGoalPmAction?: (
    selection: GoalPmRoutingSelectionPayload,
    sourceConversationId: string,
    creation?: GoalPmRoutingCreation,
  ) => Promise<GoalPmRoutingEnactmentResponse>;
  onRepositoryGroundingLaunch?: (
    submission: RepositoryGroundingSubmission,
  ) => Promise<void>;
};

export type SecondaryActionContext = FieldComponentContext;

/** Host-supplied navigation to a conversation created by a Goal PM choice. */
export interface GoalPmConversationLink {
  href: (conversationId: string) => string;
  onOpen: (conversationId: string) => void;
}

export type FieldValidity = "valid" | "loading" | "invalid";

export interface FieldComponentProps<
  V = string | number | object | string[] | boolean,
> {
  config: FieldConfig;
  value?: V;
  onChange?: (value: V) => void;
  error?: string;
  isSubmitted: boolean;
  disabled?: boolean;
  status?: SaveStatus;
  isSubmittable?: boolean;
  context: FieldComponentContext;
  /** The concrete message owning this field, including attached proposals. */
  conversationMessage?: ConversationMessage;
  /** Reports attached to the producing system message for inline rendering. */
  inlineReports?: ReportDto[];
  /** Optional guarded submit path for field-specific keyboard shortcuts. */
  onSubmit?: () => void;
  /**
   * Optional guarded submit path for fields that own more than one explicit
   * action. The value is passed through DynamicForm's normal admission path.
   */
  onSubmitValue?: (value: FormValue) => void;
  onValidityChange?: (validity: FieldValidity) => void;
}

export const PlanGapContinueRevisingHandler =
  "plan_gap_continue_revising" as const;
export const PlanApprovalContinueRevisingHandler =
  "plan_approval_continue_revising" as const;
export const PlanStageContinueRevisingHandler =
  "plan_stage_continue_revising" as const;
export const SyncRecommendationContinueRevisingHandler =
  "sync_recommendation_continue_revising" as const;
export const FeatureListContinueRevisingHandler =
  "feature_list_continue_revising" as const;
export const PlanGenerationStageReviewContinueRevisingHandler =
  "plan_generation_stage_review_continue_revising" as const;
export const PlanGenerationStageReviewApproveAllHandler =
  "plan_generation_stage_review_approve_all" as const;
export const PlanGenerationStepReviewContinueRevisingHandler =
  "plan_generation_step_review_continue_revising" as const;
export const PlanGenerationStepReviewApproveAllHandler =
  "plan_generation_step_review_approve_all" as const;
export const PlanGenerationJourneyMapApproveHandler =
  "plan_generation_journey_map_approve" as const;
export const PlanGenerationJourneyMapContinueRevisingHandler =
  "plan_generation_journey_map_continue_revising" as const;
export const PlanGenerationVisualPreviewApproveHandler =
  "plan_generation_visual_preview_approve" as const;
export const PlanGenerationVisualPreviewContinueRevisingHandler =
  "plan_generation_visual_preview_continue_revising" as const;
export const NextStepHandler = "next_step" as const;
export const PlanShapingFeatureSyncReviewDoneHandler =
  "plan_shaping_feature_sync_review_done" as const;
export const PlanShapingFeatureSyncReviewRequestRevisionsHandler =
  "plan_shaping_feature_sync_review_request_revisions" as const;

export type SecondaryActionHandlerKey =
  | SecondaryActionHandler
  | typeof PlanGapContinueRevisingHandler
  | typeof PlanApprovalContinueRevisingHandler
  | typeof PlanStageContinueRevisingHandler
  | typeof SyncRecommendationContinueRevisingHandler
  | typeof FeatureListContinueRevisingHandler
  | typeof PlanGenerationStageReviewContinueRevisingHandler
  | typeof PlanGenerationStageReviewApproveAllHandler
  | typeof PlanGenerationStepReviewContinueRevisingHandler
  | typeof PlanGenerationStepReviewApproveAllHandler
  | typeof PlanGenerationJourneyMapApproveHandler
  | typeof PlanGenerationJourneyMapContinueRevisingHandler
  | typeof PlanGenerationVisualPreviewApproveHandler
  | typeof PlanGenerationVisualPreviewContinueRevisingHandler
  | typeof NextStepHandler
  | typeof PlanShapingFeatureSyncReviewDoneHandler
  | typeof PlanShapingFeatureSyncReviewRequestRevisionsHandler;

export type SecondaryActionConfigWithHandler = Omit<
  SecondaryActionConfig,
  "handler"
> & {
  handler: SecondaryActionHandlerKey;
};

export type SecondaryActionApplyContext = {
  config: SecondaryActionConfigWithHandler;
  formValues: Record<string, FormValue>;
};

export type SecondaryActionIsDisabledContext = {
  config: SecondaryActionConfigWithHandler;
  formValues: Record<string, FormValue>;
  context: SecondaryActionContext;
};

export type SecondaryActionAvailability =
  { disabled: false; reason?: never } | { disabled: true; reason?: string };

export type SecondaryActionSubmitOptions = {
  handler?: SecondaryActionHandlerKey;
  /**
   * Workflow node represented by the source SYSTEM message being submitted.
   * The conversation renderer supplies this alongside the action handler.
   */
  nodeId?: string;
};

export type SecondaryActionRenderContext = {
  action: SecondaryActionConfigWithHandler;
  context: SecondaryActionContext;
  trackUI: (action: UIAction, data: UITrackingData) => void;
  messageId: string;
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void;
  formValues: Record<string, FormValue>;
  /** True while the form's answer or another secondary action is in flight. */
  isSubmissionLocked: boolean;
  onExecute: (
    formValues: Record<string, FormValue>,
    options?: SecondaryActionSubmitOptions,
  ) => void;
  suggestionDecision?: SuggestionDecisionStatus;
  recordDecision: (
    accepted: boolean,
    metadata?: SuggestionDecisionMetadata,
  ) => void;
};

export type SecondaryActionBehavior = {
  apply?: (
    context: SecondaryActionApplyContext,
  ) => Record<string, FormValue> | null;
  render?: (context: SecondaryActionRenderContext) => ReactNode;
  /**
   * Optional availability evaluator, recalculated from live form values and
   * the same message interaction context supplied to fields.
   */
  getAvailability?: (
    context: SecondaryActionIsDisabledContext,
  ) => SecondaryActionAvailability;
};

export type FieldPrepareInitialValueContext = {
  messageData: QuestionsSystemMessageData;
  uiElement: Pick<UIElement, "id" | "type" | "payload">;
  baseValue: FormValue | undefined;
  responseData?: UserMessageData;
};

export type FieldShouldShowFormContext = {
  conversationMessage: ConversationMessage;
};

export type DynamicSecondaryActionsConfig = {
  /** The uiElement identifier used to query available actions from the API */
  uiElement?: string;
  /** Passed as the actionType query parameter to filter actions */
  actionHint?: string;
};

export type AutoSubmitContext = {
  element: UIElement;
  rejectedCount: number;
  approvedCount: number;
  totalProposals: number;
};

export type AutoSubmitPayload = {
  data: BuildUserMessageDataInput;
  handler?: SecondaryActionHandler;
};

export type AutoSubmitStrategy = {
  shouldFire(message: MessageResponseDto, ctx: AutoSubmitContext): boolean;
  buildPayload(
    message: MessageResponseDto,
    ctx: AutoSubmitContext,
  ): AutoSubmitPayload | null;
};

export type ProposalsPlacement = "above-element" | "below-element";

export type FieldRegistryEntry = {
  responseBehavior: ResponseBehavior;
  Component: React.FC<FieldComponentProps>;
  getHasContent: (value: FormValue | undefined) => boolean;
  /** Optional typed action that a field may submit from its keyboard shortcut. */
  fieldSubmitHandler?: SecondaryActionHandlerKey;
  shouldShowForm?: (context: FieldShouldShowFormContext) => boolean;
  secondaryActions?: Partial<
    Record<SecondaryActionHandlerKey, SecondaryActionBehavior>
  >;
  dynamicSecondaryActions?: DynamicSecondaryActionsConfig;
  prepareInitialValue?: (
    context: FieldPrepareInitialValueContext,
  ) => FormValue | undefined;
  shouldShowButtons?: (value: FormValue | undefined) => boolean;
  /** When true, the system message (response text) above this field's form is suppressed. */
  hideSystemMessage?: boolean;
  /** Declarative auto-submit strategy. When set, the auto-advance hook consults this before posting. */
  autoSubmit?: AutoSubmitStrategy;
  /** When false, suppress the proposals block alongside this field. Defaults to true. */
  autoRenderProposals?: boolean;
  /** Whether the proposals block renders above or below this field's form. Defaults to "below-element". */
  proposalsPlacement?: ProposalsPlacement;
};

export type PlanGapReviewAction =
  PlanGapReviewActionEnum | PlanGapCoverageReviewActionEnum;

export type PlanGapCoverageReview = ApiPlanGapCoverageReview;
export type PlanGapReview = ApiPlanGapReview;
export type PlanGapClarifyingAnswer = ApiPlanGapClarifyingAnswer;

export const PlanGapDiscoveryNextAction = {
  ReadyForNextStep: "READY_FOR_NEXT_STEP",
  ContinueRevising: "CONTINUE_REVISING",
} as const;

export type PlanGapDiscoveryNextAction =
  (typeof PlanGapDiscoveryNextAction)[keyof typeof PlanGapDiscoveryNextAction];

export const PlanGapDiscoveryMessageType = {
  PlanGaps: "PLAN_GAPS",
} as const;

export type PlanGapDiscoveryMessageType =
  (typeof PlanGapDiscoveryMessageType)[keyof typeof PlanGapDiscoveryMessageType];

export interface PlanGapAddedExistingEntity extends ApiPlanGapAddedEntity {
  source: "user_added";
  kind: "existing";
  entityType: "tasks" | "design_docs" | "services";
  entityId: string;
  name: string;
  description?: string;
}

export interface PlanGapAddedManualTask extends ApiPlanGapAddedEntity {
  source: "user_added";
  kind: "manual";
  entityType: "tasks";
  title: string;
  description?: string;
}

export type PlanGapAddedEntity =
  PlanGapAddedExistingEntity | PlanGapAddedManualTask;

export interface PlanGapServiceAddition extends Omit<
  PlanGapAddedExistingEntity,
  "entityType"
> {
  entityType: "services";
}

export interface PlanGapDesignDocAddition extends Omit<
  PlanGapAddedExistingEntity,
  "entityType"
> {
  entityType: "design_docs";
}

export type PlanGapTaskManualAddition = PlanGapAddedManualTask;

export interface PlanGapTaskExistingAddition extends Omit<
  PlanGapAddedExistingEntity,
  "entityType"
> {
  entityType: "tasks";
}

export type PlanGapTaskAddition =
  PlanGapTaskManualAddition | PlanGapTaskExistingAddition;

export type PlanGapDiscoveryUserMessage = ApiPlanGapDiscoveryUserMessage;

export interface PlanGapsServicesValue extends PlanGapDiscoveryUserMessage {
  manuallyAdded: PlanGapServiceAddition[];
}

export interface PlanGapsDesignDocsValue extends PlanGapDiscoveryUserMessage {
  manuallyAdded: PlanGapDesignDocAddition[];
}

export interface PlanGapsTasksValue extends PlanGapDiscoveryUserMessage {
  manuallyAdded: PlanGapTaskAddition[];
}

export const PlanServiceSelectionNextAction = {
  ServicesReady: "SERVICES_READY",
  AnalyzeServices: "ANALYZE_SERVICES",
} as const;

export type PlanServiceSelectionNextAction =
  (typeof PlanServiceSelectionNextAction)[keyof typeof PlanServiceSelectionNextAction];

export type PlanServiceSelectionService = PlanGapServiceAddition;

export interface PlanServiceSelectionValue {
  type: "PLAN_SERVICE_SELECTION";
  nextAction: PlanServiceSelectionNextAction;
  services: PlanServiceSelectionService[];
}

export interface PlanGapServiceAdditionLegacy {
  source: "user_added";
  kind: "existing";
  serviceId: string;
  name: string;
}

export interface PlanGapDesignDocAdditionLegacy {
  source: "user_added";
  kind: "existing";
  designDocId: string;
  name: string;
}

export interface PlanGapTaskManualAdditionLegacy {
  source: "user_added";
  kind: "manual";
  title: string;
  description?: string;
}

export interface PlanGapTaskExistingAdditionLegacy {
  source: "user_added";
  kind: "existing";
  taskId: string;
  name: string;
  description?: string;
}

export interface PlanGapsServicesFieldConfig extends FieldConfig {
  type: "plan_gaps_services";
  payload: PlanGapDiscoveryPayload;
}

export interface PlanGapsDesignDocsFieldConfig extends FieldConfig {
  type: "plan_gaps_design_docs";
  payload: PlanGapDiscoveryPayload;
}

export interface PlanGapsTasksFieldConfig extends FieldConfig {
  type: "plan_gaps_tasks";
  payload: PlanGapDiscoveryPayload;
}

export interface ServiceSelectorFieldConfig extends FieldConfig {
  type: "service_selector";
}

// Plan Approval Types

export const PlanApprovalNextAction = {
  Approve: "APPROVE",
  ContinueRevising: "CONTINUE_REVISING",
} as const;

export type PlanApprovalNextAction =
  (typeof PlanApprovalNextAction)[keyof typeof PlanApprovalNextAction];

export interface PlanApprovalWorkstreamEdit {
  id: string;
  name: string;
  focus: string;
  isNew?: boolean;
  isDeleted?: boolean;
}

export interface PlanApprovalValue {
  type: "PLAN_APPROVAL";
  nextAction: PlanApprovalNextAction;
  userMessage: string;
  description: {
    approach: string;
    outcome: string;
    verification: string;
  };
  workstreams: PlanApprovalWorkstreamEdit[];
}

export interface PlanApprovalFieldConfig extends FieldConfig {
  type: "plan_approval";
  payload: PlanApprovalPayload;
}

// Plan Stage Proposal Types

export const PlanStageProposalNextAction = {
  ReadyForNextStep: "READY_FOR_NEXT_STEP",
  ContinueRevising: "CONTINUE_REVISING",
} as const;

export type PlanStageProposalNextAction =
  (typeof PlanStageProposalNextAction)[keyof typeof PlanStageProposalNextAction];

export interface PlanStageProposalStageValue {
  title: string;
  description: string;
  purpose: string;
  timing: string;
  sequenceOrder: number;
  action: PlanStageProposalStageFeedbackActionEnum;
  comment?: string;
}

export interface PlanStageProposalStageFeedbackValue {
  sequenceOrder: number;
  title: string;
  action: PlanStageProposalStageFeedbackActionEnum;
  comment?: string;
}

export interface PlanStageProposalValue {
  type: "PLAN_STAGE_PROPOSAL";
  nextAction: PlanStageProposalNextAction;
  userMessage: string;
  stages: PlanStageProposalStageValue[];
  stageFeedback: PlanStageProposalStageFeedbackValue[];
}

export interface PlanStageProposalFieldConfig extends FieldConfig {
  type: "plan_stage_proposal";
  payload: OnboardingPlanCandidateReviewPayload;
}

// Sync Recommendation Types

export const SyncRecommendationNextAction = {
  ReadyForNextStep: "READY_FOR_NEXT_STEP",
  ContinueRevising: "CONTINUE_REVISING",
} as const;

export type SyncRecommendationNextAction =
  (typeof SyncRecommendationNextAction)[keyof typeof SyncRecommendationNextAction];

export type SyncRecommendationAction = "accept" | "reject" | "pending";

export type SyncRecommendationSeverity = "small" | "large" | "ignored";

export type SyncRecommendationDirection = "design_doc" | "code";

export interface SyncRecommendationItem {
  id: string;
  title: string;
  reasoning: string;
  suggestedAlignment: string;
  severity: SyncRecommendationSeverity;
  direction: SyncRecommendationDirection;
  action: SyncRecommendationAction;
  comment?: string;
}

export interface SyncRecommendationItemFeedback {
  id: string;
  title: string;
  action: SyncRecommendationAction;
  comment?: string;
}

export interface SyncRecommendationValue {
  type: "SYNC_RECOMMENDATION";
  nextAction: SyncRecommendationNextAction;
  userMessage: string;
  recommendations: SyncRecommendationItem[];
  feedback: SyncRecommendationItemFeedback[];
}

export const isSyncRecommendationValue = (
  value: unknown,
): value is SyncRecommendationValue =>
  typeof value === "object" &&
  value !== null &&
  (value as SyncRecommendationValue).type === "SYNC_RECOMMENDATION" &&
  "nextAction" in value &&
  "recommendations" in value;

// Reconciliation Report Types

export const ReconciliationReportNextAction = {
  ReadyForNextStep: "READY_FOR_NEXT_STEP",
  ContinueRevising: "CONTINUE_REVISING",
} as const;

export type ReconciliationReportNextAction =
  (typeof ReconciliationReportNextAction)[keyof typeof ReconciliationReportNextAction];

export type ReconciliationReportItemAction = "accept" | "reject" | "pending";

export interface ReconciliationReportProposalItem {
  id: string;
  title: string;
  description: string;
  action: ReconciliationReportItemAction;
  comment?: string;
}

export interface ReconciliationReportCodeChangeItem {
  id: string;
  filePath: string;
  currentSnippet: string;
  proposedSnippet: string;
  reasoning: string;
  severity: "low" | "medium" | "high";
  action: ReconciliationReportItemAction;
  comment?: string;
}

export interface ReconciliationReportItemFeedback {
  id: string;
  title: string;
  action: ReconciliationReportItemAction;
  comment?: string;
}

export interface ReconciliationReportValue {
  type: "RECONCILIATION_REPORT";
  nextAction: ReconciliationReportNextAction;
  userMessage: string;
  designDocUpdates: ReconciliationReportProposalItem[];
  codeChanges: ReconciliationReportCodeChangeItem[];
  followUpTasks: ReconciliationReportProposalItem[];
  feedback: ReconciliationReportItemFeedback[];
}

export const isReconciliationReportValue = (
  value: unknown,
): value is ReconciliationReportValue =>
  typeof value === "object" &&
  value !== null &&
  (value as ReconciliationReportValue).type === "RECONCILIATION_REPORT" &&
  "nextAction" in value &&
  "codeChanges" in value;

// Feature List Types

import type {
  FeatureListProposalNode,
  FeatureListRefinement,
  RepositoryGroundingCompletion,
} from "../../../api";

export interface FeatureListValue {
  type: "FEATURE_LIST";
  generatedProposalIds?: string[];
  narrative?: string;
  topLevels?: FeatureListProposalNode[];
  repositoryGroundingCompletion?: RepositoryGroundingCompletion;
  refinement: FeatureListRefinement;
}

export const isFeatureListValue = (value: unknown): value is FeatureListValue =>
  typeof value === "object" &&
  value !== null &&
  (value as FeatureListValue).type === "FEATURE_LIST" &&
  "refinement" in value;

// Plan Generation Stage Review Types

type PlanGenerationStageReviewSubmission =
  | (Omit<PlanShapingProposedStagesFeedbackApprovedSubmission, "payload"> & {
      payload: Record<string, never>;
    })
  | PlanShapingProposedStagesFeedbackRefineSubmission;

export interface PlanGenerationStageReviewDraftValue {
  action?: undefined;
  payload: { feedback: string };
}

export type PlanGenerationStageReviewValue =
  PlanGenerationStageReviewDraftValue | PlanGenerationStageReviewSubmission;

export type PlanGenerationStageReviewAction =
  PlanShapingProposedStagesFeedbackUserSubmission["action"];

export type PlanGenerationStageReviewPayload =
  PlanGenerationStageReviewValue["payload"];

export const isPlanGenerationStageReviewValue = (
  value: unknown,
): value is PlanGenerationStageReviewValue => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    action?: unknown;
    payload?: unknown;
  };
  if (typeof candidate.payload !== "object" || candidate.payload === null) {
    return false;
  }
  if (candidate.action === WorkflowReviewAction.Approved) {
    return Object.keys(candidate.payload).length === 0;
  }
  return (
    (candidate.action === undefined ||
      candidate.action === WorkflowReviewAction.Refine) &&
    typeof (candidate.payload as { feedback?: unknown }).feedback === "string"
  );
};

// Plan Generation Step Review Types

type PlanGenerationStepReviewSubmission =
  | (Omit<RefineStageStepsFeedbackApprovedSubmission, "payload"> & {
      payload: Record<string, never>;
    })
  | RefineStageStepsFeedbackRefineSubmission;

export interface PlanGenerationStepReviewDraftValue {
  action?: undefined;
  payload: { feedback: string };
}

export type PlanGenerationStepReviewValue =
  PlanGenerationStepReviewDraftValue | PlanGenerationStepReviewSubmission;

export type PlanGenerationStepReviewAction =
  RefineStageStepsFeedbackUserSubmission["action"];

export type PlanGenerationStepReviewPayload =
  PlanGenerationStepReviewValue["payload"];

export const isPlanGenerationStepReviewValue = (
  value: unknown,
): value is PlanGenerationStepReviewValue => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { action?: unknown; payload?: unknown };
  if (typeof candidate.payload !== "object" || candidate.payload === null) {
    return false;
  }
  if (candidate.action === WorkflowReviewAction.Approved) {
    return Object.keys(candidate.payload).length === 0;
  }
  return (
    (candidate.action === undefined ||
      candidate.action === WorkflowReviewAction.Refine) &&
    typeof (candidate.payload as { feedback?: unknown }).feedback === "string"
  );
};

// Plan Generation Finalize Types

export type PlanGenerationFinalizeStatus = "PENDING" | "READY";

export interface PlanGenerationFinalizeValue {
  type: "PLAN_GENERATION_FINALIZE";
  status: PlanGenerationFinalizeStatus;
  planId: string;
  firstStageId: string;
  readyButtonLabel: string;
  progressLabel: string;
}

export const isPlanGenerationFinalizeValue = (
  value: unknown,
): value is PlanGenerationFinalizeValue => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PlanGenerationFinalizeValue>;
  return (
    candidate.type === "PLAN_GENERATION_FINALIZE" &&
    (candidate.status === "PENDING" || candidate.status === "READY") &&
    typeof candidate.planId === "string" &&
    typeof candidate.firstStageId === "string" &&
    typeof candidate.readyButtonLabel === "string" &&
    typeof candidate.progressLabel === "string"
  );
};

// Plan Generation Journey Review Types

import type { JourneyMap, QuestionsFeedbackPayload } from "../../../api";

type PlanGenerationJourneyReviewSubmission =
  | {
      action: typeof WorkflowReviewAction.Approved;
      payload: Record<string, never>;
    }
  | {
      action: typeof WorkflowReviewAction.Refine;
      payload: QuestionsFeedbackPayload;
    };

export type PlanGenerationJourneyReviewAction =
  PlanGenerationJourneyReviewSubmission["action"];

export interface PlanGenerationJourneyReviewPayload {
  journeyMap: JourneyMap;
  feedback: string;
}

export interface PlanGenerationJourneyReviewDraftValue {
  payload: PlanGenerationJourneyReviewPayload;
  action?: undefined;
}

export type PlanGenerationJourneyReviewValue =
  PlanGenerationJourneyReviewDraftValue | PlanGenerationJourneyReviewSubmission;

const isJourneyMapShape = (value: unknown): value is JourneyMap => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { steps?: unknown };
  return Array.isArray(candidate.steps);
};

export const isPlanGenerationJourneyReviewValue = (
  value: unknown,
): value is PlanGenerationJourneyReviewValue => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { action?: unknown; payload?: unknown };
  if (typeof candidate.payload !== "object" || candidate.payload === null) {
    return false;
  }
  if (candidate.action === WorkflowReviewAction.Approved) {
    return Object.keys(candidate.payload).length === 0;
  }
  if (candidate.action === WorkflowReviewAction.Refine) {
    return (
      typeof (candidate.payload as { feedback?: unknown }).feedback === "string"
    );
  }
  if (candidate.action !== undefined) {
    return false;
  }
  const payload =
    candidate.payload as Partial<PlanGenerationJourneyReviewPayload>;
  if (!isJourneyMapShape(payload.journeyMap)) {
    return false;
  }
  if (payload.feedback !== undefined && typeof payload.feedback !== "string") {
    return false;
  }
  return true;
};

type PlanGenerationVisualPreviewSubmission =
  | (Omit<PlanShapingVisualPreviewFeedbackApprovedSubmission, "payload"> & {
      payload: Record<string, never>;
    })
  | PlanShapingVisualPreviewFeedbackRefineSubmission;

export type PlanGenerationVisualPreviewReviewAction = "REFINE" | "APPROVED";

export interface PlanGenerationVisualPreviewDraftValue {
  action?: undefined;
  payload: { feedback: string };
}

export type PlanGenerationVisualPreviewValue =
  PlanGenerationVisualPreviewDraftValue | PlanGenerationVisualPreviewSubmission;

export const isPlanGenerationVisualPreviewValue = (
  value: unknown,
): value is PlanGenerationVisualPreviewValue => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { action?: unknown; payload?: unknown };
  if (typeof candidate.payload !== "object" || candidate.payload === null) {
    return false;
  }
  if (candidate.action === WorkflowReviewAction.Approved) {
    return Object.keys(candidate.payload).length === 0;
  }
  return (
    (candidate.action === undefined ||
      candidate.action === WorkflowReviewAction.Refine) &&
    typeof (candidate.payload as { feedback?: unknown }).feedback === "string"
  );
};

// Plan Shaping Feature Sync Review Types

export type PlanShapingFeatureSyncReviewValue =
  | (Omit<PlanShapingFeatureSyncReviewDismissedWorkflowAnswer, "payload"> & {
      payload: Record<string, never>;
    })
  | PlanShapingFeatureSyncReviewRefineWorkflowAnswer;

export type PlanShapingFeatureSyncReviewAction =
  PlanShapingFeatureSyncReviewValue["action"];

export const isPlanShapingFeatureSyncReviewValue = (
  value: unknown,
): value is PlanShapingFeatureSyncReviewValue => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<PlanShapingFeatureSyncReviewValue>;
  if (
    candidate.action !== WorkflowReviewAction.Dismissed &&
    candidate.action !== WorkflowReviewAction.Refine
  ) {
    return false;
  }
  if (
    typeof candidate.payload !== "object" ||
    candidate.payload === null ||
    Array.isArray(candidate.payload)
  ) {
    return false;
  }
  if (candidate.action === WorkflowReviewAction.Dismissed) {
    return Object.keys(candidate.payload).length === 0;
  }
  return (
    typeof (candidate.payload as { feedback?: unknown }).feedback === "string"
  );
};
