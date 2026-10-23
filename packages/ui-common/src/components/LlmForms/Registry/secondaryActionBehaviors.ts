import { projectFeatureListSubmission } from "./featureListSubmission";
import type { OnboardingFeatureListReviewUserSubmission } from "../../../api";
import type {
  CodingPromptUserMessage,
  TaskStubUserMessage,
} from "../../../api";
import {
  CodingPromptUserMessageNextActionEnum,
  CodingPromptUserMessageTypeEnum,
  TaskStubUserMessageNextActionEnum,
  WorkflowReviewAction,
} from "../../../api";
import { log } from "../../../utils/logger";
import type { FormValue } from "../types";
import type { SecondaryActionConfigWithHandler } from "./types";
import {
  PlanApprovalNextAction,
  PlanGapDiscoveryMessageType,
  PlanGapDiscoveryNextAction,
  PlanServiceSelectionNextAction,
  PlanStageProposalNextAction,
  SyncRecommendationNextAction,
  isSyncRecommendationValue,
  isFeatureListValue,
  isPlanGenerationStageReviewValue,
  isPlanGenerationStepReviewValue,
  isPlanGenerationJourneyReviewValue,
  isPlanGenerationVisualPreviewValue,
  type PlanApprovalValue,
  type PlanGapDiscoveryUserMessage,
  type PlanGenerationStageReviewAction,
  type PlanGenerationStageReviewValue,
  type PlanGenerationStepReviewAction,
  type PlanGenerationStepReviewValue,
  type PlanGenerationJourneyReviewValue,
  type PlanGenerationVisualPreviewReviewAction,
  type PlanGenerationVisualPreviewValue,
  type PlanServiceSelectionValue,
  type PlanStageProposalValue,
} from "./types";
import { projectPlanGenerationStageReviewAction } from "./planGenerationStageReviewUtils";
import { projectPlanGenerationStepReviewAction } from "./planGenerationStepReviewUtils";
import {
  getPlanGenerationJourneyReviewFeedback,
  projectPlanGenerationJourneyReviewAction,
} from "./planGenerationJourneyReviewUtils";
import { projectPlanGenerationVisualPreviewAction } from "./planGenerationVisualPreviewReviewUtils";

type UpdateNextActionResult = {
  updated: boolean;
  values: Record<string, FormValue>;
};

const isRecord = (value: FormValue): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const updateFieldByPredicate = <T extends FormValue>(
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  isTarget: (value: FormValue) => value is T,
  update: (value: T) => FormValue,
): UpdateNextActionResult => {
  const result = { ...formValues };

  const updateValue = (value: FormValue): FormValue | null =>
    isTarget(value) ? update(value) : null;

  if (fieldId && fieldId in result) {
    const updated = updateValue(result[fieldId]);
    if (updated) {
      result[fieldId] = updated;
      return { updated: true, values: result };
    }
  }

  for (const key of Object.keys(result)) {
    const updated = updateValue(result[key]);
    if (updated) {
      result[key] = updated;
      return { updated: true, values: result };
    }
  }

  return { updated: false, values: result };
};

const isTaskStubUserMessageValue = (
  value: FormValue,
): value is TaskStubUserMessage => isRecord(value) && "stubReviews" in value;

export const updateTaskStubNextAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  nextAction: TaskStubUserMessageNextActionEnum,
): Record<string, FormValue> => {
  const result = updateFieldByPredicate(
    formValues,
    fieldId,
    isTaskStubUserMessageValue,
    (value) => ({
      ...value,
      nextAction,
    }),
  );

  if (!result.updated) {
    log.warn(
      "dynamic_form",
      "Could not find task stub field to update nextAction",
      {
        fieldId,
        availableFields: Object.keys(formValues),
      },
    );
  }

  return result.values;
};

const isPlanGapDiscoveryUserMessageValue = (
  value: FormValue,
): value is PlanGapDiscoveryUserMessage =>
  isRecord(value) &&
  value.type === PlanGapDiscoveryMessageType.PlanGaps &&
  "gapReviews" in value &&
  "clarifyingAnswers" in value &&
  "manuallyAdded" in value;

const isPlanApprovalValue = (value: FormValue): value is PlanApprovalValue =>
  isRecord(value) && value.type === "PLAN_APPROVAL" && "nextAction" in value;

const isPlanStageProposalValue = (
  value: FormValue,
): value is PlanStageProposalValue =>
  isRecord(value) &&
  value.type === "PLAN_STAGE_PROPOSAL" &&
  "nextAction" in value;

const isPlanServiceSelectionValue = (
  value: FormValue,
): value is PlanServiceSelectionValue =>
  isRecord(value) &&
  value.type === "PLAN_SERVICE_SELECTION" &&
  "nextAction" in value &&
  "services" in value;

export const tryUpdatePlanGapNextAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  nextAction: PlanGapDiscoveryNextAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanGapDiscoveryUserMessageValue,
    (value) => ({
      ...value,
      nextAction,
    }),
  );

export const tryUpdatePlanApprovalNextAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  nextAction: PlanApprovalNextAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(formValues, fieldId, isPlanApprovalValue, (value) => ({
    ...value,
    nextAction,
  }));

export const tryUpdatePlanStageNextAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  nextAction: PlanStageProposalNextAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanStageProposalValue,
    (value) => ({
      ...value,
      nextAction,
    }),
  );

export const tryUpdatePlanServiceSelectionNextAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  nextAction: PlanServiceSelectionNextAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanServiceSelectionValue,
    (value) => ({
      ...value,
      nextAction,
    }),
  );

export const tryUpdateSyncRecommendationNextAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  nextAction: SyncRecommendationNextAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isSyncRecommendationValue,
    (value) => ({
      ...value,
      nextAction,
    }),
  );

const isPlanGenerationStageReviewFormValue = (
  value: FormValue,
): value is PlanGenerationStageReviewValue =>
  isPlanGenerationStageReviewValue(value);

export const tryUpdatePlanGenerationStageReviewAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  action: PlanGenerationStageReviewAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanGenerationStageReviewFormValue,
    (value) => projectPlanGenerationStageReviewAction(value, action),
  );

const isPlanGenerationStepReviewFormValue = (
  value: FormValue,
): value is PlanGenerationStepReviewValue =>
  isPlanGenerationStepReviewValue(value);

export const tryUpdatePlanGenerationStepReviewAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  action: PlanGenerationStepReviewAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanGenerationStepReviewFormValue,
    (value) => projectPlanGenerationStepReviewAction(value, action),
  );

export const tryUpdateFeatureListAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  action: OnboardingFeatureListReviewUserSubmission["action"],
): UpdateNextActionResult =>
  updateFieldByPredicate(formValues, fieldId, isFeatureListValue, (value) =>
    projectFeatureListSubmission(value, action),
  );

const isCodingPromptUserMessageValue = (
  value: FormValue,
): value is CodingPromptUserMessage =>
  isRecord(value) && "userMessage" in value && "nextAction" in value;

const getCodingPromptFieldValue = (
  formValues: Record<string, FormValue>,
  action: SecondaryActionConfigWithHandler,
) => {
  const targetFieldId = action.fieldId;

  if (!targetFieldId) {
    log.warn("dynamic_form", "CodingPromptAccept missing coding prompt field", {
      actionId: action.id,
      availableFields: Object.keys(formValues),
    });
    return null;
  }

  if (!(targetFieldId in formValues)) {
    log.warn("dynamic_form", "CodingPromptAccept field has no value", {
      actionId: action.id,
      targetFieldId,
      availableFields: Object.keys(formValues),
    });
    return null;
  }

  return { targetFieldId, fieldValue: formValues[targetFieldId] };
};

const isPlanGenerationJourneyReviewFormValue = (
  value: FormValue,
): value is PlanGenerationJourneyReviewValue =>
  isPlanGenerationJourneyReviewValue(value);

const isPlanGenerationVisualPreviewFormValue = (
  value: FormValue,
): value is PlanGenerationVisualPreviewValue =>
  isPlanGenerationVisualPreviewValue(value);

export const tryUpdatePlanGenerationVisualPreviewAction = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  action: PlanGenerationVisualPreviewReviewAction,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanGenerationVisualPreviewFormValue,
    (value) => projectPlanGenerationVisualPreviewAction(value, action),
  );

const getTextareaFeedback = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): string => {
  const value = fieldId ? formValues[fieldId] : undefined;
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.text === "string") {
    return value.text;
  }

  return "";
};

const buildVisualPreviewTextareaSubmission = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
  action: WorkflowReviewAction,
): Record<string, FormValue> | null => {
  if (!fieldId) {
    return null;
  }

  return {
    ...formValues,
    [fieldId]: {
      action,
      payload:
        action === WorkflowReviewAction.Refine
          ? { feedback: getTextareaFeedback(formValues, fieldId) }
          : {},
    },
  };
};

export const applyPlanGenerationVisualPreviewTextareaApprove = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): Record<string, FormValue> | null =>
  buildVisualPreviewTextareaSubmission(
    formValues,
    fieldId,
    WorkflowReviewAction.Approved,
  );

export const applyPlanGenerationVisualPreviewTextareaContinueRevising = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): Record<string, FormValue> | null =>
  buildVisualPreviewTextareaSubmission(
    formValues,
    fieldId,
    WorkflowReviewAction.Refine,
  );

export const applyPlanGenerationJourneyMapApprove = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanGenerationJourneyReviewFormValue,
    (value) =>
      projectPlanGenerationJourneyReviewAction(
        value,
        WorkflowReviewAction.Approved,
      ),
  );

export const applyPlanGenerationJourneyMapContinueRevising = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): UpdateNextActionResult =>
  updateFieldByPredicate(
    formValues,
    fieldId,
    isPlanGenerationJourneyReviewFormValue,
    (value) =>
      projectPlanGenerationJourneyReviewAction(
        value,
        WorkflowReviewAction.Refine,
      ),
  );

const findPlanGenerationJourneyReviewValue = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): PlanGenerationJourneyReviewValue | undefined => {
  if (fieldId && fieldId in formValues) {
    const candidate = formValues[fieldId];
    if (isPlanGenerationJourneyReviewFormValue(candidate)) {
      return candidate;
    }
  }
  for (const key of Object.keys(formValues)) {
    const candidate = formValues[key];
    if (isPlanGenerationJourneyReviewFormValue(candidate)) {
      return candidate;
    }
  }
  return undefined;
};

export const isPlanGenerationJourneyReviewFeedbackEmpty = (
  formValues: Record<string, FormValue>,
  fieldId: string | undefined,
): boolean => {
  const value = findPlanGenerationJourneyReviewValue(formValues, fieldId);
  if (!value) {
    return true;
  }
  return getPlanGenerationJourneyReviewFeedback(value).trim().length === 0;
};

export const buildCodingPromptAcceptPayload = (
  formValues: Record<string, FormValue>,
  action: SecondaryActionConfigWithHandler,
): Record<string, FormValue> | null => {
  const codingPromptField = getCodingPromptFieldValue(formValues, action);

  if (!codingPromptField) {
    return null;
  }

  const { targetFieldId, fieldValue } = codingPromptField;

  let userMessage = "";
  if (typeof fieldValue === "string") {
    userMessage = fieldValue;
  } else if (isCodingPromptUserMessageValue(fieldValue)) {
    userMessage = fieldValue.userMessage;
  } else if (
    isRecord(fieldValue) &&
    typeof fieldValue.userMessage === "string"
  ) {
    userMessage = fieldValue.userMessage;
  } else if (isRecord(fieldValue) && typeof fieldValue.response === "string") {
    userMessage = fieldValue.response;
  }

  const acceptPayload: CodingPromptUserMessage = {
    type: CodingPromptUserMessageTypeEnum.CodingPrompts,
    nextAction: CodingPromptUserMessageNextActionEnum.Accept,
    userMessage,
  };

  return {
    ...formValues,
    [targetFieldId]: acceptPayload,
  };
};
