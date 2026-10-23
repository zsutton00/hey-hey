import { ConfigService } from '@nestjs/config';
import { MachineEnrollmentState } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
  MachineEnrollmentClaimFailedException,
  MachineEnrollmentClaimRateLimitException,
} from '../../../common/exceptions/pairing.exceptions';
import { CompleteMachineEnrollmentClaimRequestDto } from '../../../generated';
import {
  MACHINE_ENROLLMENT_ACCOUNT_FAILURE_LIMIT,
  MachineEnrollmentClaimService,
} from '../machine-enrollment-claim.service';
import {
  MachineEnrollmentWebAuthnVerifier,
  VerifiedMachineEnrollmentCredential,
} from '../machine-enrollment-webauthn-verifier';
import * as crypto from 'node:crypto';
import { OrganizationId, UserId } from '../../../types';
import { MachinePairingService } from '../machine-pairing.service';
import { MachineConnectionEvictionService } from '../../../core/websockets/machine-connection-eviction.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';

const describeDatabase =
  process.env.RUN_MACHINE_ENROLLMENT_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('MachineEnrollmentClaimService PostgreSQL invariants', () => {
  let prisma: PrismaService;
  let service: MachineEnrollmentClaimService;
  const enrollmentIds: string[] = [];
  const machineIds: string[] = [];
  const userIds: UserId[] = [];
  const organizationIds: OrganizationId[] = [];
  const controllerInstallationId = '00000000-0000-4000-8000-000000000099';

  const hmacKey =
    process.env.MACHINE_ENROLLMENT_CODE_HMAC_KEY ??
    'machine-enrollment-integration-test-key';

  const hmac = (code: string): string =>
    crypto.createHmac('sha256', hmacKey).update(code).digest('hex');

  const makeVerifier = (
    implementation: MachineEnrollmentWebAuthnVerifier['verifyRegistration'],
  ): MachineEnrollmentWebAuthnVerifier => ({
    verifyRegistration: implementation,
  });

  const validCredential = (
    enrollmentId: string,
  ): CompleteMachineEnrollmentClaimRequestDto => ({
    enrollmentId,
    organizationId: organizationIds[0]!,
    credential: {
      id: 'shared-credential',
      rawId: 'shared-credential',
      type: 'public-key',
      response: {
        clientDataJSON: 'client-data',
        attestationObject: 'attestation-object',
        transports: ['internal'],
      },
      authenticatorAttachment: 'platform',
    },
  });

  const verified = (): VerifiedMachineEnrollmentCredential => ({
    credentialId: 'shared-credential',
    credentialPublicKeyX: Buffer.alloc(32, 1),
    credentialPublicKeyY: Buffer.alloc(32, 2),
    credentialAaguid: Buffer.alloc(16, 3),
    credentialSignCount: 1,
    credentialBackupEligible: true,
    credentialBackupState: false,
    credentialTransports: ['internal'],
    credentialFingerprint: 'a'.repeat(64),
  });

  const createFixture = async (code: string, expiresAt: Date) => {
    const organization = await prisma.db.organization.create({
      data: {
        id: randomUUID(),
        name: `Claim test ${randomUUID()}`,
        slug: `claim-test-${randomUUID()}`,
      },
    });
    organizationIds.push(organization.id);

    const users = await Promise.all(
      [1, 2].map((index) =>
        prisma.db.user.create({
          data: {
            id: randomUUID(),
            email: `claim-test-${randomUUID()}-${index}@example.com`,
            name: `Claim Test ${index}`,
            passwordHash: 'integration-test-password-hash',
          },
        }),
      ),
    );
    userIds.push(...users.map((user) => user.id));
    await prisma.db.organizationMember.createMany({
      data: users.map((user) => ({
        userId: user.id,
        organizationId: organization.id,
      })),
    });

    const enrollment = await prisma.db.pendingMachineEnrollment.create({
      data: {
        machineId: randomUUID(),
        machinePublicKey:
          '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----',
        machinePublicKeyFingerprint: randomUUID()
          .replaceAll('-', '')
          .padEnd(64, 'a'),
        machineName: 'claim-test-machine',
        osFamily: 'linux',
        cliVersion: '2.2.2',
        authorizationProtocolVersion: 2,
        userCodeHmac: hmac(code),
        deviceSecretDigest: randomUUID().replaceAll('-', '').padEnd(64, 'b'),
        expiresAt,
        createdAt: new Date(Math.min(Date.now(), expiresAt.getTime() - 1)),
      },
    });
    enrollmentIds.push(enrollment.id);
    return { organization, users, enrollment };
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    const cleanupEnrollmentIds = enrollmentIds.splice(0);
    const cleanupMachineIds = machineIds.splice(0);
    const cleanupOrganizationIds = organizationIds.splice(0);
    const cleanupUserIds = userIds.splice(0);

    if (cleanupEnrollmentIds.length > 0) {
      await prisma.db.pendingMachineEnrollment.deleteMany({
        where: { id: { in: cleanupEnrollmentIds } },
      });
    }
    if (cleanupMachineIds.length > 0) {
      await prisma.db.machine.deleteMany({
        where: { id: { in: cleanupMachineIds } },
      });
    }
    if (cleanupOrganizationIds.length > 0) {
      await prisma.db.organization.deleteMany({
        where: { id: { in: cleanupOrganizationIds } },
      });
    }
    if (cleanupUserIds.length > 0) {
      await prisma.db.user.deleteMany({
        where: { id: { in: cleanupUserIds } },
      });
    }

    expect(
      await prisma.db.pendingMachineEnrollment.count({
        where: { id: { in: cleanupEnrollmentIds } },
      }),
    ).toBe(0);
    expect(
      await prisma.db.machineEnrollmentClaimFailure.count({
        where: { userId: { in: cleanupUserIds } },
      }),
    ).toBe(0);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('claims a freshly generated CLI enrollment code through the production services', async () => {
    const fixture = await createFixture(
      'ZZZZZZZZZZ',
      new Date(Date.now() + 300_000),
    );
    await prisma.db.pendingMachineEnrollment.delete({
      where: { id: fixture.enrollment.id },
    });
    const sourceAddress = '198.51.100.250';
    const pairing = new MachinePairingService(
      prisma,
      {} as MachineConnectionEvictionService,
      {} as DomainEventPublisher,
      new ConfigService({ MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey }),
      {} as never,
      {} as never,
      { recordActivity: jest.fn() } as never,
    );
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const created = await pairing.createMachineEnrollment(
      {
        machinePublicKey: publicKey
          .export({ format: 'pem', type: 'spki' })
          .toString(),
        machineName: 'fresh-code-claim-test',
        osFamily: 'linux',
        cliVersion: '2.2.2',
        authorizationProtocolVersion: 2,
      },
      sourceAddress,
    );
    enrollmentIds.push(created.enrollmentId);
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn()),
    );

    await expect(
      service.beginClaim(
        {
          organizationId: fixture.organization.id,
          userCode: created.userCode,
          controllerLabel: 'fresh code browser',
        },
        fixture.users[0]!.id,
        [{ orgId: fixture.organization.id }],
        sourceAddress,
        { email: fixture.users[0]!.email, name: fixture.users[0]!.name },
      ),
    ).resolves.toMatchObject({
      state: 'claimable',
      enrollmentId: created.enrollmentId,
    });
    await prisma.db.machineEnrollmentCreationAttempt.deleteMany({
      where: { sourceAddress },
    });
  }, 30000);

  it('allows exactly one claimant in a competing cross-account race', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn()),
    );

    const results = await Promise.allSettled(
      fixture.users.map((user, index) =>
        service.beginClaim(
          {
            organizationId: fixture.organization.id,
            userCode: 'BCDFG-HJKLM',
            controllerLabel: `browser-${index}`,
          },
          user.id,
          [{ orgId: fixture.organization.id }],
          `198.51.100.${index + 1}`,
          { email: user.email, name: user.name },
        ),
      ),
    );

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const persisted =
      await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      });
    expect(persisted.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    expect(persisted.claimantUserId).toBeTruthy();
    expect(
      await prisma.db.machineEnrollmentClaimFailure.count({
        where: { enrollmentId: fixture.enrollment.id },
      }),
    ).toBe(1);
  }, 30000);

  it('records a local-only warning for an active foreign machine without changing machine history', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    const existingMachine = await prisma.db.machine.create({
      data: {
        id: fixture.enrollment.machineId,
        userId: fixture.users[1]!.id,
        organizationId: fixture.organization.id,
        name: 'foreign-owner-machine',
        publicKey: 'foreign-owner-machine-public-key',
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, 'a'),
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
      },
    });
    machineIds.push(existingMachine.id);
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn()),
    );

    await expect(
      service.beginClaim(
        {
          organizationId: fixture.organization.id,
          userCode: 'BCDFG-HJKLM',
          controllerLabel: 'foreign browser',
        },
        fixture.users[0]!.id,
        [{ orgId: fixture.organization.id }],
        '198.51.100.15',
      ),
    ).rejects.toMatchObject({
      message: 'Unable to claim this enrollment.',
      response: {
        code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
      },
    });

    const persisted =
      await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      });
    expect(persisted).toMatchObject({
      state: MachineEnrollmentState.PENDING,
      localOutcomeCode: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
      localOutcomeConsumedAt: null,
    });
    expect(persisted.localOutcomeIssuedAt).not.toBeNull();
    expect(
      await prisma.db.machine.findUnique({
        where: { id: existingMachine.id },
        select: { userId: true, organizationId: true, revokedAt: true },
      }),
    ).toEqual({
      userId: fixture.users[1]!.id,
      organizationId: fixture.organization.id,
      revokedAt: null,
    });
  }, 30000);

  it('records the warning when the same account switches organizations', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLP',
      new Date(Date.now() + 300_000),
    );
    const otherOrganization = await prisma.db.organization.create({
      data: {
        id: randomUUID(),
        name: `Claim test alternate ${randomUUID()}`,
        slug: `claim-test-alternate-${randomUUID()}`,
      },
    });
    organizationIds.push(otherOrganization.id);
    await prisma.db.organizationMember.create({
      data: {
        userId: fixture.users[0]!.id,
        organizationId: otherOrganization.id,
      },
    });
    const existingMachine = await prisma.db.machine.create({
      data: {
        id: fixture.enrollment.machineId,
        userId: fixture.users[0]!.id,
        organizationId: fixture.organization.id,
        name: 'organization-owner-machine',
        publicKey: 'organization-owner-machine-public-key',
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, 'a'),
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
      },
    });
    machineIds.push(existingMachine.id);
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn()),
    );

    await expect(
      service.beginClaim(
        {
          organizationId: otherOrganization.id,
          userCode: 'BCDFG-HJKLP',
          controllerLabel: 'organization-switch browser',
        },
        fixture.users[0]!.id,
        [{ orgId: otherOrganization.id }],
        '198.51.100.16',
      ),
    ).rejects.toMatchObject({
      message: 'Unable to claim this enrollment.',
      response: { code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE },
    });

    const persisted =
      await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      });
    expect(persisted.localOutcomeCode).toBe(
      MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
    );
    expect(
      await prisma.db.machine.findUnique({
        where: { id: existingMachine.id },
        select: { userId: true, organizationId: true, revokedAt: true },
      }),
    ).toEqual({
      userId: fixture.users[0]!.id,
      organizationId: fixture.organization.id,
      revokedAt: null,
    });
  }, 30000);

  it('resumes stored ceremony material and then returns persisted awaiting evidence', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    const claimant = fixture.users[0]!;
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn().mockResolvedValue(verified())),
    );
    const request = {
      organizationId: fixture.organization.id,
      userCode: 'BCDFGHJKLM',
      controllerLabel: 'original label',
    };

    const first = await service.beginClaim(
      request,
      claimant.id,
      [{ orgId: fixture.organization.id }],
      '198.51.100.12',
      { email: claimant.email, name: claimant.name },
    );
    const resumed = await service.beginClaim(
      { ...request, controllerLabel: 'replacement label' },
      claimant.id,
      [{ orgId: fixture.organization.id }],
      '198.51.100.12',
      { email: claimant.email, name: claimant.name },
    );
    expect(first.state).toBe('claimable');
    expect(resumed.state).toBe('claimable');
    if (first.state !== 'claimable' || resumed.state !== 'claimable') {
      throw new Error('Expected claimable responses');
    }
    expect(resumed.registrationOptions.challenge).toBe(
      first.registrationOptions.challenge,
    );
    expect(resumed.controllerLabel).toBe('original label');

    await service.completeClaim(
      validCredential(fixture.enrollment.id),
      claimant.id,
      [{ orgId: fixture.organization.id }],
      '198.51.100.12',
    );
    await expect(
      service.beginClaim(
        request,
        claimant.id,
        [{ orgId: fixture.organization.id }],
        '198.51.100.12',
      ),
    ).resolves.toMatchObject({
      state: 'awaiting-machine-confirmation',
      credentialFingerprint: expect.stringMatching(/^sha256:/),
    });
  }, 30000);

  it('atomically rejects only the owning browser claimant and consumes its challenge', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn()),
    );
    const claimant = fixture.users[0]!;
    await service.beginClaim(
      {
        organizationId: fixture.organization.id,
        userCode: 'BCDFG-HJKLM',
        controllerLabel: 'browser',
      },
      claimant.id,
      [{ orgId: fixture.organization.id }],
      '198.51.100.21',
      { email: claimant.email, name: claimant.name },
    );

    await expect(
      service.abandonClaim(
        {
          enrollmentId: fixture.enrollment.id,
          organizationId: fixture.organization.id,
        },
        fixture.users[1]!.id,
        [{ orgId: fixture.organization.id }],
      ),
    ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);

    await expect(
      service.abandonClaim(
        {
          enrollmentId: fixture.enrollment.id,
          organizationId: fixture.organization.id,
        },
        claimant.id,
        [{ orgId: fixture.organization.id }],
      ),
    ).resolves.toEqual({
      enrollmentId: fixture.enrollment.id,
      state: 'rejected',
    });

    await expect(
      service.abandonClaim(
        {
          enrollmentId: fixture.enrollment.id,
          organizationId: fixture.organization.id,
        },
        claimant.id,
        [{ orgId: fixture.organization.id }],
      ),
    ).resolves.toEqual({
      enrollmentId: fixture.enrollment.id,
      state: 'rejected',
    });

    const persisted =
      await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      });
    expect(persisted.state).toBe(MachineEnrollmentState.REJECTED);
    expect(persisted.rejectedAt).not.toBeNull();
    expect(persisted.challengeConsumedAt).toEqual(persisted.rejectedAt);
  }, 30000);

  it('retains safe account/source evidence for a well-formed nonexistent enrollment', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    const nonexistentEnrollmentId = randomUUID();
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn()),
    );

    await expect(
      service.completeClaim(
        validCredential(nonexistentEnrollmentId),
        fixture.users[0]!.id,
        [{ orgId: fixture.organization.id }],
        '198.51.100.30',
      ),
    ).rejects.toMatchObject({ message: 'Unable to claim this enrollment.' });

    const failure = await prisma.db.machineEnrollmentClaimFailure.findFirst({
      where: { userId: fixture.users[0]!.id },
    });
    expect(failure).toMatchObject({
      sourceAddress: '198.51.100.30',
      enrollmentId: null,
    });
    expect(JSON.stringify(failure)).not.toContain('client-data');
    expect(JSON.stringify(failure)).not.toContain('attestation-object');
    expect(JSON.stringify(failure)).not.toContain(nonexistentEnrollmentId);
  }, 30000);

  it('retains distributed failure evidence without mutating the live enrollment', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn().mockRejectedValue(new Error('invalid ceremony'))),
    );

    await service.beginClaim(
      {
        organizationId: fixture.organization.id,
        userCode: 'BCDFG-HJKLM',
        controllerLabel: 'distributed failures',
      },
      fixture.users[0]!.id,
      [{ orgId: fixture.organization.id }],
      '198.51.100.31',
      { email: fixture.users[0]!.email, name: fixture.users[0]!.name },
    );

    const attempts = [
      fixture.users[0]!,
      fixture.users[1]!,
      fixture.users[0]!,
      fixture.users[1]!,
      fixture.users[0]!,
    ];
    for (const [index, user] of attempts.entries()) {
      await expect(
        service.completeClaim(
          validCredential(fixture.enrollment.id),
          user.id,
          [{ orgId: fixture.organization.id }],
          `198.51.100.${40 + index}`,
        ),
      ).rejects.toMatchObject({ message: 'Unable to claim this enrollment.' });
    }

    const persisted =
      await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      });
    expect(persisted.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    expect(persisted.failureCount).toBe(0);
    expect(
      await prisma.db.machineEnrollmentClaimFailure.count({
        where: { enrollmentId: fixture.enrollment.id },
      }),
    ).toBe(attempts.length);
  }, 30000);

  it('serializes concurrent failure evidence without rejecting the enrollment', async () => {
    const fixture = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn().mockRejectedValue(new Error('invalid ceremony'))),
    );

    await service.beginClaim(
      {
        organizationId: fixture.organization.id,
        userCode: 'BCDFG-HJKLM',
        controllerLabel: 'concurrent failures',
      },
      fixture.users[0]!.id,
      [{ orgId: fixture.organization.id }],
      '198.51.100.50',
      { email: fixture.users[0]!.email, name: fixture.users[0]!.name },
    );

    const concurrentAttempts = 5;
    const results = await Promise.allSettled(
      Array.from({ length: concurrentAttempts }, (_, index) =>
        service.completeClaim(
          validCredential(fixture.enrollment.id),
          fixture.users[0]!.id,
          [{ orgId: fixture.organization.id }],
          `198.51.100.${60 + index}`,
        ),
      ),
    );
    expect(results).toHaveLength(concurrentAttempts);
    expect(
      results.every(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof MachineEnrollmentClaimFailedException,
      ),
    ).toBe(true);

    const persisted =
      await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      });
    expect(persisted.state).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    expect(persisted.failureCount).toBe(0);
    expect(
      await prisma.db.machineEnrollmentClaimFailure.count({
        where: { enrollmentId: fixture.enrollment.id },
      }),
    ).toBe(concurrentAttempts);
  }, 30000);

  it('retains one globally unique credential when two claimed enrollments complete concurrently', async () => {
    const first = await createFixture(
      'BCDFGHJKLM',
      new Date(Date.now() + 300_000),
    );
    const second = await createFixture(
      'BCDFGHJKLP',
      new Date(Date.now() + 300_000),
    );
    const verifier = makeVerifier(jest.fn().mockResolvedValue(verified()));
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      verifier,
    );
    await Promise.all([
      service.beginClaim(
        {
          organizationId: first.organization.id,
          userCode: 'BCDFG-HJKLM',
          controllerLabel: 'first browser',
        },
        first.users[0]!.id,
        [{ orgId: first.organization.id }],
        '198.51.100.10',
        { email: first.users[0]!.email, name: first.users[0]!.name },
      ),
      service.beginClaim(
        {
          organizationId: second.organization.id,
          userCode: 'BCDFG-HJKLP',
          controllerLabel: 'second browser',
        },
        second.users[0]!.id,
        [{ orgId: second.organization.id }],
        '198.51.100.11',
        { email: second.users[0]!.email, name: second.users[0]!.name },
      ),
    ]);

    const results = await Promise.allSettled([
      service.completeClaim(
        validCredential(first.enrollment.id),
        first.users[0]!.id,
        [{ orgId: first.organization.id }],
        '198.51.100.10',
      ),
      service.completeClaim(
        {
          ...validCredential(second.enrollment.id),
          organizationId: second.organization.id,
        },
        second.users[0]!.id,
        [{ orgId: second.organization.id }],
        '198.51.100.11',
      ),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const persisted = await prisma.db.pendingMachineEnrollment.findMany({
      where: { id: { in: [first.enrollment.id, second.enrollment.id] } },
    });
    expect(
      persisted.filter((enrollment) => enrollment.credentialId !== null),
    ).toHaveLength(1);
    expect(
      persisted.filter(
        (enrollment) =>
          enrollment.state ===
          MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
      ),
    ).toHaveLength(1);
    const persistedText = JSON.stringify(persisted);
    expect(persistedText).not.toContain('BCDFG-HJKLM');
    expect(persistedText).not.toContain('client-data');
    expect(persistedText).not.toContain('attestation-object');
  }, 30000);

  it('expires safely and rate limits invalid confirmation bursts non-destructively', async () => {
    const expired = await createFixture('BCDFGHJKLM', new Date(Date.now() - 1));
    service = new MachineEnrollmentClaimService(
      prisma,
      new ConfigService({
        NODE_ENV: 'test',
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey,
        MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: 'test.heyhey.dev',
        MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: 'https://test.heyhey.dev',
      }),
      makeVerifier(jest.fn().mockRejectedValue(new Error('invalid ceremony'))),
    );

    const expiredError = await service
      .beginClaim(
        {
          organizationId: expired.organization.id,
          userCode: 'BCDFG-HJKLM',
          controllerLabel: 'expired browser',
        },
        expired.users[0]!.id,
        [{ orgId: expired.organization.id }],
        '198.51.100.20',
        { email: expired.users[0]!.email, name: expired.users[0]!.name },
      )
      .catch((failure: unknown) => failure);
    expect(expiredError).toBeInstanceOf(MachineEnrollmentClaimFailedException);
    expect(
      (expiredError as MachineEnrollmentClaimFailedException).getResponse(),
    ).toMatchObject({ code: MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE });
    expect(
      (
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: expired.enrollment.id },
        })
      ).state,
    ).toBe(MachineEnrollmentState.EXPIRED);

    const active = await createFixture(
      'BCDFGHJKLP',
      new Date(Date.now() + 300_000),
    );
    await service.beginClaim(
      {
        organizationId: active.organization.id,
        userCode: 'BCDFG-HJKLP',
        controllerLabel: 'failing browser',
      },
      active.users[0]!.id,
      [{ orgId: active.organization.id }],
      '198.51.100.21',
      { email: active.users[0]!.email, name: active.users[0]!.name },
    );
    const failedCredential = {
      ...validCredential(active.enrollment.id),
      organizationId: active.organization.id,
    };
    for (
      let index = 0;
      index < MACHINE_ENROLLMENT_ACCOUNT_FAILURE_LIMIT;
      index += 1
    ) {
      await expect(
        service.completeClaim(
          failedCredential,
          active.users[0]!.id,
          [{ orgId: active.organization.id }],
          '198.51.100.21',
        ),
      ).rejects.toBeInstanceOf(MachineEnrollmentClaimFailedException);
    }
    expect(
      (
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: active.enrollment.id },
        })
      ).state,
    ).toBe(MachineEnrollmentState.BROWSER_CLAIMED);
    await expect(
      service.completeClaim(
        failedCredential,
        active.users[0]!.id,
        [{ orgId: active.organization.id }],
        '198.51.100.21',
      ),
    ).rejects.toBeInstanceOf(MachineEnrollmentClaimRateLimitException);
  }, 30000);
});
