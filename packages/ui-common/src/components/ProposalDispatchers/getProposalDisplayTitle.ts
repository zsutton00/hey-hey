import type { ProposalResponseDto } from "../../api";

const TITLE_KEYS = ["name", "title", "planTitle"] as const;

const formatAction = (action: string): string =>
  action.charAt(0) + action.slice(1).toLowerCase();

const formatTargetEntityType = (entityType: string): string =>
  entityType
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");

export function getProposalDisplayTitle(proposal: ProposalResponseDto): string {
  if (typeof proposal.title === "string" && proposal.title.trim().length > 0) {
    return proposal.title;
  }
  const updates = proposal.updates as Record<string, unknown> | null;
  for (const key of TITLE_KEYS) {
    const value = updates?.[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return `${formatAction(proposal.action)} ${formatTargetEntityType(
    proposal.targetEntityType
  )}`;
}
