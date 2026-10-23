import { WorkflowReviewAction } from "../../../api";
import type {
  PlanGenerationVisualPreviewDraftValue,
  PlanGenerationVisualPreviewReviewAction,
  PlanGenerationVisualPreviewValue,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

export const createPlanGenerationVisualPreviewValue = (
  feedback = "",
): PlanGenerationVisualPreviewDraftValue => ({
  payload: { feedback },
});

export const getPlanGenerationVisualPreviewFeedback = (
  value: PlanGenerationVisualPreviewValue,
): string =>
  "feedback" in value.payload && typeof value.payload.feedback === "string"
    ? value.payload.feedback
    : "";

export const projectPlanGenerationVisualPreviewAction = (
  value: PlanGenerationVisualPreviewValue,
  action: PlanGenerationVisualPreviewReviewAction,
): PlanGenerationVisualPreviewValue =>
  action === WorkflowReviewAction.Refine
    ? {
        action,
        payload: { feedback: getPlanGenerationVisualPreviewFeedback(value) },
      }
    : {
        action: WorkflowReviewAction.Approved,
        payload: {},
      };

export const normalizePlanGenerationVisualPreviewValue = (
  value: unknown,
): PlanGenerationVisualPreviewDraftValue => {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return createPlanGenerationVisualPreviewValue();
  }

  return createPlanGenerationVisualPreviewValue(
    typeof value.payload.feedback === "string"
      ? value.payload.feedback
      : "",
  );
};
