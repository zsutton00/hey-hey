import { UnauthorizedException } from '@nestjs/common';
import { MachineEnrollmentMode } from '@hey-hey/contracts/api/models';
import type { AccountPasskeyService } from '../../../auth/passkeys/account-passkey.service';
import type { MachineEnrollmentClaimService } from '../machine-enrollment-claim.service';
import { SharedEnrollmentClaimService } from '../shared-enrollment-claim.service';

const USER_ID = 'user-1';
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222';

const enrollment = {
  id: '11111111-1111-4111-8111-111111111111',
  controllerLabel: "Zac's browser",
};
const verified = {
  credentialId: 'credential-id',
  credentialPublicKey: Buffer.alloc(77, 4),
  credentialAaguid: Buffer.alloc(16, 3),
  credentialSignCount: 1,
  credentialBackupEligible: true,
  credentialBackupState: false,
  credentialTransports: ['internal'],
};
const input = {
  enrollmentId: enrollment.id,
  organizationId: ORGANIZATION_ID,
  credential: {},
  accountProof: { currentPassword: 'password' },
} as never;
const actor = {
  userId: USER_ID,
  browserSessionId: 'session-1',
  email: 'zac@example.com',
  name: 'Zac',
};

describe('SharedEnrollmentClaimService', () => {
  const session = { response: { accessToken: 'fresh' } };
  let claims: jest.Mocked<
    Pick<
      MachineEnrollmentClaimService,
      | 'prepareCompletion'
      | 'stageVerifiedCredential'
      | 'completionResponse'
      | 'rejectCompletion'
      | 'failStaging'
    >
  >;
  let passkeys: {
    addVerifiedSharedPasskey: jest.Mock;
    acceptsFirstPasskeyWithoutProof: boolean;
  };
  let service: SharedEnrollmentClaimService;

  beforeEach(() => {
    claims = {
      prepareCompletion: jest.fn().mockResolvedValue({ enrollment, verified }),
      stageVerifiedCredential: jest.fn().mockResolvedValue(undefined),
      completionResponse: jest.fn().mockReturnValue({
        enrollmentId: enrollment.id,
        state: 'awaiting-machine-confirmation',
      }),
      rejectCompletion: jest
        .fn()
        .mockRejectedValue(new Error('claim-rejected')),
      failStaging: jest.fn().mockRejectedValue(new Error('staging-failed')),
    };
    passkeys = {
      acceptsFirstPasskeyWithoutProof: false,
      addVerifiedSharedPasskey: jest.fn(
        async (_actor, _credential, _name, _proof, _meta, stage) => {
          await stage('tx', 'account-passkey-1');
          return session;
        },
      ),
    };
    service = new SharedEnrollmentClaimService(
      claims as unknown as MachineEnrollmentClaimService,
      passkeys as unknown as AccountPasskeyService,
    );
  });

  it('turns the one verified credential into sign-in eligibility and a staged controller, with a fresh session', async () => {
    const result = await service.completeSharedClaim(
      input,
      USER_ID as never,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      actor as never,
      {},
    );

    expect(claims.prepareCompletion).toHaveBeenCalledWith(
      input,
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      MachineEnrollmentMode.SHARED_NEW,
      false,
    );
    expect(passkeys.addVerifiedSharedPasskey).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({
        credentialId: 'credential-id',
        publicKey: verified.credentialPublicKey,
        backupEligible: true,
      }),
      "Zac's browser",
      { currentPassword: 'password' },
      {},
      expect.any(Function),
    );
    expect(claims.stageVerifiedCredential).toHaveBeenCalledWith(
      'tx',
      expect.anything(),
      USER_ID,
      input,
      'account-passkey-1',
    );
    expect(result.session).toBe(session);
    expect(result.response).toMatchObject({
      state: 'awaiting-machine-confirmation',
      session: session.response,
    });
  });

  it('leaves the claim retryable and issues no session when account proof fails', async () => {
    passkeys.addVerifiedSharedPasskey.mockRejectedValue(
      new UnauthorizedException('Account proof failed'),
    );

    await expect(
      service.completeSharedClaim(
        input,
        USER_ID as never,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
        actor as never,
        {},
      ),
    ).rejects.toThrow('claim-rejected');

    expect(claims.rejectCompletion).toHaveBeenCalledWith(
      USER_ID,
      '192.0.2.1',
      enrollment.id,
      'shared_registration_rejected',
      true,
      'MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE',
    );
    expect(claims.stageVerifiedCredential).not.toHaveBeenCalled();
  });

  it('does not swallow a failure to stage the controller enrollment', async () => {
    passkeys.addVerifiedSharedPasskey.mockRejectedValue(
      new Error('transition failed'),
    );

    await expect(
      service.completeSharedClaim(
        input,
        USER_ID as never,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
        actor as never,
        {},
      ),
    ).rejects.toThrow('staging-failed');
    expect(claims.rejectCompletion).not.toHaveBeenCalled();
  });
});
