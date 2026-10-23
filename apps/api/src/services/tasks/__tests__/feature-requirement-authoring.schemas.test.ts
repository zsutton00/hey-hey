import {
  canonicalize,
  featureRequirementGroupSchema,
  featureRequirementInputSchema,
  featureRequirementOperationSchema,
} from '../feature-requirement-authoring.schemas';

const DESIGN_DOC_ID = '11111111-1111-4111-8111-111111111111';

describe('feature-requirement-authoring.schemas', () => {
  it('keeps statement comparison normalization independent of persisted wording', () => {
    expect(canonicalize('  Keep   exact wording.  ')).toBe(
      'Keep exact wording',
    );
  });

  it('uses the contract-aligned group shape', () => {
    expect(featureRequirementGroupSchema.safeParse('Access control').success).toBe(
      true,
    );
    expect(featureRequirementGroupSchema.safeParse('UI/UX').success).toBe(
      false,
    );
  });

  it('accepts typed citations and rejects unknown operation fields', () => {
    expect(
      featureRequirementInputSchema.safeParse({
        statement: 'The system preserves the requirement identity',
        designedBy: [{ entityType: 'DESIGN_DOC', entityId: DESIGN_DOC_ID }],
      }).success,
    ).toBe(true);
    expect(
      featureRequirementOperationSchema.safeParse({
        op: 'delete',
        targetId: DESIGN_DOC_ID,
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
