import {
  applyFeatureRequirementOperations,
  prepareFeatureRequirementOperations,
} from '../feature-requirement-operations';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const base = [
  {
    id: A,
    statement: 'A',
    group: 'Old',
    designedBy: [],
    fulfilledBy: [],
    contracts: [],
  },
  { id: B, statement: 'B', designedBy: [], fulfilledBy: [], contracts: [] },
];

describe('feature requirement operations', () => {
  it('mints once and permits a later operation to address the new identity', () => {
    const prepared = prepareFeatureRequirementOperations(
      [
        { op: 'add', value: { statement: 'C' } },
        { op: 'update', targetId: C, group: 'New' },
      ],
      () => C,
    );
    const result = applyFeatureRequirementOperations(base, prepared);
    expect(result.issues).toEqual([]);
    expect(result.records[2]).toMatchObject({
      id: C,
      statement: 'C',
      group: 'New',
    });
  });

  it('preserves identity, wording, sibling order and omitted fields on update', () => {
    const result = applyFeatureRequirementOperations(base, [
      { op: 'update', targetId: A, statement: 'A revised', group: null },
    ]);
    expect(result.issues).toEqual([]);
    expect(result.records.map(({ id }) => id)).toEqual([A, B]);
    expect(result.records[0]).toEqual({
      id: A,
      statement: 'A revised',
      designedBy: [],
      fulfilledBy: [],
      contracts: [],
    });
    expect(base[0]).toMatchObject({ statement: 'A', group: 'Old' });
  });

  it('rejects the complete batch when its final collection is invalid', () => {
    const result = applyFeatureRequirementOperations(base, [
      { op: 'add', id: A, value: { statement: 'Different' } },
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.message).toContain('/records/2/id duplicates');
    expect(result.records).toEqual(base);
  });

  it('returns the unchanged collection when an operation fails mid-batch', () => {
    const result = applyFeatureRequirementOperations(base, [
      { op: 'update', targetId: A, statement: 'Changed' },
      { op: 'delete', targetId: C },
      { op: 'update', targetId: B, group: 'Later' },
    ]);

    expect(result.issues).toEqual([
      expect.objectContaining({ operationIndex: 1, field: 'targetId' }),
    ]);
    expect(result.records).toEqual(base);
  });
});
