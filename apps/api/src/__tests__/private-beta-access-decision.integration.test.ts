import { PrivateBetaAccessController } from '../controllers/private-beta-access.controller';
import { PrivateBetaAccessService } from '../services/private-beta-access.service';
import { ConfigService } from '@nestjs/config';
import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ModuleRef } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import { ExtractJwt, Strategy as PassportJwtStrategy } from 'passport-jwt';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { createHash, createHmac, randomUUID } from 'node:crypto';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { PASSWORD_CHANGE_CREDENTIAL_ISSUER } from '../auth/password-change-credential.types';
import { PasswordChangeCredentialService } from '../auth/services/password-change-credential.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrivateBetaAccessDecisionController } from '../controllers/private-beta-access-decision.controller';
import { PrivateBetaAccessProgramController } from '../controllers/private-beta-access-program.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from '../services/api-key.service';
import { BetaOnboardingService } from '../services/beta-onboarding.service';
import { EmailService } from '../services/email.service';
import { OrganizationService } from '../services/organization.service';
import { PrivateBetaAccessDecisionService } from '../services/private-beta-access-decision.service';
import { PrivateBetaAccessProgramService } from '../services/private-beta-access-program.service';
import { ProjectService } from '../services/project.service';
import { SecurityLoggerService } from '../services/security-logger.service';
import { UserService } from '../services/user.service';
import { AccountEntitlementService } from '../services/account-entitlement.service';

jest.setTimeout(60_000);

const describeDatabase =
  process.env.RUN_PRIVATE_BETA_ACCESS_DECISION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

const TEST_JWT_SECRET = 'private-beta-decision-integration-jwt-secret';
const PASSWORD_CHANGE_IDEMPOTENCY_SECRET =
  'private-beta-decision-integration-idempotency-secret';
const ADMIN_USER_ID = '550e8400-e29b-41d4-a716-446655440030';
const NON_ADMIN_USER_ID = '550e8400-e29b-41d4-a716-446655440031';

type Decision = 'APPROVE' | 'REJECT';

type Intake = {
  email: string;
  name: string;
  organizationName: string;
  productContext: string;
  accessRationale: string;
};

type WelcomeEmailParameters = Parameters<EmailService['sendWelcomeEmail']>[0];

@Injectable()
class DecisionTestJwtStrategy extends PassportStrategy(
  PassportJwtStrategy,
  'jwt',
) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: TEST_JWT_SECRET,
      algorithms: ['HS256'],
    });
  }

  validate(payload: { sub: string }): AuthenticatedUser {
    return { userId: payload.sub } as AuthenticatedUser;
  }
}

describeDatabase('Private-beta access decision API integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let moduleRef: TestingModule;
  let sendWelcomeEmail: jest.MockedFunction<EmailService['sendWelcomeEmail']>;
  const requestIds: string[] = [];
  let loggerSpies: jest.SpyInstance[] = [];

  const config = new ConfigService({
    ADMIN_USER_IDS: ADMIN_USER_ID,
    NODE_ENV: 'test',
    PASSWORD_CHANGE_IDEMPOTENCY_SECRET,
    PASSWORD_CHANGE_TOKEN_TTL_SECONDS: '900',
    SECRET_KEY: 'private-beta-decision-integration-encryption-secret',
  });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    sendWelcomeEmail = jest
      .fn<
        ReturnType<EmailService['sendWelcomeEmail']>,
        [WelcomeEmailParameters]
      >()
      .mockResolvedValue(undefined);
    const emailService = {
      sendWelcomeEmail,
    } as unknown as EmailService;

    const passwordChangeCredentialService = new PasswordChangeCredentialService(
      config,
      prisma,
      {} as UserService,
      {} as never,
    );
    const credentialModuleRef = {
      get: (token: unknown) =>
        token === PASSWORD_CHANGE_CREDENTIAL_ISSUER
          ? passwordChangeCredentialService
          : undefined,
    } as unknown as ModuleRef;
    const apiKeyService = new ApiKeyService(prisma, config);
    const accountEntitlementService = new AccountEntitlementService(prisma);
    const organizationService = new OrganizationService(
      { membershipRemoved: jest.fn() } as never,
      {} as never,
      prisma,
      {} as SecurityLoggerService,
      apiKeyService,
      {} as ProjectService,
      {} as UserService,
      emailService,
      accountEntitlementService,
    );
    const programService = new PrivateBetaAccessProgramService(prisma);
    const userService = new UserService(
      prisma,
      organizationService,
      accountEntitlementService,
      credentialModuleRef,
    );
    const onboardingService = new BetaOnboardingService(
      userService,
      emailService,
      apiKeyService,
    );
    const decisionService = new PrivateBetaAccessDecisionService(
      prisma,
      onboardingService,
      programService,
      accountEntitlementService,
    );

    moduleRef = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        PrivateBetaAccessDecisionController,
        PrivateBetaAccessController,
        PrivateBetaAccessProgramController,
      ],
      providers: [
        {
          provide: PrivateBetaAccessService,
          useValue: new PrivateBetaAccessService(
            prisma,
            programService,
            decisionService,
          ),
        },
        DecisionTestJwtStrategy,
        JwtAuthGuard,
        AdminGuard,
        { provide: ConfigService, useValue: config },
        {
          provide: PrivateBetaAccessDecisionService,
          useValue: decisionService,
        },
        {
          provide: PrivateBetaAccessProgramService,
          useValue: programService,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useLogger(false);
    await app.init();
  });

  beforeEach(() => {
    sendWelcomeEmail.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    loggerSpies.forEach((spy) => spy.mockRestore());
    loggerSpies = [];

    await prisma.db.privateBetaAccessProgramState.update({
      where: { id: 'private-beta' },
      data: {
        closedAt: null,
        closedByUserId: null,
        selfServiceAdmissionMode: 'OPEN',
        selfServiceAdmissionUpdatedByUserId: null,
      },
    });

    for (const requestId of requestIds.splice(0)) {
      await removeRequestAndProvisionedResources(requestId);
    }
  });

  afterAll(async () => {
    await app.close();
    await moduleRef.close();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated, non-admin, and missing-request decisions without mutation', async () => {
    const intake = makeIntake();
    const requestId = await createPendingRequest(intake);

    await postDecision(requestId, 'REJECT').expect(401);
    await postDecision(requestId, 'REJECT', tokenFor(NON_ADMIN_USER_ID)).expect(
      403,
    );
    await postAdminDecision(randomUUID(), 'REJECT').expect(404);

    await expectStoredRequest(requestId, {
      status: 'PENDING',
      decisionAt: null,
      provisionedUserId: null,
      provisionedOrganizationId: null,
      provisioningCompletedAt: null,
      provisioningError: null,
    });
    await expectNoProvisioningSideEffects(requestId, intake);
  });

  it('makes rejection terminal and creates no onboarding or welcome-delivery side effects', async () => {
    const intake = makeIntake();
    const requestId = await createPendingRequest(intake);

    const response = await postAdminDecision(requestId, 'REJECT').expect(200);

    expect(response.body).toMatchObject({
      requestId,
      decision: 'REJECT',
      status: 'REJECTED',
      provisioningOutcome: null,
    });
    const rejected = await expectStoredRequest(requestId, {
      status: 'REJECTED',
      decisionAt: expect.any(Date),
      provisionedUserId: null,
      provisionedOrganizationId: null,
      provisioningCompletedAt: null,
      provisioningError: null,
    });
    expect(rejected.decisionAt).not.toBeNull();

    await postAdminDecision(requestId, 'REJECT').expect(409);
    await expectNoProvisioningSideEffects(requestId, intake);
  });

  it('allows one concurrent approval claimant and persists one canonical onboarding outcome', async () => {
    const intake = makeIntake();
    const requestId = await createPendingRequest(intake);

    const responses = await Promise.all([
      postAdminDecision(requestId, 'APPROVE'),
      postAdminDecision(requestId, 'APPROVE'),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual(
      expect.arrayContaining([200]),
    );
    expect(
      responses.every((response) => [200, 409].includes(response.status)),
    ).toBe(true);
    const approved = await expectSuccessfulProvisioning(requestId, intake);
    expect(approved.status).toBe('APPROVED');
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('replays an approved decision without duplicating resources or welcome delivery', async () => {
    const intake = makeIntake();
    const requestId = await createPendingRequest(intake);

    const first = await postAdminDecision(requestId, 'APPROVE').expect(200);
    const approved = await expectSuccessfulProvisioning(requestId, intake);
    const transitionCountBeforeReplay =
      await prisma.db.accountEntitlementTransition.count({
        where: { organizationId: approved.provisionedOrganizationId! },
      });
    const replay = await postAdminDecision(requestId, 'APPROVE').expect(200);

    expect(replay.body).toEqual(first.body);
    await expectSuccessfulProvisioning(requestId, intake);
    expect(
      await prisma.db.accountEntitlementTransition.count({
        where: { organizationId: approved.provisionedOrganizationId! },
      }),
    ).toBe(transitionCountBeforeReplay);
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'missing',
      async (organizationId: string) => {
        await prisma.db.accountEntitlement.delete({
          where: { organizationId },
        });
      },
    ],
    [
      'conflicting',
      async (organizationId: string) => {
        await prisma.db.accountEntitlement.update({
          where: { organizationId },
          data: { createdReason: 'PRIVATE_BETA_ADMISSION:another-request' },
        });
      },
    ],
  ])(
    'returns a bounded provisioning failure for %s entitlement state on approved replay',
    async (_case, corruptEntitlement) => {
      const intake = makeIntake();
      const requestId = await createPendingRequest(intake);

      await postAdminDecision(requestId, 'APPROVE').expect(200);
      const approved = await expectSuccessfulProvisioning(requestId, intake);
      await corruptEntitlement(approved.provisionedOrganizationId!);

      const replay = await postAdminDecision(requestId, 'APPROVE').expect(200);

      expect(replay.body).toMatchObject({
        requestId,
        decision: 'APPROVE',
        status: 'PROVISIONING_FAILED',
        provisioningOutcome: {
          status: 'FAILED',
          failureCode: 'ORGANIZATION_PROVISIONING',
          failureMessage: 'Private-beta provisioning could not be completed.',
          retryable: true,
        },
      });
      expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
      expect(
        await prisma.db.accountEntitlementTransition.count({
          where: { organizationId: approved.provisionedOrganizationId! },
        }),
      ).toBe(_case === 'missing' ? 0 : 1);
    },
  );

  it('records a bounded partial failure, then retries from checkpoints without duplicate provisioning', async () => {
    const intake = makeIntake();
    const requestId = await createPendingRequest(intake);
    const sensitiveValues = [
      intake.email,
      intake.productContext,
      intake.accessRationale,
    ];
    const expectedCredential = expectedWelcomeCredential(requestId);
    const logCalls = ['debug', 'log', 'warn', 'error'].map((method) =>
      jest.spyOn(Logger.prototype, method as 'debug'),
    );
    loggerSpies = logCalls;

    const provisioningError = new Error(
      `deterministic welcome provider failure ${'x'.repeat(3000)}`,
    );
    sendWelcomeEmail.mockRejectedValueOnce(provisioningError);

    const failedResponse = await postAdminDecision(requestId, 'APPROVE').expect(
      200,
    );
    expect(failedResponse.body).toMatchObject({
      status: 'PROVISIONING_FAILED',
      provisioningOutcome: {
        status: 'FAILED',
        failureCode: 'WELCOME_EMAIL',
        failureMessage: 'Private-beta provisioning could not be completed.',
        retryable: true,
      },
    });
    const serializedError = JSON.stringify(failedResponse.body);
    expect(
      [...sensitiveValues, expectedCredential].every(
        (value) => !serializedError.includes(value),
      ),
    ).toBe(true);

    const failed = await expectStoredRequest(requestId, {
      status: 'PROVISIONING_FAILED',
      decisionAt: expect.any(Date),
      provisioningAttemptedAt: expect.any(Date),
      provisioningCompletedAt: expect.any(Date),
      provisioningFailureCode: 'WELCOME_EMAIL',
      provisioningError: 'Private-beta provisioning could not be completed.',
      welcomeEmailIdempotencyKey: null,
      welcomeEmailSentAt: null,
    });
    expect(failed.provisionedUserId).not.toBeNull();
    expect(failed.provisionedOrganizationId).not.toBeNull();
    expect(failed.provisioningCredentialId).not.toBeNull();
    expect(failed.provisioningOrganizationApiKeyId).not.toBeNull();
    expect(await countUser(intake.email)).toBe(1);
    expect(
      await prisma.db.organization.count({
        where: { id: failed.provisionedOrganizationId! },
      }),
    ).toBe(1);
    expect(
      await prisma.db.passwordChangeCredential.count({
        where: { privateBetaAccessRequestId: requestId },
      }),
    ).toBe(1);
    expect(
      await prisma.db.apiKey.count({
        where: { organizationId: failed.provisionedOrganizationId! },
      }),
    ).toBe(1);
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);

    sendWelcomeEmail.mockResolvedValueOnce(undefined);
    const retriedResponse = await postAdminDecision(
      requestId,
      'APPROVE',
    ).expect(200);
    expect(retriedResponse.body.status).toBe('APPROVED');

    const approved = await expectSuccessfulProvisioning(requestId, intake);
    expect(approved.provisioningAttemptedAt!.getTime()).toBeGreaterThanOrEqual(
      failed.provisioningAttemptedAt!.getTime(),
    );
    expect(approved.provisionedUserId).toBe(failed.provisionedUserId);
    expect(approved.provisionedOrganizationId).toBe(
      failed.provisionedOrganizationId,
    );
    expect(approved.provisioningCredentialId).toBe(
      failed.provisioningCredentialId,
    );
    expect(approved.provisioningOrganizationApiKeyId).toBe(
      failed.provisioningOrganizationApiKeyId,
    );
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(2);
    expect(
      sendWelcomeEmail.mock.calls.map(
        ([parameters]) => parameters.providerIdempotencyKey,
      ),
    ).toEqual([
      `private-beta-welcome:${requestId}`,
      `private-beta-welcome:${requestId}`,
    ]);

    const capturedLogs = loggerSpies
      .flatMap((spy) => spy.mock.calls)
      .map((call) =>
        call
          .map((value: unknown) =>
            typeof value === 'string' ? value : JSON.stringify(value),
          )
          .join(' '),
      )
      .join('\n');
    expect(
      [...sensitiveValues, expectedCredential].every(
        (value) => !capturedLogs.includes(value),
      ),
    ).toBe(true);
    const credential =
      await prisma.db.passwordChangeCredential.findUniqueOrThrow({
        where: { privateBetaAccessRequestId: requestId },
      });
    expect(capturedLogs).not.toContain(credential.credentialId);
  });

  it('closes idempotently, revokes outstanding credentials, and blocks later approvals', async () => {
    const approvedIntake = makeIntake();
    const approvedRequestId = await createPendingRequest(approvedIntake);
    await postAdminDecision(approvedRequestId, 'APPROVE').expect(200);

    const pendingIntake = makeIntake();
    const pendingRequestId = await createPendingRequest(pendingIntake);

    await postClose(tokenFor(NON_ADMIN_USER_ID)).expect(403);
    const closed = await postClose(tokenFor(ADMIN_USER_ID)).expect(200);
    expect(closed.body).toMatchObject({
      status: 'CLOSED',
      closedByUserId: ADMIN_USER_ID,
      alreadyClosed: false,
      revokedCredentialCount: 1,
    });

    const replay = await postClose(tokenFor(ADMIN_USER_ID)).expect(200);
    expect(replay.body).toEqual({
      ...closed.body,
      alreadyClosed: true,
      revokedCredentialCount: 0,
    });
    await postAdminDecision(pendingRequestId, 'APPROVE').expect(409);
    await postAdminDecision(pendingRequestId, 'REJECT').expect(200);

    const credential =
      await prisma.db.passwordChangeCredential.findUniqueOrThrow({
        where: { privateBetaAccessRequestId: approvedRequestId },
      });
    expect(credential.revokedAt).toEqual(expect.any(Date));
  });

  it('guards pause control and leaves manual approval available while paused', async () => {
    await putAdmissionMode('PAUSED').expect(401);
    await putAdmissionMode('PAUSED', tokenFor(NON_ADMIN_USER_ID)).expect(403);

    const paused = await putAdmissionMode(
      'PAUSED',
      tokenFor(ADMIN_USER_ID),
    ).expect(200);
    expect(paused.body).toMatchObject({
      mode: 'PAUSED',
      updatedByUserId: ADMIN_USER_ID,
      alreadyCurrent: false,
    });
    const replay = await putAdmissionMode(
      'PAUSED',
      tokenFor(ADMIN_USER_ID),
    ).expect(200);
    expect(replay.body).toMatchObject({
      mode: 'PAUSED',
      alreadyCurrent: true,
    });
    await getAdmissionMode(tokenFor(ADMIN_USER_ID))
      .expect(200)
      .expect(({ body }) => expect(body.mode).toBe('PAUSED'));

    const intake = makeIntake();
    const requestId = await createPendingRequest(intake);
    await postAdminDecision(requestId, 'APPROVE').expect(200);
    await expectSuccessfulProvisioning(requestId, intake);
  });

  it('converges concurrent OPEN submissions and operator replay on one canonical activation', async () => {
    const intake = makeIntake();
    await prisma.db.privateBetaAccessProgramState.update({
      where: { id: 'private-beta' },
      data: { selfServiceAdmissionMode: 'OPEN' },
    });
    const submit = () =>
      request(app.getHttpServer() as App)
        .post('/api/v1/private-beta/access-requests')
        .send({
          name: intake.name,
          workEmail: intake.email,
          organizationName: intake.organizationName,
        });
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(responses.map((response) => response.body)).toEqual([
      { accepted: true },
      { accepted: true },
    ]);
    const rows = await prisma.db.privateBetaAccessRequest.findMany({
      where: { normalizedEmail: intake.email },
    });
    requestIds.push(...rows.map((row) => row.id));
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      teamSize: null,
      productContext: null,
      accessRationale: null,
    });
    await expectSuccessfulProvisioning(row.id, intake);
    await submit().expect(202);
    await postAdminDecision(row.id, 'APPROVE').expect(200);
    await expectSuccessfulProvisioning(row.id, intake);
    expect(sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it.each(['APPROVE', 'REJECT'] as const)(
    'keeps PAUSED signup unprovisioned until authenticated %s and preserves rejection after reopening',
    async (decision) => {
      await prisma.db.privateBetaAccessProgramState.update({
        where: { id: 'private-beta' },
        data: { selfServiceAdmissionMode: 'PAUSED' },
      });
      const intake = makeIntake();
      const submit = () =>
        request(app.getHttpServer() as App)
          .post('/api/v1/private-beta/access-requests')
          .send({
            name: intake.name,
            workEmail: intake.email,
            organizationName: intake.organizationName,
          });
      await submit().expect(202);
      const row = await prisma.db.privateBetaAccessRequest.findFirstOrThrow({
        where: { normalizedEmail: intake.email },
      });
      requestIds.push(row.id);
      expect(row.status).toBe('PENDING');
      await expectNoProvisioningSideEffects(row.id, intake);
      await postDecision(row.id, decision).expect(401);
      await postAdminDecision(row.id, decision).expect(200);
      if (decision === 'APPROVE') {
        await expectSuccessfulProvisioning(row.id, intake);
      } else {
        await prisma.db.privateBetaAccessProgramState.update({
          where: { id: 'private-beta' },
          data: { selfServiceAdmissionMode: 'OPEN' },
        });
        await submit().expect(202);
        await expectStoredRequest(row.id, { status: 'REJECTED' });
        await expectNoProvisioningSideEffects(row.id, intake);
      }
    },
  );

  async function createPendingRequest(intake: Intake): Promise<string> {
    const requestId = randomUUID();
    requestIds.push(requestId);
    await prisma.db.privateBetaAccessRequest.create({
      data: {
        id: requestId,
        submittedEmail: intake.email,
        normalizedEmail: intake.email,
        name: intake.name,
        organizationName: intake.organizationName,
        teamSize: 3,
        productContext: intake.productContext,
        accessRationale: intake.accessRationale,
        status: 'PENDING',
      },
    });
    return requestId;
  }

  async function expectStoredRequest(
    requestId: string,
    expected: Record<string, unknown>,
  ) {
    const stored = await prisma.db.privateBetaAccessRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(stored).toMatchObject(expected);
    return stored;
  }

  async function expectSuccessfulProvisioning(
    requestId: string,
    intake: Intake,
  ) {
    const stored = await expectStoredRequest(requestId, {
      status: 'APPROVED',
      decisionAt: expect.any(Date),
      provisioningAttemptedAt: expect.any(Date),
      provisioningCompletedAt: expect.any(Date),
      provisioningFailureCode: null,
      provisioningError: null,
      welcomeEmailIdempotencyKey: `private-beta-welcome:${requestId}`,
      welcomeEmailSentAt: expect.any(Date),
    });
    expect(stored.provisionedUserId).not.toBeNull();
    expect(stored.provisionedOrganizationId).not.toBeNull();
    expect(stored.provisioningCredentialId).not.toBeNull();
    expect(stored.provisioningOrganizationApiKeyId).not.toBeNull();

    expect(await countUser(intake.email)).toBe(1);
    expect(
      await prisma.db.organization.count({
        where: { id: stored.provisionedOrganizationId! },
      }),
    ).toBe(1);
    expect(
      await prisma.db.passwordChangeCredential.count({
        where: { privateBetaAccessRequestId: requestId },
      }),
    ).toBe(1);
    expect(
      await prisma.db.apiKey.count({
        where: { organizationId: stored.provisionedOrganizationId! },
      }),
    ).toBe(1);
    expect(
      await prisma.db.accountEntitlement.count({
        where: {
          organizationId: stored.provisionedOrganizationId!,
          subscriptionType: 'BETA',
          accessStatus: 'ACTIVE',
          accessThroughAt: null,
          paidThroughAt: null,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.db.accountEntitlementTransition.count({
        where: { organizationId: stored.provisionedOrganizationId! },
      }),
    ).toBe(1);

    const expectedCredential = expectedWelcomeCredential(requestId);
    expect(sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: intake.email,
        name: intake.name,
        passwordChangeCredential: expectedCredential,
        providerIdempotencyKey: `private-beta-welcome:${requestId}`,
      }),
    );
    const credential =
      await prisma.db.passwordChangeCredential.findUniqueOrThrow({
        where: { privateBetaAccessRequestId: requestId },
      });
    expect(credential.userId).toBe(stored.provisionedUserId);
    expect(credential.credentialId).toBe(
      createHash('sha256').update(expectedCredential).digest('hex'),
    );
    return stored;
  }

  async function expectNoProvisioningSideEffects(
    requestId: string,
    intake: Intake,
  ) {
    expect(await countUser(intake.email)).toBe(0);
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
    expect(
      await prisma.db.passwordChangeCredential.count({
        where: { privateBetaAccessRequestId: requestId },
      }),
    ).toBe(0);
    expect(
      await prisma.db.organization.count({
        where: { name: intake.organizationName },
      }),
    ).toBe(0);
    expect(
      await prisma.db.apiKey.count({
        where: { organization: { name: intake.organizationName } },
      }),
    ).toBe(0);
    expect(
      await prisma.db.accountEntitlement.count({
        where: { organization: { name: intake.organizationName } },
      }),
    ).toBe(0);
  }

  async function countUser(email: string): Promise<number> {
    return prisma.db.user.count({ where: { email } });
  }

  function expectedWelcomeCredential(requestId: string): string {
    return createHmac('sha256', PASSWORD_CHANGE_IDEMPOTENCY_SECRET)
      .update(`private-beta-welcome-credential:${requestId}`)
      .digest('base64url');
  }

  async function removeRequestAndProvisionedResources(requestId: string) {
    const stored = await prisma.db.privateBetaAccessRequest.findUnique({
      where: { id: requestId },
    });
    if (!stored) return;

    await prisma.db.privateBetaAccessRequest.delete({
      where: { id: requestId },
    });
    if (stored.provisionedOrganizationId) {
      await prisma.db.organization.delete({
        where: { id: stored.provisionedOrganizationId },
      });
    }
    if (stored.provisionedUserId) {
      await prisma.db.user.delete({ where: { id: stored.provisionedUserId } });
    }
  }

  function makeIntake(): Intake {
    const id = randomUUID();
    return {
      email: `decision-${id}@example.com`,
      name: `Decision Applicant ${id}`,
      organizationName: `Decision Organization ${id}`,
      productContext: `sensitive-product-context-${id}`,
      accessRationale: `sensitive-access-rationale-${id}`,
    };
  }

  function tokenFor(userId: string): string {
    return jwt.sign({}, TEST_JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
      subject: userId,
    });
  }

  function postDecision(requestId: string, decision: Decision, token?: string) {
    const httpRequest = request(app.getHttpServer() as App)
      .post(`/api/v1/admin/private-beta-access-requests/${requestId}/decision`)
      .set('User-Agent', 'private-beta-decision-integration');
    if (token) {
      httpRequest.set('Authorization', `Bearer ${token}`);
    }
    return httpRequest.send({ decision });
  }

  function postAdminDecision(requestId: string, decision: Decision) {
    return postDecision(requestId, decision, tokenFor(ADMIN_USER_ID));
  }

  function postClose(token?: string) {
    const httpRequest = request(app.getHttpServer() as App)
      .post('/api/v1/admin/private-beta-access/close')
      .set('User-Agent', 'private-beta-decision-integration');
    if (token) {
      httpRequest.set('Authorization', `Bearer ${token}`);
    }
    return httpRequest.send();
  }

  function getAdmissionMode(token?: string) {
    const httpRequest = request(app.getHttpServer() as App)
      .get('/api/v1/admin/private-beta-access/admission-mode')
      .set('User-Agent', 'private-beta-decision-integration');
    if (token) httpRequest.set('Authorization', `Bearer ${token}`);
    return httpRequest;
  }

  function putAdmissionMode(mode: 'OPEN' | 'PAUSED', token?: string) {
    const httpRequest = request(app.getHttpServer() as App)
      .put('/api/v1/admin/private-beta-access/admission-mode')
      .set('User-Agent', 'private-beta-decision-integration');
    if (token) httpRequest.set('Authorization', `Bearer ${token}`);
    return httpRequest.send({ mode });
  }
});
