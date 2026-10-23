import type {
  PlanGenerationVisualPreviewEntry,
  PlanGenerationVisualPreviewPayload,
  PlanGenerationVisualPreviewRelationship,
  ProposalResponseDto,
} from "../../../api";

const VISUAL_PREVIEW_RESPONSE_TYPE =
  "plan_generation_visual_preview_v1" as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isArtifactFamily = (
  value: unknown,
): value is PlanGenerationVisualPreviewEntry["artifactFamily"] =>
  value === "mockup" || value === "diagram";

const isRelationshipKind = (
  value: unknown,
): value is PlanGenerationVisualPreviewRelationship["kind"] =>
  value === "depends_on" || value === "refines";

const isRelationship = (
  value: unknown,
): value is PlanGenerationVisualPreviewRelationship =>
  isRecord(value) &&
  isRelationshipKind(value.kind) &&
  typeof value.proposalId === "string" &&
  value.proposalId.length > 0;

const isEntry = (value: unknown): value is PlanGenerationVisualPreviewEntry =>
  isRecord(value) &&
  typeof value.proposalId === "string" &&
  value.proposalId.length > 0 &&
  isArtifactFamily(value.artifactFamily) &&
  typeof value.presentationOrder === "number" &&
  Number.isInteger(value.presentationOrder) &&
  value.presentationOrder >= 0 &&
  (value.relationship === undefined || isRelationship(value.relationship));

export const isPlanGenerationVisualPreviewPayload = (
  value: unknown,
): value is PlanGenerationVisualPreviewPayload =>
  isRecord(value) &&
  value.responseType === VISUAL_PREVIEW_RESPONSE_TYPE &&
  Array.isArray(value.entries) &&
  value.entries.length > 0 &&
  value.entries.every(isEntry);

export interface ResolvedPlanGenerationVisualPreviewEntry {
  entry: PlanGenerationVisualPreviewEntry;
  proposal: ProposalResponseDto;
}

export type PlanGenerationVisualPreviewResolution =
  | {
      kind: "ready";
      entries: ResolvedPlanGenerationVisualPreviewEntry[];
    }
  | {
      kind: "error";
      message: string;
    };

const error = (message: string): PlanGenerationVisualPreviewResolution => ({
  kind: "error",
  message,
});

/**
 * Resolves the explicit field payload against the canonical proposals loaded
 * for its entry IDs. It never falls back to proposal timestamps or collection
 * order.
 */
export const resolvePlanGenerationVisualPreview = (
  payload: unknown,
  resolvedProposals: readonly ProposalResponseDto[],
): PlanGenerationVisualPreviewResolution => {
  if (!isPlanGenerationVisualPreviewPayload(payload)) {
    return error("This visual preview payload is unavailable or malformed.");
  }

  const proposalById = new Map(
    resolvedProposals.map((proposal) => [proposal.id, proposal]),
  );
  const entryByProposalId = new Map<string, PlanGenerationVisualPreviewEntry>();
  const orderValues = new Set<number>();

  for (const entry of payload.entries) {
    if (entryByProposalId.has(entry.proposalId)) {
      return error("This visual preview contains a duplicate proposal entry.");
    }
    if (orderValues.has(entry.presentationOrder)) {
      return error(
        "This visual preview contains duplicate presentation order.",
      );
    }
    if (!proposalById.has(entry.proposalId)) {
      return error("A visual preview proposal could not be loaded.");
    }

    entryByProposalId.set(entry.proposalId, entry);
    orderValues.add(entry.presentationOrder);
  }

  for (const entry of payload.entries) {
    const relationship = entry.relationship;
    if (!relationship) continue;

    const relatedEntry = entryByProposalId.get(relationship.proposalId);
    if (!relatedEntry || relatedEntry.artifactFamily !== entry.artifactFamily) {
      return error(
        "Visual preview relationships must target another visual in the same family.",
      );
    }
  }

  const resolvedEntries: ResolvedPlanGenerationVisualPreviewEntry[] = [];
  for (const entry of [...payload.entries].sort(
    (left, right) => left.presentationOrder - right.presentationOrder,
  )) {
    const proposal = proposalById.get(entry.proposalId);
    if (!proposal) {
      return error("A visual preview proposal could not be loaded.");
    }
    resolvedEntries.push({ entry, proposal });
  }

  return { kind: "ready", entries: resolvedEntries };
};

export type PlanGenerationVisualEntryPresentation =
  | {
      kind: "content";
      entityId: string;
      artifactFamily: PlanGenerationVisualPreviewEntry["artifactFamily"];
    }
  | { kind: "proposal" };

/**
 * An unchanged reused visual whose proposal is APPROVED is shown as the
 * Mockup or Diagram it was enacted as; new, revised, pending, and deletion
 * proposals stay reviewable proposal cards. The caller still falls back to
 * the card when the content work item cannot be loaded.
 */
export const resolveVisualEntryPresentation = (
  entry: ResolvedPlanGenerationVisualPreviewEntry,
): PlanGenerationVisualEntryPresentation => {
  const { proposal } = entry;
  return proposal.status === "APPROVED" &&
    proposal.action !== "DELETE" &&
    proposal.targetEntityType === "TASK" &&
    proposal.targetEntityId
    ? {
        kind: "content",
        entityId: proposal.targetEntityId,
        artifactFamily: entry.entry.artifactFamily,
      }
    : { kind: "proposal" };
};
