import type {
  PlanServiceSelectionValue,
  PlanServiceSelectionService,
} from "./types";
import { PlanServiceSelectionNextAction } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

const isPlanServiceSelectionNextAction = (
  value: unknown
): value is PlanServiceSelectionValue["nextAction"] =>
  value === PlanServiceSelectionNextAction.AnalyzeServices ||
  value === PlanServiceSelectionNextAction.ServicesReady;

const isServiceSelectionService = (
  value: unknown
): value is PlanServiceSelectionService =>
  isRecord(value) &&
  value.source === "user_added" &&
  value.kind === "existing" &&
  value.entityType === "services" &&
  typeof value.entityId === "string" &&
  typeof value.name === "string" &&
  (value.description === undefined || typeof value.description === "string");

export const createPlanServiceSelectionValue =
  (): PlanServiceSelectionValue => ({
    type: "PLAN_SERVICE_SELECTION",
    nextAction: PlanServiceSelectionNextAction.AnalyzeServices,
    services: [],
  });

export const normalizePlanServiceSelectionValue = (
  value: unknown,
  fallback: PlanServiceSelectionValue
): PlanServiceSelectionValue => {
  if (!isRecord(value)) {
    return fallback;
  }

  const services = Array.isArray(value.services)
    ? value.services.filter(isServiceSelectionService)
    : fallback.services;

  const nextAction = isPlanServiceSelectionNextAction(value.nextAction)
    ? value.nextAction
    : fallback.nextAction;

  return {
    type: "PLAN_SERVICE_SELECTION",
    nextAction,
    services,
  };
};
