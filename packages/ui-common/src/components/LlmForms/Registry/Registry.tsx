import { HistoricalCodingPlanContextField } from "./HistoricalCodingPlanContextField";
import { CodingPlanApprovalField } from "./CodingPlanApprovalField";
import { CodingPlanDiscrepancyField } from "./CodingPlanDiscrepancyField";
import { OpenItemsTriageField } from "./OpenItemsTriageField";
import { goalPmAnswer } from "./goalPmAnswer";
import React from "react";
import type {
  PlanApprovalPayload,
  PlanGapDiscoveryPayload,
  PlanGenerationFinalizePayload,
  OnboardingPlanCandidateReviewPayload,
  QuestionsSystemMessageData,
  RepositoryPlacementReviewPayload,
  UIElement,
} from "../../../api";
import {
  DesignDocTemplate,
  SecondaryActionHandler,
  TaskStubUserMessageNextActionEnum,
  WorkflowReviewAction,
} from "../../../api";
import {
  AdrContentApplyAction,
  CodingPromptAcceptAction,
  InitiativeContentApplyAction,
  NextStepAction,
  RelatedEntitiesAction,
  SuggestedActionAction,
  TaskContentApplyAction,
} from "../../Conversation/SecondaryActions";
import {
  CODING_METHOD_ACTION_ID,
  CODING_PROMPT_FOLLOWUP_INPUT_ID,
} from "../../AgentSession/codingPromptConversationContracts";
import type { FormValue } from "../types";
import { AdrContextStarterField } from "./AdrContextStarterField";
import { AgentCompleteField } from "./AgentCompleteField";
import { AgentHiddenField } from "./AgentHiddenField";
import { AgentSearchResultsField } from "./AgentSearchResultsField";
import { AgentPermissionRequestField } from "./AgentPermissionRequestField";
import { AgentQuestionField } from "./AgentQuestionField";
import { AgentServiceScopeRequestField } from "./AgentServiceScopeRequestField";
import { AgentReviewFileScopeRequestField } from "./AgentReviewFileScopeRequestField";
import { AgentResponseField } from "./AgentResponseField";
import { VerifyFeatureField } from "./VerifyFeatureField";
import { isVerifyFeaturePayload } from "../../../types/secondaryActions";
import { ButtonGroupField } from "./ButtonGroupField";
import { CodingPromptField } from "./CodingPromptField";
import { CompleteOnboarding } from "./CompleteOnboarding";
import { CurrencyField } from "./CurrencyField";
import { DatePickerField } from "./DatePickerField";
import {
  ExistingWorkIntentField,
  isExistingWorkIntentValue,
} from "./ExistingWorkIntentField";
import { FileDiffField } from "./FileDiffField";
import { FinalAssessmentStructuredField } from "./FinalAssessmentStructuredField";
import { MergedFinalAssessmentStructuredField } from "./MergedFinalAssessmentStructuredField";
import { InitiativeIntroField } from "./InitiativeIntroField";
import { IntegrationsField } from "./IntegrationsField";
import { ImplementationReadinessField } from "./ImplementationReadinessField";
import { ImplementationReadinessSecondaryAction } from "./ImplementationReadinessSecondaryAction";
import { buildImplementationReadinessDispositionValue } from "./implementationReadinessUtils";
import { InterstitialField } from "./InterstitialField";
import { MultipleChoiceField } from "./MultipleChoiceField";
import { GoalPmActionFieldRenderer } from "./GoalPmActionFieldRenderer";
import { PlanApprovalField } from "./PlanApprovalField";
import { PlanGenerationFinalizeField } from "./PlanGenerationFinalizeField";
import { PlanGenerationJourneyReviewField } from "./PlanGenerationJourneyReviewField";
import { PlanGenerationVisualPreviewField } from "./PlanGenerationVisualPreviewField";
import { PlanGenerationVisualPreviewApproveAction } from "./PlanGenerationVisualPreviewApproveAction";
import { PlanGenerationStageReviewField } from "./PlanGenerationStageReviewField";
import { RepositoryFeatureEnrichmentReplyField } from "./RepositoryFeatureEnrichmentReplyField";
import { PlanGenerationStageReviewReadyAction } from "./PlanGenerationStageReviewReadyAction";
import { PlanShapingFeatureSyncReviewField } from "./PlanShapingFeatureSyncReviewField";
import { PlanGenerationStepReviewField } from "./PlanGenerationStepReviewField";
import ReconciliationReportField, {
  prepareReconciliationReportInitialValue,
} from "./ReconciliationReportField";
import { PlanDocumentStructuredField } from "./PlanDocumentStructuredField";
import { PlanGapsDesignDocsField } from "./PlanGapsDesignDocsField";
import { PlanGapsServicesField } from "./PlanGapsServicesField";
import { PlanGapsTasksField } from "./PlanGapsTasksField";
import { PlanStageProposalField } from "./PlanStageProposalField";
import { PriorityField } from "./PriorityField";
import { QuestionGroupField } from "./QuestionGroupField";
import { RepositoryGroundingRegistryField } from "./RepositoryGroundingField";
import { FeatureListField } from "./FeatureListField";
import { RepositoryPlacementStrategyField } from "./RepositoryPlacementStrategyField";
import { RepositoryPlacementReviewField } from "./RepositoryPlacementReviewField";
import { SelectField } from "./SelectField";
import { SessionMonitorField } from "./SessionMonitorField";
import { ServiceSelectorField } from "./ServiceSelectorField";
import { StartupPlanStructuredField } from "./StartupPlanStructuredField";
import SyncRecommendationField, {
  prepareSyncRecommendationInitialValue,
} from "./SyncRecommendationField";
import { TaskFeedbackField } from "./TaskFeedbackField";
import { TaskGenerationField } from "./TaskGenerationField";
import { TaskListField } from "./TaskListField";
import { TaskPriorityField } from "./TaskPriorityField";
import { TaskStubField } from "./TaskStubField";
import { TeamMembersField } from "./TeamMembersField";
import { TextField } from "./TextField";
import { TextareaField } from "./TextareaField";
import { InitiativeStepperField } from "./initiatives/InitiativeStepperField";
import {
  createPlanApprovalValue,
  normalizePlanApprovalValue,
} from "./planApprovalUtils";
import {
  createPlanGenerationFinalizeValue,
  normalizePlanGenerationFinalizeValue,
} from "./planGenerationFinalizeUtils";
import { createPlanGenerationJourneyReviewValue } from "./planGenerationJourneyReviewUtils";
import { createPlanGenerationVisualPreviewValue } from "./planGenerationVisualPreviewReviewUtils";
import { createPlanGenerationStageReviewValue } from "./planGenerationStageReviewUtils";
import { createPlanShapingFeatureSyncReviewValue } from "./planShapingFeatureSyncReviewUtils";
import { projectPlanShapingFeatureSyncReviewAction } from "./planShapingFeatureSyncReviewUtils";
import { createPlanGenerationStepReviewValue } from "./planGenerationStepReviewUtils";
import {
  createPlanGapsDesignDocsValue,
  createPlanGapsServicesValue,
  createPlanGapsTasksValue,
  normalizePlanGapsDesignDocsValue,
  normalizePlanGapsServicesValue,
  normalizePlanGapsTasksValue,
} from "./planGapsUtils";
import {
  createPlanServiceSelectionValue,
  normalizePlanServiceSelectionValue,
} from "./planServiceSelectionUtils";
import {
  createPlanStageProposalValue,
  normalizePlanStageProposalValue,
} from "./planStageProposalUtils";
import {
  applyPlanGenerationJourneyMapApprove,
  applyPlanGenerationJourneyMapContinueRevising,
  applyPlanGenerationVisualPreviewTextareaApprove,
  applyPlanGenerationVisualPreviewTextareaContinueRevising,
  isPlanGenerationJourneyReviewFeedbackEmpty,
  tryUpdatePlanGenerationVisualPreviewAction,
  buildCodingPromptAcceptPayload,
  tryUpdatePlanApprovalNextAction,
  tryUpdatePlanGapNextAction,
  tryUpdatePlanGenerationStageReviewAction,
  tryUpdatePlanGenerationStepReviewAction,
  tryUpdatePlanServiceSelectionNextAction,
  tryUpdatePlanStageNextAction,
  tryUpdateSyncRecommendationNextAction,
  tryUpdateFeatureListAction,
  updateTaskStubNextAction,
} from "./secondaryActionBehaviors";
import type {
  FieldComponentProps,
  FieldPrepareInitialValueContext,
  FieldRegistryEntry,
  SecondaryActionApplyContext,
  SecondaryActionBehavior,
  SecondaryActionHandlerKey,
} from "./types";
import {
  getFieldResponseMetadata,
  getRegistryType,
} from "./fieldResponseMetadata";
import type { RegistryTypeInput } from "./fieldResponseMetadata";
export {
  getFormVisibilityOverride,
  getRegistryType,
} from "./fieldResponseMetadata";
import { prepareRepositoryGroundingInitialValue } from "./repositoryGroundingUtils";
import {
  NextStepHandler,
  PlanApprovalContinueRevisingHandler,
  PlanApprovalNextAction,
  PlanGapContinueRevisingHandler,
  PlanGapDiscoveryNextAction,
  PlanGenerationJourneyMapApproveHandler,
  PlanGenerationJourneyMapContinueRevisingHandler,
  PlanGenerationVisualPreviewApproveHandler,
  PlanGenerationVisualPreviewContinueRevisingHandler,
  PlanShapingFeatureSyncReviewDoneHandler,
  PlanShapingFeatureSyncReviewRequestRevisionsHandler,
  PlanGenerationStageReviewContinueRevisingHandler,
  PlanGenerationStageReviewApproveAllHandler,
  PlanGenerationStepReviewContinueRevisingHandler,
  PlanGenerationStepReviewApproveAllHandler,
  PlanServiceSelectionNextAction,
  PlanStageContinueRevisingHandler,
  PlanStageProposalNextAction,
  SyncRecommendationContinueRevisingHandler,
  SyncRecommendationNextAction,
  ReconciliationReportNextAction,
  FeatureListContinueRevisingHandler,
  type PlanApprovalValue,
  type PlanGapsDesignDocsValue,
  type PlanGapsServicesValue,
  type PlanGapsTasksValue,
  type PlanServiceSelectionValue,
  type PlanStageProposalValue,
  isPlanGenerationFinalizeValue,
  isPlanGenerationJourneyReviewValue,
  isPlanGenerationVisualPreviewValue,
  isPlanGenerationStageReviewValue,
  isPlanGenerationStepReviewValue,
  isPlanShapingFeatureSyncReviewValue,
  isSyncRecommendationValue,
  isReconciliationReportValue,
  isRepositoryPlacementReviewValue,
  normalizeRepositoryPlacementReviewValue,
} from "./types";

const MESSAGE_REGISTRY_KEY = "__message__";

const isRecord = (
  value: FormValue | undefined,
): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const isRecordPayload = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const hasStringValue = (value: FormValue | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const hasNumberValue = (value: FormValue | undefined): boolean =>
  typeof value === "number" && value !== 0;

const hasObjectValue = (value: FormValue | undefined): boolean =>
  isRecord(value) && Object.keys(value).length > 0;

const getSubmittedFeedback = (responseData: unknown): string | undefined => {
  if (!isRecordPayload(responseData)) {
    return undefined;
  }

  const payload = responseData.payload;
  if (isRecordPayload(payload) && typeof payload.feedback === "string") {
    return payload.feedback;
  }

  return typeof responseData.feedback === "string"
    ? responseData.feedback
    : undefined;
};

const hasExistingWorkIntentValue = (value: FormValue | undefined): boolean =>
  isExistingWorkIntentValue(value);

const hasTextareaValue = (value: FormValue | undefined): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (isRecord(value) && typeof value.text === "string") {
    return value.text.trim().length > 0;
  }

  return false;
};

const hasInitiativeListValue = (value: FormValue | undefined): boolean => {
  if (isRecord(value)) {
    return value.allReviewed === true;
  }
  return false;
};

const hasPlanGapContent = (
  value: PlanGapsServicesValue | PlanGapsDesignDocsValue | PlanGapsTasksValue,
): boolean => {
  const getArrayLength = (items: unknown) =>
    Array.isArray(items) ? items.length : 0;

  const hasGapReviews = getArrayLength(value.gapReviews) > 0;
  const hasCoverageReviews = Array.isArray(value.gapReviews)
    ? value.gapReviews.some(
        (review) =>
          Array.isArray(review?.coverageReviews) &&
          review.coverageReviews.length > 0,
      )
    : false;
  const hasClarifyingAnswers = getArrayLength(value.clarifyingAnswers) > 0;
  const hasManualAdditions = getArrayLength(value.manuallyAdded) > 0;
  const isEmptyPayload =
    !hasGapReviews &&
    !hasCoverageReviews &&
    !hasClarifyingAnswers &&
    !hasManualAdditions;
  const hasReviewedGaps = Array.isArray(value.gapReviews)
    ? value.gapReviews.some(
        (review) =>
          typeof review === "object" &&
          review !== null &&
          "action" in review &&
          review.action !== "pending",
      )
    : false;
  const hasReviewedCoverage = Array.isArray(value.gapReviews)
    ? value.gapReviews.some((review) =>
        Array.isArray(review?.coverageReviews)
          ? review.coverageReviews.some(
              (coverage) =>
                typeof coverage === "object" &&
                coverage !== null &&
                "action" in coverage &&
                coverage.action !== "pending",
            )
          : false,
      )
    : false;
  const hasAnsweredClarifying = Array.isArray(value.clarifyingAnswers)
    ? value.clarifyingAnswers.some(
        (answer) =>
          typeof answer === "object" &&
          answer !== null &&
          "answer" in answer &&
          typeof answer.answer === "string" &&
          answer.answer.trim().length > 0,
      )
    : false;

  return (
    hasReviewedGaps ||
    hasReviewedCoverage ||
    hasAnsweredClarifying ||
    hasManualAdditions ||
    isEmptyPayload
  );
};

const isPlanGapValue = (
  value: FormValue | undefined,
): value is
  PlanGapsServicesValue | PlanGapsDesignDocsValue | PlanGapsTasksValue =>
  value !== null &&
  typeof value === "object" &&
  "nextAction" in value &&
  "gapReviews" in value;

const isPlanServiceSelectionValue = (
  value: FormValue | undefined,
): value is PlanServiceSelectionValue =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  value.type === "PLAN_SERVICE_SELECTION";

const isPlanApprovalValue = (
  value: FormValue | undefined,
): value is PlanApprovalValue =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  value.type === "PLAN_APPROVAL";

const isPlanStageProposalValue = (
  value: FormValue | undefined,
): value is PlanStageProposalValue =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  value.type === "PLAN_STAGE_PROPOSAL";

const isPlanGapDiscoveryPayload = (
  payload: unknown,
): payload is PlanGapDiscoveryPayload =>
  isRecordPayload(payload) &&
  "gaps" in payload &&
  "clarificationQuestions" in payload;

const isPlanApprovalPayload = (
  payload: unknown,
): payload is PlanApprovalPayload =>
  isRecordPayload(payload) &&
  "description" in payload &&
  "workstreams" in payload;

const isOnboardingPlanCandidateReviewPayload = (
  payload: unknown,
): payload is OnboardingPlanCandidateReviewPayload =>
  isRecordPayload(payload) && "response" in payload && "stages" in payload;

const isRepositoryPlacementReviewPayload = (
  payload: unknown,
): payload is RepositoryPlacementReviewPayload =>
  isRecordPayload(payload) && Array.isArray(payload.roots);

const prepareRepositoryPlacementReviewInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  return isRepositoryPlacementReviewPayload(uiElement.payload)
    ? normalizeRepositoryPlacementReviewValue(uiElement.payload, baseValue)
    : undefined;
};

const isPlanGenerationFinalizePayload = (
  payload: unknown,
): payload is PlanGenerationFinalizePayload =>
  isRecordPayload(payload) &&
  typeof payload.planId === "string" &&
  typeof payload.firstStageId === "string" &&
  typeof payload.readyButtonLabel === "string" &&
  typeof payload.progressLabel === "string";

const messageTypeMatches = (
  messageData: QuestionsSystemMessageData,
  messageType: string,
): boolean => messageData?.type === messageType;

const prepareMessageTypeValue = ({
  messageData,
  baseValue,
  messageType,
}: {
  messageData: QuestionsSystemMessageData;
  baseValue: FormValue | undefined;
  messageType: string;
}): FormValue | undefined =>
  messageTypeMatches(messageData, messageType) ? messageData : baseValue;

const prepareCodingPromptInitialValue = ({
  uiElement,
  messageData,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined =>
  baseValue ?? uiElement.payload ?? messageData;

const prepareAgentResponseInitialValue = ({
  messageData,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (baseValue !== undefined) {
    return baseValue;
  }

  return typeof messageData.response === "string"
    ? messageData.response
    : undefined;
};

const PLAN_DOCUMENT_VIEW_TEMPLATES = [
  DesignDocTemplate.PlanDocument,
  DesignDocTemplate.Brainstorm,
] as const;

type PlanDocumentViewTemplate = (typeof PLAN_DOCUMENT_VIEW_TEMPLATES)[number];

const normalizePlanDocumentViewTemplate = (
  value: unknown,
): PlanDocumentViewTemplate | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  return PLAN_DOCUMENT_VIEW_TEMPLATES.includes(
    value as PlanDocumentViewTemplate,
  )
    ? (value as PlanDocumentViewTemplate)
    : undefined;
};

const sanitizePlanDocumentInitialValue = (
  value: unknown,
): FormValue | undefined => {
  if (!isRecordPayload(value)) {
    return undefined;
  }

  const entityId = value["entityId"];
  if (typeof entityId !== "string" || entityId.trim().length === 0) {
    return undefined;
  }

  const template = normalizePlanDocumentViewTemplate(value["template"]);
  const responseType =
    value["responseType"] === "plan_document_view_v1"
      ? "plan_document_view_v1"
      : undefined;
  const userMessage =
    typeof value["userMessage"] === "string" ? value["userMessage"] : undefined;

  return {
    entityId,
    ...(template ? { template } : {}),
    ...(responseType ? { responseType } : {}),
    ...(userMessage ? { userMessage } : {}),
  };
};

const preparePlanDocumentInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  const normalizedBaseValue = sanitizePlanDocumentInitialValue(baseValue);
  if (normalizedBaseValue) {
    return normalizedBaseValue;
  }

  if (!isRecordPayload(uiElement.payload)) {
    return baseValue;
  }

  const payloadEntityId = uiElement.payload["entityId"];
  if (
    typeof payloadEntityId !== "string" ||
    payloadEntityId.trim().length === 0
  ) {
    return baseValue;
  }

  const payloadTemplate = uiElement.payload["template"];
  const normalizedTemplate = normalizePlanDocumentViewTemplate(payloadTemplate);

  return {
    entityId: payloadEntityId,
    ...(normalizedTemplate ? { template: normalizedTemplate } : {}),
  };
};

const preparePlanGapsServicesInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (!isPlanGapDiscoveryPayload(uiElement.payload)) {
    return baseValue;
  }

  const fallbackValue = createPlanGapsServicesValue(
    uiElement.payload.gaps.services,
    uiElement.payload.clarificationQuestions.services,
  );
  return normalizePlanGapsServicesValue(baseValue, fallbackValue);
};

const preparePlanGapsDesignDocsInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (!isPlanGapDiscoveryPayload(uiElement.payload)) {
    return baseValue;
  }

  const fallbackValue = createPlanGapsDesignDocsValue(
    uiElement.payload.gaps.design_docs,
    uiElement.payload.clarificationQuestions.design_docs,
  );
  return normalizePlanGapsDesignDocsValue(baseValue, fallbackValue);
};

const preparePlanGapsTasksInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (!isPlanGapDiscoveryPayload(uiElement.payload)) {
    return baseValue;
  }

  const fallbackValue = createPlanGapsTasksValue(
    uiElement.payload.gaps.tasks,
    uiElement.payload.clarificationQuestions.tasks,
  );
  return normalizePlanGapsTasksValue(baseValue, fallbackValue);
};

const preparePlanServiceSelectionInitialValue = ({
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  const fallbackValue = createPlanServiceSelectionValue();
  return normalizePlanServiceSelectionValue(baseValue, fallbackValue);
};

const preparePlanApprovalInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (!isPlanApprovalPayload(uiElement.payload)) {
    return baseValue;
  }

  const fallbackValue = createPlanApprovalValue(uiElement.payload);
  return normalizePlanApprovalValue(baseValue, fallbackValue);
};

const preparePlanStageProposalInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (!isOnboardingPlanCandidateReviewPayload(uiElement.payload)) {
    return baseValue;
  }

  const fallbackValue = createPlanStageProposalValue(uiElement.payload);
  return normalizePlanStageProposalValue(baseValue, fallbackValue);
};

const preparePlanGenerationFinalizeInitialValue = ({
  uiElement,
  baseValue,
}: FieldPrepareInitialValueContext): FormValue | undefined => {
  if (!isPlanGenerationFinalizePayload(uiElement.payload)) {
    return baseValue;
  }

  const fallbackValue = createPlanGenerationFinalizeValue(uiElement.payload);
  return normalizePlanGenerationFinalizeValue(baseValue, fallbackValue);
};

const applySuggestedAgentAction = ({
  config,
}: SecondaryActionApplyContext): Record<string, FormValue> | null => {
  const payload = config.payload as
    { promptTemplate?: string; method?: string } | undefined;
  if (payload?.method) {
    return { [CODING_METHOD_ACTION_ID]: payload.method };
  }
  const prompt = payload?.promptTemplate;
  if (!prompt) return null;
  return { [CODING_PROMPT_FOLLOWUP_INPUT_ID]: prompt };
};

export const FIELD_REGISTRY: Record<string, FieldRegistryEntry> = {
  [MESSAGE_REGISTRY_KEY]: {
    ...getFieldResponseMetadata("__message__"),
    Component: () => null,
    getHasContent: () => false,
    secondaryActions: {
      [SecondaryActionHandler.AdrContentApply]: {
        render: ({ action, context, suggestionDecision, recordDecision }) => (
          <AdrContentApplyAction
            action={action}
            context={context}
            suggestionDecision={suggestionDecision}
            onDecision={(accepted) => {
              recordDecision(accepted);
            }}
          />
        ),
      },
      [SecondaryActionHandler.InitiativeContentApply]: {
        render: ({ action, context, suggestionDecision, recordDecision }) => (
          <InitiativeContentApplyAction
            action={action}
            context={context}
            suggestionDecision={suggestionDecision}
            onDecision={(accepted) => {
              recordDecision(accepted);
            }}
          />
        ),
      },
      [SecondaryActionHandler.TaskContentApply]: {
        render: ({ action, context, suggestionDecision, recordDecision }) => (
          <TaskContentApplyAction
            action={action}
            context={context}
            suggestionDecision={suggestionDecision}
            onDecision={(accepted) => {
              recordDecision(accepted);
            }}
          />
        ),
      },
      [SecondaryActionHandler.SuggestedAction]: {
        render: ({
          action,
          context,
          messageId,
          trackUI,
          suggestionDecision,
          recordDecision,
        }) => (
          <SuggestedActionAction
            action={action}
            context={context}
            messageId={messageId}
            suggestionDecision={suggestionDecision}
            recordDecision={recordDecision}
            trackUI={trackUI}
          />
        ),
      },
      [SecondaryActionHandler.RelatedEntities]: {
        render: ({ action, context }) => (
          <RelatedEntitiesAction action={action} context={context} />
        ),
      },
      [NextStepHandler]: {
        render: ({ action }) => <NextStepAction action={action} />,
      },
      [SecondaryActionHandler.SuggestedAgentAction]: {
        apply: applySuggestedAgentAction,
      },
      [SecondaryActionHandler.CompleteOnboarding]: {
        apply: ({ formValues }) => formValues,
      },
      [PlanGenerationVisualPreviewApproveHandler]: {
        apply: ({ config, formValues }) =>
          applyPlanGenerationVisualPreviewTextareaApprove(
            formValues,
            config.fieldId ?? undefined,
          ),
        render: ({
          action,
          context,
          formValues,
          isSubmissionLocked,
          onExecute,
        }) => (
          <PlanGenerationVisualPreviewApproveAction
            action={action}
            context={context}
            formValues={formValues}
            isSubmissionLocked={isSubmissionLocked}
            onExecute={onExecute}
          />
        ),
      },
      [PlanGenerationVisualPreviewContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          applyPlanGenerationVisualPreviewTextareaContinueRevising(
            formValues,
            config.fieldId ?? undefined,
          ),
      },
    },
  },
  textarea: {
    ...getFieldResponseMetadata("textarea"),
    Component: TextareaField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasTextareaValue,
    prepareInitialValue: ({ baseValue, responseData }) =>
      typeof baseValue === "string"
        ? baseValue
        : getSubmittedFeedback(responseData),
  },
  "agent-reply-textarea": {
    ...getFieldResponseMetadata("agent-reply-textarea"),
    Component: TextareaField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasTextareaValue,
    proposalsPlacement: "above-element",
  },
  repository_feature_enrichment_reply: {
    ...getFieldResponseMetadata("repository_feature_enrichment_reply"),
    Component:
      RepositoryFeatureEnrichmentReplyField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  currency: {
    ...getFieldResponseMetadata("currency"),
    Component: CurrencyField,
    getHasContent: hasNumberValue,
  },
  priority: {
    ...getFieldResponseMetadata("priority"),
    Component: PriorityField,
    getHasContent: hasNumberValue,
  },
  text: {
    ...getFieldResponseMetadata("text"),
    Component: TextField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  number: {
    ...getFieldResponseMetadata("number"),
    Component: TextField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasNumberValue,
  },
  select: {
    ...getFieldResponseMetadata("select"),
    Component: SelectField,
    getHasContent: hasStringValue,
  },
  repository_grounding_intent: {
    ...getFieldResponseMetadata("repository_grounding_intent"),
    Component:
      ExistingWorkIntentField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasExistingWorkIntentValue,
  },
  datepicker: {
    ...getFieldResponseMetadata("datepicker"),
    Component: DatePickerField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  integrations: {
    ...getFieldResponseMetadata("integrations"),
    Component: IntegrationsField,
    getHasContent: hasObjectValue,
  },
  team_members: {
    ...getFieldResponseMetadata("team_members"),
    Component: TeamMembersField,
    getHasContent: hasStringValue,
  },
  initiative_list: {
    ...getFieldResponseMetadata("initiative_list"),
    Component:
      InitiativeStepperField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasInitiativeListValue,
    prepareInitialValue: ({ messageData, baseValue }) =>
      prepareMessageTypeValue({
        messageData,
        baseValue,
        messageType: "INITIATIVES",
      }),
  },
  initiative_intro: {
    ...getFieldResponseMetadata("initiative_intro"),
    Component: InitiativeIntroField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  button_group: {
    ...getFieldResponseMetadata("button_group"),
    Component: ButtonGroupField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  complete_onboarding: {
    ...getFieldResponseMetadata("complete_onboarding"),
    Component: CompleteOnboarding as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
  },
  task_generation: {
    ...getFieldResponseMetadata("task_generation"),
    Component: TaskGenerationField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
    secondaryActions: {
      [SecondaryActionHandler.ContinueConversation]: {
        apply: ({ formValues }) => formValues,
      },
      [SecondaryActionHandler.TaskGenerationGenerate]: {
        apply: ({ config, formValues }) =>
          updateTaskStubNextAction(
            formValues,
            config.fieldId ?? undefined,
            TaskStubUserMessageNextActionEnum.GenerateReal,
          ),
      },
    },
  },
  feature_list: {
    ...getFieldResponseMetadata("feature_list"),
    Component: FeatureListField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    secondaryActions: {
      [FeatureListContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdateFeatureListAction(
            formValues,
            config.fieldId ?? undefined,
            "REFINE",
          ).values,
      },
    },
    prepareInitialValue: ({ messageData, baseValue }) => {
      if (
        isRecordPayload(messageData) &&
        "generatedProposalIds" in messageData
      ) {
        const baseRefinement =
          isRecordPayload(baseValue) && isRecordPayload(baseValue.refinement)
            ? baseValue.refinement
            : undefined;
        const sections =
          baseRefinement &&
          isRecordPayload((baseRefinement as { sections?: unknown }).sections)
            ? (baseRefinement as { sections: Record<string, string> }).sections
            : {};
        const overall =
          baseRefinement &&
          typeof (baseRefinement as { overall?: unknown }).overall === "string"
            ? (baseRefinement as { overall: string }).overall
            : "";

        return {
          ...messageData,
          type: "FEATURE_LIST",
          refinement: { sections, overall },
        };
      }
      return baseValue;
    },
  },
  repository_placement_strategy: {
    ...getFieldResponseMetadata("repository_placement_strategy"),
    Component:
      RepositoryPlacementStrategyField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
  },
  repository_placement_review: {
    ...getFieldResponseMetadata("repository_placement_review"),
    Component:
      RepositoryPlacementReviewField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isRepositoryPlacementReviewValue(value),
    prepareInitialValue: prepareRepositoryPlacementReviewInitialValue,
  },
  task_feedback: {
    ...getFieldResponseMetadata("task_feedback"),
    Component: TaskFeedbackField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  task_list: {
    ...getFieldResponseMetadata("task_list"),
    Component: TaskListField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    prepareInitialValue: ({ messageData, baseValue }) =>
      prepareMessageTypeValue({
        messageData,
        baseValue,
        messageType: "TASKS",
      }),
  },
  task_stub: {
    ...getFieldResponseMetadata("task_stub"),
    Component: TaskStubField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    secondaryActions: {
      [SecondaryActionHandler.ContinueConversation]: {
        apply: ({ formValues }) => formValues,
      },
      [SecondaryActionHandler.TaskStubGenerationGenerate]: {
        apply: ({ config, formValues }) =>
          updateTaskStubNextAction(
            formValues,
            config.fieldId ?? undefined,
            TaskStubUserMessageNextActionEnum.GenerateStubs,
          ),
      },
    },
    prepareInitialValue: ({ messageData, baseValue }) =>
      prepareMessageTypeValue({
        messageData,
        baseValue,
        messageType: "TASK_STUBS",
      }),
  },
  task_priority: {
    ...getFieldResponseMetadata("task_priority"),
    Component: TaskPriorityField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
  },
  adr_context_starter: {
    ...getFieldResponseMetadata("adr_context_starter"),
    Component:
      AdrContextStarterField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  adr_agent_response: {
    ...getFieldResponseMetadata("adr_agent_response"),
    Component: AgentResponseField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
    prepareInitialValue: prepareAgentResponseInitialValue,
  },
  agent_response: {
    ...getFieldResponseMetadata("agent_response"),
    Component: () => null,
    getHasContent: () => false,
    shouldShowButtons: () => false,
  },
  verify_feature: {
    ...getFieldResponseMetadata("verify_feature"),
    Component: (props) => (
      <VerifyFeatureField
        {...props}
        value={
          isVerifyFeaturePayload(props.config.payload)
            ? props.config.payload
            : undefined
        }
        onChange={undefined}
      />
    ),
    prepareInitialValue: ({ uiElement }) =>
      isVerifyFeaturePayload(uiElement.payload) ? uiElement.payload : undefined,
    getHasContent: () => false,
    shouldShowButtons: () => false,
  },
  agent_hidden: {
    ...getFieldResponseMetadata("agent_hidden"),
    Component: AgentHiddenField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => false,
    shouldShowButtons: () => false,
  },
  agent_search_results: {
    ...getFieldResponseMetadata("agent_search_results"),
    Component:
      AgentSearchResultsField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => false,
    shouldShowButtons: () => false,
    hideSystemMessage: true,
  },
  interstitial: {
    ...getFieldResponseMetadata("interstitial"),
    Component: InterstitialField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => false,
    shouldShowButtons: () => false,
    hideSystemMessage: true,
  },
  implementation_readiness: {
    ...getFieldResponseMetadata("implementation_readiness"),
    Component: ImplementationReadinessField,
    getHasContent: () => false,
    shouldShowButtons: () => false,
    hideSystemMessage: true,
    secondaryActions: {
      [SecondaryActionHandler.ImplementationReadinessReply]: {
        render: (context) => (
          <ImplementationReadinessSecondaryAction {...context} kind="clarify" />
        ),
      },
      [SecondaryActionHandler.ImplementationReadinessDismiss]: {
        apply: ({ config, formValues }) =>
          buildImplementationReadinessDispositionValue(
            SecondaryActionHandler.ImplementationReadinessDismiss,
            config,
            formValues,
          ),
        render: (context) => (
          <ImplementationReadinessSecondaryAction {...context} kind="dismiss" />
        ),
      },
    },
  },
  session_monitor: {
    ...getFieldResponseMetadata("session_monitor"),
    Component: SessionMonitorField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => false,
    shouldShowButtons: () => false,
    hideSystemMessage: true,
  },
  agent_complete: {
    ...getFieldResponseMetadata("agent_complete"),
    Component: AgentCompleteField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
    dynamicSecondaryActions: {
      actionHint: "task_complete",
    },
    secondaryActions: {
      [SecondaryActionHandler.SuggestedAgentAction]: {
        apply: applySuggestedAgentAction,
      },
    },
  },
  agent_request_permission: {
    ...getFieldResponseMetadata("agent_request_permission"),
    Component:
      AgentPermissionRequestField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  agent_question: {
    ...getFieldResponseMetadata("agent_question"),
    Component: AgentQuestionField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  agent_request_service_scope: {
    ...getFieldResponseMetadata("agent_request_service_scope"),
    Component:
      AgentServiceScopeRequestField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  agent_request_review_file_scope: {
    ...getFieldResponseMetadata("agent_request_review_file_scope"),
    Component:
      AgentReviewFileScopeRequestField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  file_diff: {
    ...getFieldResponseMetadata("file_diff"),
    Component: FileDiffField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  coding_prompt_final_assessment: {
    ...getFieldResponseMetadata("coding_prompt_final_assessment"),
    Component:
      FinalAssessmentStructuredField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
    prepareInitialValue: prepareCodingPromptInitialValue,
  },
  coding_prompt_merged_final_assessment: {
    ...getFieldResponseMetadata("coding_prompt_merged_final_assessment"),
    Component:
      MergedFinalAssessmentStructuredField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
    prepareInitialValue: prepareCodingPromptInitialValue,
    dynamicSecondaryActions: {
      uiElement: "coding_prompt_merged_final_assessment",
    },
    secondaryActions: {
      [SecondaryActionHandler.SuggestedAgentAction]: {
        apply: applySuggestedAgentAction,
      },
    },
  },
  coding_plan_version: {
    ...getFieldResponseMetadata("coding_plan_version"),
    Component: CodingPlanApprovalField,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
  },
  coding_plan_context: {
    ...getFieldResponseMetadata("coding_plan_context"),
    Component: HistoricalCodingPlanContextField,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
  },
  coding_plan_discrepancy: {
    ...getFieldResponseMetadata("coding_plan_discrepancy"),
    Component: CodingPlanDiscrepancyField,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
  },
  coding_prompt_startup_plan: {
    ...getFieldResponseMetadata("coding_prompt_startup_plan"),
    Component:
      StartupPlanStructuredField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => true,
    prepareInitialValue: prepareCodingPromptInitialValue,
  },
  plan_document_view: {
    ...getFieldResponseMetadata("plan_document_view"),
    Component:
      PlanDocumentStructuredField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
    prepareInitialValue: preparePlanDocumentInitialValue,
  },
  question_group: {
    ...getFieldResponseMetadata("question_group"),
    Component: QuestionGroupField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasObjectValue,
  },
  multiple_choice: {
    ...getFieldResponseMetadata("multiple_choice"),
    Component: MultipleChoiceField as unknown as React.FC<FieldComponentProps>,
    getHasContent: hasStringValue,
  },
  open_items_triage: {
    ...getFieldResponseMetadata("open_items_triage"),
    Component: OpenItemsTriageField,
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  goal_pm_action: {
    ...getFieldResponseMetadata("goal_pm_action"),
    Component: GoalPmActionFieldRenderer,
    prepareInitialValue: ({ baseValue }) => goalPmAnswer(baseValue),
    getHasContent: () => true,
    shouldShowButtons: () => false,
  },
  coding_prompt: {
    ...getFieldResponseMetadata("coding_prompt"),
    Component: CodingPromptField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => hasStringValue(value) || hasObjectValue(value),
    secondaryActions: {
      [SecondaryActionHandler.CodingPromptAccept]: {
        apply: ({ config, formValues }) =>
          buildCodingPromptAcceptPayload(formValues, config),
        render: ({ action, onExecute, formValues }) => (
          <CodingPromptAcceptAction
            action={action}
            onAccept={() => onExecute(formValues)}
          />
        ),
      },
    },
    prepareInitialValue: prepareCodingPromptInitialValue,
  },
  service_selector: {
    ...getFieldResponseMetadata("service_selector"),
    Component: ServiceSelectorField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isPlanServiceSelectionValue(value),
    secondaryActions: {
      [SecondaryActionHandler.ContinueConversation]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanServiceSelectionNextAction(
            formValues,
            config.fieldId ?? undefined,
            PlanServiceSelectionNextAction.AnalyzeServices,
          ).values,
      },
    },
    prepareInitialValue: preparePlanServiceSelectionInitialValue,
  },
  repository_grounding: {
    ...getFieldResponseMetadata("repository_grounding"),
    Component: RepositoryGroundingRegistryField,
    getHasContent: hasObjectValue,
    shouldShowButtons: () => false,
    prepareInitialValue: prepareRepositoryGroundingInitialValue,
  },
  plan_gaps_services: {
    ...getFieldResponseMetadata("plan_gaps_services"),
    Component:
      PlanGapsServicesField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) =>
      isPlanGapValue(value) ? hasPlanGapContent(value) : false,
    secondaryActions: {
      [PlanGapContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGapNextAction(
            formValues,
            config.fieldId ?? undefined,
            PlanGapDiscoveryNextAction.ContinueRevising,
          ).values,
      },
    },
    prepareInitialValue: preparePlanGapsServicesInitialValue,
  },
  plan_gaps_design_docs: {
    ...getFieldResponseMetadata("plan_gaps_design_docs"),
    Component:
      PlanGapsDesignDocsField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) =>
      isPlanGapValue(value) ? hasPlanGapContent(value) : false,
    secondaryActions: {
      [PlanGapContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGapNextAction(
            formValues,
            config.fieldId ?? undefined,
            PlanGapDiscoveryNextAction.ContinueRevising,
          ).values,
      },
    },
    prepareInitialValue: preparePlanGapsDesignDocsInitialValue,
  },
  plan_gaps_tasks: {
    ...getFieldResponseMetadata("plan_gaps_tasks"),
    Component: PlanGapsTasksField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) =>
      isPlanGapValue(value) ? hasPlanGapContent(value) : false,
    secondaryActions: {
      [PlanGapContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGapNextAction(
            formValues,
            config.fieldId ?? undefined,
            PlanGapDiscoveryNextAction.ContinueRevising,
          ).values,
      },
    },
    prepareInitialValue: preparePlanGapsTasksInitialValue,
  },
  plan_approval: {
    ...getFieldResponseMetadata("plan_approval"),
    Component: PlanApprovalField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isPlanApprovalValue(value),
    secondaryActions: {
      [PlanApprovalContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanApprovalNextAction(
            formValues,
            config.fieldId ?? undefined,
            PlanApprovalNextAction.ContinueRevising,
          ).values,
      },
    },
    prepareInitialValue: preparePlanApprovalInitialValue,
  },
  plan_stage_proposal: {
    ...getFieldResponseMetadata("plan_stage_proposal"),
    Component:
      PlanStageProposalField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => {
      if (!isPlanStageProposalValue(value)) {
        return false;
      }
      const hasStages = Array.isArray(value.stages) && value.stages.length > 0;
      const hasMessage =
        typeof value.userMessage === "string" &&
        value.userMessage.trim().length > 0;
      return hasStages || hasMessage;
    },
    shouldShowButtons: (value) =>
      isPlanStageProposalValue(value) &&
      value.nextAction === PlanStageProposalNextAction.ReadyForNextStep,
    secondaryActions: {
      [PlanStageContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanStageNextAction(
            formValues,
            config.fieldId ?? undefined,
            PlanStageProposalNextAction.ContinueRevising,
          ).values,
      },
    },
    prepareInitialValue: preparePlanStageProposalInitialValue,
  },
  sync_recommendation: {
    ...getFieldResponseMetadata("sync_recommendation"),
    Component:
      SyncRecommendationField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => {
      if (!isSyncRecommendationValue(value)) {
        return false;
      }
      const isReady =
        value.nextAction === SyncRecommendationNextAction.ReadyForNextStep;
      const hasRecommendations =
        Array.isArray(value.recommendations) &&
        value.recommendations.length > 0;
      const hasMessage =
        typeof value.userMessage === "string" &&
        value.userMessage.trim().length > 0;
      return isReady && (hasRecommendations || hasMessage);
    },
    shouldShowButtons: (value) =>
      isSyncRecommendationValue(value) &&
      value.nextAction === SyncRecommendationNextAction.ReadyForNextStep,
    secondaryActions: {
      [SyncRecommendationContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdateSyncRecommendationNextAction(
            formValues,
            config.fieldId ?? undefined,
            SyncRecommendationNextAction.ContinueRevising,
          ).values,
      },
    },
    prepareInitialValue: prepareSyncRecommendationInitialValue,
  },
  reconciliation_report: {
    ...getFieldResponseMetadata("reconciliation_report"),
    Component:
      ReconciliationReportField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => {
      if (!isReconciliationReportValue(value)) {
        return false;
      }
      const isReady =
        value.nextAction === ReconciliationReportNextAction.ReadyForNextStep;
      const hasItems =
        (Array.isArray(value.designDocUpdates) &&
          value.designDocUpdates.length > 0) ||
        (Array.isArray(value.codeChanges) && value.codeChanges.length > 0) ||
        (Array.isArray(value.followUpTasks) && value.followUpTasks.length > 0);
      const hasMessage =
        typeof value.userMessage === "string" &&
        value.userMessage.trim().length > 0;
      return isReady && (hasItems || hasMessage);
    },
    shouldShowButtons: (value) =>
      isReconciliationReportValue(value) &&
      value.nextAction === ReconciliationReportNextAction.ReadyForNextStep,
    secondaryActions: {},
    prepareInitialValue: prepareReconciliationReportInitialValue,
  },
  plan_generation_stage_review: {
    ...getFieldResponseMetadata("plan_generation_stage_review"),
    Component:
      PlanGenerationStageReviewField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isPlanGenerationStageReviewValue(value),
    shouldShowButtons: () => false,
    hideSystemMessage: true,
    secondaryActions: {
      [PlanGenerationStageReviewContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGenerationStageReviewAction(
            formValues,
            config.fieldId ?? undefined,
            WorkflowReviewAction.Refine,
          ).values,
      },
      [PlanGenerationStageReviewApproveAllHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGenerationStageReviewAction(
            formValues,
            config.fieldId ?? undefined,
            WorkflowReviewAction.Approved,
          ).values,
        render: (context) => {
          const field = context.context.messageData?.uiElements?.find(
            (element) =>
              element.id === context.action.fieldId &&
              element.type === "plan_generation_stage_review",
          );
          const payload = field?.payload;
          if (
            !payload ||
            !("expectedStageCount" in payload) ||
            typeof payload.expectedStageCount !== "number"
          ) {
            return null;
          }
          const stageReviewPayload = {
            expectedStageCount: payload.expectedStageCount,
          };
          return (
            <PlanGenerationStageReviewReadyAction
              key={`${context.messageId}:${field.id}:${stageReviewPayload.expectedStageCount}`}
              {...context}
              payload={stageReviewPayload}
            />
          );
        },
      },
    },
    prepareInitialValue: ({ baseValue }) =>
      isPlanGenerationStageReviewValue(baseValue)
        ? baseValue
        : createPlanGenerationStageReviewValue(),
  },
  plan_generation_step_review: {
    ...getFieldResponseMetadata("plan_generation_step_review"),
    Component:
      PlanGenerationStepReviewField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isPlanGenerationStepReviewValue(value),
    shouldShowButtons: () => false,
    secondaryActions: {
      [PlanGenerationStepReviewContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGenerationStepReviewAction(
            formValues,
            config.fieldId ?? undefined,
            WorkflowReviewAction.Refine,
          ).values,
      },
      [PlanGenerationStepReviewApproveAllHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGenerationStepReviewAction(
            formValues,
            config.fieldId ?? undefined,
            WorkflowReviewAction.Approved,
          ).values,
      },
    },
    prepareInitialValue: ({ baseValue }) =>
      isPlanGenerationStepReviewValue(baseValue)
        ? baseValue
        : createPlanGenerationStepReviewValue(),
  },
  plan_generation_journey_review: {
    ...getFieldResponseMetadata("plan_generation_journey_review"),
    Component:
      PlanGenerationJourneyReviewField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isPlanGenerationJourneyReviewValue(value),
    shouldShowButtons: () => false,
    hideSystemMessage: true,
    secondaryActions: {
      [PlanGenerationJourneyMapApproveHandler]: {
        apply: ({ config, formValues }) =>
          applyPlanGenerationJourneyMapApprove(
            formValues,
            config.fieldId ?? undefined,
          ).values,
      },
      [PlanGenerationJourneyMapContinueRevisingHandler]: {
        apply: ({ config, formValues }) =>
          applyPlanGenerationJourneyMapContinueRevising(
            formValues,
            config.fieldId ?? undefined,
          ).values,
        getAvailability: ({ config, formValues }) => ({
          disabled: isPlanGenerationJourneyReviewFeedbackEmpty(
            formValues,
            config.fieldId ?? undefined,
          ),
        }),
      },
    },
    prepareInitialValue: ({ uiElement, baseValue }) => {
      if (isPlanGenerationJourneyReviewValue(baseValue)) {
        return baseValue;
      }
      const payload = uiElement.payload as unknown;
      if (
        payload &&
        typeof payload === "object" &&
        Array.isArray((payload as { steps?: unknown }).steps)
      ) {
        return createPlanGenerationJourneyReviewValue(
          payload as Parameters<
            typeof createPlanGenerationJourneyReviewValue
          >[0],
        );
      }
      if (
        payload &&
        typeof payload === "object" &&
        "journeyMap" in payload &&
        typeof (payload as { journeyMap?: unknown }).journeyMap === "object" &&
        (payload as { journeyMap?: unknown }).journeyMap !== null &&
        Array.isArray(
          (
            (payload as { journeyMap?: { steps?: unknown } }).journeyMap as {
              steps?: unknown;
            }
          ).steps,
        )
      ) {
        return createPlanGenerationJourneyReviewValue(
          (
            payload as {
              journeyMap: Parameters<
                typeof createPlanGenerationJourneyReviewValue
              >[0];
            }
          ).journeyMap,
        );
      }
      return createPlanGenerationJourneyReviewValue();
    },
  },
  plan_generation_visual_preview: {
    ...getFieldResponseMetadata("plan_generation_visual_preview"),
    Component:
      PlanGenerationVisualPreviewField as unknown as React.FC<FieldComponentProps>,
    getHasContent: () => true,
    shouldShowButtons: () => false,
    autoRenderProposals: false,
    secondaryActions: {
      [PlanGenerationVisualPreviewApproveHandler]: {
        apply: ({ config, formValues }) =>
          tryUpdatePlanGenerationVisualPreviewAction(
            formValues,
            config.fieldId ?? undefined,
            WorkflowReviewAction.Approved,
          ).values,
      },
    },
    prepareInitialValue: ({ baseValue }) =>
      isPlanGenerationVisualPreviewValue(baseValue)
        ? baseValue
        : createPlanGenerationVisualPreviewValue(),
  },
  plan_generation_finalize: {
    ...getFieldResponseMetadata("plan_generation_finalize"),
    Component:
      PlanGenerationFinalizeField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) =>
      isPlanGenerationFinalizeValue(value) && value.status === "READY",
    shouldShowButtons: (value) =>
      isPlanGenerationFinalizeValue(value) && value.status === "READY",
    prepareInitialValue: preparePlanGenerationFinalizeInitialValue,
  },
  plan_shaping_feature_sync_review: {
    ...getFieldResponseMetadata("plan_shaping_feature_sync_review"),
    Component:
      PlanShapingFeatureSyncReviewField as unknown as React.FC<FieldComponentProps>,
    getHasContent: (value) => isPlanShapingFeatureSyncReviewValue(value),
    fieldSubmitHandler: PlanShapingFeatureSyncReviewRequestRevisionsHandler,
    shouldShowButtons: () => false,
    hideSystemMessage: true,
    proposalsPlacement: "above-element",
    secondaryActions: {
      [PlanShapingFeatureSyncReviewDoneHandler]: {
        apply: ({ config, formValues }) => {
          const fieldId = config.fieldId ?? undefined;
          if (!fieldId) return null;
          const value = formValues[fieldId];
          if (!isPlanShapingFeatureSyncReviewValue(value)) return null;
          return {
            ...formValues,
            [fieldId]: projectPlanShapingFeatureSyncReviewAction(
              value,
              WorkflowReviewAction.Dismissed,
            ),
          };
        },
      },
      [PlanShapingFeatureSyncReviewRequestRevisionsHandler]: {
        apply: ({ config, formValues }) => {
          const fieldId = config.fieldId ?? undefined;
          if (!fieldId) return null;
          const value = formValues[fieldId];
          if (!isPlanShapingFeatureSyncReviewValue(value)) return null;
          return {
            ...formValues,
            [fieldId]: projectPlanShapingFeatureSyncReviewAction(
              value,
              WorkflowReviewAction.Refine,
            ),
          };
        },
      },
    },
    prepareInitialValue: () => createPlanShapingFeatureSyncReviewValue(),
  },
} as const;

const isRegistryTypeInput = (value: unknown): value is RegistryTypeInput => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "id" in value &&
    typeof value.id === "string" &&
    "type" in value &&
    typeof value.type === "string"
  );
};

export const getProposalsRenderConfig = (
  uiElements: unknown,
): { autoRender: boolean; placement: "above-element" | "below-element" } => {
  const defaults = {
    autoRender: true,
    placement: "below-element" as const,
  };

  if (!Array.isArray(uiElements)) {
    return defaults;
  }

  for (const uiElement of uiElements) {
    if (!isRegistryTypeInput(uiElement)) {
      continue;
    }

    const registryType = getRegistryType(uiElement);
    const fieldEntry = FIELD_REGISTRY[registryType];
    if (!fieldEntry) {
      continue;
    }

    if (
      fieldEntry.autoRenderProposals === undefined &&
      fieldEntry.proposalsPlacement === undefined
    ) {
      continue;
    }

    return {
      autoRender: fieldEntry.autoRenderProposals ?? defaults.autoRender,
      placement: fieldEntry.proposalsPlacement ?? defaults.placement,
    };
  }

  return defaults;
};

const getRegistryEntryByFieldId = (
  uiElements: UIElement[],
  fieldId: string | undefined | null,
): FieldRegistryEntry | undefined => {
  if (!fieldId) {
    return undefined;
  }

  const match = uiElements.find((element) => element.id === fieldId);
  if (!match) {
    return undefined;
  }

  const registryType = getRegistryType(match);
  return FIELD_REGISTRY[registryType];
};

const getFieldIdsWithSecondaryActionBehavior = ({
  handler,
  uiElements,
}: {
  handler: SecondaryActionHandlerKey;
  uiElements: UIElement[];
}): string[] =>
  uiElements
    .filter((element) => {
      const registryType = getRegistryType(element);
      return !!FIELD_REGISTRY[registryType]?.secondaryActions?.[handler];
    })
    .map((element) => element.id);

export const getSecondaryActionFieldId = ({
  handler,
  fieldId,
  uiElements,
}: {
  handler: SecondaryActionHandlerKey;
  fieldId?: string | null;
  uiElements: UIElement[];
}): string | undefined => {
  const fieldEntry = getRegistryEntryByFieldId(uiElements, fieldId);
  if (fieldEntry?.secondaryActions?.[handler] && fieldId) {
    return fieldId;
  }

  const matchingFieldIds = getFieldIdsWithSecondaryActionBehavior({
    handler,
    uiElements,
  });
  return matchingFieldIds.length === 1
    ? matchingFieldIds[0]
    : (fieldId ?? undefined);
};

export const getSecondaryActionBehavior = ({
  handler,
  fieldId,
  uiElements,
}: {
  handler: SecondaryActionHandlerKey;
  fieldId?: string | null;
  uiElements: UIElement[];
}): SecondaryActionBehavior | undefined => {
  const resolvedFieldId = getSecondaryActionFieldId({
    handler,
    fieldId,
    uiElements,
  });
  const fieldEntry = getRegistryEntryByFieldId(uiElements, resolvedFieldId);
  const fieldBehavior = fieldEntry?.secondaryActions?.[handler];
  if (fieldBehavior) {
    return fieldBehavior;
  }

  const matchingFieldIds = getFieldIdsWithSecondaryActionBehavior({
    handler,
    uiElements,
  });
  if (matchingFieldIds.length === 1) {
    const matchingEntry = getRegistryEntryByFieldId(
      uiElements,
      matchingFieldIds[0],
    );
    return matchingEntry?.secondaryActions?.[handler];
  }

  const messageBehavior =
    FIELD_REGISTRY[MESSAGE_REGISTRY_KEY]?.secondaryActions?.[handler];
  if (messageBehavior) {
    return messageBehavior;
  }

  return undefined;
};
