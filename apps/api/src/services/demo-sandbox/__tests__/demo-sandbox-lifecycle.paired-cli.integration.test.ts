import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { UnauthorizedException } from '@nestjs/common';
import { DemoSandboxStatus } from '@prisma/client';
import * as crypto from 'crypto';
import { MachineCredentialGuard } from '../../../auth/guards/machine-credential.guard';
import { MachinePairingService } from '../../machine-pairing/machine-pairing.service';
import { DemoSandboxActivityService } from '../demo-sandbox-activity.service';
import { DemoSandboxLifecycleService } from '../demo-sandbox-lifecycle.service';

interface ActivityWhere {
  demoUserId: string;
  status: DemoSandboxStatus;
  expiresAt: { gt: Date };
  OR: [unknown, { lastActivityAt: { lte: Date } }];
}
interface ActivityData {
  lastActivityAt: Date;
  expiresAt: Date;
}

const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-10-17T09:00:00.000Z');
const DEMO_USER = 'demo-user-1';
const MACHINE = 'machine-1';
const ORG = 'org-1';
const CREDENTIAL = 'mch_paired_cli_credential';

/**
 * A paired CLI of a demo user against the real activity, lifecycle, machine
 * pairing and credential-guard code, with only the database and the
 * websocket/deletion boundaries faked.
 */
function build() {
  const sandbox = {
    id: 'sandbox-1',
    status: DemoSandboxStatus.ACTIVE as DemoSandboxStatus,
    organizationId: ORG,
    demoUserId: DEMO_USER as string | null,
    lastActivityAt: T0 as Date | null,
    expiresAt: new Date(T0.getTime() + 2 * HOUR),
  };
  const machine = {
    id: MACHINE,
    userId: DEMO_USER,
    organizationId: ORG,
    authorizationProtocolVersion: 2,
    tokenHash: crypto.createHash('sha256').update(CREDENTIAL).digest('hex'),
    revokedAt: null as Date | null,
  };
  const closure = { closed: false, stage: 'PENDING' };
  const frames: unknown[] = [];

  const tx = {
    $queryRaw: jest.fn(async () => [sandbox]),
    $executeRaw: jest.fn(async () => 0),
    machine: {
      findUnique: jest.fn(async () => ({
        id: machine.id,
        userId: machine.userId,
        revokedAt: machine.revokedAt,
        user: { isDemoUser: true },
      })),
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        machine.userId === where.userId && machine.revokedAt === null
          ? [machine]
          : [],
      ),
      update: jest.fn(async ({ data }: { data: { revokedAt: Date } }) => {
        machine.revokedAt = data.revokedAt;
        return machine;
      }),
    },
    machineControllerCredential: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    executionGrant: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    demoSandbox: {
      findUnique: jest.fn(async () => ({ demoUserId: sandbox.demoUserId })),
      updateMany: jest.fn(async () => {
        sandbox.status = DemoSandboxStatus.DELETED;
        sandbox.demoUserId = null;
        return { count: 1 };
      }),
    },
    user: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $executeRaw: jest.fn(async () => {
      // Claim: ACTIVE rows past their deadline become EXPIRING.
      if (
        sandbox.status === DemoSandboxStatus.ACTIVE &&
        sandbox.expiresAt.getTime() <= Date.now()
      ) {
        sandbox.status = DemoSandboxStatus.EXPIRING;
        return 1;
      }
      return 0;
    }),
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    demoSandbox: {
      // Activity: the conditional refresh.
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: ActivityWhere;
          data: ActivityData;
        }) => {
          const refreshable =
            sandbox.demoUserId === where.demoUserId &&
            sandbox.status === where.status &&
            sandbox.expiresAt.getTime() > where.expiresAt.gt.getTime() &&
            (sandbox.lastActivityAt === null ||
              sandbox.lastActivityAt.getTime() <=
                where.OR[1].lastActivityAt.lte.getTime());
          if (!refreshable) return { count: 0 };
          sandbox.lastActivityAt = data.lastActivityAt;
          sandbox.expiresAt = data.expiresAt;
          return { count: 1 };
        },
      ),
    },
    // The stage queries of the sweep, told apart by the clause that selects them.
    $queryRaw: jest.fn(async (query: { strings: string[] }) => {
      const sql = query.strings.join('?');
      const expiring = sandbox.status === DemoSandboxStatus.EXPIRING;
      const row = [{ id: sandbox.id, organizationId: ORG }];
      if (sql.includes('NOT EXISTS')) {
        return expiring && !closure.closed ? row : [];
      }
      if (sql.includes("'PENDING'::")) {
        return expiring && closure.closed && closure.stage === 'PENDING'
          ? row
          : [];
      }
      if (sql.includes("'COMPLETED'::")) {
        return expiring && closure.stage === 'COMPLETED' ? row : [];
      }
      return [];
    }),
    db: undefined as unknown,
  };
  prisma.db = { ...prisma, ...tx, $transaction: prisma.$transaction };

  const config = { get: jest.fn() };
  const activity = new DemoSandboxActivityService(
    prisma as never,
    config as never,
  );
  const gateway = {
    emitAuthorityReductionWithAck: jest.fn(async (frame: unknown) => {
      frames.push(frame);
      return { status: 'APPLIED' };
    }),
  };
  const connections = { evictMachine: jest.fn().mockResolvedValue(1) };
  const pairing = new MachinePairingService(
    prisma as never,
    connections as never,
    { publish: jest.fn().mockResolvedValue('event') } as never,
    { get: () => 'enrollment-hmac-key' } as never,
    {
      signMachineRevocationReduction: jest
        .fn()
        .mockReturnValue({ signed: true }),
    } as never,
    gateway as never,
    activity,
  );
  const browserSessions = {
    revokeAllForUserInTransaction: jest.fn().mockResolvedValue({
      revokedFamilyIds: [],
      revokedSessionIds: [],
    }),
    invalidateRevokedSessions: jest.fn(),
  };
  const deletion = {
    executeForOrganization: jest.fn(async () => {
      closure.stage = 'COMPLETED';
      return true;
    }),
  };
  const lifecycle = new DemoSandboxLifecycleService(
    prisma as never,
    browserSessions as never,
    pairing,
    {
      closeImmediatelyForSystemOrganization: jest.fn(async () => {
        closure.closed = true;
      }),
    } as never,
    deletion as never,
  );
  const guard = new MachineCredentialGuard(pairing);
  const cliRequest = () =>
    guard.canActivate(
      new ExecutionContextHost([
        { headers: { authorization: `Bearer ${CREDENTIAL}` } },
      ]),
    );
  return { sandbox, machine, frames, connections, lifecycle, cliRequest };
}

describe('paired CLI against a demo sandbox', () => {
  beforeEach(() =>
    jest.useFakeTimers({ now: T0, doNotFake: ['setImmediate'] }),
  );
  afterEach(() => jest.useRealTimers());

  it('stays usable while it is being used, then fails closed after two idle hours', async () => {
    const t = build();

    // Writes from the paired CLI keep the sandbox alive well past the first deadline.
    jest.setSystemTime(new Date(T0.getTime() + 90 * 60 * 1000));
    await expect(t.cliRequest()).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(t.sandbox.expiresAt).toEqual(new Date(T0.getTime() + 3.5 * HOUR));

    jest.setSystemTime(new Date(T0.getTime() + 3 * HOUR));
    await t.lifecycle.sweep();
    expect(t.sandbox.status).toBe(DemoSandboxStatus.ACTIVE);
    await expect(t.cliRequest()).resolves.toBe(true);

    // Two hours of silence after the last request expires the sandbox.
    jest.setSystemTime(new Date(T0.getTime() + 5 * HOUR + 60_000));
    await t.lifecycle.sweep();

    expect(t.sandbox.status).toBe(DemoSandboxStatus.DELETED);
    expect(t.sandbox.demoUserId).toBeNull();
    expect(t.machine.revokedAt).not.toBeNull();
    expect(t.connections.evictMachine).toHaveBeenCalledWith(MACHINE);
    expect(t.frames).toEqual([
      expect.objectContaining({
        type: 'trigger.authority_reduction',
        organizationId: ORG,
      }),
    ]);
    await expect(t.cliRequest()).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('does not extend an expired sandbox when the CLI reconnects before the sweep revokes it', async () => {
    const t = build();

    jest.setSystemTime(new Date(T0.getTime() + 2 * HOUR + 30_000));
    await expect(t.cliRequest()).resolves.toBe(true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(t.sandbox.expiresAt).toEqual(new Date(T0.getTime() + 2 * HOUR));
  });
});
