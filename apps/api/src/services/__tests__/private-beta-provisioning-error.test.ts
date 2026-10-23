import { ConflictException } from '@nestjs/common';
import { toPrivateBetaProvisioningError } from '../private-beta-provisioning-error';

describe('toPrivateBetaProvisioningError', () => {
  it('classifies a user-stage conflict as a user conflict', () => {
    expect(
      toPrivateBetaProvisioningError(
        'USER_PROVISIONING',
        new ConflictException('Existing user'),
      ),
    ).toMatchObject({ code: 'USER_CONFLICT' });
  });

  it('preserves the organization stage for an entitlement conflict', () => {
    expect(
      toPrivateBetaProvisioningError(
        'ORGANIZATION_PROVISIONING',
        new ConflictException('Conflicting account entitlement'),
      ),
    ).toMatchObject({ code: 'ORGANIZATION_PROVISIONING' });
  });
});
