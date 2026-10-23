import type { PlanGenerationFinalizePayload } from "../../../api";
import type {
  PlanGenerationFinalizeStatus,
  PlanGenerationFinalizeValue,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isFinalizeStatus = (
  value: unknown
): value is PlanGenerationFinalizeStatus =>
  value === "PENDING" || value === "READY";

const stringOrEmpty = (value: unknown): string =>
  typeof value === "string" ? value : "";

export const createPlanGenerationFinalizeValue = (
  payload: PlanGenerationFinalizePayload
): PlanGenerationFinalizeValue => ({
  type: "PLAN_GENERATION_FINALIZE",
  status: "PENDING",
  planId: payload.planId,
  firstStageId: payload.firstStageId,
  readyButtonLabel: payload.readyButtonLabel,
  progressLabel: payload.progressLabel,
});

export const normalizePlanGenerationFinalizeValue = (
  value: unknown,
  fallback: PlanGenerationFinalizeValue
): PlanGenerationFinalizeValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  const status = isFinalizeStatus(value.status)
    ? value.status
    : fallback.status;
  const planId = stringOrEmpty(value.planId) || fallback.planId;
  const firstStageId =
    stringOrEmpty(value.firstStageId) || fallback.firstStageId;
  const readyButtonLabel =
    stringOrEmpty(value.readyButtonLabel) || fallback.readyButtonLabel;
  const progressLabel =
    stringOrEmpty(value.progressLabel) || fallback.progressLabel;

  return {
    type: "PLAN_GENERATION_FINALIZE",
    status,
    planId,
    firstStageId,
    readyButtonLabel,
    progressLabel,
  };
};
