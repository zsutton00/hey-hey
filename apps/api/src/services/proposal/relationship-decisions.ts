import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { relationshipDecisionSchema } from './work-item-change-set.schema';
import { WorkStatus } from '@hey-hey/contracts/api/models';
import type {
  ProposalEdgeDeclaration,
  RelationshipDecision,
  WorkItemChangeSetOperation,
  WorkItemRelationshipDeleteOperation,
  WorkItemRelationshipUpdateOperation,
} from '@hey-hey/contracts/api/models';

export interface RelationshipDecisionIssue {
  field: string;
  code: string;
  reason: string;
}

/**
 * The one place a reviewed decision becomes graph operations. Authoring,
 * projection consistency checks, review and approval all derive from this so
 * the displayed result and the applied result cannot diverge.
 *
 * - remove  -> relationship.delete on the existing relationship
 * - replace -> relationship.update on the existing relationship, so the
 *              relationship keeps one stable identity across retries
 * - retain  -> nothing; retention is review evidence, not a graph write
 */
export function relationshipDecisionOperations(
  decisions: readonly RelationshipDecision[],
): WorkItemChangeSetOperation[] {
  return decisions.flatMap((decision): WorkItemChangeSetOperation[] => {
    switch (decision.decision) {
      case 'retain':
        return [];
      case 'remove':
        return [
          {
            op: 'relationship.delete',
            ref: decision.relationship,
          } satisfies WorkItemRelationshipDeleteOperation,
        ];
      case 'replace':
        return decision.replacement
          ? [
              {
                op: 'relationship.update',
                ref: decision.relationship,
                ...decision.replacement,
              } satisfies WorkItemRelationshipUpdateOperation,
            ]
          : [];
    }
  });
}

/** Authoring-time checks that need no graph reads. */
export function relationshipDecisionIssues(
  decisions: readonly RelationshipDecision[],
  explicitOperations: readonly WorkItemChangeSetOperation[],
): RelationshipDecisionIssue[] {
  const issues: RelationshipDecisionIssue[] = [];
  const seen = new Set<string>();
  const explicitlyChanged = new Set(
    explicitOperations.flatMap((operation) =>
      (operation.op === 'relationship.update' ||
        operation.op === 'relationship.delete') &&
      operation.ref.refType === 'existing'
        ? [operation.ref.id]
        : [],
    ),
  );

  decisions.forEach((decision, index) => {
    const field = `relationshipDecisions[${index}]`;
    const id = decision.relationship.id;

    if (seen.has(id)) {
      issues.push({
        field: `${field}.relationship`,
        code: 'duplicate_relationship_decision',
        reason: `Relationship ${id} has more than one decision. Declare exactly one of retain, remove or replace for each relationship.`,
      });
    }
    seen.add(id);

    if (explicitlyChanged.has(id)) {
      issues.push({
        field: `${field}.relationship`,
        code: 'decision_conflicts_with_operation',
        reason: `Relationship ${id} is also changed by an explicit relationship operation. Express the change once, as a decision.`,
      });
    }

    if (decision.decision === 'retain' && !decision.reason?.trim()) {
      issues.push({
        field: `${field}.reason`,
        code: 'retain_requires_reason',
        reason:
          'A retain decision needs a nonempty reason that tells the reviewer why the relationship stays.',
      });
    }

    if (decision.decision === 'replace' && !decision.replacement) {
      issues.push({
        field: `${field}.replacement`,
        code: 'replace_requires_replacement',
        reason:
          'A replace decision must declare the exact source, target and relationship type of the connection that replaces it.',
      });
    }

    if (decision.decision !== 'replace' && decision.replacement) {
      issues.push({
        field: `${field}.replacement`,
        code: 'replacement_requires_replace',
        reason: `A ${decision.decision} decision cannot carry a replacement connection.`,
      });
    }
  });

  return issues;
}

/**
 * Operations a stored request must contain for its decisions. A remove must be
 * exactly one delete, a replace exactly the update its declared replacement
 * produces (same endpoints, type and metadata), and a retain no operation at
 * all. Anything else means the request is not what was reviewed.
 */
export function missingDecisionOperations(
  decisions: readonly RelationshipDecision[],
  operations: readonly WorkItemChangeSetOperation[],
): RelationshipDecisionIssue[] {
  const issues: RelationshipDecisionIssue[] = [];

  decisions.forEach((decision, index) => {
    const field = `relationshipDecisions[${index}]`;
    const id = decision.relationship.id;
    const expected = relationshipDecisionOperations([decision])[0];
    const touching = operations.filter(
      (operation) =>
        (operation.op === 'relationship.delete' ||
          operation.op === 'relationship.update') &&
        operation.ref.refType === 'existing' &&
        operation.ref.id === id,
    );

    if (!expected) {
      if (touching.length > 0) {
        issues.push({
          field,
          code: 'retained_relationship_changed',
          reason: `Relationship ${id} is retained but an operation changes it.`,
        });
      }
      return;
    }

    if (touching.length === 0) {
      issues.push({
        field,
        code: 'decision_operation_missing',
        reason: `The ${decision.decision} decision for relationship ${id} has no matching operation.`,
      });
      return;
    }

    if (touching.length !== 1 || !isDeepStrictEqual(touching[0], expected)) {
      issues.push({
        field,
        code: 'decision_operation_mismatch',
        reason: `The operations on relationship ${id} do not match its ${decision.decision} decision.`,
      });
    }
  });

  return issues;
}

const storedDecisionsSchema = z.object({
  relationshipDecisions: z.array(relationshipDecisionSchema).optional(),
});

/**
 * Decisions persisted in a proposal's update payload. The payload is stored
 * JSON, so it is parsed once here at the boundary; proposals created before
 * decisions existed simply have none.
 */
export function readRelationshipDecisions(
  updates: unknown,
): RelationshipDecision[] {
  // A malformed stored array must fail loudly rather than silently drop the
  // reviewed decisions.
  return (
    storedDecisionsSchema.passthrough().parse(updates).relationshipDecisions ??
    []
  );
}

/**
 * Successor-authored SUPERSEDES declarations: the only form that may run the
 * atomic status-and-lineage transition. A proposal that itself sets the status
 * to SUPERSEDED is predecessor-authored and is handled by the legacy protocol.
 */
export function declaredSupersedesEdges(proposal: {
  edges: unknown;
  updates: unknown;
}): ProposalEdgeDeclaration[] {
  const status = (proposal.updates as { status?: unknown } | null)?.status;
  if (status === WorkStatus.Superseded) {
    return [];
  }

  const edges = (proposal.edges as ProposalEdgeDeclaration[] | null) ?? [];
  return edges.filter(
    (edge) =>
      edge.edgeType === 'SUPERSEDES' && edge.endpointMode !== 'PROPOSAL',
  );
}
