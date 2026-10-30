import isEqual from "lodash/isEqual.js";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../api";
import { isFutureProposal } from "../ProposalDispatchers/futureAsUpdate";

const valueText = (value: unknown) =>
  typeof value === "string"
    ? value
    : value == null
      ? ""
      : JSON.stringify(value);

/** Carry current-only changes into the editable result; overlaps remain explicit choices. */
export function manualReconciliationContent(
  proposal: ProposalResponseDto,
  state: ProposalReconciliationState,
): Record<string, unknown> {
  const revision = state.revisions.find(
    (entry) => entry.id === state.candidateRevisionId,
  );
  const result = structuredClone(revision?.proposedResult ?? {});
  const current = state.currentBases[0]?.content;
  if (!current || !revision) return result;
  if (isFutureProposal(proposal) && proposal.updates.operation === "REVISE") {
    const baseline = proposal.updates.baseline.content;
    for (const key of [
      "name",
      "priority",
      "tag",
      "summary",
      "tags",
      "parentTaskId",
      "parentEntityId",
      "parentEntityType",
      "assigneeId",
      "dueDate",
      "initiativeId",
    ]) {
      if (isEqual(result[key], Reflect.get(baseline, key)) && key in current)
        result[key] = current[key];
    }
    for (const key of ["status", "source", "config"])
      if (key in current) result[key] = current[key];
    const sections = result.sections as {
      key: string;
      order: number;
      materializedMarkdown: string;
    }[];
    const before = new Map(
      baseline.sections.map((section) => [
        section.key,
        section.materializedMarkdown,
      ]),
    );
    const now = current.sections as Record<string, unknown>;
    const order = current.sectionOrder as Record<string, number>;
    result.sections = sections.map((section) =>
      isEqual(section.materializedMarkdown, before.get(section.key)) &&
      section.key in now
        ? {
            ...section,
            materializedMarkdown: valueText(now[section.key]),
            order: order[section.key],
          }
        : section,
    );
    const metadata = current.materializedSections as
      | { id: string; key: string; materializedProposalId?: string }[]
      | undefined;
    for (const [key, value] of Object.entries(now)) {
      if (!before.has(key) && !sections.some((section) => section.key === key))
        (result.sections as typeof sections).push({
          ...metadata?.find((section) => section.key === key),
          key,
          order: order[key],
          materializedMarkdown: valueText(value),
        });
    }
  } else {
    const before = revision.bases[0]?.content;
    if (!before) return result;
    for (const [key, value] of Object.entries(current)) {
      if (key === "sections" || key === "sectionOrder") {
        const proposed = result[key] as Record<string, unknown>;
        const original = before[key] as Record<string, unknown>;
        for (const [section, content] of Object.entries(
          value as Record<string, unknown>,
        ))
          if (isEqual(proposed?.[section], original?.[section]))
            proposed[section] = content;
      } else if (isEqual(result[key], before[key])) result[key] = value;
    }
  }
  return result;
}
