import type { ProjectApprovalPolicyRule } from "../../api";

export const ANY = "ANY";
export type Choice = typeof ANY | string;
export type TopLevelChoice = typeof ANY | "TOP_LEVEL" | "NOT_TOP_LEVEL";

export type RuleFieldKey =
  | "author"
  | "action"
  | "change"
  | "topLevel"
  | "outcome"
  | "approvals"
  | "credit"
  | "priority";

/** Info text is copied from the Approval Rule Editor Modal mockup. */
export const FIELD_INFO: Record<RuleFieldKey, string> = {
  author:
    "Who made the change. User is a person; Agent is an AI agent. Any matches both.",
  action:
    "What the proposal does to an item: add a new one, change an existing one, or remove one. Any matches all three.",
  change:
    "Status only means the status field is the only thing that changed. Content changes includes edits that also change status. Any matches both.",
  topLevel:
    "A Feature is top-level when it has no parent task, even if it sits inside an initiative. Top-level Features are the main product areas; everything beneath them is not top-level. Choose Any to ignore the difference.",
  outcome:
    "Apply immediately applies the change and keeps the proposal as an audit record. Require human approval holds it until enough people approve.",
  approvals:
    "How many people must approve before the change applies. Only used when the outcome requires human approval.",
  credit:
    "When on, a user who proposes a change counts as one of its approvals if they are allowed to approve it. Agents never earn approval this way.",
  priority:
    "Position among all rules in every group. Lower numbers are checked first and the first match wins.",
};

export const FEATURE_TYPE_KEY = "FEATURE";
export const MAX_APPROVALS = 2147483647;

export function topLevelChoice(topLevel: boolean | undefined): TopLevelChoice {
  if (topLevel === undefined) {
    return ANY;
  }
  return topLevel ? "TOP_LEVEL" : "NOT_TOP_LEVEL";
}

export function topLevelValue(choice: TopLevelChoice): boolean | undefined {
  if (choice === ANY) {
    return undefined;
  }
  return choice === "TOP_LEVEL";
}

export type RuleEntries = {
  author: Choice;
  action: Choice;
  change: Choice;
  topLevel: TopLevelChoice;
  outcome: ProjectApprovalPolicyRule["requirement"];
  approvals: string;
  credit: boolean;
  priority: string;
};

export function newRuleEntries(position: number): RuleEntries {
  return {
    author: ANY,
    action: ANY,
    change: ANY,
    topLevel: ANY,
    outcome: "PROJECT_REQUIRED",
    approvals: "1",
    credit: false,
    priority: String(position),
  };
}

export function entriesFromRule(
  rule: ProjectApprovalPolicyRule,
  position: number,
): RuleEntries {
  return {
    author: rule.conditions.author ?? ANY,
    action: rule.conditions.action ?? ANY,
    change: rule.conditions.change ?? ANY,
    topLevel: topLevelChoice(rule.conditions.topLevel),
    outcome: rule.requirement,
    approvals: String(rule.requiredApprovals),
    credit: rule.allowsProposerApproval,
    priority: String(position),
  };
}
