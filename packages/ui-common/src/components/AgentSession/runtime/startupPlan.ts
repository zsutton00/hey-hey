import type { StartupPlan } from "./types";
import { parseStructuredResponseFromText } from "../../AgentSession/structured-response.js";

const isStartupPlanShape = (value: Record<string, unknown>): boolean => {
  if (!Array.isArray(value.executionPlan)) {
    return false;
  }
  if (!Array.isArray(value.discrepancies)) {
    return false;
  }
  if (!Array.isArray(value.clarificationQuestions)) {
    return false;
  }

  return true;
};

export const parseStartupPlanFromText = (
  responseText: string
): StartupPlan | null => {
  const parsed = parseStructuredResponseFromText(responseText);
  if (!parsed || !parsed.contract) {
    return null;
  }

  if (
    parsed.contract.type !== "startup_plan" ||
    parsed.contract.version !== 1
  ) {
    return null;
  }

  if (!isStartupPlanShape(parsed.value)) {
    return null;
  }

  return {
    ...parsed.value,
    responseType: "startup_plan_v1",
  } as StartupPlan;
};
