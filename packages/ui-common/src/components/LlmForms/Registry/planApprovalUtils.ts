import type { PlanApprovalPayload } from "../../../api";
import type { PlanApprovalValue, PlanApprovalWorkstreamEdit } from "./types";
import { PlanApprovalNextAction } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isPlanApprovalNextAction = (
  value: unknown
): value is PlanApprovalValue["nextAction"] =>
  value === PlanApprovalNextAction.Approve ||
  value === PlanApprovalNextAction.ContinueRevising;

const isWorkstreamEdit = (
  value: unknown
): value is PlanApprovalWorkstreamEdit =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  typeof value.focus === "string";

/**
 * Creates the initial PlanApprovalValue from a server payload.
 */
export const createPlanApprovalValue = (
  payload: PlanApprovalPayload
): PlanApprovalValue => ({
  type: "PLAN_APPROVAL",
  nextAction: PlanApprovalNextAction.Approve,
  userMessage: "",
  description: {
    approach: payload.description.approach,
    outcome: payload.description.outcome,
    verification: payload.description.verification,
  },
  workstreams: payload.workstreams.map((ws, index) => ({
    id: `ws-${index}`,
    name: ws.name,
    focus: ws.focus,
    isNew: false,
    isDeleted: false,
  })),
});

/**
 * Normalizes an unknown value into a valid PlanApprovalValue,
 * using the fallback for any invalid or missing fields.
 */
export const normalizePlanApprovalValue = (
  value: unknown,
  fallback: PlanApprovalValue
): PlanApprovalValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  const description = isRecord(value.description)
    ? {
        approach:
          typeof value.description.approach === "string"
            ? value.description.approach
            : fallback.description.approach,
        outcome:
          typeof value.description.outcome === "string"
            ? value.description.outcome
            : fallback.description.outcome,
        verification:
          typeof value.description.verification === "string"
            ? value.description.verification
            : fallback.description.verification,
      }
    : fallback.description;

  const workstreams = Array.isArray(value.workstreams)
    ? value.workstreams.filter(isWorkstreamEdit).map((ws) => ({
        id: ws.id,
        name: ws.name,
        focus: ws.focus,
        isNew: ws.isNew === true,
        isDeleted: ws.isDeleted === true,
      }))
    : fallback.workstreams;

  return {
    type: "PLAN_APPROVAL",
    nextAction: isPlanApprovalNextAction(value.nextAction)
      ? value.nextAction
      : fallback.nextAction,
    userMessage:
      typeof value.userMessage === "string"
        ? value.userMessage
        : fallback.userMessage,
    description,
    workstreams,
  };
};

/**
 * Returns only the active (non-deleted) workstreams.
 */
export const getActiveWorkstreams = (
  value: PlanApprovalValue
): PlanApprovalWorkstreamEdit[] =>
  value.workstreams.filter((ws) => !ws.isDeleted);
