import type { WorkItemChangeSetOperation } from '../../../generated';
import { workItemChangeSetValidationRequestSchema } from '../work-item-change-set.schema';

const root = {
  refType: 'existing' as const,
  id: '10000000-0000-4000-8000-000000000001',
};
const temporaryWorkItem = {
  refType: 'temporary' as const,
  tempId: 'new-item',
};
const temporaryRelationship = {
  refType: 'temporary' as const,
  tempId: 'new-relationship',
};

const validOperations = [
  {
    op: 'workItem.create',
    ref: temporaryWorkItem,
    name: 'New item',
  },
  { op: 'workItem.update', ref: root, name: 'Renamed item' },
  { op: 'workItem.delete', ref: root },
  {
    op: 'section.replace',
    ref: root,
    key: 'description',
    content: 'Updated description',
  },
  { op: 'section.clear', ref: root, key: 'description' },
  {
    op: 'relationship.create',
    ref: temporaryRelationship,
    source: root,
    target: temporaryWorkItem,
    edgeType: 'RELATED_TO',
    category: 'meta',
  },
  {
    op: 'relationship.update',
    ref: temporaryRelationship,
    reasoning: 'Updated reasoning',
  },
  { op: 'relationship.delete', ref: temporaryRelationship },
  {
    op: 'layout.replace',
    root,
    sectionKey: 'graphLayout',
    entries: [{ node: root, position: { x: 0, y: 0 } }],
  },
  { op: 'layout.clear', root, sectionKey: 'graphLayout' },
] satisfies WorkItemChangeSetOperation[];

describe('workItemChangeSetValidationRequestSchema', () => {
  it('preserves Service ID arrays, including duplicates, through validation', () => {
    const serviceId = '10000000-0000-4000-8000-000000000002';
    const request = {
      root,
      operations: [
        {
          op: 'workItem.create',
          ref: temporaryWorkItem,
          name: 'New item',
          serviceIds: [serviceId, serviceId],
        },
        {
          op: 'workItem.update',
          ref: root,
          serviceIds: [serviceId, serviceId],
        },
      ],
    };
    expect(workItemChangeSetValidationRequestSchema.parse(request)).toEqual(
      request,
    );
  });

  it.each(validOperations.map((operation) => operation.op))(
    'accepts the OpenAPI shape for %s',
    (op) => {
      const operation = validOperations.find(
        (candidate) => candidate.op === op,
      );

      expect(
        workItemChangeSetValidationRequestSchema.safeParse({
          root,
          operations: [operation],
        }).success,
      ).toBe(true);
    },
  );

  it('rejects a CONDITIONAL relationship without its required predicate', () => {
    const result = workItemChangeSetValidationRequestSchema.safeParse({
      root,
      operations: [
        {
          op: 'relationship.create',
          ref: temporaryRelationship,
          source: root,
          target: temporaryWorkItem,
          edgeType: 'CONDITIONAL',
          category: 'flow',
          direction: 'forward',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain('predicate');
  });

  it('accepts a contract-valid CONDITIONAL relationship', () => {
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'CONDITIONAL',
            category: 'flow',
            direction: 'forward',
            predicate: 'approved',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('accepts a contract-valid STANDARD relationship', () => {
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'STANDARD',
            category: 'flow',
            direction: 'forward',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each(['STANDARD', 'CONDITIONAL'] as const)(
    'rejects a %s relationship without direction',
    (edgeType) => {
      const result = workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType,
            category: 'flow',
            ...(edgeType === 'CONDITIONAL' ? { predicate: 'approved' } : {}),
          },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(JSON.stringify(result.error.issues)).toContain('direction');
    },
  );

  it('rejects a STANDARD relationship that declares a predicate', () => {
    const result = workItemChangeSetValidationRequestSchema.safeParse({
      root,
      operations: [
        {
          op: 'relationship.create',
          ref: temporaryRelationship,
          source: root,
          target: temporaryWorkItem,
          edgeType: 'STANDARD',
          category: 'flow',
          direction: 'forward',
          actionLabel: 'tap Continue',
          predicate: 'approved',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(JSON.stringify(result.error.issues)).toContain('predicate');
  });

  it.each([undefined, 'retryCount < 3'])(
    'accepts a LOOP relationship with optional predicate %s',
    (predicate) => {
      expect(
        workItemChangeSetValidationRequestSchema.safeParse({
          root,
          operations: [
            {
              op: 'relationship.create',
              ref: temporaryRelationship,
              source: root,
              target: temporaryWorkItem,
              edgeType: 'LOOP',
              category: 'flow',
              ...(predicate === undefined ? {} : { predicate }),
            },
          ],
        }).success,
      ).toBe(true);
    },
  );

  it('rejects a LOOP relationship with a non-portable predicate', () => {
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'LOOP',
            category: 'flow',
            predicate: 'retry\nnow',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a non-flow edge type declared in the flow category', () => {
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'RELATED_TO',
            category: 'flow',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts nullable direction for meta relationships', () => {
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'RELATED_TO',
            category: 'meta',
            direction: null,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each(['STANDARD', 'CONDITIONAL', 'LOOP'] as const)(
    'accepts an optional action label on %s flow relationships',
    (edgeType) => {
      const result = workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType,
            category: 'flow',
            ...(edgeType === 'STANDARD' || edgeType === 'CONDITIONAL'
              ? { direction: 'forward' }
              : {}),
            ...(edgeType === 'CONDITIONAL' ? { predicate: 'approved' } : {}),
            actionLabel: 'tap Continue',
          },
        ],
      });

      expect(result.success).toBe(true);
    },
  );

  it('rejects a whitespace-only flow action label', () => {
    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'STANDARD',
            category: 'flow',
            direction: 'forward',
            actionLabel: '  \t  ',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([null, 'forward'])(
    'rejects direction on LOOP relationships',
    (direction) => {
      const result = workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [
          {
            op: 'relationship.create',
            ref: temporaryRelationship,
            source: root,
            target: temporaryWorkItem,
            edgeType: 'LOOP',
            category: 'flow',
            direction,
          },
        ],
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(JSON.stringify(result.error.issues)).toContain('direction');
    },
  );

  it.each([
    ['workItem.create', 'name'],
    ['workItem.update', 'ref'],
    ['workItem.delete', 'ref'],
    ['section.replace', 'content'],
    ['section.clear', 'key'],
    ['relationship.create', 'target'],
    ['relationship.update', 'ref'],
    ['relationship.delete', 'ref'],
    ['layout.replace', 'entries'],
    ['layout.clear', 'sectionKey'],
  ])('rejects %s when required field %s is absent', (op, requiredField) => {
    const valid = validOperations.find((operation) => operation.op === op);
    const malformed = JSON.parse(JSON.stringify(valid)) as Record<
      string,
      unknown
    >;
    delete malformed[requiredField];

    expect(
      workItemChangeSetValidationRequestSchema.safeParse({
        root,
        operations: [malformed],
      }).success,
    ).toBe(false);
  });
});
