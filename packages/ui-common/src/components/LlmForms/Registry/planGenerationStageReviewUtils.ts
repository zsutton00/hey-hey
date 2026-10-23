import { ProposalStatus, WorkflowReviewAction } from "../../../api";
import type {
  PlanGenerationStageReviewAction,
  PlanGenerationStageReviewDraftValue,
  PlanGenerationStageReviewValue,
} from "./types";
import type { MessageInteractionContext } from "../../Conversation/hooks/proposalsAcceptedTypes";
import type { PlanGenerationStageReviewPayload } from "../../../api";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

export type StageReadinessDecision =
  | { kind: "submit-approved" }
  | {
      kind: "confirm-mismatch";
      expectedStageCount: number;
      approvedStageCount: number;
    };

const PLAN_STAGE_WORK_ITEM_TYPE = "PLAN_STAGE" as const;

export const countApprovedPlanStages = (
  interaction: MessageInteractionContext
): number =>
  interaction.proposals.filter(
    ({ lifecycle, targetWorkItemType }) =>
      targetWorkItemType === PLAN_STAGE_WORK_ITEM_TYPE &&
      lifecycle === ProposalStatus.Approved
  ).length;

export const decideStageReadiness = (
  completion: PlanGenerationStageReviewPayload,
  interaction: MessageInteractionContext
): StageReadinessDecision => {
  const approvedStageCount = countApprovedPlanStages(interaction);
  return approvedStageCount === completion.expectedStageCount
    ? { kind: "submit-approved" }
    : {
        kind: "confirm-mismatch",
        expectedStageCount: completion.expectedStageCount,
        approvedStageCount,
      };
};

export const createPlanGenerationStageReviewValue = (
  feedback = ""
): PlanGenerationStageReviewDraftValue => ({
  payload: { feedback },
});

export const createPlanGenerationStageApprovedSubmission =
  (): PlanGenerationStageReviewValue => ({
    action: WorkflowReviewAction.Approved,
    payload: {},
  });

export const getPlanGenerationStageReviewFeedback = (
  value: PlanGenerationStageReviewValue
): string =>
  "feedback" in value.payload && typeof value.payload.feedback === "string"
    ? value.payload.feedback
    : "";

export const projectPlanGenerationStageReviewAction = (
  value: PlanGenerationStageReviewValue,
  action: PlanGenerationStageReviewAction
): PlanGenerationStageReviewValue =>
  action === WorkflowReviewAction.Refine
    ? {
        action,
        payload: { feedback: getPlanGenerationStageReviewFeedback(value) },
      }
    : createPlanGenerationStageApprovedSubmission();

export const normalizePlanGenerationStageReviewValue = (
  value: unknown
): PlanGenerationStageReviewDraftValue => {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return createPlanGenerationStageReviewValue();
  }
  return createPlanGenerationStageReviewValue(
    typeof value.payload.feedback === "string" ? value.payload.feedback : ""
  );
};
