import { ConflictException, NotFoundException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { DemoSandboxStatus } from '@prisma/client';
import { DemoSandboxAdmissionService } from '../demo-sandbox-admission.service';
import {
  DEMO_AGENT_BRIDGE_DOCUMENT,
  DEMO_SYSTEM_USER_ID,
  DEMO_TERMS_DOCUMENT,
} from '../demo-sandbox.constants';

const input = {
  botCheckToken: 'widget-token',
  demoTermsVersion: DEMO_TERMS_DOCUMENT.version,
  agentBridgeAcknowledgmentVersion: DEMO_AGENT_BRIDGE_DOCUMENT.version,
};
const session = { refreshSecret: 'refresh', sessionId: 's', familyId: 'f' };
const context = (bindingSecret?: string) => ({
  ...(bindingSecret ? { bindingSecret } : {}),
  ipAddress: '203.0.113.9',
  sessionMetadata: {},
});
const hash = (secret: string) =>
  createHash('sha256').update(secret).digest('hex');

const deployment = process.env.DEPLOYMENT_ENVIRONMENT;
beforeEach(() => {
  process.env.DEPLOYMENT_ENVIRONMENT = 'staging';
});
afterAll(() => {
  process.env.DEPLOYMENT_ENVIRONMENT = deployment;
});

const openProgram = {
  activeCap: 10,
  perIpLimit: 3,
  perIpWindowSeconds: 3600,
};
const activeSandbox = {
  id: 'sandbox-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  demoUserId: 'demo-user-1',
  status: DemoSandboxStatus.ACTIVE,
  expiresAt: new Date(Date.now() + 3_600_000),
};

function setup() {
  const db = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    demoSandbox: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    demoSandboxProgramState: { findUniqueOrThrow: jest.fn() },
    demoTemplate: { findFirstOrThrow: jest.fn() },
    task: { findFirstOrThrow: jest.fn() },
    user: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
    organizationMember: { create: jest.fn() },
    privateBetaDisclosureAcceptance: { create: jest.fn() },
  };
  // Emulates pg_advisory_xact_lock: held from the lock query until the
  // transaction that took it settles.
  const scope = new AsyncLocalStorage<{ release?: () => void }>();
  let lockTail: Promise<void> = Promise.resolve();
  db.$transaction.mockImplementation(
    async (callback: (tx: typeof db) => unknown) => {
      const held: { release?: () => void } = {};
      try {
        return await scope.run(held, () => callback(db));
      } finally {
        held.release?.();
      }
    },
  );
  const advisoryLock = async () => {
    const previous = lockTail;
    lockTail = new Promise<void>((release) => {
      scope.getStore()!.release = release;
    });
    await previous;
    return [];
  };
  const botCheck = { verify: jest.fn().mockResolvedValue(true) };
  const organizations = {
    createOrganizationWithTransaction: jest
      .fn()
      .mockResolvedValue({ id: 'org-new' }),
  };
  const projects = {
    createSandboxProjectInTransaction: jest
      .fn()
      .mockResolvedValue({ id: 'project-new' }),
    createProjectMembership: jest.fn(),
  };
  const entitlements = { createBetaAtAdmissionInTransaction: jest.fn() };
  const templateSnapshot = {
    sourceProjectId: 'template-project',
    graph: { nodes: [], edges: [] },
  };
  const clone = {
    snapshotTemplate: jest.fn().mockResolvedValue(templateSnapshot),
    cloneInto: jest.fn().mockResolvedValue({
      idMap: new Map([['source-feature', 'copied-feature']]),
      graphCopyIntentId: 'intent-1',
    }),
  };
  const readiness = { waitUntilConnected: jest.fn().mockResolvedValue(true) };
  const discard = { discard: jest.fn().mockResolvedValue(true) };
  const browserSessions = {
    establishInTransaction: jest.fn().mockResolvedValue(session),
  };
  const workItemTypes = {
    refresh: jest.fn(),
    publishConfigChanged: jest.fn(),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue('ip-key'),
    get: jest.fn(),
  };

  db.demoSandboxProgramState.findUniqueOrThrow.mockResolvedValue(openProgram);
  db.demoSandbox.count.mockResolvedValue(0);
  db.demoSandbox.findFirst.mockResolvedValue(null);
  db.demoSandbox.findUnique.mockResolvedValue(null);
  db.demoTemplate.findFirstOrThrow.mockResolvedValue({
    projectId: 'template-project',
    repositoryUrl: 'https://github.com/example/template',
  });
  db.task.findFirstOrThrow.mockResolvedValue({ id: 'source-feature' });
  db.user.create.mockResolvedValue({ id: 'demo-user-new' });
  db.user.findUniqueOrThrow.mockResolvedValue({
    id: 'demo-user-1',
    email: 'demo@demo.invalid',
    name: 'Demo visitor',
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isDevAdmin: false,
    devAdminMode: false,
    memberships: [{ organizationId: 'org-1', role: 'MEMBER' }],
  });
  db.demoSandbox.create.mockImplementation(({ data }: { data: object }) => ({
    id: 'sandbox-new',
    ...data,
  }));
  db.demoSandbox.update.mockImplementation(({ data }: { data: object }) => ({
    ...activeSandbox,
    id: 'sandbox-new',
    organizationId: 'org-new',
    projectId: 'project-new',
    ...data,
  }));
  db.demoSandbox.updateMany.mockResolvedValue({ count: 1 });
  db.demoSandbox.findUniqueOrThrow.mockResolvedValue({
    provisioningDeadline: new Date(Date.now() + 120_000),
  });
  db.$queryRaw.mockImplementation((query: { strings?: string[] }) =>
    String(query.strings).includes('pg_advisory_xact_lock')
      ? advisoryLock()
      : [{ id: 'sandbox-new' }],
  );

  const service = new DemoSandboxAdmissionService(
    { db, $transaction: db.$transaction } as never,
    config as never,
    botCheck as never,
    organizations as never,
    projects as never,
    entitlements as never,
    clone as never,
    readiness as never,
    discard as never,
    browserSessions as never,
    workItemTypes as never,
  );
  return {
    service,
    db,
    botCheck,
    organizations,
    projects,
    entitlements,
    clone,
    templateSnapshot,
    readiness,
    discard,
    browserSessions,
    config,
  };
}

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (error: { getStatus(): number; getResponse(): { code: string } }) => ({
      status: error.getStatus(),
      code: error.getResponse().code,
    }),
  );

describe('DemoSandboxAdmissionService', () => {
  describe('returning browsers', () => {
    it('resumes through POST /demo-sandboxes even when at capacity, creating nothing', async () => {
      const t = setup();
      t.db.demoSandbox.count.mockResolvedValue(99);
      t.db.demoSandbox.findFirst.mockResolvedValue(activeSandbox);

      const admission = await t.service.provision(input, context('secret'));

      expect(admission.sandbox).toMatchObject({
        organizationId: 'org-1',
        projectId: 'project-1',
        resumed: true,
        repositoryUrl: 'https://github.com/example/template',
      });
      expect(admission.bindingSecret).toBeUndefined();
      expect(t.db.demoSandbox.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          browserBindingHash: hash('secret'),
          status: DemoSandboxStatus.ACTIVE,
          expiresAt: { gt: expect.any(Date) },
        }),
      });
      expect(t.botCheck.verify).not.toHaveBeenCalled();
      expect(
        t.organizations.createOrganizationWithTransaction,
      ).not.toHaveBeenCalled();
      expect(t.clone.cloneInto).not.toHaveBeenCalled();
      expect(t.db.demoSandbox.create).not.toHaveBeenCalled();
      expect(t.db.user.create).not.toHaveBeenCalled();
      expect(t.browserSessions.establishInTransaction).toHaveBeenCalledTimes(1);
    });

    it('resumes through POST /demo-sandboxes/resume with the same lookup and creates nothing', async () => {
      const t = setup();
      t.db.demoSandbox.findFirst.mockResolvedValue(activeSandbox);

      const admission = await t.service.resume(context('secret'));

      expect(admission.sandbox.resumed).toBe(true);
      expect(admission.bindingSecret).toBeUndefined();
      expect(t.clone.cloneInto).not.toHaveBeenCalled();
      expect(t.db.demoSandbox.create).not.toHaveBeenCalled();
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
    });

    it('reports NONE for a browser that never had a sandbox', async () => {
      const t = setup();
      await expect(t.service.resume(context())).rejects.toMatchObject({
        response: { data: { state: 'NONE' } },
      });
      expect(t.db.demoSandbox.findUnique).not.toHaveBeenCalled();
    });

    it('reports EXPIRED for a binding whose sandbox is gone', async () => {
      const t = setup();
      t.db.demoSandbox.findUnique.mockResolvedValue({ id: 'old' });
      const miss: unknown = await t.service
        .resume(context('secret'))
        .catch((e: unknown) => e);
      expect(miss).toBeInstanceOf(NotFoundException);
      expect((miss as NotFoundException).getResponse()).toMatchObject({
        data: { state: 'EXPIRED' },
      });
      expect(t.db.demoSandbox.findUnique).toHaveBeenCalledWith({
        where: { browserBindingHash: hash('secret') },
        select: { id: true },
      });
    });
  });

  describe('expired and deleted bindings', () => {
    it('matches only ACTIVE unexpired sandboxes that still have a demo user, never EXPIRING or DELETED ones', async () => {
      const t = setup();

      await t.service.resume(context('secret')).catch(() => undefined);

      expect(t.db.demoSandbox.findFirst).toHaveBeenCalledWith({
        where: {
          browserBindingHash: hash('secret'),
          status: DemoSandboxStatus.ACTIVE,
          expiresAt: { gt: expect.any(Date) },
          demoUserId: { not: null },
        },
      });
    });

    it.each([DemoSandboxStatus.EXPIRING, DemoSandboxStatus.DELETED])(
      'tells a browser bound to a %s sandbox its demo expired, without a session',
      async (status) => {
        const t = setup();
        t.db.demoSandbox.findUnique.mockResolvedValue({ id: 'old', status });

        await expect(t.service.resume(context('secret'))).rejects.toMatchObject(
          { response: { data: { state: 'EXPIRED' } } },
        );
        expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
      },
    );

    it('reports the configured inactivity timeout to the visitor', async () => {
      const t = setup();
      t.config.get.mockReturnValue('900');
      t.db.demoSandbox.findFirst.mockResolvedValue(activeSandbox);

      const admission = await t.service.resume(context('secret'));

      expect(admission.sandbox.inactivityTimeoutSeconds).toBe(900);
    });
  });

  describe('refusals, in order', () => {
    const failing = {
      off: () => {
        process.env.DEPLOYMENT_ENVIRONMENT = 'production';
      },
      full: (t: ReturnType<typeof setup>) =>
        t.db.demoSandbox.count.mockResolvedValueOnce(openProgram.activeCap),
      limited: (t: ReturnType<typeof setup>) =>
        t.db.demoSandbox.count
          .mockResolvedValueOnce(0)
          .mockResolvedValueOnce(openProgram.perIpLimit),
      bot: (t: ReturnType<typeof setup>) =>
        t.botCheck.verify.mockResolvedValue(false),
    };

    it.each([
      ['DISABLED', 503, ['off', 'full', 'limited', 'bot']],
      ['AT_CAPACITY', 503, ['full', 'limited', 'bot']],
      ['RATE_LIMITED', 429, ['limited', 'bot']],
      ['BOT_CHECK_FAILED', 400, ['bot']],
    ] as const)(
      '%s wins when every later check also fails',
      async (code, status, failures) => {
        const t = setup();
        for (const failure of failures) failing[failure](t);

        await expect(
          refusal(t.service.provision(input, context())),
        ).resolves.toEqual({
          status,
          code,
        });
        expect(t.clone.cloneInto).not.toHaveBeenCalled();
        expect(t.db.demoSandbox.create).not.toHaveBeenCalled();
      },
    );

    it('counts ACTIVE sandboxes plus PROVISIONING reservations against the cap', async () => {
      const t = setup();
      failing.full(t);
      await refusal(t.service.provision(input, context()));
      expect(t.db.demoSandbox.count).toHaveBeenNthCalledWith(1, {
        where: {
          status: {
            in: [DemoSandboxStatus.ACTIVE, DemoSandboxStatus.PROVISIONING],
          },
        },
      });
    });

    it('limits per hashed creator address within the configured window', async () => {
      const t = setup();
      failing.limited(t);
      await refusal(t.service.provision(input, context()));
      expect(t.db.demoSandbox.count).toHaveBeenNthCalledWith(2, {
        where: {
          creatorIpHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          createdAt: { gt: expect.any(Date) },
        },
      });
      expect(JSON.stringify(t.db.demoSandbox.count.mock.calls)).not.toContain(
        '203.0.113.9',
      );
    });

    it('rejects a stale demo document version after the admission checks', async () => {
      const t = setup();
      await expect(
        t.service.provision(
          { ...input, demoTermsVersion: 'demo-0.1' },
          context(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(t.clone.cloneInto).not.toHaveBeenCalled();
    });
  });

  describe('provisioning', () => {
    it('prepares an inaccessible attempt, then activates it with exactly the member roles', async () => {
      const t = setup();

      const admission = await t.service.provision(input, context());

      expect(
        t.organizations.createOrganizationWithTransaction,
      ).toHaveBeenCalledWith(
        t.db,
        expect.objectContaining({
          name: expect.stringContaining('Demo sandbox'),
        }),
        DEMO_SYSTEM_USER_ID,
      );
      expect(t.clone.cloneInto).toHaveBeenCalledWith(t.db, {
        targetOrganizationId: 'org-new',
        targetProjectId: 'project-new',
        actorUserId: DEMO_SYSTEM_USER_ID,
        templateSnapshot: t.templateSnapshot,
      });
      expect(t.db.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          passwordHash: '!',
          isDemoUser: true,
        }),
      });
      expect(
        t.db.privateBetaDisclosureAcceptance.create.mock.calls.map(
          ([{ data }]: [{ data: Record<string, string> }]) => [
            data.documentKind,
            data.version,
            data.actionType,
          ],
        ),
      ).toEqual([
        ['TERMS', DEMO_TERMS_DOCUMENT.version, 'AGREED'],
        ['SECURITY', DEMO_AGENT_BRIDGE_DOCUMENT.version, 'ACKNOWLEDGED'],
      ]);
      expect(t.db.demoSandbox.create).toHaveBeenCalledWith({
        data: {
          browserBindingHash: expect.any(String),
          creatorIpHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          status: DemoSandboxStatus.PROVISIONING,
          provisioningDeadline: expect.any(Date),
        },
        select: { id: true },
      });
      expect(t.db.demoSandbox.updateMany).toHaveBeenCalledWith({
        where: { id: 'sandbox-new', status: DemoSandboxStatus.PROVISIONING },
        data: {
          organizationId: 'org-new',
          projectId: 'project-new',
          demoUserId: 'demo-user-new',
          readinessFeatureId: 'copied-feature',
        },
      });
      // Nothing is visible to the visitor before the Graph sample matches.
      const prepared = t.db.demoSandbox.updateMany.mock.invocationCallOrder[0]!;
      expect(
        t.db.organizationMember.create.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        t.readiness.waitUntilConnected.mock.invocationCallOrder[0]!,
      );
      expect(
        t.readiness.waitUntilConnected.mock.invocationCallOrder[0],
      ).toBeGreaterThan(prepared);

      expect(t.db.organizationMember.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'demo-user-new',
          organizationId: 'org-new',
          role: 'MEMBER',
        }),
      });
      expect(t.projects.createProjectMembership).toHaveBeenCalledWith(
        'org-new',
        'project-new',
        { userId: 'demo-user-new', role: 'MEMBER' },
        t.db,
      );
      expect(t.browserSessions.establishInTransaction).toHaveBeenCalledTimes(1);
      expect(admission.session).toBe(session);
      expect(admission.sandbox).toMatchObject({
        organizationId: 'org-new',
        projectId: 'project-new',
        resumed: false,
        inactivityTimeoutSeconds: 7200,
      });
      expect(admission.bindingSecret).toEqual(expect.any(String));
      expect(
        t.db.demoSandbox.create.mock.calls[0]![0].data.browserBindingHash,
      ).toBe(hash(admission.bindingSecret!));
      expect(t.discard.discard).not.toHaveBeenCalled();
    });

    it('prepares concurrently admitted visitors at the same time', async () => {
      const t = setup();
      const releases: Array<() => void> = [];
      t.clone.cloneInto.mockImplementation(
        () =>
          new Promise((resolve) => {
            releases.push(() =>
              resolve({
                idMap: new Map([['source-feature', 'copied-feature']]),
              }),
            );
          }),
      );

      const admissions = [1, 2, 3].map(() =>
        t.service.provision(input, context()),
      );
      for (let tick = 0; tick < 50 && releases.length < 3; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      // Every visitor is cloning before any clone finishes.
      expect(releases).toHaveLength(3);
      for (const release of releases) release();

      await expect(Promise.all(admissions)).resolves.toHaveLength(3);
      expect(t.db.demoSandbox.create).toHaveBeenCalledTimes(3);
    });

    it('keeps the reservation counted while the sandbox is prepared', async () => {
      const t = setup();
      let counted: unknown;
      t.clone.cloneInto.mockImplementation(async () => {
        counted = t.db.demoSandbox.create.mock.calls.length;
        return { idMap: new Map([['source-feature', 'copied-feature']]) };
      });

      await t.service.provision(input, context());

      expect(counted).toBe(1);
    });

    it('releases the reservation and reports PROVISIONING_FAILED when preparation fails', async () => {
      const t = setup();
      t.clone.cloneInto.mockRejectedValue(new Error('constraint violated'));

      await expect(
        refusal(t.service.provision(input, context())),
      ).resolves.toEqual({
        status: 503,
        code: 'PROVISIONING_FAILED',
      });
      expect(t.db.demoSandbox.updateMany).not.toHaveBeenCalled();
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
      expect(t.readiness.waitUntilConnected).not.toHaveBeenCalled();
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
    });

    it('fails preparation when the reservation was discarded meanwhile', async () => {
      const t = setup();
      t.db.demoSandbox.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        refusal(t.service.provision(input, context())),
      ).resolves.toEqual({
        status: 503,
        code: 'PROVISIONING_FAILED',
      });
      expect(t.readiness.waitUntilConnected).not.toHaveBeenCalled();
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
    });

    it('keeps the template snapshot outside every database transaction', async () => {
      const t = setup();
      let open = 0;
      const transaction = t.db.$transaction.getMockImplementation()! as (
        callback: (tx: typeof t.db) => unknown,
      ) => Promise<unknown>;
      t.db.$transaction.mockImplementation(
        async (callback: (tx: typeof t.db) => unknown) => {
          open += 1;
          try {
            return await transaction(callback);
          } finally {
            open -= 1;
          }
        },
      );
      let during = -1;
      t.clone.snapshotTemplate.mockImplementation(async () => {
        during = open;
        return t.templateSnapshot;
      });

      await t.service.provision(input, context());

      expect(during).toBe(0);
    });

    it('discards the whole attempt when the Graph sample never connects', async () => {
      const t = setup();
      t.readiness.waitUntilConnected.mockResolvedValue(false);

      await expect(
        refusal(t.service.provision(input, context())),
      ).resolves.toEqual({
        status: 503,
        code: 'PROVISIONING_FAILED',
      });
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
    });

    it('still returns the typed 503 when the discard itself fails', async () => {
      const t = setup();
      t.readiness.waitUntilConnected.mockResolvedValue(false);
      t.discard.discard.mockRejectedValueOnce(new Error('db down'));

      await expect(
        refusal(t.service.provision(input, context())),
      ).resolves.toEqual({
        status: 503,
        code: 'PROVISIONING_FAILED',
      });
    });

    it('lets closure win against a late match', async () => {
      const t = setup();
      // The activation lock finds the attempt already DISCARDING or past its deadline.
      t.db.$queryRaw.mockImplementation(
        (query: { sql?: string; strings?: string[] }) =>
          String(query.strings ?? query.sql).includes('FOR UPDATE')
            ? []
            : [{ id: 'sandbox-new' }],
      );

      await expect(
        refusal(t.service.provision(input, context())),
      ).resolves.toEqual({
        status: 503,
        code: 'PROVISIONING_FAILED',
      });
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.projects.createProjectMembership).not.toHaveBeenCalled();
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
    });
  });

  describe('current', () => {
    it('returns the ACTIVE sandbox of a demo user and 404s otherwise', async () => {
      const t = setup();
      t.db.demoSandbox.findFirst.mockResolvedValueOnce(activeSandbox);
      await expect(
        t.service.current('demo-user-1' as never),
      ).resolves.toMatchObject({
        organizationId: 'org-1',
        resumed: false,
      });
      expect(t.db.demoSandbox.findFirst).toHaveBeenCalledWith({
        where: {
          demoUserId: 'demo-user-1',
          status: DemoSandboxStatus.ACTIVE,
          expiresAt: { gt: expect.any(Date) },
        },
      });

      t.db.demoSandbox.findFirst.mockResolvedValueOnce(null);
      await expect(
        t.service.current('someone' as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
