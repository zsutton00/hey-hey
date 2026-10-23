import { WorkflowReviewAction } from "../../../api";
import type { JourneyMap } from "../../../api";
import type {
  PlanGenerationJourneyReviewAction,
  PlanGenerationJourneyReviewDraftValue,
  PlanGenerationJourneyReviewValue,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const createEmptyJourneyMap = (): JourneyMap => ({ steps: [] });

const normalizeJourneyMap = (value: unknown): JourneyMap | undefined => {
  if (!isRecord(value) || !Array.isArray(value.steps)) {
    return undefined;
  }
  return value as unknown as JourneyMap;
};

export const createPlanGenerationJourneyReviewValue = (
  journeyMap: JourneyMap = createEmptyJourneyMap(),
  feedback = ""
): PlanGenerationJourneyReviewDraftValue => ({
  payload: { journeyMap, feedback },
});

export const getPlanGenerationJourneyReviewFeedback = (
  value: PlanGenerationJourneyReviewValue
): string =>
  "feedback" in value.payload && typeof value.payload.feedback === "string"
    ? value.payload.feedback
    : "";

export const projectPlanGenerationJourneyReviewAction = (
  value: PlanGenerationJourneyReviewValue,
  action: PlanGenerationJourneyReviewAction
): PlanGenerationJourneyReviewValue =>
  action === WorkflowReviewAction.Refine
    ? {
        action,
        payload: { feedback: getPlanGenerationJourneyReviewFeedback(value) },
      }
    : {
        action: WorkflowReviewAction.Approved,
        payload: {},
      };

export const normalizePlanGenerationJourneyReviewValue = (
  value: unknown,
  fallback: PlanGenerationJourneyReviewDraftValue = createPlanGenerationJourneyReviewValue()
): PlanGenerationJourneyReviewDraftValue => {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return fallback;
  }

  return createPlanGenerationJourneyReviewValue(
    normalizeJourneyMap(value.payload.journeyMap) ??
      fallback.payload.journeyMap,
    typeof value.payload.feedback === "string"
      ? value.payload.feedback
      : fallback.payload.feedback
  );
};
