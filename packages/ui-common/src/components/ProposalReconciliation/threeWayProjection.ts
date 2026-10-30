import isEqual from "lodash/isEqual.js";
import type {
  ProjectedWorkItemChangeSetResponse,
  ProposalResponseDto,
  ProposalReconciliationState,
  WorkItemChangeSetIdentity,
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
    intended: revision
      ? normalizeReconciliationContent(revision.proposedResult)
      : future
        ? normalizeReconciliationContent({ ...future.result })
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
      !equivalentContent(values[0], values[1]) ||
      !equivalentContent(values[0], values[2])
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
  if (equivalentContent(original, value)) return "Unchanged";
  if (storedValue(original) == null) return "Added";
  if (storedValue(value) == null) return "Removed";
  return "Changed";
}

/**
 * Mirrors the API's drift comparison: an unset value stored as null or '', and
 * structured content stored as JSON text or as the parsed value, are the same
 * content. A full graph projection compares by its editable content basis.
 */
export function equivalentContent(a: unknown, b: unknown): boolean {
  return isEqual(storedValue(a), storedValue(b));
}

function storedValue(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (isProjectedGraph(value)) return graphContentBasis(value);
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : value;
  } catch {
    return value;
  }
}

export function isProjectedGraph(
  value: unknown,
): value is ProjectedWorkItemChangeSetResponse {
  return (
    isContentRecord(value) &&
    isContentRecord(value.projectedRoot) &&
    Array.isArray(value.children) &&
    Array.isArray(value.incidentRelationships)
  );
}

const graphIdentityKey = (ref: WorkItemChangeSetIdentity) =>
  ref.refType === "existing" ? `existing:${ref.id}` : `temporary:${ref.tempId}`;

/** Same shape as the API's graphContentBasis, which live graph content arrives in. */
function graphContentBasis(graph: ProjectedWorkItemChangeSetResponse) {
  const nodes = [graph.projectedRoot, ...graph.children]
    .filter((node) => !node.deleted)
    .map((node) => [
      graphIdentityKey(node.identity),
      {
        type: node.type,
        name: node.name,
        parent: node.parent ?? null,
        status: node.status ?? null,
        priority: node.priority ?? null,
        dueDate: node.dueDate ?? null,
        assigneeId: node.assigneeId ?? null,
        tag: node.tag ?? null,
        serviceIds: [...(node.serviceIds ?? [])].sort(),
        sections: Object.fromEntries(
          node.sections
            .filter((section) => storedValue(section.content) !== null)
            .map((section) => [section.key, storedValue(section.content)]),
        ),
      },
    ]);
  const relationships = graph.incidentRelationships
    .filter((edge) => !edge.deleted)
    .map((edge) => [
      graphIdentityKey(edge.identity),
      {
        source: edge.source,
        target: edge.target,
        sourceEntityType: edge.sourceEntityType ?? "TASK",
        targetEntityType: edge.targetEntityType ?? "TASK",
        edgeType: edge.edgeType,
        category:
          edge.category ??
          (["STANDARD", "CONDITIONAL", "LOOP"].includes(edge.edgeType)
            ? "flow"
            : "meta"),
        direction: edge.direction ?? null,
        predicate: edge.predicate ?? null,
        reasoning: edge.reasoning ?? null,
        metadata: edge.metadata ?? null,
      },
    ]);
  return {
    nodes: Object.fromEntries(nodes),
    relationships: Object.fromEntries(relationships),
  };
}
