import { ConfigService } from '@nestjs/config';
import { MachineEnrollmentState } from '@prisma/client';
import { generateKeyPairSync } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { MachineConnectionEvictionService } from '../../../core/websockets/machine-connection-eviction.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { TriggerEnvelopeSigner } from '../../../core/websockets/trigger-envelope-signer.service';
import { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { DemoSandboxActivityService } from '../../demo-sandbox/demo-sandbox-activity.service';
import {
  InvalidMachineEnrollmentMaterialException,
  MachineEnrollmentCreationRateLimitException,
} from '../../../common/exceptions/pairing.exceptions';
import {
  MachinePairingService,
  MACHINE_ENROLLMENT_ATTEMPT_LIMIT,
} from '../machine-pairing.service';
import { CreateMachineEnrollmentRequestDto } from '../../../generated';

interface AttemptRow {
  sourceAddress: string;
  attemptedAt: Date;
}

interface EnrollmentRow {
  id: string;
  machineId: string;
  machinePublicKey: string;
  machinePublicKeyFingerprint: string;
  machineName: string;
  osFamily: string;
  cliVersion: string;
  authorizationProtocolVersion: number;
  userCodeHmac: string;
  deviceSecretDigest: string;
  state: MachineEnrollmentState;
  expiresAt: Date;
  createdAt: Date;
  expiredAt: Date | null;
}

describe('MachinePairingService machine enrollment creation', () => {
  let service: MachinePairingService;
  let loggerLog: jest.SpyInstance;
  let attempts: AttemptRow[];
  let enrollments: EnrollmentRow[];

  const makePublicKey = (): string => {
    const { publicKey } = generateKeyPairSync('ed25519');
    return publicKey.export({ format: 'pem', type: 'spki' }).toString();
  };

  const makeInput = (
    overrides: Partial<CreateMachineEnrollmentRequestDto> = {},
  ): CreateMachineEnrollmentRequestDto => ({
    machinePublicKey: makePublicKey(),
    machineName: 'test-machine',
    osFamily: 'linux',
    cliVersion: '2.2.2',
    authorizationProtocolVersion: 2,
    ...overrides,
  });

  beforeEach(async () => {
    attempts = [];
    enrollments = [];

    const machineEnrollmentCreationAttempt = {
      create: jest.fn(async ({ data }: { data: AttemptRow }) => {
        attempts.push(data);
        return data;
      }),
      count: jest.fn(
        async ({
          where,
        }: {
          where: { sourceAddress: string; attemptedAt: { gte: Date } };
        }) =>
          attempts.filter(
            (attempt) =>
              attempt.sourceAddress === where.sourceAddress &&
              attempt.attemptedAt >= where.attemptedAt.gte,
          ).length,
      ),
    };

    const pendingMachineEnrollment = {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            machinePublicKeyFingerprint: string;
            state: { in: MachineEnrollmentState[] };
            expiresAt: { lte: Date };
          };
          data: { state: MachineEnrollmentState; expiredAt: Date };
        }) => {
          let count = 0;
          for (const enrollment of enrollments) {
            if (
              enrollment.machinePublicKeyFingerprint ===
                where.machinePublicKeyFingerprint &&
              where.state.in.includes(enrollment.state) &&
              enrollment.expiresAt <= where.expiresAt.lte
            ) {
              enrollment.state = data.state;
              enrollment.expiredAt = data.expiredAt;
              count += 1;
            }
          }
          return { count };
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            machinePublicKeyFingerprint: string;
            state: { in: MachineEnrollmentState[] };
            expiresAt: { gt: Date };
          };
        }) =>
          enrollments.filter(
            (enrollment) =>
              enrollment.machinePublicKeyFingerprint ===
                where.machinePublicKeyFingerprint &&
              where.state.in.includes(enrollment.state) &&
              enrollment.expiresAt > where.expiresAt.gt,
          ).length,
      ),
      create: jest.fn(async ({ data }: { data: Omit<EnrollmentRow, 'id'> }) => {
        const row = {
          id: `enrollment-${enrollments.length + 1}`,
          ...data,
          expiredAt: null,
        };
        enrollments.push(row);
        return row;
      }),
    };

    const transactionalDb = {
      machineEnrollmentCreationAttempt,
      pendingMachineEnrollment,
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      db: {
        ...transactionalDb,
        $transaction: jest.fn(
          async (callback: (tx: typeof transactionalDb) => Promise<unknown>) =>
            callback(transactionalDb),
        ),
      },
    } as unknown as PrismaService;

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MachinePairingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'MACHINE_ENROLLMENT_CODE_HMAC_KEY'
                ? 'test-machine-enrollment-hmac-key'
                : undefined,
            ),
          },
        },
        {
          provide: MachineConnectionEvictionService,
          useValue: { evictMachine: jest.fn() },
        },
        { provide: DomainEventPublisher, useValue: { publish: jest.fn() } },
        { provide: TriggerEnvelopeSigner, useValue: { sign: jest.fn() } },
        { provide: WebsocketGateway, useValue: {} },
        {
          provide: DemoSandboxActivityService,
          useValue: { recordActivity: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(MachinePairingService);
    loggerLog = jest
      .spyOn(
        (
          service as unknown as {
            logger: { log: (...args: unknown[]) => void };
          }
        ).logger,
        'log',
      )
      .mockImplementation(() => undefined);
  });

  it('returns plaintext issuance values once and persists only one-way representations', async () => {
    const result = await service.createMachineEnrollment(
      makeInput(),
      '::ffff:192.0.2.1',
    );

    expect(result.machineId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.userCode).toMatch(
      /^[BCDFGHJKLMNPQRSTVWXZ]{5}-[BCDFGHJKLMNPQRSTVWXZ]{5}$/,
    );
    expect(Buffer.from(result.deviceSecret, 'base64')).toHaveLength(32);
    expect(result.pollingIntervalSeconds).toBe(5);

    const row = enrollments[0]!;
    expect(row.machineId).toBe(result.machineId);
    expect(row.userCodeHmac).toHaveLength(64);
    expect(row.deviceSecretDigest).toHaveLength(64);
    expect(row).not.toHaveProperty('userCode');
    expect(row).not.toHaveProperty('deviceSecret');
    expect(JSON.stringify(row)).not.toContain(result.userCode);
    expect(JSON.stringify(row)).not.toContain(result.deviceSecret);
    expect(loggerLog).toHaveBeenCalledWith(
      'Machine enrollment created',
      expect.objectContaining({
        event: 'machine_enrollment.creation',
        operation: 'machine_enrollment',
        protocolVersion: 2,
        contractVersion: 'machine-enrollment-v2',
        enrollmentId: row.id,
        machineId: result.machineId,
        state: MachineEnrollmentState.PENDING,
        decision: 'created',
        reasonCode: 'enrollment_created',
      }),
    );
    expect(JSON.stringify(loggerLog.mock.calls)).not.toContain(result.userCode);
    expect(JSON.stringify(loggerLog.mock.calls)).not.toContain(
      result.deviceSecret,
    );
  });

  it('allows fifty creations per source in a rolling minute and rejects the next', async () => {
    for (let index = 0; index < MACHINE_ENROLLMENT_ATTEMPT_LIMIT; index += 1) {
      await service.createMachineEnrollment(makeInput(), '203.0.113.9');
    }

    await expect(
      service.createMachineEnrollment(makeInput(), '203.0.113.9'),
    ).rejects.toBeInstanceOf(MachineEnrollmentCreationRateLimitException);
    expect(attempts).toHaveLength(MACHINE_ENROLLMENT_ATTEMPT_LIMIT + 1);
    expect(enrollments).toHaveLength(MACHINE_ENROLLMENT_ATTEMPT_LIMIT);
  });

  it('allows multiple short-lived enrollments for the same machine fingerprint', async () => {
    const machinePublicKey = makePublicKey();
    const input = () => makeInput({ machinePublicKey });

    await service.createMachineEnrollment(input(), '192.0.2.11');
    await service.createMachineEnrollment(input(), '192.0.2.12');
    await service.createMachineEnrollment(input(), '192.0.2.13');

    await expect(
      service.createMachineEnrollment(input(), '192.0.2.14'),
    ).resolves.toMatchObject({ machineId: expect.any(String) });

    enrollments[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(
      service.createMachineEnrollment(input(), '192.0.2.15'),
    ).resolves.toMatchObject({ machineId: expect.any(String) });

    expect(
      enrollments.filter((row) => row.state === MachineEnrollmentState.PENDING),
    ).toHaveLength(5);
  });

  it('rejects malformed or non-Ed25519 public material without echoing it', async () => {
    const privateMaterial = generateKeyPairSync('ed25519')
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();

    await expect(
      service.createMachineEnrollment(
        makeInput({ machinePublicKey: privateMaterial }),
        '198.51.100.4',
      ),
    ).rejects.toBeInstanceOf(InvalidMachineEnrollmentMaterialException);
    expect(enrollments).toHaveLength(0);
  });
});
