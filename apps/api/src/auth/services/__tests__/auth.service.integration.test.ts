import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ModuleRef } from '@nestjs/core';

import { RegisterDto } from '@hey-hey/contracts/api/models';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationService } from '../../../services/organization.service';
import { UserService } from '../../../services/user.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { ConversationController } from '../../../controllers/conversation.controller';
import { ExecutionGrantService } from '../../../services/controller-authorization/execution-grant.service';
import { AuthService } from '../auth.service';
import { BrowserSessionService } from '../browser-session.service';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { JwtKeysService } from '../jwt-keys.service';
import { ProjectService } from '../../../services/project.service';
import { LocalDefaultProjectService } from '../../../services/local-default-project.service';
import { ProjectAccessService } from '../project-access.service';
import { OrganizationProjectEntitlementService } from '../../../services/organization-project-entitlement.service';
import { EntityRegistryService } from '../../../services/entity-registry/entity-registry.service';

const describeDatabase =
  process.env.RUN_AUTH_DB_TESTS === '1' && process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('AuthService registration browser session handoff', () => {
  const policy = {
    BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
    BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
    BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  };

  let prisma: PrismaService;
  let authService: AuthService;
  let userId: UserId;
  let userService: jest.Mocked<UserService>;
  let organizationService: jest.Mocked<OrganizationService>;
  let localInstallationSecret: string | undefined;
  let localDefaultProjects: () => LocalDefaultProjectService;
  let jwtKeysService: JwtKeysService;
  let browserSessionService: BrowserSessionService;
  // Temporal is the system boundary; project creation itself runs for real.
  const startWorkflowByType = jest.fn(async () => ({
    workflowId: `onboarding-${randomUUID()}`,
  }));
  const handoffEntries = new Map<string, string>();
  const redisClient = {
    set: jest.fn(async (key: string, value: string) => {
      if (handoffEntries.has(key)) return null;
      handoffEntries.set(key, value);
      return 'OK';
    }),
    getdel: jest.fn(async (key: string) => {
      const value = handoffEntries.get(key) ?? null;
      handoffEntries.delete(key);
      return value;
    }),
    exists: jest.fn(async (key: string) =>
      Number(connectedMachineIds.has(key.replace('machine:presence:', ''))),
    ),
  };
  const redisService = { getClient: jest.fn(() => redisClient) };
  const connectedMachineIds = new Set<string>();

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    userId = randomUUID() as UserId;
    const configService = {
      get: jest.fn((key: string) => policy[key as keyof typeof policy]),
    } as unknown as ConfigService;
    jwtKeysService = {
      signToken: jest.fn(
        (payload: { sid?: string }) => `access-${payload.sid}`,
      ),
    } as unknown as JwtKeysService;
    browserSessionService = new BrowserSessionService(
      configService,
      prisma,
      jwtKeysService,
      {
        assertOrganizationAuthorized: jest.fn(),
        isOrganizationAuthorized: jest.fn().mockResolvedValue(true),
        getAuthorizedOrganizationIds: jest.fn(
          async (organizationIds: string[]) => new Set(organizationIds),
        ),
      } as unknown as AccountEntitlementService,
    );

    userService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn(async (dto: RegisterDto) =>
        prisma.db.user.create({
          data: {
            id: userId,
            email: dto.email,
            name: dto.name,
            passwordHash: 'registration-integration-test',
          },
        }),
      ),
      updateLastLogin: jest.fn(async (id: UserId) => {
        await prisma.db.user.update({
          where: { id },
          data: { lastLoginAt: new Date() },
        });
      }),
      getUserWithOrganizations: jest.fn(async (id: UserId) => {
        const user = await prisma.db.user.findUniqueOrThrow({
          where: { id },
        });

        return {
          id: user.id as UserId,
          email: user.email,
          name: user.name,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          currentOrganizationId: null,
        };
      }),
    } as unknown as jest.Mocked<UserService>;
    organizationService = {
      getUserMemberships: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<OrganizationService>;

    // A fresh owner per call stands in for an API restart between saves.
    localDefaultProjects = () =>
      new LocalDefaultProjectService(
        prisma,
        new ProjectService(
          {} as never,
          prisma,
          new ProjectAccessService(prisma),
          {} as never,
          {
            refresh: jest.fn(),
            publishConfigChanged: jest.fn(),
          } as never,
          { startWorkflowByType } as never,
          new OrganizationProjectEntitlementService(prisma),
          new EntityRegistryService(prisma),
          { publishInTransaction: jest.fn(async () => null) } as never,
        ),
      );
    authService = createAuthService();
  });

  const createAuthService = (): AuthService =>
    new AuthService(
      userService,
      organizationService,
      jwtKeysService,
      {} as never,
      browserSessionService,
      {} as never,
      prisma,
      {} as never,
      {} as never,
      redisService as never,
      localDefaultProjects(),
    );

  afterAll(async () => {
    if (prisma) {
      if (localInstallationSecret) {
        const localIdentity = createHmac('sha256', localInstallationSecret)
          .update('heyhey-local-identity-v1')
          .digest('hex');
        const localUser = await prisma.db.user.findUnique({
          where: { email: `local-${localIdentity}@local.invalid` },
        });
        if (localUser) {
          const memberships = await prisma.db.organizationMember.findMany({
            where: { userId: localUser.id },
            select: { organizationId: true },
          });
          await prisma.db.organization.deleteMany({
            where: {
              id: {
                in: memberships.map(({ organizationId }) => organizationId),
              },
            },
          });
          await prisma.db.user.delete({ where: { id: localUser.id } });
        }
      }
    }
    if (userId) {
      await prisma.db.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });

  it('persists one registration session and renews its opaque refresh secret', async () => {
    const registration = await authService.register(
      {
        email: `${userId}@registration-session.test`,
        password: 'registration-password',
        name: 'Registration Integration User',
      },
      {
        ipAddress: '203.0.113.30',
        userAgent: 'registration-integration-test',
      },
    );

    expect(registration.response).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(registration.response)).not.toContain(
      registration.refreshSecret,
    );

    const family = await prisma.db.browserSessionFamily.findUniqueOrThrow({
      where: { id: registration.familyId },
      include: { refreshGenerations: true },
    });
    expect(family.userId).toBe(userId);
    expect(family.refreshGenerations).toHaveLength(1);
    expect(family.refreshGenerations[0]?.generation).toBe(0);
    expect(family.refreshGenerations[0]?.secretHash).toBe(
      createHash('sha256').update(registration.refreshSecret).digest('hex'),
    );
    expect(family.refreshGenerations[0]?.secretHash).not.toBe(
      registration.refreshSecret,
    );

    const renewal = await authService.refreshToken(registration.refreshSecret, {
      userAgent: 'registration-integration-test',
    });

    expect(renewal.response).not.toHaveProperty('refreshToken');
    expect(renewal.refreshSecret).not.toBe(registration.refreshSecret);
    expect(JSON.stringify(renewal.response)).not.toContain(
      renewal.refreshSecret,
    );

    const generations = await prisma.db.refreshGeneration.findMany({
      where: { browserSessionFamilyId: registration.familyId },
      orderBy: { generation: 'asc' },
    });
    expect(generations).toHaveLength(2);
    expect(generations[0]?.consumedAt).not.toBeNull();
    expect(generations[1]?.generation).toBe(1);
    expect(generations[1]?.secretHash).toBe(
      createHash('sha256').update(renewal.refreshSecret).digest('hex'),
    );
  });

  it('bootstraps one local identity and exchanges its one-use handoff for a persisted browser session', async () => {
    const originalEnvironment = {
      deployment: process.env.DEPLOYMENT_ENVIRONMENT,
      localApplication: process.env.HEYHEY_LOCAL_APPLICATION,
      installationSecret: process.env.LOCAL_INSTALLATION_SECRET,
    };
    const installationSecret = randomUUID();
    localInstallationSecret = installationSecret;
    process.env.DEPLOYMENT_ENVIRONMENT = 'local';
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
    process.env.LOCAL_INSTALLATION_SECRET = installationSecret;
    handoffEntries.clear();
    connectedMachineIds.clear();

    const actualOrganizationService = new OrganizationService(
      {} as never,
      {} as never,
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const actualUserService = new UserService(
      prisma,
      actualOrganizationService,
      new AccountEntitlementService(prisma),
      {} as ModuleRef,
    );
    userService.createLocalBootstrapUser = jest.fn(
      actualUserService.createLocalBootstrapUser.bind(actualUserService),
    );
    userService.findForAuthentication = jest.fn(
      actualUserService.findForAuthentication.bind(actualUserService),
    );
    userService.getUserWithOrganizations = jest.fn(
      actualUserService.getUserWithOrganizations.bind(actualUserService),
    );
    organizationService.getUserMemberships = jest.fn(
      actualOrganizationService.getUserMemberships.bind(
        actualOrganizationService,
      ),
    );

    try {
      const [firstHandoff, secondHandoff] = await Promise.all([
        authService.createLocalHandoff(installationSecret),
        authService.createLocalHandoff(installationSecret),
      ]);
      const identity = createHmac('sha256', installationSecret)
        .update('heyhey-local-identity-v1')
        .digest('hex');
      const email = `local-${identity}@local.invalid`;
      const users = await prisma.db.user.findMany({ where: { email } });
      expect(users).toHaveLength(1);
      expect(users[0]?.name).toBe('');
      expect(users[0]?.isActive).toBe(true);
      expect(users[0]?.isDevAdmin).toBe(false);
      expect(users[0]?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(users[0]?.email).toMatch(/^local-[a-f0-9]{64}@local\.invalid$/);

      const memberships = await prisma.db.organizationMember.findMany({
        where: { userId: users[0]?.id, isActive: true },
        include: { organization: true },
      });
      expect(memberships).toHaveLength(1);
      // Without an entitlement the access check rejects every request from the local user.
      await expect(
        prisma.db.accountEntitlement.count({
          where: { organizationId: memberships[0]!.organizationId },
        }),
      ).resolves.toBe(1);

      const simulatedMachine = await prisma.db.machine.create({
        data: {
          userId: users[0]!.id,
          organizationId: memberships[0]!.organizationId,
          name: 'Integration test machine',
          publicKey: 'local-handoff-integration-public-key',
          tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          authorizationProtocolVersion: 2,
          authorizationState: 'CONTROLLER_ENROLLMENT_REQUIRED',
        },
      });
      connectedMachineIds.add(simulatedMachine.id);

      const session = await authService.completeLocalHandoff(
        firstHandoff.handoffToken,
        { userAgent: 'local-handoff-integration-test' },
      );
      expect(session.response).toHaveProperty('accessToken');
      expect(session.response.user).toMatchObject({
        id: users[0]?.id,
        isLocalAccount: true,
      });
      const localUserId = users[0]!.id as UserId;
      const localOrganizationId = memberships[0]!.organizationId;
      // Concurrent first saves, a retry and a save after restart all
      // converge on the single project pairing will grant access to.
      const statuses = await Promise.all([
        authService.updateLocalDisplayName(localUserId, 'Ada Lovelace'),
        createAuthService().updateLocalDisplayName(localUserId, 'Ada Lovelace'),
      ]);
      await authService.updateLocalDisplayName(localUserId, 'Ada Lovelace');
      const afterRestart = await createAuthService().updateLocalDisplayName(
        localUserId,
        'Ada Lovelace',
      );
      const projects = await prisma.db.project.findMany({
        where: { organizationId: localOrganizationId },
        include: { members: true },
      });
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({
        status: 'ONBOARDING',
        createdBy: localUserId,
        description: null,
      });
      expect(projects[0]!.members).toEqual([
        expect.objectContaining({ userId: localUserId, role: 'OWNER' }),
      ]);
      expect(startWorkflowByType).toHaveBeenCalledTimes(1);
      for (const status of [...statuses, afterRestart]) {
        expect(status).toMatchObject({
          nameComplete: true,
          hasProjects: true,
          setupProjectId: projects[0]!.id,
        });
      }
      const refreshedSession = await authService.refreshToken(
        session.refreshSecret,
        { userAgent: 'local-handoff-integration-test' },
      );
      expect(refreshedSession.response.user).toMatchObject({
        name: 'Ada Lovelace',
        isLocalAccount: true,
      });
      await expect(
        authService.getLocalStatus(users[0]!.id as UserId),
      ).resolves.toMatchObject({
        browserSession: true,
        machineConnected: true,
        executionReady: false,
      });
      // Leaving onboarding completes setup: return visits enter the workspace.
      await prisma.db.project.update({
        where: { id: projects[0]!.id },
        data: { status: 'ACTIVE' },
      });
      await expect(
        authService.getLocalStatus(localUserId),
      ).resolves.toMatchObject({ hasProjects: true, setupProjectId: null });
      await prisma.db.project.update({
        where: { id: projects[0]!.id },
        data: { status: 'ONBOARDING' },
      });
      // Exercise the launch boundary with the automatically authenticated user,
      // not merely the readiness projection. No controller proof or grant is
      // supplied: a live local connection must not confer execution authority.
      const submitPrepared = jest.fn();
      const launchController = new ConversationController(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        new ExecutionGrantService(prisma, {} as never, {} as never),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { submitPrepared } as never,
      );
      // JSON is the untrusted request boundary; deliberately omit the required
      // authorization field rather than inventing valid controller evidence.
      const launchBody = JSON.parse(
        JSON.stringify({
          machineId: simulatedMachine.id,
          agentSessionId: randomUUID(),
          operationId: randomUUID(),
          operationFingerprint: '0'.repeat(64),
          handlerPromptType: 'entity_conversation',
          model: 'test-model',
          contextMetadata: {
            capturedAt: new Date().toISOString(),
            organizationId: memberships[0]!.organizationId,
            projectId: randomUUID(),
            agentSessionId: randomUUID(),
            userComments: [],
            fileReferences: { resolved: [], unresolved: [] },
          },
        }),
      );
      await expect(
        launchController.startConversationRun(
          launchBody.contextMetadata.projectId as ProjectId,
          randomUUID() as ConversationId,
          memberships[0]!.organizationId as OrganizationId,
          session.response.user.id as UserId,
          launchBody,
        ),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_CONTROLLER_AUTHORIZATION' },
      });
      expect(submitPrepared).not.toHaveBeenCalled();
      expect(
        await prisma.db.executionGrant.count({
          where: { userId: users[0]!.id },
        }),
      ).toBe(0);
      expect(
        await prisma.db.agentOperation.count({
          where: { userId: users[0]!.id },
        }),
      ).toBe(0);

      await expect(
        authService.completeLocalHandoff(firstHandoff.handoffToken, {}),
      ).rejects.toThrow('Local browser handoff expired');

      const persistedFamily = await prisma.db.browserSessionFamily.findUnique({
        where: { id: session.familyId },
        include: { refreshGenerations: true },
      });
      expect(persistedFamily?.userId).toBe(users[0]?.id);
      expect(persistedFamily?.refreshGenerations).toHaveLength(2);
      expect(secondHandoff.handoffToken).not.toBe(firstHandoff.handoffToken);
    } finally {
      for (const [key, value] of Object.entries({
        DEPLOYMENT_ENVIRONMENT: originalEnvironment.deployment,
        HEYHEY_LOCAL_APPLICATION: originalEnvironment.localApplication,
        LOCAL_INSTALLATION_SECRET: originalEnvironment.installationSecret,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
