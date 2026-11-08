import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../types';
import { AccountEntitlementService } from '../../services/account-entitlement.service';
import { UserService } from '../../services/user.service';
import type { ControllerManagementService } from '../../services/controller-management/controller-management.service';
import { BrowserSessionService } from '../../auth/services/browser-session.service';
import { JwtKeysService } from '../../auth/services/jwt-keys.service';
import { CredentialProfileService } from '../../auth/credential-profile';
import {
  AccountPasskeyActor,
  AccountPasskeyService,
  userHandleFor,
} from '../../auth/passkeys/account-passkey.service';
import { AccountProofThrottleService } from '../../auth/passkeys/account-proof-throttle.service';
import { SoftwareAuthenticator } from '../../auth/passkeys/__tests__/software-authenticator';
import { LocalFirstPasskeyAuthority } from '../local-first-passkey-authority';

const describeDatabase =
  process.env.RUN_BROWSER_SESSION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:5173';
const AAGUID = new Uint8Array(16);

const config = {
  BROWSER_TOKEN_ISSUER: 'urn:heyhey:local',
  BROWSER_TOKEN_AUDIENCE: ORIGIN,
  BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
  BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
  BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  ACCOUNT_PASSKEY_RP_ID: RP_ID,
  ACCOUNT_PASSKEY_ORIGIN: ORIGIN,
};
const configService = {
  get: (key: string) => config[key as keyof typeof config] ?? process.env[key],
} as unknown as ConfigService;

describeDatabase('Local first passkey authority', () => {
  const previousEnvironment = {
    deployment: process.env.DEPLOYMENT_ENVIRONMENT,
    local: process.env.HEYHEY_LOCAL_APPLICATION,
  };
  const recorded = new Set<string>();
  const redis = {
    getClient: () => ({
      set: async (key: string) => {
        recorded.add(key);
        return 'OK';
      },
      exists: async (key: string) => Number(recorded.has(key)),
      del: async (key: string) => Number(recorded.delete(key)),
    }),
  };
  const userIds: UserId[] = [];
  const organizationIds: OrganizationId[] = [];
  let prisma: PrismaService;
  let browserSessions: BrowserSessionService;
  let authority: LocalFirstPasskeyAuthority;
  let localPasskeys: AccountPasskeyService;
  let hostedPasskeys: AccountPasskeyService;

  const buildPasskeys = (first?: LocalFirstPasskeyAuthority) =>
    new AccountPasskeyService(
      configService,
      prisma,
      {} as unknown as UserService,
      browserSessions,
      {} as unknown as AccountProofThrottleService,
      {
        publishAccountRemovalReductions: async () => undefined,
      } as unknown as ControllerManagementService,
      first,
    );

  beforeAll(async () => {
    process.env.DEPLOYMENT_ENVIRONMENT = 'local';
    process.env.HEYHEY_LOCAL_APPLICATION = 'true';
    prisma = new PrismaService();
    await prisma.$connect();
    browserSessions = new BrowserSessionService(
      configService,
      prisma,
      new JwtKeysService(configService),
      {
        getAuthorizedOrganizationIds: async (ids: string[]) => new Set(ids),
      } as unknown as AccountEntitlementService,
      new CredentialProfileService(configService),
    );
    authority = new LocalFirstPasskeyAuthority(redis as never);
    localPasskeys = buildPasskeys(authority);
    hostedPasskeys = buildPasskeys();
  });

  afterAll(async () => {
    await prisma.db.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.db.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.$disconnect();
    for (const [key, value] of [
      ['DEPLOYMENT_ENVIRONMENT', previousEnvironment.deployment],
      ['HEYHEY_LOCAL_APPLICATION', previousEnvironment.local],
    ] as const) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  const createLocalAccount = async (email?: string) => {
    const userId = randomUUID() as UserId;
    const organizationId = randomUUID() as OrganizationId;
    userIds.push(userId);
    organizationIds.push(organizationId);
    await prisma.db.organization.create({
      data: { id: organizationId, name: 'Local', slug: `l-${organizationId}` },
    });
    const accountEmail =
      email ?? `local-${randomBytes(32).toString('hex')}@local.invalid`;
    await prisma.db.user.create({
      data: {
        id: userId,
        email: accountEmail,
        name: 'Local Person',
        passwordHash: 'unused',
        defaultOrganizationId: organizationId,
        memberships: { create: { organizationId, role: 'OWNER' } },
      },
    });
    const openSession = async (cliOpened: boolean) => {
      const session = await browserSessions.establish(
        {
          userId,
          user: {
            id: userId,
            email: accountEmail,
            name: 'Local Person',
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            currentOrganizationId: null,
          },
          claims: {
            email: accountEmail,
            name: 'Local Person',
            orgMemberships: [{ orgId: organizationId, role: 'OWNER' }],
          },
        },
        {},
      );
      if (cliOpened) {
        await authority.recordCliOpenedSession(session.sessionId);
      }
      const actor: AccountPasskeyActor = {
        userId,
        browserSessionId: session.sessionId,
        email: accountEmail,
        name: 'Local Person',
      };
      return { session, actor };
    };
    return {
      userId,
      openSession,
      authenticator: new SoftwareAuthenticator(RP_ID, userHandleFor(userId)),
    };
  };

  /** What the controller enrollment ceremony hands the shared service. */
  const verifiedCredential = async (authenticator: SoftwareAuthenticator) => {
    const challenge = randomBytes(32).toString('base64url');
    const { authenticatorAttachment, ...credential } = authenticator.register(
      challenge,
      ORIGIN,
    );
    const verification = await verifyRegistrationResponse({
      response: {
        ...credential,
        authenticatorAttachment: authenticatorAttachment ?? undefined,
        clientExtensionResults: {},
      },
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });
    const verified = verification.registrationInfo!.credential;
    return {
      credentialId: verified.id,
      publicKey: verified.publicKey,
      counter: verified.counter,
      transports: ['internal'],
      backupEligible: false,
      backupState: false,
      aaguid: AAGUID,
    };
  };

  const enrollWithoutProof = async (
    passkeys: AccountPasskeyService,
    actor: AccountPasskeyActor,
    authenticator: SoftwareAuthenticator,
    staged = jest.fn(async () => undefined),
  ) =>
    passkeys.addVerifiedSharedPasskey(
      actor,
      await verifiedCredential(authenticator),
      'This computer',
      undefined,
      {},
      staged,
    );

  const livePasskeys = (userId: UserId) =>
    prisma.db.accountPasskey.count({ where: { userId, revokedAt: null } });
  const activeSessions = (userId: UserId) =>
    prisma.db.browserSessionFamily.count({
      where: { userId, revokedAt: null },
    });

  it('lets the CLI-opened session create the first passkey, replacing its sessions, and that passkey signs in', async () => {
    const account = await createLocalAccount();
    const cliOpened = await account.openSession(true);
    const staged = jest.fn(async () => undefined);

    const fresh = await enrollWithoutProof(
      localPasskeys,
      cliOpened.actor,
      account.authenticator,
      staged,
    );

    expect(staged).toHaveBeenCalledTimes(1);
    expect(await livePasskeys(account.userId)).toBe(1);
    expect(await activeSessions(account.userId)).toBe(1);
    expect(fresh.sessionId).not.toBe(cliOpened.session.sessionId);

    const options = await localPasskeys.startSignIn();
    const signedIn = await localPasskeys.completeSignIn(
      account.authenticator.assert(options.challenge, ORIGIN),
      {},
    );
    expect(signedIn.response.user.id).toBe(account.userId);
  });

  it('refuses a CLI-opened session once a passkey exists', async () => {
    const account = await createLocalAccount();
    const first = await account.openSession(true);
    await enrollWithoutProof(localPasskeys, first.actor, account.authenticator);

    const later = await account.openSession(true);
    await expect(
      enrollWithoutProof(
        localPasskeys,
        later.actor,
        new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await livePasskeys(account.userId)).toBe(1);
  });

  it('refuses a session the CLI did not open', async () => {
    const account = await createLocalAccount();
    const ordinary = await account.openSession(false);

    await expect(
      enrollWithoutProof(localPasskeys, ordinary.actor, account.authenticator),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await livePasskeys(account.userId)).toBe(0);
  });

  it('refuses an account that is not the local account', async () => {
    const account = await createLocalAccount(`${randomUUID()}@example.test`);
    const session = await account.openSession(true);

    await expect(
      enrollWithoutProof(localPasskeys, session.actor, account.authenticator),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await livePasskeys(account.userId)).toBe(0);
  });

  it('creates exactly one passkey when two CLI-opened sessions race', async () => {
    const account = await createLocalAccount();
    const [one, two] = [
      await account.openSession(true),
      await account.openSession(true),
    ];

    const outcomes = await Promise.allSettled([
      enrollWithoutProof(
        localPasskeys,
        one.actor,
        new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
      ),
      enrollWithoutProof(
        localPasskeys,
        two.actor,
        new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
      ),
    ]);

    expect(
      outcomes.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await livePasskeys(account.userId)).toBe(1);
  });

  it('refuses proofless enrollment where no first-passkey rule is registered', async () => {
    const account = await createLocalAccount();
    const session = await account.openSession(true);

    await expect(
      enrollWithoutProof(hostedPasskeys, session.actor, account.authenticator),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(await livePasskeys(account.userId)).toBe(0);
  });
});
