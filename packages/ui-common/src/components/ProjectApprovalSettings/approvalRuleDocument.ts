import isEqual from "lodash/isEqual.js";
import type {
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicySnapshot,
} from "../../api";

/** The saved project rules, in global priority order, as a replaceable document. */
export function savedProjectRules(
  snapshot: ProjectApprovalPolicySnapshot,
): ProjectApprovalPolicyRule[] {
  return snapshot.rules
    .filter((rule) => rule.editable)
    .map((rule) => ({
      conditions: rule.conditions,
      requirement:
        rule.requirement === "IMMEDIATE" ? "IMMEDIATE" : "PROJECT_REQUIRED",
      requiredApprovals: rule.requiredApprovals,
      allowsProposerApproval: rule.allowsProposerApproval,
    }));
}

/**
 * Finds the rule the user opened in the latest saved rules. Positions shift
 * when someone else adds, removes or reorders rules, so the rule is matched by
 * content, preferring its old position. Null means it was removed or changed.
 */
export function locateRule(
  rules: ProjectApprovalPolicyRule[],
  opened: ProjectApprovalPolicyRule,
  openedIndex: number,
): number | null {
  if (isEqual(rules[openedIndex], opened)) {
    return openedIndex;
  }
  const found = rules.findIndex((rule) => isEqual(rule, opened));
  return found === -1 ? null : found;
}

/**
 * Adds a rule (index null) or replaces the rule at index, placing it at
 * position. Returns null when the rule being replaced no longer exists.
 */
export function withRuleSaved(
  rules: ProjectApprovalPolicyRule[],
  rule: ProjectApprovalPolicyRule,
  index: number | null,
  position: number,
): ProjectApprovalPolicyRule[] | null {
  const remaining = [...rules];
  if (index !== null) {
    if (index < 0 || index >= rules.length) {
      return null;
    }
    remaining.splice(index, 1);
  }
  remaining.splice(position, 0, rule);
  return remaining;
}

export function withoutRule(
  rules: ProjectApprovalPolicyRule[],
  index: number,
): ProjectApprovalPolicyRule[] | null {
  if (index < 0 || index >= rules.length) {
    return null;
  }
  return rules.filter((_, position) => position !== index);
}

export function withRuleMoved(
  rules: ProjectApprovalPolicyRule[],
  from: number,
  to: number,
): ProjectApprovalPolicyRule[] | null {
  if (from < 0 || from >= rules.length || to < 0 || to >= rules.length) {
    return null;
  }
  const ordered = [...rules];
  const [rule] = ordered.splice(from, 1);
  ordered.splice(to, 0, rule);
  return ordered;
}
