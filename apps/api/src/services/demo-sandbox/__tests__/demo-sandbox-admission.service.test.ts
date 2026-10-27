import { ConflictException, NotFoundException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { DemoSandboxStage, DemoSandboxStatus } from '@prisma/client';
import { DemoSandboxReadinessService } from '../demo-sandbox-readiness.service';
import type { GraphsClientService } from '../../graphs-client.service';
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
  stage: DemoSandboxStage.READY,
  readinessFeatureIds: ['copied-feature'],
  connectedFeatureCount: 1,
  expiresAt: new Date(Date.now() + 3_600_000),
};
const connectingSandbox = {
  ...activeSandbox,
  status: DemoSandboxStatus.PROVISIONING,
  stage: DemoSandboxStage.CONNECTING,
  readinessFeatureIds: ['copied-a', 'copied-b', 'copied-c'],
  connectedFeatureCount: 2,
  expiresAt: null,
};
const failedTombstone = {
  id: 'sandbox-0',
  organizationId: null,
  projectId: null,
  demoUserId: null,
  status: DemoSandboxStatus.DELETED,
  stage: DemoSandboxStage.FAILED,
  readinessFeatureIds: [],
  connectedFeatureCount: 0,
  expiresAt: null,
};

/** Lets the detached background setup run to completion. */
const settle = async () => {
  for (let tick = 0; tick < 50; tick++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
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
    },
    demoSandboxProgramState: { findUniqueOrThrow: jest.fn() },
    demoTemplate: { findFirstOrThrow: jest.fn() },
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
      idMap: new Map([
        ['source-feature', 'copied-feature'],
        ['source-feature-2', 'copied-feature-2'],
        ['source-task', 'copied-task'],
      ]),
      copiedFeatureIds: ['copied-feature', 'copied-feature-2'],
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
  db.demoSandbox.updateMany.mockResolvedValue({ count: 1 });
  db.$queryRaw.mockImplementation((query: { strings?: string[] }) =>
    String(query.strings).includes('pg_advisory_xact_lock')
      ? advisoryLock()
      : [
          {
            organizationId: 'org-new',
            projectId: 'project-new',
            demoUserId: 'demo-user-new',
          },
        ],
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
      t.db.demoSandbox.findUnique.mockResolvedValue(activeSandbox);

      const admission = await t.service.provision(input, context('secret'));

      expect(admission.admission.state).toBe('ACTIVE');
      expect(admission.admission.sandbox).toMatchObject({
        organizationId: 'org-1',
        projectId: 'project-1',
        resumed: true,
        repositoryUrl: 'https://github.com/example/template',
      });
      expect(admission.bindingSecret).toBeUndefined();
      expect(t.db.demoSandbox.findUnique).toHaveBeenCalledWith({
        where: { browserBindingHash: hash('secret') },
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
      t.db.demoSandbox.findUnique.mockResolvedValue(activeSandbox);

      const admission = await t.service.resume(context('secret'));

      expect(admission.admission.sandbox?.resumed).toBe(true);
      expect(admission.session).toBe(session);
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

    it('reports NONE for an unknown binding', async () => {
      const t = setup();
      await expect(t.service.resume(context('secret'))).rejects.toMatchObject({
        response: { data: { state: 'NONE' } },
      });
    });
  });

  describe('a browser whose sandbox is still being set up', () => {
    it('reads the stage and the connected and total feature counts through resume, without a session', async () => {
      const t = setup();
      t.db.demoSandbox.findUnique.mockResolvedValue(connectingSandbox);

      await expect(t.service.resume(context('secret'))).resolves.toEqual({
        admission: {
          state: 'PROVISIONING',
          progress: {
            stage: 'CONNECTING',
            connectedFeatureCount: 2,
            totalFeatureCount: 3,
          },
        },
      });
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
    });

    it('gets its status back from POST /demo-sandboxes instead of a second reservation', async () => {
      const t = setup();
      t.db.demoSandbox.findUnique.mockResolvedValue(connectingSandbox);

      const admission = await t.service.provision(input, context('secret'));

      expect(admission.admission.state).toBe('PROVISIONING');
      expect(admission.bindingSecret).toBeUndefined();
      expect(t.botCheck.verify).not.toHaveBeenCalled();
      expect(t.db.demoSandbox.create).not.toHaveBeenCalled();
      expect(t.clone.cloneInto).not.toHaveBeenCalled();
    });
  });

  describe('failed, expired and deleted bindings', () => {
    it.each([
      ['a FAILED tombstone', failedTombstone],
      [
        'a sandbox still being discarded',
        {
          ...connectingSandbox,
          status: DemoSandboxStatus.DISCARDING,
          stage: DemoSandboxStage.FAILED,
        },
      ],
    ])('reports FAILED for %s, without a session', async (_label, row) => {
      const t = setup();
      t.db.demoSandbox.findUnique.mockResolvedValue(row);

      await expect(t.service.resume(context('secret'))).resolves.toEqual({
        admission: { state: 'FAILED' },
      });
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
    });

    it('lets a browser with a FAILED setup try again with a new reservation and binding', async () => {
      const t = setup();
      t.db.demoSandbox.findUnique.mockResolvedValue(failedTombstone);

      const admission = await t.service.provision(input, context('old'));

      expect(admission.admission.state).toBe('PROVISIONING');
      expect(admission.bindingSecret).toEqual(expect.any(String));
      expect(admission.bindingSecret).not.toBe('old');
      expect(t.db.demoSandbox.create).toHaveBeenCalledTimes(1);
      await settle();
    });

    it.each([
      ['EXPIRING', { ...activeSandbox, status: DemoSandboxStatus.EXPIRING }],
      [
        'DELETED',
        {
          ...activeSandbox,
          status: DemoSandboxStatus.DELETED,
          demoUserId: null,
        },
      ],
      [
        'past its expiry',
        { ...activeSandbox, expiresAt: new Date(Date.now() - 1) },
      ],
    ])(
      'tells a browser bound to a sandbox that is %s its demo expired, without a session',
      async (_label, row) => {
        const t = setup();
        t.db.demoSandbox.findUnique.mockResolvedValue(row);

        const miss: unknown = await t.service
          .resume(context('secret'))
          .catch((e: unknown) => e);
        expect(miss).toBeInstanceOf(NotFoundException);
        expect((miss as NotFoundException).getResponse()).toMatchObject({
          data: { state: 'EXPIRED' },
        });
        expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
      },
    );

    it('reports the configured inactivity timeout to the visitor', async () => {
      const t = setup();
      t.config.get.mockReturnValue('900');
      t.db.demoSandbox.findUnique.mockResolvedValue(activeSandbox);

      const admission = await t.service.resume(context('secret'));

      expect(admission.admission.sandbox?.inactivityTimeoutSeconds).toBe(900);
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

    it('limits per hashed creator address within the configured window, ignoring failed setups', async () => {
      const t = setup();
      failing.limited(t);
      await refusal(t.service.provision(input, context()));
      expect(t.db.demoSandbox.count).toHaveBeenNthCalledWith(2, {
        where: {
          creatorIpHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          createdAt: { gt: expect.any(Date) },
          stage: { not: DemoSandboxStage.FAILED },
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
    it('returns as soon as the reservation commits, publishing the binding and no session', async () => {
      const t = setup();
      let finishClone!: (value: unknown) => void;
      t.clone.cloneInto.mockReturnValue(
        new Promise((resolve) => {
          finishClone = resolve;
        }),
      );

      const admission = await t.service.provision(input, context());

      expect(admission).toEqual({
        admission: {
          state: 'PROVISIONING',
          progress: {
            stage: 'COPYING',
            connectedFeatureCount: 0,
            totalFeatureCount: 0,
          },
        },
        bindingSecret: expect.any(String),
      });
      expect(admission.session).toBeUndefined();
      expect(t.db.demoSandbox.create).toHaveBeenCalledWith({
        data: {
          browserBindingHash: hash(admission.bindingSecret!),
          creatorIpHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          status: DemoSandboxStatus.PROVISIONING,
          stage: DemoSandboxStage.COPYING,
          provisioningDeadline: expect.any(Date),
        },
        select: { id: true },
      });
      // Preparation is still running in the background.
      expect(t.db.demoSandbox.updateMany).not.toHaveBeenCalled();
      expect(t.readiness.waitUntilConnected).not.toHaveBeenCalled();

      finishClone({
        idMap: new Map([['source-feature', 'copied-feature']]),
        copiedFeatureIds: ['copied-feature'],
      });
      await settle();
      expect(t.readiness.waitUntilConnected).toHaveBeenCalledWith(
        'sandbox-new',
      );
    });

    it('prepares an inaccessible attempt with every copied feature, then activates it with exactly the member roles and no session', async () => {
      const t = setup();

      await t.service.provision(input, context());
      await settle();

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
      expect(t.db.demoSandbox.updateMany).toHaveBeenCalledWith({
        where: { id: 'sandbox-new', status: DemoSandboxStatus.PROVISIONING },
        data: {
          organizationId: 'org-new',
          projectId: 'project-new',
          demoUserId: 'demo-user-new',
          readinessFeatureIds: ['copied-feature', 'copied-feature-2'],
          stage: DemoSandboxStage.CONNECTING,
        },
      });
      // Nothing is visible to the visitor before every feature is connected.
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
      expect(t.db.demoSandbox.update).toHaveBeenCalledWith({
        where: { id: 'sandbox-new' },
        data: expect.objectContaining({
          status: DemoSandboxStatus.ACTIVE,
          stage: DemoSandboxStage.READY,
          expiresAt: expect.any(Date),
        }),
      });
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
      expect(t.discard.discard).not.toHaveBeenCalled();
    });

    it('signs the visitor in on the next resume once activation flipped the row to ACTIVE', async () => {
      const t = setup();
      const admission = await t.service.provision(input, context());
      await settle();
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();

      t.db.demoSandbox.findUnique.mockResolvedValue({
        ...activeSandbox,
        organizationId: 'org-new',
        projectId: 'project-new',
        demoUserId: 'demo-user-new',
      });
      const resumed = await t.service.resume(context(admission.bindingSecret));

      expect(resumed.admission).toMatchObject({
        state: 'ACTIVE',
        sandbox: { projectId: 'project-new' },
      });
      expect(resumed.session).toBe(session);
      expect(t.db.demoSandbox.findUnique).toHaveBeenCalledWith({
        where: { browserBindingHash: hash(admission.bindingSecret!) },
      });
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
                copiedFeatureIds: ['copied-feature'],
              }),
            );
          }),
      );

      await Promise.all(
        [1, 2, 3].map(() => t.service.provision(input, context())),
      );
      for (let tick = 0; tick < 50 && releases.length < 3; tick++) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      // Every visitor is cloning before any clone finishes.
      expect(releases).toHaveLength(3);
      for (const release of releases) release();
      await settle();

      expect(t.db.demoSandbox.create).toHaveBeenCalledTimes(3);
      expect(t.db.organizationMember.create).toHaveBeenCalledTimes(3);
    });

    it('keeps the reservation counted while the sandbox is prepared', async () => {
      const t = setup();
      let counted: unknown;
      t.clone.cloneInto.mockImplementation(async () => {
        counted = t.db.demoSandbox.create.mock.calls.length;
        return {
          idMap: new Map([['source-feature', 'copied-feature']]),
          copiedFeatureIds: ['copied-feature'],
        };
      });

      await t.service.provision(input, context());
      await settle();

      expect(counted).toBe(1);
    });

    it('discards the attempt when preparation fails, without waiting or activating', async () => {
      const t = setup();
      t.clone.cloneInto.mockRejectedValue(new Error('constraint violated'));

      await expect(
        t.service.provision(input, context()),
      ).resolves.toMatchObject({ admission: { state: 'PROVISIONING' } });
      await settle();

      expect(t.db.demoSandbox.updateMany).not.toHaveBeenCalled();
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
      expect(t.readiness.waitUntilConnected).not.toHaveBeenCalled();
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
    });

    it('discards the attempt when the clone copied no features', async () => {
      const t = setup();
      t.clone.cloneInto.mockResolvedValue({
        idMap: new Map(),
        copiedFeatureIds: [],
        graphCopyIntentId: 'intent-1',
      });

      await t.service.provision(input, context());
      await settle();

      expect(t.db.demoSandbox.updateMany).not.toHaveBeenCalled();
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
    });

    it('fails preparation when the reservation was discarded meanwhile', async () => {
      const t = setup();
      t.db.demoSandbox.updateMany.mockResolvedValue({ count: 0 });

      await t.service.provision(input, context());
      await settle();

      expect(t.readiness.waitUntilConnected).not.toHaveBeenCalled();
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
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
      await settle();

      expect(during).toBe(0);
    });

    it('discards the whole attempt when the copied features never all connect', async () => {
      const t = setup();
      t.readiness.waitUntilConnected.mockResolvedValue(false);

      await t.service.provision(input, context());
      await settle();

      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
    });

    it('swallows a failing discard so the deadline sweep can retry it', async () => {
      const t = setup();
      t.readiness.waitUntilConnected.mockResolvedValue(false);
      t.discard.discard.mockRejectedValueOnce(new Error('db down'));

      await t.service.provision(input, context());
      await expect(settle()).resolves.toBeUndefined();
      expect(t.discard.discard).toHaveBeenCalledTimes(1);
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

      await t.service.provision(input, context());
      await settle();

      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.projects.createProjectMembership).not.toHaveBeenCalled();
      expect(t.db.demoSandbox.update).not.toHaveBeenCalled();
      expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
    });
  });

  describe('scoped Graph readiness through provisioning', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const realReadiness = (
      t: ReturnType<typeof setup>,
      checkFeatureProjectConnection: jest.Mock,
    ) => {
      t.db.demoSandbox.findUnique.mockResolvedValue({
        organizationId: 'org-new',
        projectId: 'project-new',
        readinessFeatureIds: ['copied-feature', 'copied-feature-2'],
        provisioningDeadline: new Date(Date.now() + 120_000),
      });
      const readiness = new DemoSandboxReadinessService(
        { db: t.db } as never,
        { checkFeatureProjectConnection } as unknown as GraphsClientService,
        () => 'scoped-token',
      );
      t.readiness.waitUntilConnected.mockImplementation(
        readiness.waitUntilConnected.bind(readiness),
      );
    };

    it('withholds activation while only some features are connected, then activates on the full set', async () => {
      const t = setup();
      const checkFeatureProjectConnection = jest
        .fn()
        .mockResolvedValueOnce({ connectedCount: 1 })
        .mockResolvedValue({ connectedCount: 2 });
      realReadiness(t, checkFeatureProjectConnection);

      await t.service.provision(input, context());
      await jest.advanceTimersByTimeAsync(0);
      expect(t.db.organizationMember.create).not.toHaveBeenCalled();
      expect(t.db.demoSandbox.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'sandbox-new', status: DemoSandboxStatus.PROVISIONING },
        data: { connectedFeatureCount: 1 },
      });
      await jest.advanceTimersByTimeAsync(1_000);

      expect(t.db.organizationMember.create).toHaveBeenCalledTimes(1);
      expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
      expect(checkFeatureProjectConnection).toHaveBeenCalledTimes(2);
      expect(checkFeatureProjectConnection).toHaveBeenLastCalledWith(
        'org-new',
        'project-new',
        { featureIds: ['copied-feature', 'copied-feature-2'] },
        'scoped-token',
      );
    });

    it.each(['partial', 'unavailable'])(
      'discards safely when Graph stays %s through the deadline',
      async (state) => {
        const t = setup();
        const checkFeatureProjectConnection =
          state === 'partial'
            ? jest.fn().mockResolvedValue({ connectedCount: 1 })
            : jest.fn().mockRejectedValue(new Error('Graph unavailable'));
        realReadiness(t, checkFeatureProjectConnection);

        await t.service.provision(input, context());
        await jest.advanceTimersByTimeAsync(120_000);

        expect(t.discard.discard).toHaveBeenCalledWith('sandbox-new');
        expect(t.db.organizationMember.create).not.toHaveBeenCalled();
        expect(t.projects.createProjectMembership).not.toHaveBeenCalled();
        expect(t.browserSessions.establishInTransaction).not.toHaveBeenCalled();
      },
    );
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
