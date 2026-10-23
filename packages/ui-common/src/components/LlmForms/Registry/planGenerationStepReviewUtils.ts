import { WorkflowReviewAction } from "../../../api";
import type {
  PlanGenerationStepReviewAction,
  PlanGenerationStepReviewDraftValue,
  PlanGenerationStepReviewValue,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

export const createPlanGenerationStepReviewValue = (
  feedback = ""
): PlanGenerationStepReviewDraftValue => ({
  payload: { feedback },
});

export const createPlanGenerationStepApprovedSubmission =
  (): PlanGenerationStepReviewValue => ({
    action: WorkflowReviewAction.Approved,
    payload: {},
  });

export const getPlanGenerationStepReviewFeedback = (
  value: PlanGenerationStepReviewValue
): string =>
  "feedback" in value.payload && typeof value.payload.feedback === "string"
    ? value.payload.feedback
    : "";

export const projectPlanGenerationStepReviewAction = (
  value: PlanGenerationStepReviewValue,
  action: PlanGenerationStepReviewAction
): PlanGenerationStepReviewValue =>
  action === WorkflowReviewAction.Refine
    ? {
        action,
        payload: { feedback: getPlanGenerationStepReviewFeedback(value) },
      }
    : createPlanGenerationStepApprovedSubmission();

export const normalizePlanGenerationStepReviewValue = (
  value: unknown
): PlanGenerationStepReviewDraftValue => {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return createPlanGenerationStepReviewValue();
  }
  return createPlanGenerationStepReviewValue(
    typeof value.payload.feedback === "string" ? value.payload.feedback : ""
  );
};
