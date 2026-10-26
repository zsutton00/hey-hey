import isEqual from "lodash/isEqual.js";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../api";

export const isContentRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Normalize only retained server content; absence is never filled from live. */
export function normalizeReconciliationContent(
  content: Record<string, unknown>,
): Record<string, unknown> {
  if (!Array.isArray(content.sections)) return content;
  const sections: Record<string, unknown> = {};
  for (const section of content.sections) {
    if (!isContentRecord(section) || typeof section.key !== "string") continue;
    sections[section.key] = section.materializedMarkdown;
  }
  return { ...content, sections };
}

export interface ThreeWayProjection {
  original: Record<string, unknown> | undefined;
  live: Record<string, unknown> | undefined;
  intended: Record<string, unknown> | undefined;
}

export function projectThreeWayReview(
  proposal: ProposalResponseDto,
  state: ProposalReconciliationState,
): ThreeWayProjection {
  const future =
    proposal.action === "VERSIONED_UPDATE" && proposal.status === "APPROVED"
      ? proposal.reviewedFuture
      : undefined;
  const owner = future?.latestProposalId ?? proposal.id;
  const selected = state.revisions.find(
    (revision) =>
      revision.id === state.candidateRevisionId &&
      revision.proposalId === owner,
  );
  // The API selects the current reviewed future even when opened through an older proposal.
  // Never choose an unrelated history entry or a pending replacement's result.
  const revision =
    selected ??
    [...state.revisions].reverse().find((entry) => entry.proposalId === owner);
  const basis = revision?.bases.find(
    (entry) =>
      entry.entityId === proposal.targetEntityId &&
      entry.entityType === proposal.targetEntityType,
  );
  const current = state.currentBases.find(
    (entry) =>
      entry.entityId === proposal.targetEntityId &&
      entry.entityType === proposal.targetEntityType,
  );
  const futureBaseline = future?.baseline?.content;
  return {
    original: future
      ? futureBaseline
        ? normalizeReconciliationContent({ ...futureBaseline })
        : undefined
      : basis
        ? normalizeReconciliationContent(basis.content)
        : undefined,
    live: current ? normalizeReconciliationContent(current.content) : undefined,
    intended: future
      ? normalizeReconciliationContent({ ...future.result })
      : revision
        ? normalizeReconciliationContent(revision.proposedResult)
        : undefined,
  };
}

export function threeWayFields(projection: ThreeWayProjection): string[] {
  const states = [projection.original, projection.live, projection.intended];
  // Adapter-only identity, timestamps and materialization metadata are not changes to review.
  const reviewableFields = new Set([
    "name",
    "status",
    "priority",
    "tag",
    "dueDate",
    "assigneeId",
    "parentTaskId",
    "serviceIds",
    "summary",
    "tags",
    "parentEntityId",
    "parentEntityType",
    "initiativeId",
    "config",
    "graph",
  ]);
  const fields = new Set(
    states.flatMap((value) =>
      Object.keys(value ?? {}).filter((key) => reviewableFields.has(key)),
    ),
  );
  const sections = new Set(
    states.flatMap((value) =>
      isContentRecord(value?.sections) ? Object.keys(value.sections) : [],
    ),
  );
  return [
    ...fields,
    ...Array.from(sections, (key) => `sections.${key}`),
  ].filter((path) => {
    const values = states.map((value) => threeWayValue(value, path));
    return (
      !isEqual(values[0] ?? null, values[1] ?? null) ||
      !isEqual(values[0] ?? null, values[2] ?? null)
    );
  });
}

export function threeWayValue(
  content: Record<string, unknown> | undefined,
  path: string,
): unknown {
  if (!content) return undefined;
  if (!path.startsWith("sections.")) return content[path];
  return isContentRecord(content.sections)
    ? content.sections[path.slice(9)]
    : undefined;
}

export function branchChange(original: unknown, value: unknown): string {
  if (isEqual(original ?? null, value ?? null)) return "Unchanged";
  if (original == null) return "Added";
  if (value == null) return "Removed";
  return "Changed";
}
