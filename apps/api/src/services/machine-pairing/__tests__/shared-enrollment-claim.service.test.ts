import { BadRequestException } from '@nestjs/common';
import {
  AccountProofFailedException,
  AccountProofRequiredException,
  BrowserSessionEndedException,
  PasskeyAlreadyRegisteredException,
} from '../../../auth/passkeys/account-passkey.exceptions';
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

  it.each([
    [
      'the account already has a passkey and none was proven',
      new AccountProofRequiredException(),
      'shared_registration_account_proof_required',
      true,
      'MACHINE_ENROLLMENT_ACCOUNT_PROOF_REQUIRED',
    ],
    [
      'the account proof does not verify',
      new AccountProofFailedException(),
      'shared_registration_account_proof_failed',
      true,
      'MACHINE_ENROLLMENT_ACCOUNT_PROOF_FAILED',
    ],
    [
      'the passkey is already registered',
      new PasskeyAlreadyRegisteredException(),
      'shared_registration_passkey_already_registered',
      false,
      'MACHINE_ENROLLMENT_PASSKEY_ALREADY_REGISTERED',
    ],
    [
      'the acting browser session ended',
      new BrowserSessionEndedException(),
      'shared_registration_session_ended',
      true,
      'MACHINE_ENROLLMENT_SESSION_ENDED',
    ],
    [
      'the request carries a malformed proof',
      new BadRequestException('Provide exactly one account proof'),
      'shared_registration_rejected_http_400',
      false,
      'MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE',
    ],
  ])(
    'leaves the claim retryable and reports the real cause when %s',
    async (_case, refusal, reasonCode, counted, publicCode) => {
      passkeys.addVerifiedSharedPasskey.mockRejectedValue(refusal);

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
        reasonCode,
        counted,
        publicCode,
      );
      expect(claims.stageVerifiedCredential).not.toHaveBeenCalled();
    },
  );

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
