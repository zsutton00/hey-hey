import type {
  RelationshipDecision,
  WorkItemChangeSetOperation,
} from '@hey-hey/contracts/api/models';
import {
  declaredSupersedesEdges,
  missingDecisionOperations,
  readRelationshipDecisions,
  relationshipDecisionIssues,
  relationshipDecisionOperations,
} from '../relationship-decisions';
import { workItemChangeSetValidationRequestSchema } from '../work-item-change-set.schema';

const CONSUMER_A = '123e4567-e89b-42d3-a456-426614174001';
const OLD_PROVIDER = '123e4567-e89b-42d3-a456-426614174002';
const NEW_PROVIDER = '123e4567-e89b-42d3-a456-426614174003';
const EDGE_A = '123e4567-e89b-42d3-a456-426614174011';
const EDGE_B = '123e4567-e89b-42d3-a456-426614174012';
const EDGE_C = '123e4567-e89b-42d3-a456-426614174013';

const existing = (id: string) => ({ refType: 'existing' as const, id });

const retain = (id: string): RelationshipDecision => ({
  relationship: existing(id),
  decision: 'retain',
  reason: 'Consumer B has not migrated yet.',
});
const remove = (id: string): RelationshipDecision => ({
  relationship: existing(id),
  decision: 'remove',
});
const replace = (id: string): RelationshipDecision => ({
  relationship: existing(id),
  decision: 'replace',
  replacement: {
    source: existing(CONSUMER_A),
    target: existing(NEW_PROVIDER),
    edgeType: 'DEPENDS_ON',
  },
});

describe('relationship decisions', () => {
  describe('what approval applies', () => {
    it('applies only remove and replace; a retained relationship is never written', () => {
      const operations = relationshipDecisionOperations([
        retain(EDGE_A),
        remove(EDGE_B),
        replace(EDGE_C),
      ]);

      expect(operations).toEqual([
        { op: 'relationship.delete', ref: existing(EDGE_B) },
        {
          op: 'relationship.update',
          ref: existing(EDGE_C),
          source: existing(CONSUMER_A),
          target: existing(NEW_PROVIDER),
          edgeType: 'DEPENDS_ON',
        },
      ]);
    });

    it('moves one consumer without touching the former provider or other relationships', () => {
      const operations = relationshipDecisionOperations([replace(EDGE_A)]);

      expect(operations).toHaveLength(1);
      expect(operations.map((operation) => operation.op)).not.toContain(
        'workItem.update',
      );
      expect(JSON.stringify(operations)).not.toContain(OLD_PROVIDER);
    });
  });

  describe('authoring errors', () => {
    it('accepts one decision per relationship with retain explained', () => {
      expect(
        relationshipDecisionIssues(
          [retain(EDGE_A), remove(EDGE_B), replace(EDGE_C)],
          [],
        ),
      ).toEqual([]);
    });

    it('rejects a second decision about the same relationship', () => {
      const issues = relationshipDecisionIssues(
        [retain(EDGE_A), remove(EDGE_A)],
        [],
      );

      expect(issues.map((issue) => issue.code)).toEqual([
        'duplicate_relationship_decision',
      ]);
    });

    it('rejects a retain with no reason', () => {
      const issues = relationshipDecisionIssues(
        [{ ...retain(EDGE_A), reason: '   ' }],
        [],
      );

      expect(issues.map((issue) => issue.code)).toEqual([
        'retain_requires_reason',
      ]);
    });

    it('rejects a replace without its replacement and a replacement on any other decision', () => {
      const withoutReplacement: RelationshipDecision = {
        relationship: existing(EDGE_A),
        decision: 'replace',
      };
      const strayReplacement: RelationshipDecision = {
        ...remove(EDGE_B),
        replacement: replace(EDGE_B).replacement,
      };

      expect(
        relationshipDecisionIssues([withoutReplacement, strayReplacement], [])
          .map((issue) => issue.code)
          .sort(),
      ).toEqual([
        'replace_requires_replacement',
        'replacement_requires_replace',
      ]);
    });

    it('rejects a decision that conflicts with an explicit operation on the same relationship', () => {
      const explicit: WorkItemChangeSetOperation[] = [
        { op: 'relationship.delete', ref: existing(EDGE_A) },
      ];

      expect(
        relationshipDecisionIssues([retain(EDGE_A)], explicit).map(
          (issue) => issue.code,
        ),
      ).toEqual(['decision_conflicts_with_operation']);
    });
  });

  describe('stored request agreement', () => {
    it('reports a decision whose operation was dropped or a retained relationship that is changed', () => {
      const issues = missingDecisionOperations(
        [remove(EDGE_A), retain(EDGE_B)],
        [{ op: 'relationship.delete', ref: existing(EDGE_B) }],
      );

      expect(issues.map((issue) => issue.code).sort()).toEqual([
        'decision_operation_missing',
        'retained_relationship_changed',
      ]);
    });

    it('rejects a replacement paired with a deletion, or an update to different endpoints', () => {
      const asDelete = missingDecisionOperations(
        [replace(EDGE_C)],
        [{ op: 'relationship.delete', ref: existing(EDGE_C) }],
      );
      const toOtherTarget = missingDecisionOperations(
        [replace(EDGE_C)],
        [
          {
            op: 'relationship.update',
            ref: existing(EDGE_C),
            source: existing(CONSUMER_A),
            target: existing(OLD_PROVIDER),
            edgeType: 'DEPENDS_ON',
          },
        ],
      );
      const removedButUpdated = missingDecisionOperations(
        [remove(EDGE_B)],
        [
          {
            op: 'relationship.update',
            ref: existing(EDGE_B),
            edgeType: 'RELATED_TO',
          },
        ],
      );

      expect(asDelete.map((issue) => issue.code)).toEqual([
        'decision_operation_mismatch',
      ]);
      expect(toOtherTarget.map((issue) => issue.code)).toEqual([
        'decision_operation_mismatch',
      ]);
      expect(removedButUpdated.map((issue) => issue.code)).toEqual([
        'decision_operation_mismatch',
      ]);
    });

    it('rejects a second operation on the same decided relationship', () => {
      const decisions = [remove(EDGE_B)];

      expect(
        missingDecisionOperations(decisions, [
          ...relationshipDecisionOperations(decisions),
          { op: 'relationship.delete', ref: existing(EDGE_B) },
        ]).map((issue) => issue.code),
      ).toEqual(['decision_operation_mismatch']);
    });

    it('agrees when operations are exactly what the decisions produce', () => {
      const decisions = [retain(EDGE_A), remove(EDGE_B), replace(EDGE_C)];

      expect(
        missingDecisionOperations(
          decisions,
          relationshipDecisionOperations(decisions),
        ),
      ).toEqual([]);
    });
  });

  describe('transport', () => {
    const request = (count: number) => ({
      root: existing(CONSUMER_A),
      operations: [],
      relationshipDecisions: Array.from({ length: count }, (_, index) =>
        retain(`123e4567-e89b-42d3-a456-${String(426614175000 + index)}`),
      ),
    });

    it('accepts up to 100 decisions and rejects more', () => {
      expect(
        workItemChangeSetValidationRequestSchema.safeParse(request(100))
          .success,
      ).toBe(true);
      expect(
        workItemChangeSetValidationRequestSchema.safeParse(request(101))
          .success,
      ).toBe(false);
    });

    it('treats proposals without decisions as before', () => {
      expect(readRelationshipDecisions({ name: 'Plain edit' })).toEqual([]);
    });

    it('fails loudly instead of dropping malformed stored decisions', () => {
      expect(() =>
        readRelationshipDecisions({
          relationshipDecisions: [{ decision: 'retain' }],
        }),
      ).toThrow();
    });
  });

  describe('successor-authored supersession', () => {
    const edge = (edgeType: string, endpointMode?: string) => ({
      edgeType,
      endpointMode,
      targetEntityId: OLD_PROVIDER,
      targetEntityType: 'TASK',
    });

    it('selects only successor-authored SUPERSEDES declarations', () => {
      expect(
        declaredSupersedesEdges({
          edges: [
            edge('SUPERSEDES'),
            edge('DEPENDS_ON'),
            edge('SUPERSEDES', 'PROPOSAL'),
          ],
          updates: {},
        }),
      ).toHaveLength(1);
    });

    it('leaves a proposal that sets SUPERSEDED itself to the legacy protocol', () => {
      expect(
        declaredSupersedesEdges({
          edges: [edge('SUPERSEDES')],
          updates: { status: 'SUPERSEDED' },
        }),
      ).toEqual([]);
    });
  });
});
