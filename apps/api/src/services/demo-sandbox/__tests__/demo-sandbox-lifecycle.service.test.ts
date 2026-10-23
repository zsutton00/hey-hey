import { Logger } from '@nestjs/common';
import { DemoSandboxStatus } from '@prisma/client';
import { DemoSandboxLifecycleService } from '../demo-sandbox-lifecycle.service';

type RowState = {
  status: DemoSandboxStatus;
  organizationId: string;
  demoUserId: string | null;
};

type SweepRows = {
  /** EXPIRING rows with no closure execution yet: access still live. */
  pending: Array<{ id: string }>;
  /** Closed rows whose deletion is PENDING and due. */
  due: Array<{ id: string; organizationId: string }>;
  /** Rows whose final deletion COMPLETED. */
  completed: Array<{ id: string }>;
  /** Rows whose closure execution FAILED. */
  failed: Array<Record<string, unknown>>;
};

const sqlOf = (query: unknown) =>
  (query as { strings: string[] }).strings.join('?');

const sqlOfCall = (mock: jest.Mock, call: number) =>
  sqlOf((mock.mock.calls[call] as unknown[])[0]);

function setup(
  overrides: { row?: Partial<RowState>; rows?: Partial<SweepRows> } = {},
) {
  const events: string[] = [];
  const row: RowState = {
    status: DemoSandboxStatus.EXPIRING,
    organizationId: 'org-1',
    demoUserId: 'demo-user-1',
    ...overrides.row,
  };
  const rows: SweepRows = {
    pending: [{ id: 'sandbox-1' }],
    due: [{ id: 'sandbox-1', organizationId: 'org-1' }],
    completed: [{ id: 'sandbox-1' }],
    failed: [],
    ...overrides.rows,
  };
  const tx = {
    $queryRaw: jest.fn(async () => [row]),
    demoSandbox: {
      findUnique: jest.fn(async () => ({ demoUserId: row.demoUserId })),
      updateMany: jest.fn(async () => {
        events.push('row-deleted');
        return { count: 1 };
      }),
    },
    user: {
      deleteMany: jest.fn(async () => {
        events.push('user-deleted');
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    $executeRaw: jest.fn(async () => {
      events.push('claim');
      return 1;
    }),
    $queryRaw: jest.fn(async (query: unknown) => {
      const sql = sqlOf(query);
      if (sql.includes('NOT EXISTS')) return rows.pending;
      if (sql.includes("'PENDING'::")) return rows.due;
      if (sql.includes("'COMPLETED'::")) return rows.completed;
      if (sql.includes("'FAILED'::")) return rows.failed;
      throw new Error(`Unexpected sweep query: ${sql}`);
    }),
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => {
      const result = await callback(tx);
      events.push('commit');
      return result;
    }),
  };
  const revokedSessions = ['session-1'];
  const browserSessions = {
    revokeAllForUserInTransaction: jest.fn(async () => {
      events.push('revoke-sessions');
      return {
        revokedFamilyIds: ['family-1'],
        revokedSessionIds: revokedSessions,
      };
    }),
    invalidateRevokedSessions: jest.fn(() => {
      events.push('invalidate-sessions');
    }),
  };
  const reductions = [{ machineId: 'machine-1' }];
  const machines = {
    revokeAllForUserInTransaction: jest.fn(async () => {
      events.push('revoke-machines');
      return reductions;
    }),
    deliverRevocationReductions: jest.fn(async () => {
      events.push('deliver-reductions');
    }),
  };
  const lifecycle = {
    closeImmediatelyForSystemOrganization: jest.fn(async () => {
      events.push('close-organization');
    }),
  };
  const deletion = {
    executeForOrganization: jest.fn(async () => {
      events.push('final-deletion');
      return true;
    }),
  };
  const service = new DemoSandboxLifecycleService(
    prisma as never,
    browserSessions as never,
    machines as never,
    lifecycle as never,
    deletion as never,
  );
  return {
    service,
    events,
    row,
    rows,
    tx,
    prisma,
    browserSessions,
    machines,
    lifecycle,
    deletion,
    reductions,
  };
}

describe('DemoSandboxLifecycleService sweep', () => {
  it('claims every expired ACTIVE row into EXPIRING before doing anything else', async () => {
    const t = setup();

    await t.service.sweep();

    expect(t.events[0]).toBe('claim');
    const claimSql = sqlOfCall(t.prisma.$executeRaw, 0);
    expect(claimSql).toContain("status = 'ACTIVE'");
    expect(claimSql).toContain('SKIP LOCKED');
    expect(claimSql).not.toContain('LIMIT');
  });

  it('revokes browser sessions, then machines, then closes the organization, and only afterwards deletes', async () => {
    const t = setup();

    await t.service.sweep();

    expect(t.events).toEqual([
      'claim',
      'revoke-sessions',
      'revoke-machines',
      'close-organization',
      'commit',
      'invalidate-sessions',
      'deliver-reductions',
      'final-deletion',
      'user-deleted',
      'row-deleted',
      'commit',
    ]);
    expect(
      t.browserSessions.revokeAllForUserInTransaction,
    ).toHaveBeenCalledWith(
      t.tx,
      'demo-user-1',
      expect.any(Date),
      expect.any(String),
    );
    expect(t.machines.deliverRevocationReductions).toHaveBeenCalledWith(
      'demo-user-1',
      t.reductions,
    );
    expect(t.browserSessions.invalidateRevokedSessions).toHaveBeenCalledWith([
      'session-1',
    ]);
  });

  it('marks the row DELETED with the demo user cleared once final deletion completed', async () => {
    const t = setup();

    await t.service.sweep();

    expect(t.tx.user.deleteMany).toHaveBeenCalledWith({
      where: { id: 'demo-user-1' },
    });
    expect(t.tx.demoSandbox.updateMany).toHaveBeenCalledWith({
      where: { id: 'sandbox-1', status: DemoSandboxStatus.EXPIRING },
      data: { status: DemoSandboxStatus.DELETED, demoUserId: null },
    });
  });

  describe('row selection', () => {
    it('revokes access for every expiring sandbox that has no closure execution, without a batch limit', async () => {
      const t = setup();

      await t.service.sweep();

      const pendingSql = sqlOfCall(t.prisma.$queryRaw, 0);
      expect(pendingSql).toContain("sandbox.status = 'EXPIRING'");
      expect(pendingSql).toContain('NOT EXISTS');
      expect(pendingSql).toContain('organization_closure_executions');
      expect(pendingSql).not.toContain('LIMIT');
    });

    it('starts deletion only for closed sandboxes whose execution is PENDING and due', async () => {
      const t = setup();

      await t.service.sweep();

      const dueSql = sqlOfCall(t.prisma.$queryRaw, 1);
      expect(dueSql).toContain("execution.stage = 'PENDING'");
      expect(dueSql).toContain('execution.next_retry_at');
      expect(dueSql).toContain('execution.lease_expires_at');
      expect(dueSql).toContain('LIMIT');
    });

    it('finishes only sandboxes whose execution COMPLETED', async () => {
      const t = setup();

      await t.service.sweep();

      const completedSql = sqlOfCall(t.prisma.$queryRaw, 2);
      expect(completedSql).toContain("execution.stage = 'COMPLETED'");
    });

    it('revokes a newly expired sandbox even when many other deletions are stuck', async () => {
      const stuck = Array.from({ length: 25 }, (_, i) => ({
        id: `stuck-${i}`,
        organizationId: `stuck-org-${i}`,
        lastFailure: 'foreign key violation',
      }));
      const t = setup({
        row: { organizationId: 'org-new' },
        rows: {
          pending: [{ id: 'sandbox-new' }],
          due: [{ id: 'sandbox-new', organizationId: 'org-new' }],
          completed: [],
          failed: stuck,
        },
      });

      await t.service.sweep();

      expect(t.tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(
        t.browserSessions.revokeAllForUserInTransaction,
      ).toHaveBeenCalledTimes(1);
      expect(t.machines.revokeAllForUserInTransaction).toHaveBeenCalledTimes(1);
      expect(
        t.lifecycle.closeImmediatelyForSystemOrganization,
      ).toHaveBeenCalledTimes(1);
      expect(t.deletion.executeForOrganization).toHaveBeenCalledTimes(1);
      expect(t.deletion.executeForOrganization).toHaveBeenCalledWith('org-new');
    });
  });

  it('leaves a row EXPIRING while projection-first deletion is still in progress', async () => {
    const t = setup({ rows: { completed: [] } });

    await t.service.sweep();

    expect(t.deletion.executeForOrganization).toHaveBeenCalledWith('org-1');
    expect(t.tx.user.deleteMany).not.toHaveBeenCalled();
    expect(t.tx.demoSandbox.updateMany).not.toHaveBeenCalled();
  });

  it('reports sandboxes with a FAILED closure and leaves them EXPIRING', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const failed = [
      {
        id: 'sandbox-stuck',
        organizationId: 'org-stuck',
        failedAt: new Date('2026-10-17T10:00:00.000Z'),
        lastFailure: 'foreign key violation',
      },
    ];
    const t = setup({
      rows: { pending: [], due: [], completed: [], failed },
    });

    await expect(t.service.sweep()).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      'Demo sandboxes stuck after failed final deletion',
      { stuck: 1, sandboxes: failed },
    );
    expect(t.deletion.executeForOrganization).not.toHaveBeenCalled();
    expect(t.tx.user.deleteMany).not.toHaveBeenCalled();
    expect(t.tx.demoSandbox.updateMany).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('stays quiet when no closure FAILED', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const t = setup();

    await t.service.sweep();

    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it('does nothing for a row another instance already moved on', async () => {
    const t = setup({ row: { status: DemoSandboxStatus.DELETED } });

    await t.service.sweep();

    expect(
      t.browserSessions.revokeAllForUserInTransaction,
    ).not.toHaveBeenCalled();
    expect(
      t.lifecycle.closeImmediatelyForSystemOrganization,
    ).not.toHaveBeenCalled();
    expect(t.machines.deliverRevocationReductions).not.toHaveBeenCalled();
  });

  it('still closes and finishes a row whose demo user is already gone', async () => {
    const t = setup({ row: { demoUserId: null } });

    await t.service.sweep();

    expect(
      t.browserSessions.revokeAllForUserInTransaction,
    ).not.toHaveBeenCalled();
    expect(t.machines.revokeAllForUserInTransaction).not.toHaveBeenCalled();
    expect(t.machines.deliverRevocationReductions).not.toHaveBeenCalled();
    expect(
      t.lifecycle.closeImmediatelyForSystemOrganization,
    ).toHaveBeenCalledTimes(1);
  });

  it('does not close or delete when revocation fails, and the next sweep revokes again', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const t = setup({ rows: { due: [], completed: [] } });
    t.machines.revokeAllForUserInTransaction.mockRejectedValueOnce(
      new Error('database unavailable'),
    );

    await expect(t.service.sweep()).resolves.toBeUndefined();

    expect(
      t.lifecycle.closeImmediatelyForSystemOrganization,
    ).not.toHaveBeenCalled();
    expect(t.deletion.executeForOrganization).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      'Demo sandbox expiry step failed; will retry',
      expect.objectContaining({ step: 'access revocation' }),
    );

    await t.service.sweep();

    expect(
      t.lifecycle.closeImmediatelyForSystemOrganization,
    ).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it('lets one failing sandbox not block revoking the rest', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const t = setup({
      rows: {
        pending: [{ id: 'sandbox-1' }, { id: 'sandbox-2' }],
        due: [],
        completed: [],
      },
    });
    t.browserSessions.revokeAllForUserInTransaction.mockRejectedValueOnce(
      new Error('boom'),
    );

    await t.service.sweep();

    expect(
      t.lifecycle.closeImmediatelyForSystemOrganization,
    ).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it('lets one failing deletion not block starting the rest', async () => {
    const errorLog = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const t = setup({
      rows: {
        pending: [],
        due: [
          { id: 'sandbox-1', organizationId: 'org-1' },
          { id: 'sandbox-2', organizationId: 'org-2' },
        ],
        completed: [],
      },
    });
    t.deletion.executeForOrganization.mockRejectedValueOnce(new Error('boom'));

    await t.service.sweep();

    expect(t.deletion.executeForOrganization).toHaveBeenCalledTimes(2);
    errorLog.mockRestore();
  });

  it('skips a sweep that overlaps one still running', async () => {
    const t = setup();
    let release!: () => void;
    t.prisma.$executeRaw.mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve(0))),
    );

    const first = t.service.sweep();
    await t.service.sweep();
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);

    release();
    await first;
  });
});
