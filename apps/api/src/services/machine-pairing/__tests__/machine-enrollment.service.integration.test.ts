import { ConfigService } from '@nestjs/config';
import { MachineEnrollmentState } from '@prisma/client';
import {
  createHash,
  createHmac,
  createPublicKey,
  generateKeyPairSync,
} from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { MachineConnectionEvictionService } from '../../../core/websockets/machine-connection-eviction.service';
import { MachineEnrollmentCreationRateLimitException } from '../../../common/exceptions/pairing.exceptions';
import {
  MachinePairingService,
  MACHINE_ENROLLMENT_ATTEMPT_LIMIT,
} from '../machine-pairing.service';
import { CreateMachineEnrollmentRequestDto } from '../../../generated';

const describeDatabase =
  process.env.RUN_MACHINE_ENROLLMENT_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase(
  'MachinePairingService machine enrollment PostgreSQL invariants',
  () => {
    const hmacKey =
      process.env.MACHINE_ENROLLMENT_CODE_HMAC_KEY ??
      'machine-enrollment-integration-test-key';
    let prisma: PrismaService;
    let service: MachinePairingService;
    const enrollmentIds = new Set<string>();
    const sourceAddresses = new Set<string>();
    let nextSourceOctet = 1;

    const makePublicKey = (): string => {
      const { publicKey } = generateKeyPairSync('ed25519');
      return publicKey.export({ format: 'pem', type: 'spki' }).toString();
    };

    const makeInput = (
      machinePublicKey = makePublicKey(),
    ): CreateMachineEnrollmentRequestDto => ({
      machinePublicKey,
      machineName: 'machine-enrollment-integration-test',
      osFamily: 'linux',
      cliVersion: '2.2.2',
      authorizationProtocolVersion: 2,
    });

    const makeSourceAddress = (): string => {
      const sourceAddress = `198.51.100.${nextSourceOctet}`;
      nextSourceOctet = (nextSourceOctet % 250) + 1;
      sourceAddresses.add(sourceAddress);
      return sourceAddress;
    };

    const createEnrollment = async (
      input: CreateMachineEnrollmentRequestDto,
      sourceAddress = makeSourceAddress(),
    ) => {
      const result = await service.createMachineEnrollment(
        input,
        sourceAddress,
      );
      enrollmentIds.add(result.enrollmentId);
      return result;
    };

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      service = new MachinePairingService(
        prisma,
        {} as MachineConnectionEvictionService,
        {} as DomainEventPublisher,
        new ConfigService({ MACHINE_ENROLLMENT_CODE_HMAC_KEY: hmacKey }),
        {} as never,
        {} as never,
        { recordActivity: jest.fn() } as never,
      );
    });

    afterEach(async () => {
      if (enrollmentIds.size > 0) {
        await prisma.db.pendingMachineEnrollment.deleteMany({
          where: { id: { in: [...enrollmentIds] } },
        });
        enrollmentIds.clear();
      }
      if (sourceAddresses.size > 0) {
        await prisma.db.machineEnrollmentCreationAttempt.deleteMany({
          where: { sourceAddress: { in: [...sourceAddresses] } },
        });
        sourceAddresses.clear();
      }
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    it('allows simultaneous short-lived requests for one fingerprint', async () => {
      const machinePublicKey = makePublicKey();
      const fingerprint = createHash('sha256')
        .update(
          createPublicKey(machinePublicKey).export({
            format: 'der',
            type: 'spki',
          }),
        )
        .digest('hex');
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          createEnrollment(makeInput(machinePublicKey)),
        ),
      );
      const successes = results.filter(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof createEnrollment>>
        > => result.status === 'fulfilled',
      );

      expect(successes).toHaveLength(8);

      const rows = await prisma.db.pendingMachineEnrollment.findMany({
        where: { machinePublicKeyFingerprint: fingerprint },
      });
      expect(rows).toHaveLength(8);
      expect(rows.every((row) => row.expiresAt > new Date())).toBe(true);
    }, 30000);

    it('counts the fifty-first source attempt and allows creation after the rolling window passes', async () => {
      const sourceAddress = makeSourceAddress();
      for (
        let index = 0;
        index < MACHINE_ENROLLMENT_ATTEMPT_LIMIT;
        index += 1
      ) {
        await createEnrollment(makeInput(), sourceAddress);
      }

      await expect(
        createEnrollment(makeInput(), sourceAddress),
      ).rejects.toBeInstanceOf(MachineEnrollmentCreationRateLimitException);

      await prisma.db.machineEnrollmentCreationAttempt.updateMany({
        where: { sourceAddress },
        data: { attemptedAt: new Date(Date.now() - 60 * 1000 - 1) },
      });

      await expect(
        createEnrollment(makeInput(), sourceAddress),
      ).resolves.toEqual(
        expect.objectContaining({ pollingIntervalSeconds: 5 }),
      );
    }, 30000);

    it('keeps coexisting fingerprint enrollments independent and stores only digests', async () => {
      const machinePublicKey = makePublicKey();
      const fingerprint = createHash('sha256')
        .update(
          createPublicKey(machinePublicKey).export({
            format: 'der',
            type: 'spki',
          }),
        )
        .digest('hex');
      const first = await createEnrollment(makeInput(machinePublicKey));
      await createEnrollment(makeInput(machinePublicKey));
      await createEnrollment(makeInput(machinePublicKey));

      await createEnrollment(makeInput(machinePublicKey));

      await prisma.db.pendingMachineEnrollment.update({
        where: { id: first.enrollmentId },
        data: { expiresAt: new Date(Date.now() - 1) },
      });

      const replacement = await createEnrollment(makeInput(machinePublicKey));
      const rows = await prisma.db.pendingMachineEnrollment.findMany({
        where: { machinePublicKeyFingerprint: fingerprint },
      });
      const expired = rows.find((row) => row.id === first.enrollmentId);
      expect(expired?.state).toBe(MachineEnrollmentState.PENDING);
      expect(
        rows.filter(
          (row) =>
            row.state === MachineEnrollmentState.PENDING &&
            row.expiresAt > new Date(),
        ),
      ).toHaveLength(4);

      const persisted =
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: replacement.enrollmentId },
        });
      expect(persisted.userCodeHmac).toBe(
        createHmac('sha256', hmacKey)
          .update(replacement.userCode.replace('-', ''))
          .digest('hex'),
      );
      expect(persisted.deviceSecretDigest).toBe(
        createHash('sha256')
          .update(Buffer.from(replacement.deviceSecret, 'base64'))
          .digest('hex'),
      );
      expect(persisted).not.toHaveProperty('userCode');
      expect(persisted).not.toHaveProperty('deviceSecret');
      expect(JSON.stringify(persisted)).not.toContain(replacement.userCode);
      expect(JSON.stringify(persisted)).not.toContain(replacement.deviceSecret);
    }, 30000);
  },
);
