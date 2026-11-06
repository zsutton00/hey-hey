import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { hash, compare } from 'bcrypt';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import type { BrowserAuthResponseDto } from '@hey-hey/contracts/api/models';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../../types';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { UserService } from '../../../services/user.service';
import { DemoSandboxActivityService } from '../../../services/demo-sandbox/demo-sandbox-activity.service';
import { AuthController } from '../../../controllers/auth.controller';
import { AuthService } from '../../services/auth.service';
import { BrowserSessionService } from '../../services/browser-session.service';
import { JwtKeysService } from '../../services/jwt-keys.service';
import { UserAccessTokenValidatorService } from '../../services/user-access-token-validator.service';
import { JwtStrategy } from '../../strategies/jwt.strategy';
import { CredentialProfileService } from '../../credential-profile';
import { AccountPasskeyController } from '../account-passkey.controller';
import {
  AccountPasskeyService,
  userHandleFor,
} from '../account-passkey.service';
import { AccountProofThrottleService } from '../account-proof-throttle.service';
import { SoftwareAuthenticator } from './software-authenticator';

const describeDatabase =
  process.env.RUN_BROWSER_SESSION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

const RP_ID = 'localhost.test';
const ORIGIN = 'https://localhost.test';
const PASSWORD = 'correct horse battery staple';

const config = {
  get: (key: string) =>
    ({
      BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
      BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
      BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
      ACCOUNT_PASSKEY_RP_ID: RP_ID,
      ACCOUNT_PASSKEY_ORIGIN: ORIGIN,
      BROWSER_TOKEN_ISSUER: 'https://hosted.test/api',
      BROWSER_TOKEN_AUDIENCE: ORIGIN,
    })[key] ?? process.env[key],
} as unknown as ConfigService;

/** Cookie values a response set, keyed by cookie name. */
const setCookies = (response: request.Response): Map<string, string> => {
  const header = response.headers['set-cookie'] as unknown as
    | string[]
    | undefined;
  const cookies = new Map<string, string>();
  for (const cookie of header ?? []) {
    const [pair] = cookie.split(';');
    const [name, value] = pair!.split('=');
    if (value) {
      cookies.set(name!, cookie);
    }
  }
  return cookies;
};

/**
 * The browser session lifecycle boundary for passkey changes, exercised over
 * HTTP through the real controllers, guards, token validator and PostgreSQL.
 */
describeDatabase('Account passkeys over HTTP', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let browserSessions: BrowserSessionService;
  let validator: UserAccessTokenValidatorService;
  const userIds: UserId[] = [];
  const organizationIds: OrganizationId[] = [];
  let previousWhitelist: string | undefined;

  beforeAll(async () => {
    previousWhitelist = process.env.CORS_WHITELIST;
    process.env.CORS_WHITELIST = ORIGIN;
    prisma = new PrismaService();
    await prisma.$connect();

    const jwtKeys = new JwtKeysService(config);
    const profile = new CredentialProfileService(config);
    const userService = {
      findForAuthentication: (id: string) =>
        prisma.db.user.findUnique({
          where: { id },
          select: {
            email: true,
            name: true,
            isActive: true,
            isDevAdmin: true,
            devAdminMode: true,
            isDemoUser: true,
            authorizationRevision: true,
            memberships: {
              select: { organizationId: true, role: true, isActive: true },
            },
          },
        }),
      validatePassword: (user: { passwordHash: string }, password: string) =>
        compare(password, user.passwordHash),
    } as unknown as UserService;
    const authorizeAll = {
      getAuthorizedOrganizationIds: async (ids: string[]) => new Set(ids),
    } as unknown as AccountEntitlementService;

    validator = new UserAccessTokenValidatorService(
      userService,
      jwtKeys,
      authorizeAll,
      { recordActivity: jest.fn() } as unknown as DemoSandboxActivityService,
      prisma,
      profile,
    );
    browserSessions = new BrowserSessionService(
      config,
      prisma,
      jwtKeys,
      authorizeAll,
      profile,
    );
    const passkeys = new AccountPasskeyService(
      config,
      prisma,
      userService,
      browserSessions,
      {
        allowPasswordProof: async () => true,
      } as unknown as AccountProofThrottleService,
    );
    const authService = new AuthService(
      userService,
      {} as never,
      jwtKeys,
      {} as never,
      browserSessions,
      {} as never,
      prisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      profile,
      validator,
    );

    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController, AccountPasskeyController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: AccountPasskeyService, useValue: passkeys },
        {
          provide: JwtStrategy,
          useFactory: () => new JwtStrategy(config, jwtKeys, validator),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.db.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.db.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.$disconnect();
    process.env.CORS_WHITELIST = previousWhitelist;
  });

  const createAccount = async () => {
    const userId = randomUUID() as UserId;
    const organizationId = randomUUID() as OrganizationId;
    userIds.push(userId);
    organizationIds.push(organizationId);
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: 'Passkeys',
        slug: `pkh-${organizationId}`,
      },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `${userId}@passkeys-http.test`,
        name: 'Passkey Person',
        passwordHash: await hash(PASSWORD, 4),
        defaultOrganizationId: organizationId,
        memberships: { create: { organizationId, role: 'OWNER' } },
      },
    });
    const signIn = async () => {
      const now = new Date().toISOString();
      const session = await browserSessions.establish(
        {
          userId,
          user: {
            id: userId,
            email: `${userId}@passkeys-http.test`,
            name: 'Passkey Person',
            isActive: true,
            createdAt: now,
            updatedAt: now,
            currentOrganizationId: null,
          },
          claims: {
            email: `${userId}@passkeys-http.test`,
            name: 'Passkey Person',
            orgMemberships: [{ orgId: organizationId, role: 'OWNER' }],
          },
        },
        {},
      );
      return {
        accessToken: (session.response as BrowserAuthResponseDto).accessToken,
        refreshSecret: session.refreshSecret,
      };
    };
    return {
      userId,
      signIn,
      authenticator: new SoftwareAuthenticator(RP_ID, userHandleFor(userId)),
    };
  };

  const http = () => request(app.getHttpServer());
  const asBrowser = (req: request.Test, accessToken: string) =>
    req.set('Authorization', `Bearer ${accessToken}`).set('Origin', ORIGIN);

  const addPasskey = async (
    account: Awaited<ReturnType<typeof createAccount>>,
    accessToken: string,
  ) => {
    const options = await asBrowser(
      http().post('/api/v1/auth/passkeys/registration/options'),
      accessToken,
    ).expect(200);
    return asBrowser(http().post('/api/v1/auth/passkeys'), accessToken).send({
      name: 'Laptop',
      credential: account.authenticator.register(
        options.body.challenge as string,
        ORIGIN,
      ),
      proof: { currentPassword: PASSWORD },
    });
  };

  const expectSessionEnded = async (session: {
    accessToken: string;
    refreshSecret: string;
  }) => {
    await asBrowser(
      http().get('/api/v1/auth/passkeys'),
      session.accessToken,
    ).expect(401);
    const validation = await http()
      .post('/api/v1/auth/validate')
      .send({ token: session.accessToken })
      .expect(200);
    expect(validation.body.valid).toBe(false);
    await http()
      .post('/api/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', `refreshToken=${session.refreshSecret}`)
      .expect(401);
    // The realtime handshake authenticates with exactly this check.
    await expect(
      validator.verifyAndValidate(session.accessToken),
    ).rejects.toThrow();
  };

  it('adding a passkey replaces the acting session with one fresh cookie session and ends every earlier one', async () => {
    const account = await createAccount();
    const acting = await account.signIn();
    const otherBrowser = await account.signIn();

    const response = await addPasskey(account, acting.accessToken);

    expect(response.status).toBe(200);
    expect(response.body).not.toHaveProperty('refreshToken');
    const cookies = setCookies(response);
    expect(cookies.get('accessToken')).toMatch(/HttpOnly/);
    expect(cookies.get('refreshToken')).toMatch(/HttpOnly/);

    await expectSessionEnded(acting);
    await expectSessionEnded(otherBrowser);

    const replacement = response.body.accessToken as string;
    const listed = await asBrowser(
      http().get('/api/v1/auth/passkeys'),
      replacement,
    ).expect(200);
    expect(listed.body.passkeys).toHaveLength(1);
    const validation = await http()
      .post('/api/v1/auth/validate')
      .send({ token: replacement })
      .expect(200);
    expect(validation.body.valid).toBe(true);
    expect(
      await prisma.db.browserSessionFamily.count({
        where: { userId: account.userId, revokedAt: null },
      }),
    ).toBe(1);
  });

  it('removing a passkey with passkey proof ends the earlier session and keeps one fresh session', async () => {
    const account = await createAccount();
    const added = await addPasskey(
      account,
      (await account.signIn()).accessToken,
    );
    const accessToken = added.body.accessToken as string;
    const refreshSecret = setCookies(added)
      .get('refreshToken')!
      .split(';')[0]!
      .split('=')[1]!;
    const listed = await asBrowser(
      http().get('/api/v1/auth/passkeys'),
      accessToken,
    ).expect(200);
    const passkeyId = listed.body.passkeys[0].id as string;

    const proof = await asBrowser(
      http().post('/api/v1/auth/passkeys/proof/options'),
      accessToken,
    )
      .send({ operation: 'remove', passkeyId })
      .expect(200);
    const removed = await asBrowser(
      http().post(`/api/v1/auth/passkeys/${passkeyId}/removal`),
      accessToken,
    )
      .send({
        proof: {
          passkeyAssertion: account.authenticator.assert(
            proof.body.challenge as string,
            ORIGIN,
          ),
        },
      })
      .expect(200);

    expect(setCookies(removed).get('refreshToken')).toMatch(/HttpOnly/);
    await expectSessionEnded({ accessToken, refreshSecret });
    const after = await asBrowser(
      http().get('/api/v1/auth/passkeys'),
      removed.body.accessToken as string,
    ).expect(200);
    expect(after.body.passkeys).toEqual([]);
  });

  it('a wrong password changes no passkey, session or cookie', async () => {
    const account = await createAccount();
    const acting = await account.signIn();
    const options = await asBrowser(
      http().post('/api/v1/auth/passkeys/registration/options'),
      acting.accessToken,
    ).expect(200);

    const response = await asBrowser(
      http().post('/api/v1/auth/passkeys'),
      acting.accessToken,
    )
      .send({
        name: 'Phone',
        credential: account.authenticator.register(
          options.body.challenge as string,
          ORIGIN,
        ),
        proof: { currentPassword: 'wrong password' },
      })
      .expect(401);

    expect(setCookies(response).size).toBe(0);
    const listed = await asBrowser(
      http().get('/api/v1/auth/passkeys'),
      acting.accessToken,
    ).expect(200);
    expect(listed.body.passkeys).toEqual([]);
  });

  it('signs in with a passkey through the HTTP boundary with cookie-only refresh', async () => {
    const account = await createAccount();
    await addPasskey(account, (await account.signIn()).accessToken);

    const options = await http()
      .post('/api/v1/auth/passkeys/sign-in/options')
      .set('Origin', ORIGIN)
      .expect(200);
    const response = await http()
      .post('/api/v1/auth/passkeys/sign-in')
      .set('Origin', ORIGIN)
      .send({
        credential: account.authenticator.assert(
          options.body.challenge as string,
          ORIGIN,
        ),
      })
      .expect(200);

    expect(response.body).not.toHaveProperty('refreshToken');
    expect(setCookies(response).get('refreshToken')).toMatch(/HttpOnly/);
    await asBrowser(
      http().get('/api/v1/auth/passkeys'),
      response.body.accessToken as string,
    ).expect(200);
  });
});
