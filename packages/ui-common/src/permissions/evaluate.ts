import type { ApprovalConfig, EntityContext, PermissionRule } from "./types";
import { rules } from "./rules";

const DEFAULT_CONFIG: ApprovalConfig = {
  requiresProposal: false,
  threshold: 1,
};

export function matchesRule(
  entity: EntityContext,
  match: PermissionRule["match"]
): boolean {
  return Object.entries(match).every(
    ([key, value]) => entity[key as keyof EntityContext] === value
  );
}

export function evaluatePermissions(entity: EntityContext): ApprovalConfig {
  for (const rule of rules) {
    if (matchesRule(entity, rule.match)) {
      return rule.config;
    }
  }
  return DEFAULT_CONFIG;
}
