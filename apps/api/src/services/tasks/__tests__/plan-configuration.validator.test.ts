import { PlanType } from '../../../generated/model/planType';
import {
  canonicalizePlanConfigurationContent,
  PLAN_CONFIGURATION_SCHEMA_VERSION,
  validatePlanConfigurationContent,
} from '../plan-configuration.validator';

describe('plan configuration validator', () => {
  const configuration = {
    schemaVersion: PLAN_CONFIGURATION_SCHEMA_VERSION,
    planType: PlanType.Standard,
    worktreeBranch: null,
  } as const;

  it('accepts and canonicalizes the exact OpenAPI shape', () => {
    expect(validatePlanConfigurationContent(configuration)).toEqual({
      success: true,
      value: configuration,
      canonicalContent: JSON.stringify(configuration),
    });
    expect(
      canonicalizePlanConfigurationContent(JSON.stringify(configuration)),
    ).toBe(JSON.stringify(configuration));
  });

  it.each([
    [{ ...configuration, schemaVersion: 'plan-configuration.v2' }],
    [{ ...configuration, planType: 'LARGE' }],
    [{ ...configuration, worktreeBranch: undefined }],
    [{ ...configuration, projectId: 'not-section-content' }],
  ])('rejects contract-invalid content %#', (content) => {
    expect(validatePlanConfigurationContent(content).success).toBe(false);
  });
});
