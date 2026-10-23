import * as crypto from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { MachineId, UserId } from '../../../types';
import { LegacyMachinePairingRetiredException } from '../../../common/exceptions/pairing.exceptions';
import { MachinePairingService } from '../machine-pairing.service';
import { MachineConnectionEvictionService } from '../../../core/websockets/machine-connection-eviction.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { EVENT_TYPES } from '../../../core/events/types/event.types';
import * as TestUtils from '../../../utils/testUtils';
import { TriggerEnvelopeSigner } from '../../../core/websockets/trigger-envelope-signer.service';
import { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { DemoSandboxActivityService } from '../../demo-sandbox/demo-sandbox-activity.service';

const { testIds } = TestUtils;

const TEST_MACHINE_ID = '00000000-0000-4000-8000-000000000001' as MachineId;
const TEST_USER_ID = testIds.user as UserId;

interface PairingCodeRow {
  id: string;
  code: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  machineId: string | null;
  createdAt: Date;
}

interface PairingAttemptRow {
  id: string;
  userId: string;
  attemptedAt: Date;
  succeeded: boolean;
}

const demoOwnerIds = new Set<string>();

interface MachineRow {
  id: string;
  userId: string;
  name: string;
  publicKey: string;
  tokenHash: string;
  pairedAt: Date;
  lastSeen: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organizationId?: string | null;
  authorizationProtocolVersion?: number | null;
}

describe('MachinePairingService', () => {
  let service: MachinePairingService;
  let machineConnectionEviction: jest.Mocked<
    Pick<MachineConnectionEvictionService, 'evictMachine'>
  >;
  let domainEventPublisher: jest.Mocked<Pick<DomainEventPublisher, 'publish'>>;
  let triggerEnvelopeSigner: jest.Mocked<
    Pick<TriggerEnvelopeSigner, 'signMachineRevocationReduction'>
  >;
  let websocketGateway: jest.Mocked<
    Pick<WebsocketGateway, 'emitAuthorityReductionWithAck'>
  >;
  let demoSandboxActivity: { recordActivity: jest.Mock };

  // In-memory tables backing the mock Prisma client
  let pairingCodes: PairingCodeRow[];
  let pairingAttempts: PairingAttemptRow[];
  let machines: MachineRow[];

  const buildPrismaMock = (): jest.Mocked<PrismaService> => {
    const pairingCode = {
      create: jest.fn(async ({ data }: { data: Partial<PairingCodeRow> }) => {
        const row: PairingCodeRow = {
          id: data.id ?? `pc-${pairingCodes.length + 1}`,
          code: data.code!,
          userId: data.userId!,
          expiresAt: data.expiresAt!,
          consumedAt: data.consumedAt ?? null,
          machineId: data.machineId ?? null,
          createdAt: data.createdAt ?? new Date(),
        };
        pairingCodes.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { code?: string; id?: string } }) => {
          if (where.code) {
            return pairingCodes.find((c) => c.code === where.code) ?? null;
          }
          if (where.id) {
            return pairingCodes.find((c) => c.id === where.id) ?? null;
          }
          return null;
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
          include,
        }: {
          where: { id?: string; userId?: string };
          include?: { machine?: boolean };
        }) => {
          const row =
            pairingCodes.find(
              (c) =>
                (where.id === undefined || c.id === where.id) &&
                (where.userId === undefined || c.userId === where.userId),
            ) ?? null;
          if (!row) return null;
          if (include?.machine) {
            const machine =
              machines.find((m) => m.id === row.machineId) ?? null;
            return { ...row, machine };
          }
          return row;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<PairingCodeRow>;
        }) => {
          const row = pairingCodes.find((c) => c.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      ),
    };

    const pairingAttempt = {
      count: jest.fn(
        async ({
          where,
        }: {
          where: {
            userId: string;
            attemptedAt?: { gte: Date };
            succeeded?: boolean;
          };
        }) => {
          const threshold = where.attemptedAt?.gte?.getTime() ?? 0;
          return pairingAttempts.filter(
            (a) =>
              a.userId === where.userId &&
              a.attemptedAt.getTime() >= threshold &&
              (where.succeeded === undefined ||
                a.succeeded === where.succeeded),
          ).length;
        },
      ),
      create: jest.fn(
        async ({ data }: { data: Partial<PairingAttemptRow> }) => {
          const row: PairingAttemptRow = {
            id: `pa-${pairingAttempts.length + 1}`,
            userId: data.userId!,
            attemptedAt: data.attemptedAt ?? new Date(),
            succeeded: data.succeeded ?? false,
          };
          pairingAttempts.push(row);
          return row;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<PairingAttemptRow>;
        }) => {
          const row = pairingAttempts.find((a) => a.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      ),
    };

    const machine = {
      create: jest.fn(async ({ data }: { data: Partial<MachineRow> }) => {
        const row: MachineRow = {
          id: data.id ?? `m-${machines.length + 1}`,
          userId: data.userId!,
          name: data.name ?? 'Machine',
          publicKey: data.publicKey!,
          tokenHash: data.tokenHash!,
          pairedAt: new Date(),
          lastSeen: null,
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        machines.push(row);
        return row;
      }),
      findMany: jest.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { userId: string; revokedAt?: Date | null };
          orderBy?: { pairedAt?: 'asc' | 'desc' };
        }) => {
          const filtered = machines.filter(
            (m) =>
              m.userId === where.userId &&
              (where.revokedAt === undefined ||
                m.revokedAt === where.revokedAt),
          );
          if (orderBy?.pairedAt === 'desc') {
            filtered.sort(
              (a, b) => b.pairedAt.getTime() - a.pairedAt.getTime(),
            );
          } else if (orderBy?.pairedAt === 'asc') {
            filtered.sort(
              (a, b) => a.pairedAt.getTime() - b.pairedAt.getTime(),
            );
          }
          return filtered;
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; userId?: string; revokedAt?: Date | null };
        }) => {
          return (
            machines.find(
              (m) =>
                (where.id === undefined || m.id === where.id) &&
                (where.userId === undefined || m.userId === where.userId) &&
                (where.revokedAt === undefined ||
                  m.revokedAt === where.revokedAt),
            ) ?? null
          );
        },
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
          const machine = machines.find(
            (m) =>
              (where.id === undefined || m.id === where.id) &&
              (where.tokenHash === undefined ||
                m.tokenHash === where.tokenHash),
          );
          return machine
            ? {
                ...machine,
                user: { isDemoUser: demoOwnerIds.has(machine.userId) },
              }
            : null;
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<MachineRow>;
        }) => {
          const row = machines.find((m) => m.id === where.id);
          if (!row) throw new Error('not found');
          Object.assign(row, data);
          return row;
        },
      ),
    };

    const executionGrant = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const transactionalDb = {
      pairingCode,
      pairingAttempt,
      machine,
      executionGrant,
    };

    const $transaction = jest.fn(
      async (fn: (tx: typeof transactionalDb) => Promise<unknown>) => {
        return fn(transactionalDb);
      },
    );

    const db = { ...transactionalDb, $transaction };

    return { db } as unknown as jest.Mocked<PrismaService>;
  };

  beforeEach(async () => {
    pairingCodes = [];
    pairingAttempts = [];
    machines = [];

    const mockPrisma = buildPrismaMock();

    machineConnectionEviction = {
      evictMachine: jest.fn().mockResolvedValue(0),
    };
    domainEventPublisher = {
      publish: jest.fn().mockResolvedValue('outbox-id'),
    };
    triggerEnvelopeSigner = {
      signMachineRevocationReduction: jest.fn().mockReturnValue({
        protocolVersion: 2,
        machineId: TEST_MACHINE_ID,
        userId: TEST_USER_ID,
        nonce: '00000000-0000-4000-8000-000000000006',
        timestampMs: Date.now(),
        signature: Buffer.alloc(64).toString('base64'),
        event: {
          version: 2,
          kind: 'machine_revocation_reduction',
          action: 'MACHINE_REVOKE',
          machineId: TEST_MACHINE_ID,
          revokedAt: new Date().toISOString(),
          executionReadiness: 'MACHINE_REVOKED',
        },
      }),
    };
    demoSandboxActivity = { recordActivity: jest.fn() };
    demoOwnerIds.clear();
    websocketGateway = {
      emitAuthorityReductionWithAck: jest.fn().mockResolvedValue({
        status: 'APPLIED',
        nonce: '00000000-0000-4000-8000-000000000006',
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        MachinePairingService,
        { provide: PrismaService, useValue: mockPrisma },
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
          useValue: machineConnectionEviction,
        },
        { provide: DomainEventPublisher, useValue: domainEventPublisher },
        { provide: TriggerEnvelopeSigner, useValue: triggerEnvelopeSigner },
        { provide: WebsocketGateway, useValue: websocketGateway },
        { provide: DemoSandboxActivityService, useValue: demoSandboxActivity },
      ],
    }).compile();

    service = moduleRef.get(MachinePairingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('legacy pairing retirement', () => {
    const validRegisterInput = {
      pairingCode: '123-456-789',
      publicKey: 'PEM-PUBLIC-KEY',
      machineId: TEST_MACHINE_ID,
      userId: TEST_USER_ID,
    };

    const expectRetired = async (operation: Promise<unknown>) => {
      await expect(operation).rejects.toBeInstanceOf(
        LegacyMachinePairingRetiredException,
      );
    };

    it('rejects issuance before generating or persisting a code', async () => {
      await expectRetired(service.issuePairingCode(TEST_USER_ID));

      expect(pairingCodes).toHaveLength(0);
      expect(pairingAttempts).toHaveLength(0);
      expect(machines).toHaveLength(0);
    });

    it('rejects registration before lookup, attempt recording, machine creation, or credential issuance', async () => {
      await expectRetired(service.registerMachine(validRegisterInput));

      expect(pairingCodes).toHaveLength(0);
      expect(pairingAttempts).toHaveLength(0);
      expect(machines).toHaveLength(0);
    });

    it('rejects status polling before looking up the code', async () => {
      await expectRetired(
        service.getPairingCodeStatus(TEST_USER_ID, 'pairing-code-id'),
      );

      expect(pairingCodes).toHaveLength(0);
      expect(pairingAttempts).toHaveLength(0);
      expect(machines).toHaveLength(0);
    });
  });

  describe('listMachines', () => {
    const OTHER_USER_ID = '11111111-1111-4111-8111-111111111111' as UserId;
    const MACHINE_A = '00000000-0000-4000-8000-0000000000a1' as MachineId;
    const MACHINE_B = '00000000-0000-4000-8000-0000000000b2' as MachineId;
    const MACHINE_REVOKED = '00000000-0000-4000-8000-0000000000c3' as MachineId;
    const MACHINE_OTHER = '00000000-0000-4000-8000-0000000000d4' as MachineId;

    const seedMachine = (overrides: Partial<MachineRow>): MachineRow => {
      const row: MachineRow = {
        id: overrides.id ?? `m-${machines.length + 1}`,
        userId: overrides.userId ?? TEST_USER_ID,
        name: overrides.name ?? 'Paired machine',
        publicKey: overrides.publicKey ?? 'PEM',
        tokenHash: overrides.tokenHash ?? `hash-${machines.length + 1}`,
        pairedAt: overrides.pairedAt ?? new Date(),
        lastSeen: overrides.lastSeen ?? null,
        revokedAt: overrides.revokedAt ?? null,
        createdAt: overrides.createdAt ?? new Date(),
        updatedAt: overrides.updatedAt ?? new Date(),
        organizationId: overrides.organizationId ?? null,
        authorizationProtocolVersion:
          overrides.authorizationProtocolVersion ?? null,
      };
      machines.push(row);
      return row;
    };

    it('returns only non-revoked machines for the calling user in pairedAt desc order', async () => {
      const olderPaired = new Date('2026-05-01T10:00:00.000Z');
      const newerPaired = new Date('2026-05-10T10:00:00.000Z');
      seedMachine({ id: MACHINE_A, pairedAt: olderPaired });
      seedMachine({ id: MACHINE_B, pairedAt: newerPaired });
      seedMachine({
        id: MACHINE_REVOKED,
        pairedAt: newerPaired,
        revokedAt: new Date(),
      });

      const result = await service.listMachines(TEST_USER_ID);

      expect(result.map((m) => m.machineId)).toEqual([MACHINE_B, MACHINE_A]);
      expect(result.every((m) => m.revokedAt === null)).toBe(true);
    });

    it('excludes machines owned by other users', async () => {
      seedMachine({ id: MACHINE_A });
      seedMachine({ id: MACHINE_OTHER, userId: OTHER_USER_ID });

      const result = await service.listMachines(TEST_USER_ID);

      expect(result.map((m) => m.machineId)).toEqual([MACHINE_A]);
    });
  });

  describe('revokeMachine', () => {
    const OTHER_USER_ID = '11111111-1111-4111-8111-111111111111' as UserId;
    const MACHINE_OWNED = '00000000-0000-4000-8000-0000000000a1' as MachineId;
    const MACHINE_MISSING = '00000000-0000-4000-8000-0000000000ff' as MachineId;
    const MACHINE_OTHER = '00000000-0000-4000-8000-0000000000d4' as MachineId;

    const seedMachine = (overrides: Partial<MachineRow>): MachineRow => {
      const row: MachineRow = {
        id: overrides.id ?? `m-${machines.length + 1}`,
        userId: overrides.userId ?? TEST_USER_ID,
        name: overrides.name ?? 'Paired machine',
        publicKey: overrides.publicKey ?? 'PEM',
        tokenHash: overrides.tokenHash ?? `hash-${machines.length + 1}`,
        pairedAt: overrides.pairedAt ?? new Date(),
        lastSeen: overrides.lastSeen ?? null,
        revokedAt: overrides.revokedAt ?? null,
        createdAt: overrides.createdAt ?? new Date(),
        updatedAt: overrides.updatedAt ?? new Date(),
        organizationId: overrides.organizationId ?? null,
        authorizationProtocolVersion:
          overrides.authorizationProtocolVersion ?? null,
      };
      machines.push(row);
      return row;
    };

    it('flips revokedAt to a non-null timestamp on the target row', async () => {
      seedMachine({ id: MACHINE_OWNED });
      const before = Date.now();

      await service.revokeMachine(TEST_USER_ID, MACHINE_OWNED);

      const row = machines.find((m) => m.id === MACHINE_OWNED)!;
      expect(row.revokedAt).not.toBeNull();
      expect(row.revokedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(row.revokedAt!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('force-disconnects the revoked machine and emits a machine.revoked event', async () => {
      seedMachine({ id: MACHINE_OWNED });

      await service.revokeMachine(TEST_USER_ID, MACHINE_OWNED);

      expect(machineConnectionEviction.evictMachine).toHaveBeenCalledWith(
        MACHINE_OWNED,
      );

      expect(domainEventPublisher.publish).toHaveBeenCalledTimes(1);
      const event = domainEventPublisher.publish.mock.calls[0]![0];
      expect(event.type).toBe(EVENT_TYPES.MACHINE.REVOKED);
      expect(event.aggregateId).toBe(MACHINE_OWNED);
      expect(event.payload).toMatchObject({
        machineId: MACHINE_OWNED,
        userId: TEST_USER_ID,
      });
      expect(typeof (event.payload as { revokedAt: string }).revokedAt).toBe(
        'string',
      );
    });

    it('offers a signed machine reduction for durable acknowledgement before disconnecting', async () => {
      seedMachine({
        id: MACHINE_OWNED,
        organizationId: '00000000-0000-4000-8000-000000000005',
        authorizationProtocolVersion: 2,
      });

      await service.revokeMachine(TEST_USER_ID, MACHINE_OWNED);

      expect(
        triggerEnvelopeSigner.signMachineRevocationReduction,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'machine_revocation_reduction',
          action: 'MACHINE_REVOKE',
          machineId: MACHINE_OWNED,
        }),
        MACHINE_OWNED,
        TEST_USER_ID,
      );
      expect(
        websocketGateway.emitAuthorityReductionWithAck,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'trigger.authority_reduction',
          organizationId: '00000000-0000-4000-8000-000000000005',
        }),
        5_000,
      );
      expect(
        websocketGateway.emitAuthorityReductionWithAck.mock
          .invocationCallOrder[0]!,
      ).toBeLessThan(
        machineConnectionEviction.evictMachine.mock.invocationCallOrder[0]!,
      );
    });

    it('does not force-disconnect or emit an event when the machine is not found', async () => {
      await service
        .revokeMachine(TEST_USER_ID, MACHINE_MISSING)
        .catch(() => {});

      expect(machineConnectionEviction.evictMachine).not.toHaveBeenCalled();
      expect(domainEventPublisher.publish).not.toHaveBeenCalled();
    });

    it('still completes revocation when the event emission fails', async () => {
      seedMachine({ id: MACHINE_OWNED });
      domainEventPublisher.publish.mockRejectedValueOnce(
        new Error('outbox down'),
      );

      await expect(
        service.revokeMachine(TEST_USER_ID, MACHINE_OWNED),
      ).resolves.toBeUndefined();

      // The row is revoked and the socket force-closed even though the feed
      // write threw — the event is best-effort.
      const row = machines.find((m) => m.id === MACHINE_OWNED)!;
      expect(row.revokedAt).not.toBeNull();
      expect(machineConnectionEviction.evictMachine).toHaveBeenCalledWith(
        MACHINE_OWNED,
      );
    });

    it('throws NotFoundException when the machine id does not exist', async () => {
      let thrown: NotFoundException | undefined;
      try {
        await service.revokeMachine(TEST_USER_ID, MACHINE_MISSING);
      } catch (err) {
        thrown = err as NotFoundException;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the machine belongs to another user (confused-deputy)', async () => {
      seedMachine({ id: MACHINE_OTHER, userId: OTHER_USER_ID });

      let thrown: NotFoundException | undefined;
      try {
        await service.revokeMachine(TEST_USER_ID, MACHINE_OTHER);
      } catch (err) {
        thrown = err as NotFoundException;
      }
      expect(thrown).toBeInstanceOf(NotFoundException);

      // The other user's machine must remain untouched.
      const row = machines.find((m) => m.id === MACHINE_OTHER)!;
      expect(row.revokedAt).toBeNull();
    });
  });

  describe('revokeAllForUserInTransaction', () => {
    const OTHER_USER_ID = '11111111-1111-4111-8111-111111111111' as UserId;
    const ORG_ID = '00000000-0000-4000-8000-000000000005';
    const MACHINE_A = '00000000-0000-4000-8000-0000000000a1' as MachineId;
    const MACHINE_B = '00000000-0000-4000-8000-0000000000a2' as MachineId;
    const MACHINE_REVOKED = '00000000-0000-4000-8000-0000000000a3' as MachineId;
    const MACHINE_OTHER = '00000000-0000-4000-8000-0000000000d4' as MachineId;
    const revokedAt = new Date('2026-10-17T00:00:00.000Z');

    const seed = (overrides: Partial<MachineRow> & { id: string }) => {
      machines.push({
        userId: TEST_USER_ID,
        name: 'Paired machine',
        publicKey: 'PEM',
        tokenHash: `hash-${overrides.id}`,
        pairedAt: new Date(),
        lastSeen: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId: ORG_ID,
        authorizationProtocolVersion: 2,
        ...overrides,
      });
    };

    const runInTransaction = <T>(
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> =>
      (service as unknown as { prisma: PrismaService }).prisma.db.$transaction(
        fn as never,
      ) as Promise<T>;

    it('revokes every live machine of the user and leaves other users untouched', async () => {
      seed({ id: MACHINE_A });
      seed({ id: MACHINE_B });
      seed({ id: MACHINE_OTHER, userId: OTHER_USER_ID });

      const reductions = await runInTransaction((tx) =>
        service.revokeAllForUserInTransaction(tx, TEST_USER_ID, revokedAt),
      );

      expect(reductions.map((r) => r.machineId)).toEqual([
        MACHINE_A,
        MACHINE_B,
      ]);
      expect(machines.find((m) => m.id === MACHINE_A)!.revokedAt).toEqual(
        revokedAt,
      );
      expect(machines.find((m) => m.id === MACHINE_B)!.revokedAt).toEqual(
        revokedAt,
      );
      expect(
        machines.find((m) => m.id === MACHINE_OTHER)!.revokedAt,
      ).toBeNull();
    });

    it('returns only newly revoked machines so a resumed sweep never redelivers', async () => {
      seed({ id: MACHINE_A });
      seed({
        id: MACHINE_REVOKED,
        revokedAt: new Date('2026-10-16T00:00:00.000Z'),
      });

      const reductions = await runInTransaction((tx) =>
        service.revokeAllForUserInTransaction(tx, TEST_USER_ID, revokedAt),
      );

      expect(reductions.map((r) => r.machineId)).toEqual([MACHINE_A]);
    });

    it('sends nothing and disconnects nothing inside the transaction', async () => {
      seed({ id: MACHINE_A });

      await runInTransaction((tx) =>
        service.revokeAllForUserInTransaction(tx, TEST_USER_ID, revokedAt),
      );

      expect(
        websocketGateway.emitAuthorityReductionWithAck,
      ).not.toHaveBeenCalled();
      expect(machineConnectionEviction.evictMachine).not.toHaveBeenCalled();
      expect(domainEventPublisher.publish).not.toHaveBeenCalled();
    });

    it('delivers the signed frame, then disconnects and emits per revoked machine after commit', async () => {
      seed({ id: MACHINE_A });
      seed({ id: MACHINE_B, authorizationProtocolVersion: 1 });
      const reductions = await runInTransaction((tx) =>
        service.revokeAllForUserInTransaction(tx, TEST_USER_ID, revokedAt),
      );

      await service.deliverRevocationReductions(TEST_USER_ID, reductions);

      expect(
        websocketGateway.emitAuthorityReductionWithAck,
      ).toHaveBeenCalledTimes(1);
      expect(
        websocketGateway.emitAuthorityReductionWithAck.mock
          .invocationCallOrder[0]!,
      ).toBeLessThan(
        machineConnectionEviction.evictMachine.mock.invocationCallOrder[0]!,
      );
      expect(machineConnectionEviction.evictMachine).toHaveBeenCalledWith(
        MACHINE_A,
      );
      expect(machineConnectionEviction.evictMachine).toHaveBeenCalledWith(
        MACHINE_B,
      );
      expect(domainEventPublisher.publish).toHaveBeenCalledTimes(2);
    });
  });

  describe('authenticateMachineCredential', () => {
    const MACHINE_OWNED = '00000000-0000-4000-8000-0000000000a1' as MachineId;
    const hashOf = (token: string) =>
      crypto.createHash('sha256').update(token).digest('hex');

    const seedMachine = (overrides: Partial<MachineRow>): MachineRow => {
      const row: MachineRow = {
        id: overrides.id ?? `m-${machines.length + 1}`,
        userId: overrides.userId ?? TEST_USER_ID,
        name: overrides.name ?? 'Paired machine',
        publicKey: overrides.publicKey ?? 'PEM',
        tokenHash: overrides.tokenHash ?? `hash-${machines.length + 1}`,
        pairedAt: overrides.pairedAt ?? new Date(),
        lastSeen: overrides.lastSeen ?? null,
        revokedAt: overrides.revokedAt ?? null,
        createdAt: overrides.createdAt ?? new Date(),
        updatedAt: overrides.updatedAt ?? new Date(),
      };
      machines.push(row);
      return row;
    };

    it('resolves a valid credential to its machine and owner via the token hash', async () => {
      const token = 'mch_valid_token';
      seedMachine({ id: MACHINE_OWNED, tokenHash: hashOf(token) });

      const result = await service.authenticateMachineCredential(token);

      expect(result).toEqual({
        machineId: MACHINE_OWNED,
        userId: TEST_USER_ID,
      });
    });

    it('records demo-sandbox activity for a demo owner of a valid credential only', async () => {
      const token = 'mch_active_token';
      demoOwnerIds.add(TEST_USER_ID);
      seedMachine({ id: MACHINE_OWNED, tokenHash: hashOf(token) });

      await service.authenticateMachineCredential(token);
      await service.authenticateMachineCredential('mch_unknown_token');

      expect(demoSandboxActivity.recordActivity).toHaveBeenCalledTimes(1);
      expect(demoSandboxActivity.recordActivity).toHaveBeenCalledWith(
        TEST_USER_ID,
      );
    });

    it('records no activity for a non-demo owner', async () => {
      const token = 'mch_plain_token';
      seedMachine({ id: MACHINE_OWNED, tokenHash: hashOf(token) });

      await service.authenticateMachineCredential(token);

      expect(demoSandboxActivity.recordActivity).not.toHaveBeenCalled();
    });

    it('records no activity for a revoked credential', async () => {
      const token = 'mch_revoked_token';
      seedMachine({
        id: MACHINE_OWNED,
        tokenHash: hashOf(token),
        revokedAt: new Date(),
      });

      await expect(
        service.authenticateMachineCredential(token),
      ).resolves.toBeNull();

      expect(demoSandboxActivity.recordActivity).not.toHaveBeenCalled();
    });

    it('returns null for an unknown credential', async () => {
      const result = await service.authenticateMachineCredential('mch_nope');
      expect(result).toBeNull();
    });

    it('returns null for a revoked credential', async () => {
      const token = 'mch_revoked_token';
      seedMachine({
        id: MACHINE_OWNED,
        tokenHash: hashOf(token),
        revokedAt: new Date(),
      });

      const result = await service.authenticateMachineCredential(token);
      expect(result).toBeNull();
    });
  });

  describe('rotateMachineKey', () => {
    const MACHINE_OWNED = '00000000-0000-4000-8000-0000000000a1' as MachineId;
    const MACHINE_MISSING = '00000000-0000-4000-8000-0000000000ff' as MachineId;
    const MACHINE_REVOKED = '00000000-0000-4000-8000-0000000000c3' as MachineId;

    const seedMachine = (overrides: Partial<MachineRow>): MachineRow => {
      const row: MachineRow = {
        id: overrides.id ?? `m-${machines.length + 1}`,
        userId: overrides.userId ?? TEST_USER_ID,
        name: overrides.name ?? 'Paired machine',
        publicKey: overrides.publicKey ?? 'OLD-PEM',
        tokenHash: overrides.tokenHash ?? `hash-${machines.length + 1}`,
        pairedAt: overrides.pairedAt ?? new Date(),
        lastSeen: overrides.lastSeen ?? null,
        revokedAt: overrides.revokedAt ?? null,
        createdAt: overrides.createdAt ?? new Date(),
        updatedAt: overrides.updatedAt ?? new Date(),
      };
      machines.push(row);
      return row;
    };

    it('overwrites the public key so the old key no longer verifies', async () => {
      seedMachine({ id: MACHINE_OWNED, publicKey: 'OLD-PEM' });

      const result = await service.rotateMachineKey(MACHINE_OWNED, 'NEW-PEM');

      expect(result.machineId).toBe(MACHINE_OWNED);
      expect(result.rotatedAt).toBeInstanceOf(Date);
      const row = machines.find((m) => m.id === MACHINE_OWNED)!;
      expect(row.publicKey).toBe('NEW-PEM');
    });

    it('throws NotFoundException for an unknown machine', async () => {
      await expect(
        service.rotateMachineKey(MACHINE_MISSING, 'NEW-PEM'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to rotate a revoked machine and leaves its key untouched', async () => {
      seedMachine({
        id: MACHINE_REVOKED,
        publicKey: 'OLD-PEM',
        revokedAt: new Date(),
      });

      await expect(
        service.rotateMachineKey(MACHINE_REVOKED, 'NEW-PEM'),
      ).rejects.toBeInstanceOf(NotFoundException);

      const row = machines.find((m) => m.id === MACHINE_REVOKED)!;
      expect(row.publicKey).toBe('OLD-PEM');
    });
  });
});
