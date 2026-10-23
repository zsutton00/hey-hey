import type {
  OnboardingPlanCandidateReviewPayload,
  PlanStageProposalStageFeedbackActionEnum,
} from "../../../api";
import type {
  PlanStageProposalStageFeedbackValue,
  PlanStageProposalStageValue,
  PlanStageProposalValue,
} from "./types";
import { PlanStageProposalNextAction } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isPlanStageProposalNextAction = (
  value: unknown,
): value is PlanStageProposalValue["nextAction"] =>
  value === PlanStageProposalNextAction.ReadyForNextStep ||
  value === PlanStageProposalNextAction.ContinueRevising;

const isStageFeedbackAction = (
  value: unknown,
): value is PlanStageProposalStageFeedbackActionEnum =>
  value === "accept" || value === "reject" || value === "pending";

const normalizeStageValue = (
  value: unknown,
): PlanStageProposalStageValue | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.purpose !== "string" ||
    typeof value.timing !== "string" ||
    typeof value.sequenceOrder !== "number"
  ) {
    return null;
  }

  return {
    title: value.title,
    description: value.description,
    purpose: value.purpose,
    timing: value.timing,
    sequenceOrder: value.sequenceOrder,
    action: isStageFeedbackAction(value.action) ? value.action : "pending",
    comment: typeof value.comment === "string" ? value.comment : undefined,
  };
};

const sortStagesBySequence = <T extends { sequenceOrder: number }>(
  stages: T[],
): T[] => [...stages].sort((a, b) => a.sequenceOrder - b.sequenceOrder);

const buildStageFeedback = (
  stages: PlanStageProposalStageValue[],
): PlanStageProposalStageFeedbackValue[] =>
  stages.map((stage) => ({
    sequenceOrder: stage.sequenceOrder,
    title: stage.title,
    action: stage.action,
    comment: stage.comment,
  }));

export const createPlanStageProposalValue = (
  payload: OnboardingPlanCandidateReviewPayload,
): PlanStageProposalValue => {
  const stages: PlanStageProposalStageValue[] = sortStagesBySequence(
    payload.stages,
  ).map((stage) => ({
    title: stage.title,
    description: stage.description,
    purpose: stage.purpose,
    timing: stage.timing,
    sequenceOrder: stage.sequenceOrder,
    action: "pending" as const,
    comment: undefined,
  }));

  return {
    type: "PLAN_STAGE_PROPOSAL",
    nextAction: PlanStageProposalNextAction.ContinueRevising,
    userMessage: "",
    stages,
    stageFeedback: buildStageFeedback(stages),
  };
};

export const normalizePlanStageProposalValue = (
  value: unknown,
  fallback: PlanStageProposalValue,
): PlanStageProposalValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  const stages = Array.isArray(value.stages)
    ? value.stages
        .map(normalizeStageValue)
        .filter((stage): stage is PlanStageProposalStageValue => !!stage)
    : fallback.stages;

  const normalizedStages =
    stages.length > 0 ? sortStagesBySequence(stages) : fallback.stages;

  return {
    type: "PLAN_STAGE_PROPOSAL",
    nextAction: isPlanStageProposalNextAction(value.nextAction)
      ? value.nextAction
      : fallback.nextAction,
    userMessage:
      typeof value.userMessage === "string"
        ? value.userMessage
        : fallback.userMessage,
    stages: normalizedStages,
    stageFeedback: buildStageFeedback(normalizedStages),
  };
};

export const createStageFeedbackFromStages = (
  stages: PlanStageProposalStageValue[],
): PlanStageProposalStageFeedbackValue[] => buildStageFeedback(stages);
