import { ConfigService } from '@nestjs/config';
import { MachineEnrollmentState } from '@prisma/client';
import * as crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import {
  MachineEnrollmentAuthenticationFailedException,
  MachineEnrollmentInvalidTransitionException,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE,
} from '../../../common/exceptions/pairing.exceptions';
import { ServerSigningKeyService } from '../../../core/server-signing/server-signing-key.service';
import { canonicalizeJcs } from '../../../core/websockets/trigger-canonicalization';
import {
  ConfirmMachineEnrollmentRequestDto,
  MachineEnrollmentConfirmationPayloadDto,
  PollMachineEnrollmentRequestDto,
} from '@hey-hey/contracts/api/models';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../../types';
import { MachineEnrollmentConfirmationService } from '../machine-enrollment-confirmation.service';
import {
  FIRST_LOCAL_GRANT_OUTCOME_REASON,
  buildFirstLocalGrantIntent,
  firstLocalGrantChallenge,
  firstLocalGrantDescriptor,
  firstLocalGrantAction,
  hashControllerDeviceGrantDescriptor,
  newFirstLocalGrantNonce,
} from '../first-local-grant';

const describeDatabase =
  process.env.RUN_MACHINE_ENROLLMENT_CONFIRMATION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase(
  'MachineEnrollmentConfirmationService PostgreSQL invariants',
  () => {
    let prisma: PrismaService;
    let service: MachineEnrollmentConfirmationService;
    const enrollmentIds: string[] = [];
    const machineIds: string[] = [];
    const userIds: UserId[] = [];
    const organizationIds: OrganizationId[] = [];

    const makeFixture = async (
      state: MachineEnrollmentState = MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
    ) => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const user = await prisma.db.user.create({
        data: {
          id: randomUUID(),
          email: `confirmation-test-${randomUUID()}@example.com`,
          name: 'Confirmation Test User',
          passwordHash: 'integration-test-password-hash',
        },
      });
      userIds.push(user.id as UserId);
      const organization = await prisma.db.organization.create({
        data: {
          id: randomUUID(),
          name: `Confirmation Test ${randomUUID()}`,
          slug: `confirmation-test-${randomUUID()}`,
        },
      });
      organizationIds.push(organization.id as OrganizationId);
      await prisma.db.organizationMember.create({
        data: { userId: user.id, organizationId: organization.id },
      });

      const machineId = randomUUID();
      const enrollmentId = randomUUID();
      const secretBytes = crypto.randomBytes(32);
      const machinePublicKey = publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString();
      const machinePublicKeyFingerprint = crypto
        .createHash('sha256')
        .update(
          publicKey.export({
            format: 'der',
            type: 'spki',
          }),
        )
        .digest('hex');
      const confirmationNonce = randomUUID().replaceAll('-', '');
      enrollmentIds.push(enrollmentId);
      machineIds.push(machineId);
      const enrollment = await prisma.db.pendingMachineEnrollment.create({
        data: {
          id: enrollmentId,
          machineId,
          machinePublicKey,
          machinePublicKeyFingerprint,
          machineName: 'confirmation-test-machine',
          osFamily: 'linux',
          cliVersion: '2.2.2',
          authorizationProtocolVersion: 2,
          userCodeHmac: crypto.randomBytes(32).toString('hex'),
          deviceSecretDigest: crypto
            .createHash('sha256')
            .update(secretBytes)
            .digest('hex'),
          state,
          expiresAt: new Date(Date.now() + 300_000),
          claimantUserId: user.id,
          claimantOrganizationId: organization.id,
          controllerLabel: 'Confirmation browser',
          credentialId: `Y3JlZC${randomUUID().replaceAll('-', '')}`,
          credentialPublicKeyX: Buffer.alloc(32, 1),
          credentialPublicKeyY: Buffer.alloc(32, 2),
          credentialTransports: ['internal'],
          credentialAaguid: Buffer.alloc(16, 3),
          credentialSignCount: 1,
          credentialBackupEligible: true,
          credentialBackupState: false,
          credentialFingerprint: crypto.randomBytes(32).toString('hex'),
          credentialVerifiedAt: new Date(),
          webauthnChallenge: crypto.randomBytes(32).toString('base64url'),
          confirmationNonce,
          lastPolledAt: null,
        },
      });

      const confirmation: MachineEnrollmentConfirmationPayloadDto = {
        enrollmentId,
        machineId,
        accountId: user.id as UserId,
        organizationId: organization.id as OrganizationId,
        controllerCredentialId: enrollment.credentialId!,
        confirmationNonce,
      };
      const request: ConfirmMachineEnrollmentRequestDto = {
        deviceSecret: secretBytes.toString('base64'),
        confirmation,
        signature: crypto
          .sign(
            null,
            Buffer.from(canonicalizeJcs(confirmation), 'utf8'),
            privateKey,
          )
          .toString('base64'),
      };
      return { enrollment, request, machineId, privateKey, secretBytes };
    };

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      service = new MachineEnrollmentConfirmationService(
        prisma,
        new ServerSigningKeyService(new ConfigService()),
      );
    });

    afterEach(async () => {
      const cleanupEnrollmentIds = enrollmentIds.splice(0);
      const cleanupMachineIds = machineIds.splice(0);
      const cleanupOrganizationIds = organizationIds.splice(0);
      const cleanupUserIds = userIds.splice(0);

      if (cleanupMachineIds.length > 0) {
        await prisma.db.executionGrant.deleteMany({
          where: { machineId: { in: cleanupMachineIds } },
        });
        await prisma.db.executionAuthorization.deleteMany({
          where: { machineId: { in: cleanupMachineIds } },
        });
      }
      if (cleanupEnrollmentIds.length > 0) {
        await prisma.db.machineControllerCredential.deleteMany({
          where: { enrollmentId: { in: cleanupEnrollmentIds } },
        });
      }
      if (cleanupMachineIds.length > 0) {
        await prisma.db.machine.deleteMany({
          where: { id: { in: cleanupMachineIds } },
        });
      }
      if (cleanupEnrollmentIds.length > 0) {
        await prisma.db.pendingMachineEnrollment.deleteMany({
          where: { id: { in: cleanupEnrollmentIds } },
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
        await prisma.db.machineControllerCredential.count({
          where: { enrollmentId: { in: cleanupEnrollmentIds } },
        }),
      ).toBe(0);
      expect(
        await prisma.db.machine.count({
          where: { id: { in: cleanupMachineIds } },
        }),
      ).toBe(0);
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    /** Turns a fixture into a first-time local claim whose challenge committed to a grant. */
    const withFirstLocalGrant = async (
      fixture: Awaited<ReturnType<typeof makeFixture>>,
    ) => {
      const project = await prisma.db.project.create({
        data: {
          name: 'My First Project',
          organizationId: fixture.enrollment.claimantOrganizationId!,
          status: 'ONBOARDING',
        },
      });
      const issuedAt = new Date(Date.now() - 10_000);
      const intent = buildFirstLocalGrantIntent({
        enrollmentId: fixture.enrollment.id,
        machineId: fixture.machineId,
        userId: fixture.enrollment.claimantUserId!,
        organizationId: fixture.enrollment.claimantOrganizationId!,
        projectId: project.id,
        controllerInstallationId: randomUUID(),
        cadence: 'EIGHT_HOURS',
        issuedAt,
        nonce: newFirstLocalGrantNonce(),
      });
      await prisma.db.pendingMachineEnrollment.update({
        where: { id: fixture.enrollment.id },
        data: {
          controllerInstallationId: intent.controllerInstallationId,
          webauthnChallenge: firstLocalGrantChallenge(intent),
          challengeIssuedAt: issuedAt,
          requestedCadence: 'EIGHT_HOURS',
        },
      });
      const activationAt = new Date();
      const grantDescriptorHash = hashControllerDeviceGrantDescriptor(
        firstLocalGrantDescriptor(
          intent,
          fixture.enrollment.credentialId!,
          activationAt,
          firstLocalGrantAction(intent, randomUUID()),
        ),
      );
      const sign = (
        firstLocalGrant: MachineEnrollmentConfirmationPayloadDto['firstLocalGrant'],
      ): ConfirmMachineEnrollmentRequestDto => {
        const confirmation = {
          ...fixture.request.confirmation,
          firstLocalGrant,
        };
        return {
          ...fixture.request,
          confirmation,
          signature: crypto
            .sign(
              null,
              Buffer.from(canonicalizeJcs(confirmation), 'utf8'),
              fixture.privateKey,
            )
            .toString('base64'),
        };
      };
      return {
        intent,
        project,
        activationAt,
        request: sign({
          issuedAtMs: activationAt.getTime(),
          grantDescriptorHash,
        }),
        tampered: sign({
          issuedAtMs: activationAt.getTime(),
          grantDescriptorHash: 'f'.repeat(64),
        }),
      };
    };

    it('issues exactly one ordinary first grant with the activation the CLI signed for', async () => {
      const fixture = await makeFixture();
      const firstLocal = await withFirstLocalGrant(fixture);

      const ready = await service.poll(fixture.enrollment.id, {
        deviceSecret: fixture.request.deviceSecret,
      });
      expect(ready).toMatchObject({
        state: 'ready',
        firstLocalGrant: {
          cadence: 'EIGHT_HOURS',
          projectId: firstLocal.project.id,
        },
      });

      const activation = await service.confirm(
        fixture.enrollment.id,
        firstLocal.request,
      );
      const grant = await prisma.db.executionGrant.findUniqueOrThrow({
        where: { id: activation.firstLocalGrant!.grantId },
        include: { authorization: true },
      });
      expect(grant).toMatchObject({
        scope: 'CONTROLLER_DEVICE_WINDOW',
        cadence: 'EIGHT_HOURS',
        machineId: fixture.machineId,
        projectId: firstLocal.project.id,
        controllerInstallationId: firstLocal.intent.controllerInstallationId,
        targetKind: 'CLI_READ',
        targetId: fixture.machineId,
        issuedAt: firstLocal.activationAt,
        expiresAt: new Date(
          firstLocal.activationAt.getTime() + 8 * 60 * 60 * 1000,
        ),
        // Distinguishable from assertion-backed authorizations.
        authorization: {
          outcome: 'ADMITTED',
          outcomeReason: FIRST_LOCAL_GRANT_OUTCOME_REASON,
          assertionEvidence: null,
          actionType: 'CLI_READ',
        },
      });
      expect(
        hashControllerDeviceGrantDescriptor(
          activation.firstLocalGrant!.grantDescriptor,
        ),
      ).toBe(
        firstLocal.request.confirmation.firstLocalGrant!.grantDescriptorHash,
      );

      await expect(
        service.confirm(fixture.enrollment.id, firstLocal.request),
      ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
      expect(
        await prisma.db.executionGrant.count({
          where: { machineId: fixture.machineId },
        }),
      ).toBe(1);
    });

    it('rejects a signed descriptor the claim did not commit to and issues nothing', async () => {
      const fixture = await makeFixture();
      const firstLocal = await withFirstLocalGrant(fixture);

      await expect(
        service.confirm(fixture.enrollment.id, firstLocal.tampered),
      ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
      expect(
        await prisma.db.executionGrant.count({
          where: { machineId: fixture.machineId },
        }),
      ).toBe(0);

      // Without a grant in the signed confirmation the same claim pairs with none.
      await service.confirm(fixture.enrollment.id, fixture.request);
      expect(
        await prisma.db.executionGrant.count({
          where: { machineId: fixture.machineId },
        }),
      ).toBe(0);
    });

    it('persists state-only polling, a stable nonce, and ready review evidence', async () => {
      const fixture = await makeFixture(MachineEnrollmentState.PENDING);
      const input: PollMachineEnrollmentRequestDto = {
        deviceSecret: fixture.request.deviceSecret,
      };

      await expect(service.poll(fixture.enrollment.id, input)).resolves.toEqual(
        { state: 'pending' },
      );
      await expect(
        service.poll(fixture.enrollment.id, input),
      ).rejects.toBeInstanceOf(MachineEnrollmentInvalidTransitionException);

      await prisma.db.pendingMachineEnrollment.update({
        where: { id: fixture.enrollment.id },
        data: {
          state: MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
          lastPolledAt: new Date(Date.now() - 5_001),
          confirmationNonce: null,
        },
      });
      const ready = await service.poll(fixture.enrollment.id, input);
      expect(ready).toMatchObject({
        state: 'ready',
        enrollmentId: fixture.enrollment.id,
        machineId: fixture.machineId,
      });
      const persisted =
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: fixture.enrollment.id },
        });
      expect(persisted.confirmationNonce).toEqual(expect.any(String));
      expect(persisted.lastPolledAt).not.toBeNull();
    }, 30000);

    it('delivers a local account-mismatch warning once to the authenticated device', async () => {
      const fixture = await makeFixture(MachineEnrollmentState.PENDING);
      await prisma.db.pendingMachineEnrollment.update({
        where: { id: fixture.enrollment.id },
        data: {
          localOutcomeCode: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
          localOutcomeIssuedAt: new Date(),
        },
      });

      await expect(
        service.poll(fixture.enrollment.id, {
          deviceSecret: Buffer.alloc(32, 8).toString('base64'),
        }),
      ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
      expect(
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: fixture.enrollment.id },
        }),
      ).toMatchObject({ localOutcomeConsumedAt: null });

      await expect(
        service.poll(fixture.enrollment.id, {
          deviceSecret: fixture.request.deviceSecret,
        }),
      ).resolves.toEqual({
        state: 'warning',
        code: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
        message: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE,
      });

      const consumed =
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: fixture.enrollment.id },
        });
      expect(consumed.localOutcomeConsumedAt).not.toBeNull();

      await prisma.db.pendingMachineEnrollment.update({
        where: { id: fixture.enrollment.id },
        data: { lastPolledAt: new Date(Date.now() - 6_000) },
      });
      await expect(
        service.poll(fixture.enrollment.id, {
          deviceSecret: fixture.request.deviceSecret,
        }),
      ).resolves.toEqual({ state: 'pending' });
    }, 30000);

    it('races confirmation and returns plaintext credential to at most one winner', async () => {
      const fixture = await makeFixture();
      const results = await Promise.allSettled([
        service.confirm(fixture.enrollment.id, fixture.request),
        service.confirm(fixture.enrollment.id, fixture.request),
      ]);

      const winners = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<MachineEnrollmentConfirmationService['confirm']>>
        > => result.status === 'fulfilled',
      );
      expect(winners).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);

      const machines = await prisma.db.machine.findMany({
        where: { id: fixture.machineId },
      });
      const bindings = await prisma.db.machineControllerCredential.findMany({
        where: { enrollmentId: fixture.enrollment.id },
      });
      expect(machines).toHaveLength(1);
      expect(bindings).toHaveLength(1);
      expect(machines[0]!.tokenHash).toBe(
        crypto
          .createHash('sha256')
          .update(winners[0]!.value.machineCredential)
          .digest('hex'),
      );
      expect(JSON.stringify(machines[0])).not.toContain(
        winners[0]!.value.machineCredential,
      );
      const persisted =
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: fixture.enrollment.id },
        });
      expect(persisted.state).toBe(MachineEnrollmentState.CONSUMED);

      await expect(
        service.confirm(fixture.enrollment.id, fixture.request),
      ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
    }, 30000);

    it('rejects expired and substituted confirmations without creating rows', async () => {
      const expired = await makeFixture();
      await prisma.db.pendingMachineEnrollment.update({
        where: { id: expired.enrollment.id },
        data: {
          createdAt: new Date(Date.now() - 300_000),
          expiresAt: new Date(Date.now() - 1),
        },
      });
      await expect(
        service.confirm(expired.enrollment.id, expired.request),
      ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);

      const substituted = await makeFixture();
      const altered = {
        ...substituted.request,
        confirmation: {
          ...substituted.request.confirmation,
          organizationId: randomUUID() as OrganizationId,
        },
      };
      await expect(
        service.confirm(substituted.enrollment.id, altered),
      ).rejects.toBeInstanceOf(MachineEnrollmentAuthenticationFailedException);
      expect(
        await prisma.db.machine.count({ where: { id: substituted.machineId } }),
      ).toBe(0);
    }, 30000);

    it('wins cleanly against a concurrent expiry transition', async () => {
      const fixture = await makeFixture();
      const expiresAt = new Date(Date.now() - 1);
      const expiry = prisma.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${fixture.enrollment.id}, 21))`;
        await tx.pendingMachineEnrollment.update({
          where: { id: fixture.enrollment.id },
          data: {
            createdAt: new Date(Date.now() - 300_000),
            expiresAt,
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        await tx.pendingMachineEnrollment.updateMany({
          where: {
            id: fixture.enrollment.id,
            state: MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
            expiresAt: { lte: new Date() },
          },
          data: {
            state: MachineEnrollmentState.EXPIRED,
            expiredAt: new Date(),
          },
        });
      });

      const results = await Promise.allSettled([
        expiry,
        service.confirm(fixture.enrollment.id, fixture.request),
      ]);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ status: 'fulfilled' });
      if (results[1]?.status === 'rejected') {
        expect(results[1].reason).toBeInstanceOf(
          MachineEnrollmentAuthenticationFailedException,
        );
      }

      const machineCount = await prisma.db.machine.count({
        where: { id: fixture.machineId },
      });
      const bindingCount = await prisma.db.machineControllerCredential.count({
        where: { enrollmentId: fixture.enrollment.id },
      });
      expect(machineCount).toBeLessThanOrEqual(1);
      expect(bindingCount).toBe(machineCount);
      if (machineCount === 0) {
        expect(
          await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
            where: { id: fixture.enrollment.id },
          }),
        ).toMatchObject({ state: MachineEnrollmentState.EXPIRED });
      }
    }, 30000);
  },
);
