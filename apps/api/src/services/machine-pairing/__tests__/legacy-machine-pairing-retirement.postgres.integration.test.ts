import { ConfigService } from '@nestjs/config';
import { MachineAuthorizationState } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { DomainEventPublisher } from '../../../core/events/domain-event-publisher';
import { MachineConnectionEvictionService } from '../../../core/websockets/machine-connection-eviction.service';
import { MachinePairingService } from '../machine-pairing.service';
import { MachineExecutionReadinessService } from '../machine-execution-readiness.service';
import { MachineId, UserId } from '../../../types';

const describeDatabase =
  process.env.RUN_LEGACY_MACHINE_PAIRING_RETIREMENT_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('legacy machine pairing retirement PostgreSQL cutover', () => {
  const migrationSql = readFileSync(
    resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'db/flyway/V2026.08.18.3__retire_legacy_machine_pairing.sql',
    ),
    'utf8',
  );

  let prisma: PrismaService;
  const userIds: UserId[] = [];
  const machineIds: MachineId[] = [];
  const pairingCodeIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    if (pairingCodeIds.length > 0) {
      await prisma.db.pairingCode.deleteMany({
        where: { id: { in: pairingCodeIds.splice(0) } },
      });
    }
    if (machineIds.length > 0) {
      const cleanupMachineIds = machineIds.splice(0);
      await prisma.db.machineSecurityEvent.deleteMany({
        where: { machineId: { in: cleanupMachineIds } },
      });
      await prisma.db.machine.deleteMany({
        where: { id: { in: cleanupMachineIds } },
      });
    }
    if (userIds.length > 0) {
      await prisma.db.user.deleteMany({
        where: { id: { in: userIds.splice(0) } },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('repeatedly retires live and expired codes while preserving machines and audit history', async () => {
    const user = await prisma.db.user.create({
      data: {
        id: randomUUID(),
        email: `legacy-retirement-${randomUUID()}@example.com`,
        name: 'Legacy retirement integration test',
        passwordHash: 'integration-test-password-hash',
      },
    });
    userIds.push(user.id as UserId);

    const activeMachine = await prisma.db.machine.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        name: 'active legacy machine',
        publicKey: 'legacy-active-public-key',
        tokenHash: `legacy-active-${randomUUID()}`,
        authorizationProtocolVersion: 1,
        authorizationState: MachineAuthorizationState.LEGACY,
      },
    });
    const revokedMachine = await prisma.db.machine.create({
      data: {
        id: randomUUID(),
        userId: user.id,
        name: 'revoked legacy machine',
        publicKey: 'legacy-revoked-public-key',
        tokenHash: `legacy-revoked-${randomUUID()}`,
        authorizationProtocolVersion: 1,
        authorizationState: MachineAuthorizationState.LEGACY,
        revokedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
    machineIds.push(
      activeMachine.id as MachineId,
      revokedMachine.id as MachineId,
    );

    await prisma.db.machineSecurityEvent.createMany({
      data: [activeMachine, revokedMachine].map((machine) => ({
        id: `retirement-audit-${machine.id}`,
        machineId: machine.id,
        eventType: 'legacy_pairing_attempt',
        occurredAt: new Date('2026-08-01T00:00:00.000Z'),
        detail: 'retained audit evidence',
      })),
    });

    const pairingCodes = await Promise.all(
      [new Date(Date.now() + 60_000), new Date(Date.now() - 60_000)].map(
        (expiresAt, index) =>
          prisma.db.pairingCode.create({
            data: {
              id: randomUUID(),
              code: `RETIRE-${randomUUID()}-${index}`,
              userId: user.id,
              expiresAt,
            },
          }),
      ),
    );
    pairingCodeIds.push(...pairingCodes.map((code) => code.id));

    await prisma.db.$executeRawUnsafe(migrationSql);
    const firstCut = await prisma.db.machine.findMany({
      where: { id: { in: machineIds } },
      orderBy: { name: 'asc' },
    });
    const firstCodeCut = await prisma.db.pairingCode.findMany({
      where: { id: { in: pairingCodeIds } },
      orderBy: { createdAt: 'asc' },
    });
    const firstAuditCount = await prisma.db.machineSecurityEvent.count({
      where: { machineId: { in: machineIds } },
    });

    await prisma.db.$executeRawUnsafe(migrationSql);
    const secondCut = await prisma.db.machine.findMany({
      where: { id: { in: machineIds } },
      orderBy: { name: 'asc' },
    });
    const secondCodeCut = await prisma.db.pairingCode.findMany({
      where: { id: { in: pairingCodeIds } },
      orderBy: { createdAt: 'asc' },
    });

    expect(firstCodeCut).toHaveLength(2);
    expect(firstCodeCut.every((code) => code.consumedAt)).toBe(true);
    expect(secondCodeCut.map((code) => code.consumedAt)).toEqual(
      firstCodeCut.map((code) => code.consumedAt),
    );
    expect(firstCut).toHaveLength(2);
    expect(
      firstCut.find((machine) => machine.id === activeMachine.id),
    ).toMatchObject({
      id: activeMachine.id,
      userId: user.id,
      authorizationProtocolVersion: 1,
      authorizationState:
        MachineAuthorizationState.CONTROLLER_ENROLLMENT_REQUIRED,
      revokedAt: null,
    });
    expect(
      firstCut.find((machine) => machine.id === revokedMachine.id),
    ).toMatchObject({
      id: revokedMachine.id,
      userId: user.id,
      authorizationProtocolVersion: 1,
      revokedAt: revokedMachine.revokedAt,
    });
    expect(secondCut).toEqual(firstCut);
    expect(
      await prisma.db.machineSecurityEvent.count({
        where: { machineId: { in: machineIds } },
      }),
    ).toBe(firstAuditCount);
    expect(firstAuditCount).toBe(2);

    const disconnectMachine = jest.fn().mockResolvedValue(0);
    const publish = jest.fn().mockResolvedValue('audit-event');
    const pairing = new MachinePairingService(
      prisma,
      {
        evictMachine: disconnectMachine,
      } as never as MachineConnectionEvictionService,
      { publish } as never as DomainEventPublisher,
      new ConfigService({
        MACHINE_ENROLLMENT_CODE_HMAC_KEY: 'legacy-retirement-test-key',
      }),
      {} as never,
      {} as never,
      { recordActivity: jest.fn() } as never,
    );
    await expect(pairing.listMachines(user.id as UserId)).resolves.toEqual([
      expect.objectContaining({
        machineId: activeMachine.id,
        authorizationProtocolVersion: 1,
        revokedAt: null,
      }),
    ]);

    const readiness = new MachineExecutionReadinessService(prisma, {
      isPresent: jest.fn().mockResolvedValue(true),
    } as never);
    await expect(
      readiness.resolve({
        machineId: activeMachine.id as MachineId,
        userId: user.id as UserId,
      }),
    ).resolves.toMatchObject({ executionReadiness: 'LEGACY_PROTOCOL' });

    await pairing.revokeMachine(
      user.id as UserId,
      activeMachine.id as MachineId,
    );

    const retained = await prisma.db.machine.findUniqueOrThrow({
      where: { id: activeMachine.id },
    });
    expect(retained.revokedAt).not.toBeNull();
    expect(
      await prisma.db.machineSecurityEvent.count({
        where: { machineId: activeMachine.id },
      }),
    ).toBe(1);
    expect(disconnectMachine).toHaveBeenCalledWith(activeMachine.id);
  }, 30000);
});
