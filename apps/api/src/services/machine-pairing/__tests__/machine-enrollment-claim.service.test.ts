import { ConfigService } from '@nestjs/config';
import { MachineEnrollmentState } from '@prisma/client';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  MACHINE_ENROLLMENT_CLAIM_EXPIRED,
  MACHINE_ENROLLMENT_CLAIM_TERMINAL,
  MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
  MachineEnrollmentClaimFailedException,
  MachineEnrollmentClaimRateLimitException,
} from '../../../common/exceptions/pairing.exceptions';
import {
  AbandonMachineEnrollmentClaimRequestDto,
  BeginMachineEnrollmentClaimRequestDto,
  CompleteMachineEnrollmentClaimRequestDto,
} from '../../../generated';
import { OrganizationId, UserId } from '../../../types';
import {
  MACHINE_ENROLLMENT_ACCOUNT_FAILURE_LIMIT,
  MachineEnrollmentClaimService,
} from '../machine-enrollment-claim.service';
import {
  MachineEnrollmentWebAuthnVerifier,
  VerifiedMachineEnrollmentCredential,
} from '../machine-enrollment-webauthn-verifier';

const USER_ID = '11111111-1111-4111-8111-111111111111' as UserId;
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222' as UserId;
const ORGANIZATION_ID =
  '33333333-3333-4333-8333-333333333333' as OrganizationId;
const OTHER_ORGANIZATION_ID =
  '66666666-6666-4666-8666-666666666666' as OrganizationId;
const ENROLLMENT_ID = '44444444-4444-4444-8444-444444444444';
const MACHINE_ID = '55555555-5555-4555-8555-555555555555';
const HMAC_KEY = 'test-machine-enrollment-hmac-key';

interface TestRow {
  id: string;
  machineId: string;
  machinePublicKeyFingerprint: string;
  machineName: string;
  osFamily: 'macos' | 'windows' | 'linux';
  cliVersion: string;
  state: MachineEnrollmentState;
  userCodeHmac: string;
  expiresAt: Date;
  claimantUserId: string | null;
  claimantOrganizationId: string | null;
  controllerInstallationId: string | null;
  controllerLabel: string | null;
  webauthnChallenge: string | null;
  challengeExpiresAt: Date | null;
  challengeConsumedAt: Date | null;
  credentialId: string | null;
  failureCount: number;
  rejectedAt: Date | null;
  expiredAt: Date | null;
  localOutcomeCode: string | null;
  localOutcomeIssuedAt: Date | null;
  localOutcomeConsumedAt: Date | null;
  credentialPublicKeyX?: Buffer;
  credentialPublicKeyY?: Buffer;
  credentialTransports?: string[];
  credentialAaguid?: Buffer;
  credentialSignCount?: number;
  credentialBackupEligible?: boolean;
  credentialBackupState?: boolean;
  credentialFingerprint?: string;
  credentialVerifiedAt?: Date;
  browserBindingCredentialHash?: string | null;
  browserBindingIssuedAt?: Date | null;
  browserBindingExpiresAt?: Date | null;
}

const makeCredential = (
  enrollmentId = ENROLLMENT_ID,
): CompleteMachineEnrollmentClaimRequestDto => ({
  enrollmentId,
  organizationId: ORGANIZATION_ID,
  credential: {
    id: 'credential-id',
    rawId: 'credential-id',
    type: 'public-key',
    response: {
      clientDataJSON: 'client-data',
      attestationObject: 'attestation-object',
      transports: ['internal'],
    },
    authenticatorAttachment: 'platform',
  },
});

const makeAbandonInput = (): AbandonMachineEnrollmentClaimRequestDto => ({
  enrollmentId: ENROLLMENT_ID,
  organizationId: ORGANIZATION_ID,
});

const makeVerified = (): VerifiedMachineEnrollmentCredential => ({
  credentialId: 'credential-id',
  credentialPublicKeyX: Buffer.alloc(32, 1),
  credentialPublicKeyY: Buffer.alloc(32, 2),
  credentialAaguid: Buffer.alloc(16, 3),
  credentialSignCount: 1,
  credentialBackupEligible: true,
  credentialBackupState: false,
  credentialTransports: ['internal'],
  credentialFingerprint: 'a'.repeat(64),
});

describe('MachineEnrollmentClaimService', () => {
  let row: TestRow;
  let failures: Array<{
    userId: string;
    sourceAddress: string;
    enrollmentId: string | null;
    attemptedAt: Date;
  }>;
  let verifier: jest.Mocked<MachineEnrollmentWebAuthnVerifier>;
  let service: MachineEnrollmentClaimService;
  let prismaDb: Record<string, unknown>;
  let machine: {
    userId: string;
    organizationId: string | null;
    revokedAt: Date | null;
  } | null;

  const codeHmac = (code: string): string =>
    crypto.createHmac('sha256', HMAC_KEY).update(code).digest('hex');

  const makeBeginInput = (
    overrides: Partial<BeginMachineEnrollmentClaimRequestDto> = {},
  ): BeginMachineEnrollmentClaimRequestDto => ({
    organizationId: ORGANIZATION_ID,
    userCode: 'bcdfg-hjklm',
    controllerLabel: 'Zac browser',
    ...overrides,
  });

  beforeEach(() => {
    row = {
      id: ENROLLMENT_ID,
      machineId: MACHINE_ID,
      machinePublicKeyFingerprint: 'b'.repeat(64),
      machineName: 'test-machine',
      osFamily: 'linux',
      cliVersion: '2.2.2',
      state: MachineEnrollmentState.PENDING,
      userCodeHmac: codeHmac('BCDFGHJKLM'),
      expiresAt: new Date(Date.now() + 300_000),
      claimantUserId: null,
      claimantOrganizationId: null,
      controllerInstallationId: null,
      controllerLabel: null,
      webauthnChallenge: null,
      challengeExpiresAt: null,
      challengeConsumedAt: null,
      credentialId: null,
      failureCount: 0,
      rejectedAt: null,
      expiredAt: null,
      localOutcomeCode: null,
      localOutcomeIssuedAt: null,
      localOutcomeConsumedAt: null,
    };
    machine = null;
    failures = [];
    verifier = {
      verifyRegistration: jest.fn().mockResolvedValue(makeVerified()),
    };

    const matchesState = (
      value: MachineEnrollmentState,
      expected: MachineEnrollmentState | { in: MachineEnrollmentState[] },
    ) =>
      typeof expected === 'object'
        ? expected.in.includes(value)
        : value === expected;

    const db: any = {
      pendingMachineEnrollment: {
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: { id?: string; userCodeHmac?: string };
          }) =>
            where.id === row.id || where.userCodeHmac === row.userCodeHmac
              ? row
              : null,
        ),
        findUniqueOrThrow: jest.fn(async () => row),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, any>;
            data: Record<string, any>;
          }) => {
            if (where.id !== row.id) return { count: 0 };
            if (where.state && !matchesState(row.state, where.state))
              return { count: 0 };
            if (where.expiresAt?.lte && row.expiresAt > where.expiresAt.lte)
              return { count: 0 };
            if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt)
              return { count: 0 };
            if (
              where.challengeExpiresAt?.gt &&
              (!row.challengeExpiresAt ||
                row.challengeExpiresAt <= where.challengeExpiresAt.gt)
            )
              return { count: 0 };
            if (
              where.claimantUserId &&
              row.claimantUserId !== where.claimantUserId
            )
              return { count: 0 };
            if (
              where.claimantOrganizationId &&
              row.claimantOrganizationId !== where.claimantOrganizationId
            )
              return { count: 0 };
            if (
              where.challengeConsumedAt === null &&
              row.challengeConsumedAt !== null
            )
              return { count: 0 };
            if (where.credentialId === null && row.credentialId !== null)
              return { count: 0 };
            const { failureCount, ...directData } = data;
            Object.assign(row, directData);
            if (failureCount?.increment)
              row.failureCount += failureCount.increment;
            return { count: 1 };
          },
        ),
      },
      machineEnrollmentClaimFailure: {
        create: jest.fn(
          async ({ data }: { data: (typeof failures)[number] }) => {
            const retained = {
              ...data,
              enrollmentId: data.enrollmentId ?? null,
            };
            failures.push(retained);
            return retained;
          },
        ),
        count: jest.fn(
          async ({
            where,
          }: {
            where: {
              userId?: string;
              sourceAddress?: string;
              attemptedAt: { gte: Date };
            };
          }) =>
            failures.filter(
              (failure) =>
                failure.attemptedAt >= where.attemptedAt.gte &&
                (where.userId === undefined ||
                  failure.userId === where.userId) &&
                (where.sourceAddress === undefined ||
                  failure.sourceAddress === where.sourceAddress),
            ).length,
        ),
      },
      user: {
        findUnique: jest.fn(
          async ({
            select,
          }: {
            select: { email?: boolean; name?: boolean };
          }) => ({
            ...(select.email ? { email: 'zac@example.com' } : {}),
            ...(select.name ? { name: 'Zac' } : {}),
          }),
        ),
      },
      machine: {
        findUnique: jest.fn(async () => machine),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) =>
        callback(db),
      ),
    };

    prismaDb = db;
    service = new MachineEnrollmentClaimService(
      { db } as unknown as PrismaService,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: HMAC_KEY,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      verifier,
    );
  });

  it('normalizes the display code, binds the first claimant, and returns fixed registration options', async () => {
    const result = await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '::ffff:192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );
    expect(result.state).toBe('claimable');
    if (result.state !== 'claimable')
      throw new Error('Expected claimable response');

    expect(result.registrationOptions.rp).toEqual({
      id: 'test.heyhey.dev',
      name: 'Hey Hey',
    });
    expect(result.registrationOptions.user.name).toBe('zac@example.com');
    expect(row.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    expect(row.claimantUserId).toBe(USER_ID);
    expect(row.claimantOrganizationId).toBe(ORGANIZATION_ID);
    expect(row.controllerInstallationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.userId).toBe(USER_ID);
    expect(result.userId).toBe(row.claimantUserId);
    expect(row.webauthnChallenge).toBe(result.registrationOptions.challenge);
    expect(result.machineKeyFingerprint).toBe(`sha256:${'b'.repeat(64)}`);
  });

  it('resumes the same claimant with the original ceremony material', async () => {
    const first = await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );
    const second = await service.beginClaim(
      makeBeginInput({ controllerLabel: 'Replacement label' }),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );

    expect(first.state).toBe('claimable');
    expect(second.state).toBe('claimable');
    if (first.state !== 'claimable' || second.state !== 'claimable') {
      throw new Error('Expected claimable begin responses');
    }
    expect(second.registrationOptions.challenge).toBe(
      first.registrationOptions.challenge,
    );
    expect(second.controllerLabel).toBe('Zac browser');
    expect(failures).toHaveLength(0);
  });

  it('resumes the server-owned installation for the same claimant', async () => {
    const first = await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
    );

    const installationId = row.controllerInstallationId;
    await expect(
      service.beginClaim(
        makeBeginInput(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.2',
      ),
    ).resolves.toMatchObject({ state: first.state });
    expect(row.controllerInstallationId).toBe(installationId);
  });

  it('returns authoritative awaiting evidence to the same claimant', async () => {
    row.state = MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;
    row.controllerInstallationId = '00000000-0000-4000-8000-000000000099';
    row.controllerLabel = 'Zac browser';
    row.credentialFingerprint = 'a'.repeat(64);
    row.credentialBackupEligible = true;
    row.credentialBackupState = false;

    await expect(
      service.beginClaim(
        makeBeginInput(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      ),
    ).resolves.toMatchObject({
      state: 'awaiting-machine-confirmation',
      credentialFingerprint: `sha256:${'a'.repeat(64)}`,
      backupEligible: true,
      backupState: false,
    });
    expect(failures).toHaveLength(0);
  });

  it('terminalizes an owned browser claim and consumes its challenge', async () => {
    await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );

    const result = await service.abandonClaim(makeAbandonInput(), USER_ID, [
      { orgId: ORGANIZATION_ID },
    ]);

    expect(result).toEqual({ enrollmentId: ENROLLMENT_ID, state: 'rejected' });
    expect(row.state).toBe(MachineEnrollmentState.REJECTED);
    expect(row.rejectedAt).toBeInstanceOf(Date);
    expect(row.challengeConsumedAt).toEqual(row.rejectedAt);
  });

  it('treats an owned rejected claim as closed and consumes any retained challenge', async () => {
    const originalRejectedAt = new Date(Date.now() - 1_000);
    row.state = MachineEnrollmentState.REJECTED;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;
    row.rejectedAt = originalRejectedAt;

    await expect(
      service.abandonClaim(makeAbandonInput(), USER_ID, [
        { orgId: ORGANIZATION_ID },
      ]),
    ).resolves.toEqual({ enrollmentId: ENROLLMENT_ID, state: 'rejected' });

    expect(row.rejectedAt).toBe(originalRejectedAt);
    expect(row.challengeConsumedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['pending', MachineEnrollmentState.PENDING],
    [
      'awaiting confirmation',
      MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
    ],
  ])('cannot abandon an enrollment that is %s', async (_label, state) => {
    row.state = state;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;

    await expect(
      service.abandonClaim(makeAbandonInput(), USER_ID, [
        { orgId: ORGANIZATION_ID },
      ]),
    ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);

    expect(row.state).toBe(state);
    expect(row.challengeConsumedAt).toBeNull();
  });

  it('cannot abandon another claimant organization browser claim', async () => {
    row.state = MachineEnrollmentState.BROWSER_CLAIMED;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;

    await expect(
      service.abandonClaim(makeAbandonInput(), OTHER_USER_ID, [
        { orgId: ORGANIZATION_ID },
      ]),
    ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);

    expect(row.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
  });

  it('does not reveal an already rejected claim owned by another claimant', async () => {
    row.state = MachineEnrollmentState.REJECTED;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;

    await expect(
      service.abandonClaim(makeAbandonInput(), OTHER_USER_ID, [
        { orgId: ORGANIZATION_ID },
      ]),
    ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);
  });

  it('returns the same safe failure for an unknown code without exposing the submitted code', async () => {
    const promise = service.beginClaim(
      makeBeginInput({ userCode: 'zzzzz-zzzzz' }),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );

    const error = await promise.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(MachineEnrollmentClaimFailedException);
    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({
      message: 'Unable to claim this enrollment.',
      code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
    });
    expect(failures).toHaveLength(1);
  });

  it('classifies an invalid generated request as client-incompatible', async () => {
    const error = await service
      .beginClaim(
        makeBeginInput({ controllerLabel: '' }),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);

    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({
      code: MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
    });
  });

  it('returns an authoritative expired outcome for a recognized code', async () => {
    row.state = MachineEnrollmentState.BROWSER_CLAIMED;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;
    row.controllerInstallationId = '00000000-0000-4000-8000-000000000099';
    row.expiresAt = new Date(Date.now() - 1);

    const error = await service
      .beginClaim(
        makeBeginInput(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);

    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({
      code: MACHINE_ENROLLMENT_CLAIM_EXPIRED,
      message:
        'This enrollment has expired. Start a fresh enrollment from the CLI.',
    });
    expect(failures).toHaveLength(0);
  });

  it('keeps an expired enrollment indistinguishable from unavailable for another claimant', async () => {
    row.state = MachineEnrollmentState.BROWSER_CLAIMED;
    row.claimantUserId = OTHER_USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;
    row.controllerInstallationId = '00000000-0000-4000-8000-000000000098';
    row.expiresAt = new Date(Date.now() - 1);

    const error = await service
      .beginClaim(
        makeBeginInput(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);

    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({
      code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
      message: 'Unable to claim this enrollment.',
    });
    expect(failures).toHaveLength(0);
  });

  it('records a local warning for an active foreign account while keeping the browser failure generic', async () => {
    machine = {
      userId: OTHER_USER_ID,
      organizationId: ORGANIZATION_ID,
      revokedAt: null,
    };

    const error = await service
      .beginClaim(
        makeBeginInput(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(MachineEnrollmentClaimFailedException);
    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({
      code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
      message: 'Unable to claim this enrollment.',
    });
    expect(row.localOutcomeCode).toBe(
      MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
    );
    expect(row.localOutcomeIssuedAt).toEqual(expect.any(Date));
    expect(row.localOutcomeConsumedAt).toBeNull();
    expect(row.state).toBe(MachineEnrollmentState.PENDING);
  });

  it('records the same local warning when only the organization differs', async () => {
    machine = {
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      revokedAt: null,
    };

    const error = await service
      .beginClaim(
        makeBeginInput({ organizationId: OTHER_ORGANIZATION_ID }),
        USER_ID,
        [{ orgId: OTHER_ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(MachineEnrollmentClaimFailedException);
    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({ code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE });
    expect(row.localOutcomeCode).toBe(
      MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
    );
    expect(row.localOutcomeIssuedAt).toEqual(expect.any(Date));
  });

  it('records the local warning if ownership changes before claim completion', async () => {
    row.state = MachineEnrollmentState.BROWSER_CLAIMED;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;
    row.controllerInstallationId = '00000000-0000-4000-8000-000000000099';
    row.controllerLabel = 'Zac browser';
    row.webauthnChallenge = 'challenge';
    row.challengeExpiresAt = new Date(Date.now() + 300_000);
    machine = {
      userId: OTHER_USER_ID,
      organizationId: ORGANIZATION_ID,
      revokedAt: null,
    };

    const error = await service
      .completeClaim(
        makeCredential(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(MachineEnrollmentClaimFailedException);
    expect(
      (error as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({ code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE });
    expect(row.localOutcomeCode).toBe(
      MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
    );
    expect(verifier.verifyRegistration).not.toHaveBeenCalled();
  });

  it('reveals terminal state only to the same claimant and installation', async () => {
    row.state = MachineEnrollmentState.REJECTED;
    row.claimantUserId = USER_ID;
    row.claimantOrganizationId = ORGANIZATION_ID;
    row.controllerInstallationId = '00000000-0000-4000-8000-000000000099';

    const ownedError = await service
      .beginClaim(
        makeBeginInput(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      )
      .catch((failure: unknown) => failure);
    expect(
      (ownedError as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({ code: MACHINE_ENROLLMENT_CLAIM_TERMINAL });

    const crossAccountError = await service
      .beginClaim(
        makeBeginInput(),
        OTHER_USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.2',
      )
      .catch((failure: unknown) => failure);
    expect(
      (
        crossAccountError as MachineEnrollmentClaimFailedException
      ).getResponse(),
    ).toMatchObject({ code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE });
  });

  it('records a well-formed nonexistent enrollment as account/source evidence only', async () => {
    const nonexistentEnrollmentId = '66666666-6666-4666-8666-666666666666';

    await expect(
      service.completeClaim(
        makeCredential(nonexistentEnrollmentId),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      ),
    ).rejects.toMatchObject({ message: 'Unable to claim this enrollment.' });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      userId: USER_ID,
      sourceAddress: '192.0.2.1',
      enrollmentId: null,
    });
    expect(verifier.verifyRegistration).not.toHaveBeenCalled();
  });

  it('rate limits invalid completion bursts without mutating the live enrollment', async () => {
    await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );
    verifier.verifyRegistration.mockRejectedValue(new Error('bad ceremony'));

    for (
      let index = 0;
      index < MACHINE_ENROLLMENT_ACCOUNT_FAILURE_LIMIT;
      index += 1
    ) {
      await expect(
        service.completeClaim(
          makeCredential(),
          USER_ID,
          [{ orgId: ORGANIZATION_ID }],
          '192.0.2.1',
        ),
      ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);
    }

    expect(row.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    expect(row.failureCount).toBe(0);
    await expect(
      service.completeClaim(
        makeCredential(),
        USER_ID,
        [{ orgId: ORGANIZATION_ID }],
        '192.0.2.1',
      ),
    ).rejects.toBeInstanceOf(MachineEnrollmentClaimRateLimitException);
  });

  it('records distributed invalid evidence without rejecting the enrollment', async () => {
    await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );
    verifier.verifyRegistration.mockRejectedValue(new Error('bad ceremony'));

    const attempts = [
      [USER_ID, '192.0.2.1'],
      [OTHER_USER_ID, '192.0.2.2'],
      [USER_ID, '192.0.2.3'],
      [OTHER_USER_ID, '192.0.2.4'],
      [USER_ID, '192.0.2.5'],
    ] as const;

    for (const [attemptUserId, sourceAddress] of attempts) {
      await expect(
        service.completeClaim(
          makeCredential(),
          attemptUserId,
          [{ orgId: ORGANIZATION_ID }],
          sourceAddress,
        ),
      ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);
    }

    expect(row.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    expect(row.failureCount).toBe(0);
    expect(failures).toHaveLength(attempts.length);
    expect(
      failures.every((failure) => failure.enrollmentId === ENROLLMENT_ID),
    ).toBe(true);
  });

  it('stores normalized verification evidence and never activates the machine', async () => {
    await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );

    const result = await service.completeClaim(
      makeCredential(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
    );

    expect(result.state).toBe('awaiting-machine-confirmation');
    expect(row.state).toBe(
      MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
    );
    expect(row.credentialId).toBe('credential-id');
    expect(row.credentialFingerprint).toBe('a'.repeat(64));
    expect(row.credentialPublicKeyX).toEqual(Buffer.alloc(32, 1));
    expect(row.credentialPublicKeyY).toEqual(Buffer.alloc(32, 2));
    expect(row.credentialAaguid).toEqual(Buffer.alloc(16, 3));
  });

  it('stores only a pending browser-binding hash while local confirmation is outstanding', async () => {
    await service.beginClaim(
      makeBeginInput(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
      { email: 'zac@example.com', name: 'Zac' },
    );
    await service.completeClaim(
      makeCredential(),
      USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.1',
    );

    const binding = await service.issueBrowserBindingForAwaitingConfirmation({
      enrollmentId: ENROLLMENT_ID,
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
    });

    expect(binding.secret).toHaveLength(43);
    expect(row.browserBindingCredentialHash).toBe(
      crypto.createHash('sha256').update(binding.secret).digest('hex'),
    );
    expect(JSON.stringify(row)).not.toContain(binding.secret);
  });

  it('uses explicit staging registration options in production runtime mode', async () => {
    const productionService = new MachineEnrollmentClaimService(
      { db: prismaDb } as unknown as PrismaService,
      new ConfigService({
        NODE_ENV: 'production',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: HMAC_KEY,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'staging.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://staging.heyhey.dev',
      }),
      verifier,
    );

    const result = await productionService.beginClaim(
      makeBeginInput(),
      OTHER_USER_ID,
      [{ orgId: ORGANIZATION_ID }],
      '192.0.2.2',
      { email: 'other@example.com', name: 'Other' },
    );
    expect(result.state).toBe('claimable');
    if (result.state !== 'claimable')
      throw new Error('Expected claimable response');

    expect(result.registrationOptions.rp.id).toBe('staging.heyhey.dev');
  });
});
