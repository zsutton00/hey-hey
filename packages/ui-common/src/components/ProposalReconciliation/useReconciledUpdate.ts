import isEqual from "lodash/isEqual.js";
import { useContext } from "react";
import type {
  ProposalResponseDto,
  UpdateTaskDto,
  UpdateDesignDocDto,
} from "../../api";
import { ProposalReconciliationContext } from "./ProposalReconciliationReview";

/** Render the selected immutable revision against its own basis, never a later live fetch. */
export function useReconciledUpdate<
  T extends {
    sections?: ReadonlyArray<{
      key: string;
      order: number;
      materializedMarkdown: string;
    }>;
  },
  U extends UpdateTaskDto | UpdateDesignDocDto,
>(proposal: ProposalResponseDto & { updates: U }, existing: T) {
  const review = useContext(ProposalReconciliationContext);
  const futureReview = review?.future ? review : null;
  const activeReview = review?.standaloneUpdate ? review : null;
  const state = (activeReview ?? futureReview)?.state;
  const revision =
    state?.status === "READY_FOR_REVIEW"
      ? state.revisions.find((entry) => entry.id === state.candidateRevisionId)
      : undefined;
  const basis = revision?.bases.find(
    (entry) => entry.entityId === proposal.targetEntityId,
  );
  if (!revision || !basis)
    return {
      proposal,
      existing,
      reviewedServiceIds: undefined,
      hideDiff: futureReview
        ? !futureReview.state ||
          ["RECONCILIATION_REQUIRED", "AGENT_FIX_REQUIRED"].includes(
            futureReview.state.status,
          )
        : !!activeReview && (!state || activeReview.approvalDisabled),
    };
  const before = basis.content;
  const result = revision.proposedResult;
  const futureSections = Array.isArray(result.sections)
    ? (result.sections as {
        key: string;
        order: number;
        materializedMarkdown: string;
      }[])
    : null;
  const after = futureSections
    ? {
        ...result,
        sections: Object.fromEntries(
          futureSections.map((section) => [
            section.key,
            section.materializedMarkdown,
          ]),
        ),
        sectionOrder: Object.fromEntries(
          futureSections.map((section) => [section.key, section.order]),
        ),
      }
    : result;
  const sections = before.sections as Record<string, unknown>;
  const order = before.sectionOrder as Record<string, number>;
  const updates = { ...proposal.updates };
  for (const key of Object.keys(updates)) {
    if (key !== "sections" && key !== "sectionUpdateSource" && key !== "reason")
      Object.assign(updates, { [key]: after[key] });
  }
  for (const key of Object.keys(after)) {
    if (
      key !== "sections" &&
      key !== "sectionOrder" &&
      !isEqual(before[key], after[key])
    )
      Object.assign(updates, { [key]: after[key] });
  }
  const resultSections = after.sections as Record<string, unknown>;
  const resultOrder = after.sectionOrder as Record<string, number>;
  updates.sections = [
    ...new Set([...Object.keys(sections), ...Object.keys(resultSections)]),
  ]
    .filter(
      (key) =>
        !isEqual(sections[key], resultSections[key]) ||
        order[key] !== resultOrder[key],
    )
    .map((key) => ({
      key,
      content: resultSections[key] ?? null,
      order: key in resultSections ? resultOrder[key] : null,
    })) as U["sections"];
  // Basis content is the API's normalized entity projection; restore section rows for ordinary renderers.
  const baseline = {
    ...existing,
    ...before,
    sections: Object.keys(sections).map((key) => ({
      ...existing.sections?.find((section) => section.key === key),
      key,
      order: order[key],
      materializedMarkdown:
        typeof sections[key] === "string"
          ? sections[key]
          : sections[key] == null
            ? ""
            : JSON.stringify(sections[key]),
    })),
  } as T;
  return {
    proposal: { ...proposal, updates },
    existing: baseline,
    reviewedServiceIds: before.serviceIds as string[] | undefined,
    hideDiff: !!(activeReview ?? futureReview)?.approvalDisabled,
  };
}
