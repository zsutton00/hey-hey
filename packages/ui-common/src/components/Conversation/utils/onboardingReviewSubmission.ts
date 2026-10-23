import { projectFeatureListSubmission } from "../../LlmForms/Registry/featureListSubmission";
import type {
  OnboardingFeatureListReviewUserSubmission,
  OnboardingPlanStageProposalReviewPayload,
  OnboardingPlanStageProposalReviewUserSubmission,
  OnboardingReplyAnswers,
  RepositoryImportReplyAnswers,
  RepositoryGroundingAnalysisConfiguration,
  RepositoryGroundingPrerequisites,
  RepositoryGroundingScope,
} from "../../../api";
import { RepositoryGroundingAction, WorkflowReviewAction } from "../../../api";
import type { FormValue } from "../../LlmForms/types";
import {
  isFeatureListValue,
  type PlanStageProposalValue,
} from "../../LlmForms/Registry/types";
import type {
  RepositoryGroundingNextAction,
  RepositoryGroundingSubmission,
} from "../../LlmForms/Registry/repositoryGroundingUtils";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCanonicalReviewSubmission = (
  value: unknown,
): value is
  | OnboardingFeatureListReviewUserSubmission
  | OnboardingPlanStageProposalReviewUserSubmission =>
  isRecord(value) &&
  (value.action === WorkflowReviewAction.Refine ||
    value.action === WorkflowReviewAction.Approved) &&
  isRecord(value.payload);

const isPlanStageProposalDraft = (
  value: FormValue | undefined,
): value is PlanStageProposalValue =>
  isRecord(value) &&
  value.type === "PLAN_STAGE_PROPOSAL" &&
  (value.nextAction === "READY_FOR_NEXT_STEP" ||
    value.nextAction === "CONTINUE_REVISING") &&
  typeof value.userMessage === "string" &&
  Array.isArray(value.stageFeedback);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isReasoningEffort = (
  value: unknown,
): value is RepositoryGroundingSubmission["reasoningEffort"] =>
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh" ||
  value === "max";

const REPOSITORY_GROUNDING_BOUND_MINIMUMS = {
  maxFiles: 1,
  maxTotalBytes: 1,
  maxFileBytes: 1,
  maxDepth: 0,
  maxGeneratedFiles: 0,
  maxIgnoredFiles: 0,
  maxUnsupportedFiles: 0,
  maxBinaryFiles: 0,
} as const;

const isRepositoryGroundingBounds = (value: unknown): boolean => {
  if (!isRecord(value)) return false;

  const keys = Object.keys(REPOSITORY_GROUNDING_BOUND_MINIMUMS);
  return (
    Object.keys(value).every((key) => keys.includes(key)) &&
    keys.every((key) => {
      const bound = value[key];
      const minimum =
        REPOSITORY_GROUNDING_BOUND_MINIMUMS[
          key as keyof typeof REPOSITORY_GROUNDING_BOUND_MINIMUMS
        ];
      return (
        typeof bound === "number" && Number.isInteger(bound) && bound >= minimum
      );
    })
  );
};

const isRepositoryGroundingAction = (
  value: unknown,
): value is RepositoryGroundingNextAction =>
  value === RepositoryGroundingAction.StartAnalysis ||
  value === RepositoryGroundingAction.RetryAnalysis ||
  value === RepositoryGroundingAction.FinishLater ||
  value === RepositoryGroundingAction.ContinueConversation;

const isRepositoryGroundingSubmission = (
  value: FormValue | undefined,
): value is RepositoryGroundingSubmission => {
  if (!isRecord(value)) return false;

  return (
    (value.entryMode === "existing" || value.entryMode === "new") &&
    isNonEmptyString(value.serviceId) &&
    isNonEmptyString(value.brief) &&
    isNonEmptyString(value.machineId) &&
    (value.scope === "focused" || value.scope === "comprehensive") &&
    isNonEmptyString(value.provider) &&
    isNonEmptyString(value.model) &&
    isReasoningEffort(value.reasoningEffort) &&
    (value.fastMode === undefined || typeof value.fastMode === "boolean") &&
    isRepositoryGroundingAction(value.nextAction) &&
    isRepositoryGroundingBounds(value.bounds) &&
    (value.scope !== "focused" || isNonEmptyString(value.focus))
  );
};

const projectRepositoryGroundingSubmission = (
  value: RepositoryGroundingSubmission,
): Pick<
  RepositoryImportReplyAnswers,
  | "repository_prerequisites"
  | "repository_analysis_configuration"
  | "repository_grounding_action"
> => {
  const scope: RepositoryGroundingScope =
    value.scope === "focused"
      ? { scope: "focused", focus: value.focus?.trim() ?? "" }
      : { scope: "comprehensive" };

  const prerequisites: RepositoryGroundingPrerequisites = {
    entryMode: value.entryMode === "new" ? "new_project" : "existing_project",
    serviceId: value.serviceId,
    confirmedServiceBrief: value.brief.trim(),
    machineId: value.machineId,
  };

  const analysisConfiguration: RepositoryGroundingAnalysisConfiguration = {
    scope,
    provider: value.provider,
    resolvedFrontierModel: value.model,
    reasoningEffort: value.reasoningEffort,
    ...(value.fastMode === undefined ? {} : { fastMode: value.fastMode }),
    bounds: value.bounds,
  };

  return {
    repository_prerequisites: prerequisites,
    repository_analysis_configuration: analysisConfiguration,
    repository_grounding_action: value.nextAction,
  };
};

const projectPlanStageReview = (
  value: PlanStageProposalValue,
): OnboardingPlanStageProposalReviewUserSubmission => {
  const payload: OnboardingPlanStageProposalReviewPayload = {
    ...(value.userMessage.trim() ? { userMessage: value.userMessage } : {}),
    stageFeedback: value.stageFeedback.map(
      ({ sequenceOrder, title, action, comment }) => ({
        sequenceOrder,
        title,
        action,
        ...(comment === undefined ? {} : { comment }),
      }),
    ),
  };

  return {
    action:
      value.nextAction === "CONTINUE_REVISING"
        ? WorkflowReviewAction.Refine
        : WorkflowReviewAction.Approved,
    payload,
  };
};

/**
 * Projects onboarding's editor-only review drafts into the typed admission
 * contract. Rich proposal text and hierarchy data stay in the rendered system
 * message; only the action-specific review payload crosses the reply boundary.
 */
export const projectOnboardingReviewAnswers = (
  values: Record<string, FormValue>,
): OnboardingReplyAnswers => {
  const updated: Record<string, FormValue> = { ...values };

  const featureListValue = updated["feature-list"];
  if (isFeatureListValue(featureListValue)) {
    updated["feature-list"] = projectFeatureListSubmission(
      featureListValue,
      "APPROVED",
    );
  } else if (isCanonicalReviewSubmission(featureListValue)) {
    updated["feature-list"] = featureListValue;
  }

  const planStageValue = updated.onboarding_plan_candidate_proposals;
  if (isPlanStageProposalDraft(planStageValue)) {
    updated.onboarding_plan_candidate_proposals =
      projectPlanStageReview(planStageValue);
  } else if (isCanonicalReviewSubmission(planStageValue)) {
    updated.onboarding_plan_candidate_proposals = planStageValue;
  }

  return updated;
};

export const projectRepositoryImportReviewAnswers = (
  values: Record<string, FormValue>,
): RepositoryImportReplyAnswers => {
  const updated: Record<string, FormValue> = { ...values };
  const featureListValue = updated["feature-list"];
  if (isFeatureListValue(featureListValue)) {
    updated["feature-list"] = projectFeatureListSubmission(
      featureListValue,
      "APPROVED",
    );
  } else if (isCanonicalReviewSubmission(featureListValue)) {
    updated["feature-list"] = featureListValue;
  }
  for (const [fieldId, value] of Object.entries(updated)) {
    if (!isRepositoryGroundingSubmission(value)) continue;
    delete updated[fieldId];
    Object.assign(updated, projectRepositoryGroundingSubmission(value));
    break;
  }
  return updated;
};
