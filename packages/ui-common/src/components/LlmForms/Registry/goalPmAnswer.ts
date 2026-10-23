import type { GoalPmRoutingAnswer } from "../../../api";

export const goalPmAnswer = (value: unknown): GoalPmRoutingAnswer | undefined =>
  value &&
  typeof value === "object" &&
  "type" in value &&
  value.type === "GOAL_PM_ROUTING"
    ? (value as GoalPmRoutingAnswer)
    : undefined;
