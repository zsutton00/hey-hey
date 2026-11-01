import {
  ProposalAction,
  ProposalStatus,
  TargetEntityType,
  type FutureRevisionContent,
  type FutureRevisionMutation,
  type ProposalResponseDto,
} from "../../api";

export type FutureProposal = ProposalResponseDto & {
  updates: FutureRevisionMutation;
};

// VERSIONED_UPDATE is the API-owned discriminator for FutureRevisionMutation.
export function isFutureProposal(
  proposal: ProposalResponseDto,
): proposal is FutureProposal {
  return proposal.action === ProposalAction.VersionedUpdate;
}

/**
 * Fields Apply writes. Status, type, config and source stay with the baseline
 * (see FutureRevisionUpdate), so they are never shown as changes.
 */
const TASK_FIELDS = [
  "name",
  "priority",
  "tag",
  "initiativeId",
  "dueDate",
  "assigneeId",
  "parentTaskId",
] as const;
const DESIGN_DOC_FIELDS = [
  "name",
  "summary",
  "tags",
  "parentEntityId",
  "parentEntityType",
] as const;

type ContentRecord = Record<string, unknown> & {
  sections?: ReadonlyArray<{
    key: string;
    order: number;
    materializedMarkdown: string;
  }>;
};

const normalize = (value: unknown) =>
  JSON.stringify(value === undefined ? null : value);

const changedSections = (
  baseline: ContentRecord["sections"],
  result: ContentRecord["sections"],
) => {
  const before = new Map(
    (baseline ?? []).map((s) => [s.key, s.materializedMarkdown]),
  );
  const after = new Map((result ?? []).map((s) => [s.key, s]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key)?.materializedMarkdown)
    .map((key) => ({
      key,
      order: after.get(key)?.order ?? null,
      content: after.get(key)?.materializedMarkdown ?? null,
    }));
};

/**
 * The content a future replaces: while refining an approved future, its
 * approved result; otherwise the live target.
 */
export function futureBaselineContent(
  proposal: FutureProposal,
  live: unknown,
): unknown {
  const approved = proposal.reviewedFuture;
  const refining =
    approved &&
    proposal.status !== ProposalStatus.Approved &&
    approved.latestProposalId !== proposal.id;
  if (refining) return approved.result;
  if (
    proposal.updates.operation === "REVISE" &&
    "type" in proposal.updates.baseline.content &&
    proposal.updates.baseline.content.graph
  )
    return proposal.updates.baseline.content;
  return live;
}

/**
 * A future's result is the complete content it will write. Present it as an
 * ordinary UPDATE carrying only the fields that differ from `baseline`, so the
 * shared renderers diff it like any live edit (requirements read as
 * requirements; unchanged title/status are not shown). A cancellation has no
 * content change and projects to an empty update.
 */
export function futureAsUpdateProposal(
  proposal: FutureProposal,
  baseline: unknown,
): ProposalResponseDto {
  const { updates } = proposal;
  const projected = { ...proposal, action: ProposalAction.Update };
  if (updates.operation !== "REVISE") return { ...projected, updates: {} };
  const before = (baseline ?? {}) as ContentRecord;
  const after = updates.result as FutureRevisionContent & ContentRecord;
  const fields =
    proposal.targetEntityType === TargetEntityType.DesignDoc
      ? DESIGN_DOC_FIELDS
      : TASK_FIELDS;
  const changes: Record<string, unknown> = Object.fromEntries(
    fields
      .filter((field) => normalize(after[field]) !== normalize(before[field]))
      .map((field) => [field, after[field] ?? null]),
  );
  const sections = changedSections(before.sections, after.sections);
  if (sections.length > 0) changes.sections = sections;
  return { ...projected, updates: changes };
}
