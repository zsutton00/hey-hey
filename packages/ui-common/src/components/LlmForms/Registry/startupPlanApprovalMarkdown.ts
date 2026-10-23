import {
  renderStartupPlanMarkdown,
  renderStartupPlanReviewMarkdown,
  type StartupPlanRenderable,
  type StartupPlanReviewFeedback,
  type StartupPlanStepFeedbackEntry,
  type StartupPlanDiscrepancyFeedbackEntry,
  type StartupPlanQuestionAnswerEntry,
} from "../../../agents/coordination/startupPlanRendering";
import type {
  CodingPlanApprovedWorkflowAnswer,
  CodingPlanRefineWorkflowAnswer,
  CodingPlanReviewAnswerPayload,
  CodingPlanWorkflowAnswer,
} from "../../../api";
import { WorkflowReviewAction } from "../../../api";

type StartupPlanApprovalCommentInput = StartupPlanRenderable & {
  feedback?: string | null;
  stepFeedback?: ReadonlyArray<StartupPlanStepFeedbackEntry>;
  discrepancyFeedback?: ReadonlyArray<StartupPlanDiscrepancyFeedbackEntry>;
  questionAnswers?: ReadonlyArray<StartupPlanQuestionAnswerEntry>;
};

export type CodingPlanUserAction = CodingPlanWorkflowAnswer["action"];

export type CodingPlanSubmission =
  CodingPlanRefineWorkflowAnswer | CodingPlanApprovedWorkflowAnswer;

export const projectStartupPlanSubmission = (
  value: CodingPlanReviewAnswerPayload & { decision?: unknown },
  action: CodingPlanUserAction,
): { value: CodingPlanSubmission; comment?: string } => {
  const { decision: _decision, ...payload } = value;
  const reviewPayload = payload satisfies CodingPlanReviewAnswerPayload;
  if (action === WorkflowReviewAction.Approved) {
    return {
      value: { action, payload: reviewPayload },
      comment: buildStartupPlanApprovalCommentMarkdown(reviewPayload),
    };
  }

  return { value: { action, payload: reviewPayload } };
};

const buildStartupPlanApprovalCommentMarkdown = (
  value: StartupPlanApprovalCommentInput,
): string => {
  const planMarkdown = renderStartupPlanMarkdown(value, {
    sessionTitlePrefix: "Plan approved: ",
  });

  const feedback: StartupPlanReviewFeedback = {
    generalFeedback: value.feedback ?? null,
    stepFeedback: value.stepFeedback,
    discrepancyFeedback: value.discrepancyFeedback,
    questionAnswers: value.questionAnswers,
  };
  const review = renderStartupPlanReviewMarkdown({ plan: value, feedback });
  if (!review) {
    return planMarkdown;
  }

  return `${planMarkdown}\n\n${review}`;
};
