import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { hash } from 'bcrypt';
import { decode } from 'jsonwebtoken';
import type { BrowserAuthResponseDto } from '@hey-hey/contracts/api/models';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../../types';
import { AccountEntitlementService } from '../../../services/account-entitlement.service';
import { UserService } from '../../../services/user.service';
import { DemoSandboxActivityService } from '../../../services/demo-sandbox/demo-sandbox-activity.service';
import { BrowserSessionService } from '../../services/browser-session.service';
import { JwtKeysService } from '../../services/jwt-keys.service';
import { UserAccessTokenValidatorService } from '../../services/user-access-token-validator.service';
import { CredentialProfileService } from '../../credential-profile';
import type { JwtPayload } from '../../strategies/jwt.strategy';
import {
  AccountPasskeyActor,
  AccountPasskeyService,
  userHandleFor,
} from '../account-passkey.service';
import { SoftwareAuthenticator } from './software-authenticator';
import { AccountProofThrottleService } from '../account-proof-throttle.service';

const describeDatabase =
  process.env.RUN_BROWSER_SESSION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

const RP_ID = 'localhost.test';
const ORIGIN = 'https://localhost.test';
const PASSWORD = 'correct horse battery staple';

const hosted = {
  BROWSER_TOKEN_ISSUER: 'https://hosted.test/api',
  BROWSER_TOKEN_AUDIENCE: 'https://hosted.test',
};
const local = {
  BROWSER_TOKEN_ISSUER: 'urn:heyhey:local',
  BROWSER_TOKEN_AUDIENCE: 'http://localhost:5173',
};

const configFor = (values: Record<string, string>): ConfigService =>
  ({
    get: (key: string) =>
      ({
        BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
        BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
        BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
        ACCOUNT_PASSKEY_RP_ID: RP_ID,
        ACCOUNT_PASSKEY_ORIGIN: ORIGIN,
        ...values,
      })[key] ?? process.env[key],
  }) as unknown as ConfigService;

const accessTokenOf = (session: { response: unknown }): string =>
  (session.response as BrowserAuthResponseDto).accessToken;

describeDatabase('Account passkeys at the browser session boundary', () => {
  let prisma: PrismaService;
  let jwtKeys: JwtKeysService;
  let browserSessions: BrowserSessionService;
  let passkeys: AccountPasskeyService;
  let validator: UserAccessTokenValidatorService;
  let localValidator: UserAccessTokenValidatorService;
  const userIds: UserId[] = [];
  const organizationIds: OrganizationId[] = [];

  const buildValidator = (
    profile: Record<string, string>,
  ): UserAccessTokenValidatorService =>
    new UserAccessTokenValidatorService(
      {
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
      } as unknown as UserService,
      jwtKeys,
      new AccountEntitlementService(prisma),
      { recordActivity: jest.fn() } as unknown as DemoSandboxActivityService,
      prisma,
      new CredentialProfileService(configFor(profile)),
    );

  const authorizeAll = {
    getAuthorizedOrganizationIds: async (ids: string[]) => new Set(ids),
  } as unknown as AccountEntitlementService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    // One signing key for both deployments, so rejection proves the profile
    // checks rather than an incidental key difference.
    jwtKeys = new JwtKeysService(configFor({}));
    browserSessions = new BrowserSessionService(
      configFor(hosted),
      prisma,
      jwtKeys,
      authorizeAll,
      new CredentialProfileService(configFor(hosted)),
    );
    passkeys = new AccountPasskeyService(
      configFor(hosted),
      prisma,
      {
        validatePassword: async (
          user: { passwordHash: string },
          password: string,
        ) => (await import('bcrypt')).compare(password, user.passwordHash),
      } as unknown as UserService,
      browserSessions,
      {
        allowPasswordProof: async () => true,
      } as unknown as AccountProofThrottleService,
    );
    validator = buildValidator(hosted);
    localValidator = buildValidator(local);
  });

  afterAll(async () => {
    await prisma.db.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.db.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.$disconnect();
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
        slug: `pk-${organizationId}`,
      },
    });
    await prisma.db.user.create({
      data: {
        id: userId,
        email: `${userId}@passkeys.test`,
        name: 'Passkey Person',
        passwordHash: await hash(PASSWORD, 4),
        defaultOrganizationId: organizationId,
        memberships: { create: { organizationId, role: 'OWNER' } },
      },
    });
    const signIn = async () => {
      const user = await prisma.db.user.findUniqueOrThrow({
        where: { id: userId },
        include: { memberships: true },
      });
      return browserSessions.establish(
        {
          userId,
          user: {
            id: userId,
            email: user.email,
            name: user.name,
            isActive: true,
            createdAt: user.createdAt.toISOString(),
            updatedAt: user.updatedAt.toISOString(),
            currentOrganizationId: null,
          },
          claims: {
            email: user.email,
            name: user.name,
            orgMemberships: [{ orgId: organizationId, role: 'OWNER' }],
          },
        },
        {},
      );
    };
    const authenticator = new SoftwareAuthenticator(
      RP_ID,
      userHandleFor(userId),
    );
    return { userId, signIn, authenticator };
  };

  const actorFor = async (
    userId: UserId,
    accessToken: string,
  ): Promise<AccountPasskeyActor> => {
    const user = await validator.verifyAndValidate(accessToken);
    return {
      userId,
      browserSessionId: user.browserSessionId!,
      email: user.email,
      name: user.name,
    };
  };

  const addPasskey = async (
    account: Awaited<ReturnType<typeof createAccount>>,
    accessToken: string,
  ) => {
    const actor = await actorFor(account.userId, accessToken);
    const options = await passkeys.startRegistration(actor);
    return passkeys.register(
      actor,
      {
        name: 'Laptop',
        credential: account.authenticator.register(options.challenge, ORIGIN),
        proof: { currentPassword: PASSWORD },
      },
      {},
    );
  };

  const activeFamilies = (userId: UserId) =>
    prisma.db.browserSessionFamily.count({
      where: { userId, revokedAt: null },
    });

  it('adds a passkey, ends every earlier session and keeps exactly one fresh acting session', async () => {
    const account = await createAccount();
    const acting = await account.signIn();
    const otherBrowser = await account.signIn();

    const replacement = await addPasskey(account, accessTokenOf(acting));

    await expect(
      validator.verifyAndValidate(accessTokenOf(acting)),
    ).rejects.toThrow();
    await expect(
      validator.verifyAndValidate(accessTokenOf(otherBrowser)),
    ).rejects.toThrow();
    await expect(
      validator.verifyAndValidate(accessTokenOf(replacement)),
    ).resolves.toEqual(expect.objectContaining({ userId: account.userId }));
    expect(await activeFamilies(account.userId)).toBe(1);

    const renewal = await browserSessions.refresh({
      presentedSecret: otherBrowser.refreshSecret,
      requestMetadata: {},
    });
    expect(renewal.status).toBe('revoked');

    expect((await passkeys.list(account.userId)).passkeys).toEqual([
      expect.objectContaining({ name: 'Laptop', lastUsedAt: null }),
    ]);
  });

  it('signs in with a registered passkey through the normal browser session', async () => {
    const account = await createAccount();
    await addPasskey(account, accessTokenOf(await account.signIn()));

    const options = await passkeys.startSignIn();
    const session = await passkeys.completeSignIn(
      account.authenticator.assert(options.challenge, ORIGIN),
      {},
    );

    const context = await validator.verifyAndValidate(accessTokenOf(session));
    expect(context.userId).toBe(account.userId);
    expect(session.response).not.toHaveProperty('refreshToken');
    expect(session.refreshSecret).toEqual(expect.any(String));
  });

  it('rejects replayed, expired, wrong-origin, wrong-RP and cross-account sign-in proofs', async () => {
    const account = await createAccount();
    const stranger = await createAccount();
    await addPasskey(account, accessTokenOf(await account.signIn()));
    const strangerOnly = new SoftwareAuthenticator(
      RP_ID,
      userHandleFor(stranger.userId),
    );

    const replayed = await passkeys.startSignIn();
    const assertion = account.authenticator.assert(replayed.challenge, ORIGIN);
    await passkeys.completeSignIn(assertion, {});
    await expect(passkeys.completeSignIn(assertion, {})).rejects.toThrow(
      'Passkey sign-in failed',
    );

    const wrongOrigin = await passkeys.startSignIn();
    await expect(
      passkeys.completeSignIn(
        account.authenticator.assert(
          wrongOrigin.challenge,
          'https://evil.test',
        ),
        {},
      ),
    ).rejects.toThrow('Passkey sign-in failed');

    const wrongRp = await passkeys.startSignIn();
    await expect(
      passkeys.completeSignIn(
        account.authenticator.assert(wrongRp.challenge, ORIGIN, {
          rpId: 'evil.test',
        }),
        {},
      ),
    ).rejects.toThrow('Passkey sign-in failed');

    const unregistered = await passkeys.startSignIn();
    await expect(
      passkeys.completeSignIn(
        strangerOnly.assert(unregistered.challenge, ORIGIN),
        {},
      ),
    ).rejects.toThrow('Passkey sign-in failed');

    const expired = await passkeys.startSignIn();
    await prisma.db.accountPasskeyChallenge.update({
      where: { challenge: expired.challenge },
      data: {
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(Date.now() - 2000),
      },
    });
    await expect(
      passkeys.completeSignIn(
        account.authenticator.assert(expired.challenge, ORIGIN),
        {},
      ),
    ).rejects.toThrow('Passkey sign-in failed');
  });

  it('gives concurrent completions of one challenge exactly one winner', async () => {
    const account = await createAccount();
    await addPasskey(account, accessTokenOf(await account.signIn()));
    const options = await passkeys.startSignIn();
    const assertion = account.authenticator.assert(options.challenge, ORIGIN);

    const results = await Promise.allSettled([
      passkeys.completeSignIn(assertion, {}),
      passkeys.completeSignIn(assertion, {}),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('removes a passkey with passkey proof bound to that removal, then the passkey cannot sign in', async () => {
    const account = await createAccount();
    const session = await addPasskey(
      account,
      accessTokenOf(await account.signIn()),
    );
    const passkey = (await passkeys.list(account.userId)).passkeys[0]!;
    const actor = await actorFor(account.userId, accessTokenOf(session));

    const registerProof = await passkeys.startProof(
      actor,
      'register',
      undefined,
    );
    await expect(
      passkeys.remove(
        actor,
        passkey.id,
        {
          passkeyAssertion: account.authenticator.assert(
            registerProof.challenge,
            ORIGIN,
          ),
        },
        {},
      ),
    ).rejects.toThrow('Account proof failed');
    expect(await activeFamilies(account.userId)).toBe(1);

    const removeProof = await passkeys.startProof(actor, 'remove', passkey.id);
    const replacement = await passkeys.remove(
      actor,
      passkey.id,
      {
        passkeyAssertion: account.authenticator.assert(
          removeProof.challenge,
          ORIGIN,
        ),
      },
      {},
    );

    await expect(
      validator.verifyAndValidate(accessTokenOf(session)),
    ).rejects.toThrow();
    await expect(
      validator.verifyAndValidate(accessTokenOf(replacement)),
    ).resolves.toBeDefined();
    expect(await activeFamilies(account.userId)).toBe(1);

    const options = await passkeys.startSignIn();
    await expect(
      passkeys.completeSignIn(
        account.authenticator.assert(options.challenge, ORIGIN),
        {},
      ),
    ).rejects.toThrow('Passkey sign-in failed');
  });

  it('leaves passkeys, sessions and access unchanged when account proof fails', async () => {
    const account = await createAccount();
    const acting = await account.signIn();
    const actor = await actorFor(account.userId, accessTokenOf(acting));
    const options = await passkeys.startRegistration(actor);

    await expect(
      passkeys.register(
        actor,
        {
          name: 'Phone',
          credential: account.authenticator.register(options.challenge, ORIGIN),
          proof: { currentPassword: 'wrong password' },
        },
        {},
      ),
    ).rejects.toThrow('Account proof failed');

    expect((await passkeys.list(account.userId)).passkeys).toEqual([]);
    expect(await activeFamilies(account.userId)).toBe(1);
    await expect(
      validator.verifyAndValidate(accessTokenOf(acting)),
    ).resolves.toBeDefined();
  });

  it('rejects another account using a registration challenge', async () => {
    const account = await createAccount();
    const stranger = await createAccount();
    const actor = await actorFor(
      account.userId,
      accessTokenOf(await account.signIn()),
    );
    const strangerActor = await actorFor(
      stranger.userId,
      accessTokenOf(await stranger.signIn()),
    );
    const options = await passkeys.startRegistration(actor);

    await expect(
      passkeys.register(
        strangerActor,
        {
          name: 'Stolen',
          credential: stranger.authenticator.register(
            options.challenge,
            ORIGIN,
          ),
          proof: { currentPassword: PASSWORD },
        },
        {},
      ),
    ).rejects.toThrow();
    expect((await passkeys.list(stranger.userId)).passkeys).toEqual([]);
  });

  it('isolates hosted and local browser credentials signed with the same key', async () => {
    const account = await createAccount();
    const hostedToken = accessTokenOf(await account.signIn());
    const payload = decode(hostedToken) as JwtPayload;
    const localToken = jwtKeys.signToken(
      {
        ...payload,
        iss: undefined,
        aud: undefined,
        exp: undefined,
        iat: undefined,
        jti: undefined,
      },
      {
        expiresIn: 900,
        issuer: local.BROWSER_TOKEN_ISSUER,
        audience: local.BROWSER_TOKEN_AUDIENCE,
      },
    );
    const unscoped = jwtKeys.signToken(
      { sub: account.userId, currentOrgId: payload.currentOrgId },
      { expiresIn: 900 },
    );

    await expect(
      validator.verifyAndValidate(hostedToken),
    ).resolves.toBeDefined();
    await expect(localValidator.verifyAndValidate(hostedToken)).rejects.toThrow(
      'Token issuer does not match this deployment',
    );
    await expect(validator.verifyAndValidate(localToken)).rejects.toThrow(
      'Token issuer does not match this deployment',
    );
    await expect(validator.verifyAndValidate(unscoped)).rejects.toThrow();
  });
});
