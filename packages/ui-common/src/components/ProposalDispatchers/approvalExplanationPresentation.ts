import type {
  ProjectApprovalPolicyEffectiveConditions,
  ProposalApprovalExplanation,
} from "../../api";

export function matchedApprovalConditions(
  conditions: ProjectApprovalPolicyEffectiveConditions,
): string {
  const labels = [
    conditions.typeKey,
    conditions.author === "USER"
      ? "User"
      : conditions.author === "AGENT"
        ? "Agent"
        : undefined,
    conditions.action
      ? { CREATE: "Create", UPDATE: "Update", DELETE: "Delete" }[
          conditions.action
        ]
      : undefined,
    conditions.change === "STATUS_ONLY"
      ? "Status only"
      : conditions.change === "CONTENT_CHANGE"
        ? "Content changes"
        : undefined,
    conditions.topLevel === undefined
      ? undefined
      : conditions.topLevel
        ? "Top level"
        : "Nested",
    conditions.featureContentChange === undefined
      ? undefined
      : conditions.featureContentChange
        ? "Feature content changes"
        : "No feature content changes",
    conditions.toolName,
  ].filter((label) => label !== undefined);
  return labels.length ? labels.join(" · ") : "All changes (fallback)";
}

export function approvalSourceLabel(
  source: ProposalApprovalExplanation["source"],
): string {
  switch (source) {
    case "PROJECT":
      return "Project configuration";
    case "DEFAULT":
      return "Default rule";
    case "FIXED":
      return "Built-in · Fixed";
    case null:
      return "Unavailable";
  }
}

export function approvalRequirementLabel(
  requirement: NonNullable<ProposalApprovalExplanation["requirement"]>,
): string {
  const category = {
    IMMEDIATE: "Immediate application",
    PROJECT_REQUIRED: "Project-required",
    FIXED_REQUIRED: "Fixed approval count",
  }[requirement.category];
  return `${category} · ${requirement.requiredApprovals} ${requirement.requiredApprovals === 1 ? "approval" : "approvals"}`;
}
