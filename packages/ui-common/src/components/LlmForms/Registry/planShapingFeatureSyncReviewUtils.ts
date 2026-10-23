import type {
  PlanShapingFeatureSyncReviewAction,
  PlanShapingFeatureSyncReviewValue,
} from "./types";
import { WorkflowReviewAction } from "../../../api";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isReviewAction = (
  value: unknown
): value is PlanShapingFeatureSyncReviewAction =>
  value === WorkflowReviewAction.Dismissed ||
  value === WorkflowReviewAction.Refine;

export const createPlanShapingFeatureSyncReviewValue =
  (): PlanShapingFeatureSyncReviewValue => ({
    action: WorkflowReviewAction.Refine,
    payload: { feedback: "" },
  });

export const normalizePlanShapingFeatureSyncReviewValue = (
  value: unknown
): PlanShapingFeatureSyncReviewValue => {
  const fallback = createPlanShapingFeatureSyncReviewValue();

  if (!isRecord(value)) {
    return fallback;
  }

  if (!isReviewAction(value.action)) {
    return fallback;
  }

  if (value.action === WorkflowReviewAction.Dismissed) {
    return {
      action: value.action,
      payload: {},
    };
  }

  const payloadRecord = isRecord(value.payload) ? value.payload : undefined;
  return {
    action: value.action,
    payload: {
      feedback:
        payloadRecord && typeof payloadRecord.feedback === "string"
          ? payloadRecord.feedback
          : "",
    },
  };
};

export const projectPlanShapingFeatureSyncReviewAction = (
  value: PlanShapingFeatureSyncReviewValue,
  action: PlanShapingFeatureSyncReviewAction
): PlanShapingFeatureSyncReviewValue => {
  if (action === WorkflowReviewAction.Dismissed) {
    return { action, payload: {} };
  }

  const feedback =
    value.action === WorkflowReviewAction.Refine
      ? value.payload.feedback
      : "";
  return { action, payload: { feedback } };
};
