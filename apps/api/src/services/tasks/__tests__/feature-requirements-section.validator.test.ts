import { validateFeatureRequirementsSection } from '../feature-requirements-section.validator';

const ID = '11111111-1111-4111-8111-111111111111';
const record = {
  id: ID,
  statement: 'Keep exact wording.',
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
};

describe('validateFeatureRequirementsSection', () => {
  it('accepts an unlabeled uncited record and returns a warning', () => {
    const result = validateFeatureRequirementsSection({ records: [record] });
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.warnings).toEqual(['/records/0 has no citations']);
  });

  it('rejects extra fields and invalid UUIDs without coercing them', () => {
    const result = validateFeatureRequirementsSection({
      records: [{ ...record, id: 'bad', extra: true }],
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.message).toMatch(/additional properties|uuid/);
  });

  it('reports duplicate identities and canonicalized statements precisely', () => {
    const result = validateFeatureRequirementsSection({
      records: [record, { ...record, statement: ' Keep   exact wording ' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toContain(
        '/records/1/id duplicates /records/0/id',
      );
      expect(result.message).toContain(
        '/records/1/statement duplicates /records/0/statement',
      );
    }
  });
});
