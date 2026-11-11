import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import type { PrismaService as PrismaServiceType } from '../prisma/prisma.service';
import type { ProjectService as ProjectServiceType } from '../services/project.service';
import { OrganizationId, UserId } from '../types';
import {
  findLocalDefaultProjectId,
  LOCAL_DEFAULT_PROJECT_NAME,
} from '../services/local-default-project.service';
import {
  InMemoryPostgres,
  startInMemoryPostgres,
} from './helpers/in-memory-postgres';

// Real provider selection, real entitlement enforcement and real project
// creation against a populated PostgreSQL engine (PGlite, in-process, with the
// shipped Flyway migrations). Only the boundaries that create no project data
// (workflow start, registry refresh, events, access checks) are stubbed.
jest.setTimeout(180_000);

const HOSTED_LIMIT = 2;

interface Harness {
  module: TestingModule;
  prisma: PrismaServiceType;
  projects: ProjectServiceType;
  entitlement: {
    resolve(organizationId: OrganizationId): Promise<Record<string, unknown>>;
  };
}

// Loads every application module fresh under the requested deployment so the
// conditional provider in domain.providers.ts is evaluated for real.
async function buildHarness(local: boolean): Promise<Harness> {
  process.env.DEPLOYMENT_ENVIRONMENT = local ? 'local' : 'test';
  if (local) {
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
  } else {
    delete process.env.HEYHEY_LOCAL_APPLICATION;
  }

  let harness: Harness | undefined;
  let pending: Promise<Harness> | undefined;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { DOMAIN_SERVICES } = require('../domain/domain.providers') as {
      DOMAIN_SERVICES: Provider[];
    };
    const { PrismaService } = require('../prisma/prisma.service');
    const { ProjectService } = require('../services/project.service');
    const {
      EntityRegistryService,
    } = require('../services/entity-registry/entity-registry.service');
    const {
      OrganizationProjectEntitlementService,
    } = require('../services/organization-project-entitlement.service');
    const {
      ProjectAccessService,
    } = require('../auth/services/project-access.service');
    const {
      ProjectMembershipRevocationService,
    } = require('../core/websockets/project-membership-revocation.service');
    const {
      WorkItemTypeRegistryService,
    } = require('../services/tasks/work-item-type-registry.service');
    const {
      WorkflowTypeRegistryService,
    } = require('../services/workflows/workflow-type-registry.service');
    const { TEMPORAL_CLIENT } = require('../prisma/temporal.module');
    const { DOMAIN_EVENT_PUBLISHER_TOKEN } = require('../core/events/tokens');
    const TestUtils = require('../utils/testUtils');
    /* eslint-enable @typescript-eslint/no-require-imports */

    // The entitlement provider comes from the real domain provider list.
    const entitlement = DOMAIN_SERVICES.find(
      (provider) =>
        typeof provider === 'object' &&
        'provide' in provider &&
        provider.provide === OrganizationProjectEntitlementService,
    ) as Provider;

    pending = Test.createTestingModule({
      providers: [
        PrismaService,
        ProjectService,
        EntityRegistryService,
        entitlement,
        { provide: ProjectMembershipRevocationService, useValue: {} },
        {
          provide: ProjectAccessService,
          useValue: { assertOrganizationRole: async () => undefined },
        },
        { provide: TEMPORAL_CLIENT, useValue: {} },
        {
          provide: WorkflowTypeRegistryService,
          useValue: {
            startWorkflowByType: async () => ({ workflowId: randomUUID() }),
          },
        },
        {
          provide: WorkItemTypeRegistryService,
          useValue: {
            refresh: async () => undefined,
            publishConfigChanged: async () => undefined,
          },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: TestUtils.createMockDomainEventPublisher(),
        },
      ],
    })
      .compile()
      .then(async (module) => ({
        module,
        prisma: module.get(PrismaService),
        projects: module.get(ProjectService),
        entitlement: module.get(OrganizationProjectEntitlementService),
      }));
  });
  harness = await pending;
  if (!harness) {
    throw new Error('Test module was not built');
  }
  await harness.prisma.$connect();
  return harness;
}

describe('Project limit with a populated database', () => {
  const previousEnvironment = {
    deployment: process.env.DEPLOYMENT_ENVIRONMENT,
    local: process.env.HEYHEY_LOCAL_APPLICATION,
    database: process.env.PROJECT_DATABASE_URL,
  };
  const harnesses: Harness[] = [];
  let database: InMemoryPostgres;

  beforeAll(async () => {
    database = await startInMemoryPostgres();
    process.env.PROJECT_DATABASE_URL = database.url;
  });

  const harnessFor = async (local: boolean) => {
    const harness = await buildHarness(local);
    harnesses.push(harness);
    return harness;
  };

  // An organization that already holds `existing` projects and, optionally,
  // a stored override row, as left behind by the hosted limit or a manual fix.
  const seedOrganization = async (
    prisma: PrismaServiceType,
    existing: number,
    override?: number,
  ) => {
    const userId = randomUUID() as UserId;
    const organizationId = randomUUID() as OrganizationId;
    await prisma.db.organization.create({
      data: { id: organizationId, name: 'Limit', slug: `l-${organizationId}` },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `limit-${userId}@example.test`,
        name: 'Limit Person',
        passwordHash: 'unused',
        defaultOrganizationId: organizationId,
        memberships: { create: { organizationId, role: 'OWNER' } },
      },
    });
    for (let index = 0; index < existing; index += 1) {
      await prisma.db.project.create({
        data: {
          organizationId,
          name: `Existing ${index}`,
          createdBy: userId,
        },
      });
    }
    if (override !== undefined) {
      await prisma.db.organizationProjectEntitlement.create({
        data: { organizationId, projectLimitOverride: override },
      });
    }
    return { userId, organizationId };
  };

  const activeProjectCount = (
    prisma: PrismaServiceType,
    organizationId: OrganizationId,
  ) => prisma.db.project.count({ where: { organizationId, deletedAt: null } });

  // The in-memory engine serves one connection at a time, so each test's
  // application graph releases it before the next one starts. Every test uses
  // its own organization, and the database is discarded with the suite.
  afterEach(async () => {
    for (const { prisma, module } of harnesses.splice(0)) {
      await prisma.$disconnect();
      await module.close();
    }
  });

  afterAll(async () => {
    await database.close();
    for (const [key, value] of [
      ['DEPLOYMENT_ENVIRONMENT', previousEnvironment.deployment],
      ['HEYHEY_LOCAL_APPLICATION', previousEnvironment.local],
      ['PROJECT_DATABASE_URL', previousEnvironment.database],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('local installation', () => {
    it('creates a project past the old default and past a lower stored override', async () => {
      const { prisma, projects } = await harnessFor(true);
      const { userId, organizationId } = await seedOrganization(
        prisma,
        HOSTED_LIMIT + 3,
        1,
      );

      const created = await projects.create(
        { name: 'Sixth', organizationId },
        userId,
      );

      expect(created.organizationId).toBe(organizationId);
      expect(await activeProjectCount(prisma, organizationId)).toBe(
        HOSTED_LIMIT + 4,
      );
    });

    it('reports no limit through the entitlement result and still records usage', async () => {
      const { prisma, entitlement } = await harnessFor(true);
      const { organizationId } = await seedOrganization(prisma, 4, 1);

      const result = await entitlement.resolve(organizationId);

      expect(result).toMatchObject({
        projectLimit: null,
        projectLimitOverride: null,
        canCreateProject: true,
        creationUnavailableReason: null,
        usage: { projectCount: 4 },
      });
      const usage = await prisma.db.organizationCapacityUsage.findUniqueOrThrow(
        {
          where: { organizationId },
        },
      );
      expect(usage.projectCount).toBe(4);
    });

    // LocalDefaultProjectService.ensure holds an advisory-lock transaction
    // while ProjectService.create opens its own, which needs two connections;
    // the in-memory engine serves one. So this creates the setup project the
    // way ensure does (ProjectService.create with the local default name,
    // description and organization) and checks how the result behaves.
    it('creates the first-time setup project as an ordinary project that counts toward usage', async () => {
      const { prisma, projects, entitlement } = await harnessFor(true);
      const { userId, organizationId } = await seedOrganization(prisma, 0);

      const created = await projects.create(
        {
          name: LOCAL_DEFAULT_PROJECT_NAME,
          description: null,
          organizationId,
        },
        userId,
      );

      expect(await findLocalDefaultProjectId(prisma.db, organizationId)).toBe(
        created.id,
      );
      expect(await activeProjectCount(prisma, organizationId)).toBe(1);

      // The setup project is not special: later projects go past the old
      // default alongside it.
      for (let index = 0; index < HOSTED_LIMIT + 1; index += 1) {
        await projects.create(
          { name: `After setup ${index}`, organizationId },
          userId,
        );
      }
      expect(await entitlement.resolve(organizationId)).toMatchObject({
        projectLimit: null,
        canCreateProject: true,
        usage: { projectCount: HOSTED_LIMIT + 2 },
      });
    });
  });

  describe('hosted deployment', () => {
    it('rejects creation at the default limit with the project-limit conflict and creates nothing', async () => {
      const { prisma, projects } = await harnessFor(false);
      const { userId, organizationId } = await seedOrganization(
        prisma,
        HOSTED_LIMIT,
      );

      await expect(
        projects.create({ name: 'Over', organizationId }, userId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ORGANIZATION_PROJECT_LIMIT_REACHED',
        }),
      });
      expect(await activeProjectCount(prisma, organizationId)).toBe(
        HOSTED_LIMIT,
      );
    });

    it('honors a stored override: allows up to it and rejects beyond it', async () => {
      const { prisma, projects } = await harnessFor(false);
      const { userId, organizationId } = await seedOrganization(
        prisma,
        HOSTED_LIMIT,
        HOSTED_LIMIT + 1,
      );

      await projects.create({ name: 'Third', organizationId }, userId);

      await expect(
        projects.create({ name: 'Fourth', organizationId }, userId),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'ORGANIZATION_PROJECT_LIMIT_REACHED',
        }),
      });
      expect(await activeProjectCount(prisma, organizationId)).toBe(
        HOSTED_LIMIT + 1,
      );
    });
  });
});
