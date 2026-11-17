import {
  createHash,
  createHmac,
  generateKeyPairSync,
  sign,
  randomBytes,
  randomUUID,
} from 'node:crypto';
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
import {
  AccountProofFailedException,
  AccountProofRequiredException,
} from '../../auth/passkeys/account-passkey.exceptions';
import { LocalFirstPasskeyAuthority } from '../local-first-passkey-authority';
import {
  LOCAL_REPAIR_NO_PASSKEY,
  LOCAL_REPAIR_NOT_REQUESTED,
  LOCAL_REPAIR_SESSION_NOT_CLI_OPENED,
  LocalPasskeyRepairService,
} from '../local-passkey-repair.service';

import { MACHINE_ENROLLMENT_CODE_ALPHABET } from '../../services/machine-pairing/machine-pairing.service';
import { MachineEnrollmentClaimService } from '../../services/machine-pairing/machine-enrollment-claim.service';
import { SharedEnrollmentClaimService } from '../../services/machine-pairing/shared-enrollment-claim.service';
import { SimpleWebAuthnRegistrationVerifier } from '../../services/machine-pairing/machine-enrollment-webauthn-verifier';
import { MachineEnrollmentConfirmationService } from '../../services/machine-pairing/machine-enrollment-confirmation.service';
import { ServerSigningKeyService } from '../../core/server-signing/server-signing-key.service';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import {
  CONTROLLER_DEVICE_POLICY_REVISION,
  PRISMA_CURRENT_AGENT_OPERATIONS,
} from '../../services/controller-authorization/controller-authorization.service';

const describeDatabase =
  process.env.RUN_BROWSER_SESSION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:3850';
const AAGUID = new Uint8Array(16);

const config = {
  BROWSER_TOKEN_ISSUER: 'urn:heyhey:local',
  BROWSER_TOKEN_AUDIENCE: ORIGIN,
  BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
  BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
  BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  ACCOUNT_PASSKEY_RP_ID: RP_ID,
  ACCOUNT_PASSKEY_ORIGIN: ORIGIN,
  MACHINE_ENROLLMENT_CODE_HMAC_KEY: 'local-recovery-test-key',
  MACHINE_ENROLLMENT_WEBAUTHN_RP_ID: RP_ID,
  MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN: ORIGIN,
};
const configService = {
  get: (key: string) => config[key as keyof typeof config] ?? process.env[key],
} as unknown as ConfigService;

describeDatabase('Local first passkey authority', () => {
  const previousEnvironment = {
    deployment: process.env.DEPLOYMENT_ENVIRONMENT,
    local: process.env.HEYHEY_LOCAL_APPLICATION,
  };
  const recorded = new Map<string, string>();
  const redis = {
    getClient: () => ({
      set: async (key: string, value: string) => {
        recorded.set(key, value);
        return 'OK';
      },
      get: async (key: string) => recorded.get(key) ?? null,
      exists: async (key: string) => Number(recorded.has(key)),
      del: async (key: string) => Number(recorded.delete(key)),
    }),
  };
  const publishedReductions: Array<{ machineId: string }> = [];
  const userIds: UserId[] = [];
  const organizationIds: OrganizationId[] = [];
  let prisma: PrismaService;
  let browserSessions: BrowserSessionService;
  let authority: LocalFirstPasskeyAuthority;
  let localPasskeys: AccountPasskeyService;
  let hostedPasskeys: AccountPasskeyService;
  let repair: LocalPasskeyRepairService;

  const buildPasskeys = (first?: LocalFirstPasskeyAuthority) =>
    new AccountPasskeyService(
      configService,
      prisma,
      {} as unknown as UserService,
      browserSessions,
      {} as unknown as AccountProofThrottleService,
      {
        publishAccountRemovalReductions: async (
          revocations: Array<{ machineId: string }>,
        ) => {
          publishedReductions.push(...revocations);
        },
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
    repair = new LocalPasskeyRepairService(
      prisma,
      redis as never,
      localPasskeys,
      authority,
    );
  });

  afterAll(async () => {
    await prisma.db.executionGrant.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.db.executionAuthorization.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.db.controllerBrowserBinding.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.db.controllerBrowserContext.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.db.task.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.db.project.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.db.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.db.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
    await prisma.db.pendingMachineEnrollment.deleteMany({
      where: { claimantUserId: { in: userIds } },
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
      organizationId,
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

  describe('an account that already has a passkey', () => {
    /** The state an interrupted first pairing leaves: a live passkey, nothing confirmed. */
    const accountWithPasskey = async () => {
      const account = await createLocalAccount();
      const first = await account.openSession(true);
      await enrollWithoutProof(
        localPasskeys,
        first.actor,
        account.authenticator,
      );
      return account;
    };

    const enrollWithPasskeyProof = async (
      actor: AccountPasskeyActor,
      prover: SoftwareAuthenticator,
      newAuthenticator: SoftwareAuthenticator,
      staged = jest.fn(async () => undefined),
    ) => {
      const proof = await localPasskeys.startProof(
        actor,
        'register',
        undefined,
      );
      return localPasskeys.addVerifiedSharedPasskey(
        actor,
        await verifiedCredential(newAuthenticator),
        'This computer',
        { passkeyAssertion: prover.assert(proof.challenge, ORIGIN) },
        {},
        staged,
      );
    };

    /** A paired computer whose controller credential is the account passkey. */
    const pairComputer = async (
      account: Awaited<ReturnType<typeof accountWithPasskey>>,
    ) => {
      const passkey = await prisma.db.accountPasskey.findFirstOrThrow({
        where: { userId: account.userId, revokedAt: null },
      });
      const machineId = randomUUID();
      const enrollmentId = randomUUID();
      const machineKey = `local-repair-${machineId}`;
      await prisma.db.pendingMachineEnrollment.create({
        data: {
          id: enrollmentId,
          machineId,
          machinePublicKey: machineKey,
          machinePublicKeyFingerprint: randomBytes(32).toString('hex'),
          machineName: 'This computer',
          osFamily: 'macos',
          cliVersion: '4.4.0',
          authorizationProtocolVersion: 2,
          userCodeHmac: randomBytes(32).toString('hex'),
          deviceSecretDigest: randomBytes(32).toString('hex'),
          state: 'ACTIVE',
          expiresAt: new Date(Date.now() + 300_000),
          claimantUserId: account.userId,
          claimantOrganizationId: account.organizationId,
          controllerLabel: 'Passkey on this computer',
        },
      });
      await prisma.db.machine.create({
        data: {
          id: machineId,
          userId: account.userId,
          organizationId: account.organizationId,
          name: 'This computer',
          publicKey: machineKey,
          tokenHash: randomBytes(32).toString('hex'),
          authorizationProtocolVersion: 2,
          authorizationState: 'READY',
        },
      });
      const controller = await prisma.db.machineControllerCredential.create({
        data: {
          machineId,
          userId: account.userId,
          organizationId: account.organizationId,
          accountPasskeyId: passkey.id,
          credentialId: passkey.credentialId,
          credentialPublicKeyX: Buffer.alloc(32, 1),
          credentialPublicKeyY: Buffer.alloc(32, 2),
          credentialTransports: ['internal'],
          credentialAaguid: Buffer.alloc(16, 3),
          credentialSignCount: 0,
          credentialBackupEligible: false,
          credentialBackupState: false,
          controllerLabel: 'Passkey on this computer',
          credentialFingerprint: randomBytes(32).toString('hex'),
          enrollmentId,
        },
      });
      return { machineId, controllerId: controller.id, enrollmentId };
    };

    /** Exercise the real shared claim, WebAuthn verifier, terminal proof and activation. */
    const completePairing = async (
      account: Awaited<ReturnType<typeof accountWithPasskey>>,
      setup: Awaited<ReturnType<typeof account.openSession>>,
      withAccountProof: boolean,
    ) => {
      const keys = generateKeyPairSync('ed25519');
      const machineId = randomUUID();
      const alphabet = MACHINE_ENROLLMENT_CODE_ALPHABET;
      const code = [...randomBytes(10)]
        .map((value) => alphabet[value % alphabet.length])
        .join('');
      const deviceSecret = randomBytes(32).toString('base64');
      const enrollment = await prisma.db.pendingMachineEnrollment.create({
        data: {
          machineId,
          machineName: 'Recovered computer',
          machinePublicKey: keys.publicKey
            .export({ format: 'pem', type: 'spki' })
            .toString(),
          machinePublicKeyFingerprint: createHash('sha256')
            .update(keys.publicKey.export({ format: 'der', type: 'spki' }))
            .digest('hex'),
          osFamily: 'macos',
          cliVersion: '4.4.1',
          authorizationProtocolVersion: 2,
          userCodeHmac: createHmac(
            'sha256',
            config.MACHINE_ENROLLMENT_CODE_HMAC_KEY,
          )
            .update(code)
            .digest('hex'),
          deviceSecretDigest: createHash('sha256')
            .update(Buffer.from(deviceSecret, 'base64'))
            .digest('hex'),
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      const claims = new MachineEnrollmentClaimService(
        prisma,
        configService,
        new SimpleWebAuthnRegistrationVerifier(),
      );
      const shared = new SharedEnrollmentClaimService(claims, localPasskeys);
      const confirmations = new MachineEnrollmentConfirmationService(
        prisma,
        new ServerSigningKeyService(configService),
      );
      const memberships = [{ orgId: account.organizationId }];
      const begun = await claims.beginClaim(
        {
          userCode: code,
          organizationId: account.organizationId,
          controllerLabel: 'Recovered browser',
          enrollmentMode: 'SHARED_NEW',
        },
        account.userId,
        memberships,
        '127.0.0.1',
        setup.actor,
      );
      if (begun.state !== 'claimable') {
        throw new Error('Expected a new registration ceremony');
      }
      const replacement = new SoftwareAuthenticator(
        RP_ID,
        userHandleFor(account.userId),
      );
      const proof = withAccountProof
        ? await localPasskeys.startProof(setup.actor, 'register', undefined)
        : null;
      const registration = replacement.register(
        begun.registrationOptions.challenge,
        ORIGIN,
      );
      await shared.completeSharedClaim(
        {
          enrollmentId: enrollment.id,
          organizationId: account.organizationId,
          credential: {
            ...registration,
            authenticatorAttachment: 'platform',
            response: { ...registration.response, transports: ['internal'] },
          },
          ...(proof
            ? {
                accountProof: {
                  passkeyAssertion: account.authenticator.assert(
                    proof.challenge,
                    ORIGIN,
                  ),
                },
              }
            : {}),
        },
        account.userId,
        memberships,
        '127.0.0.1',
        setup.actor,
        {},
      );
      await claims.issueBrowserBindingForAwaitingConfirmation({
        enrollmentId: enrollment.id,
        userId: account.userId,
        organizationId: account.organizationId,
      });
      expect(
        await prisma.db.machine.findUnique({ where: { id: machineId } }),
      ).toBeNull();
      await confirmations.poll(enrollment.id, { deviceSecret });
      const pending =
        await prisma.db.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: enrollment.id },
        });
      const confirmation = {
        enrollmentId: enrollment.id,
        machineId,
        accountId: account.userId,
        organizationId: account.organizationId,
        controllerCredentialId: replacement.id,
        confirmationNonce: pending.confirmationNonce!,
      };
      await confirmations.confirm(enrollment.id, {
        deviceSecret,
        confirmation,
        signature: sign(
          null,
          Buffer.from(canonicalizeJcs(confirmation)),
          keys.privateKey,
        ).toString('base64'),
      });
      expect(
        await prisma.db.machine.findUniqueOrThrow({ where: { id: machineId } }),
      ).toMatchObject({ authorizationState: 'READY' });
      expect(
        await prisma.db.controllerBrowserBinding.count({
          where: { userId: account.userId, revokedAt: null },
        }),
      ).toBe(1);
      expect(
        await prisma.db.executionGrant.count({ where: { machineId } }),
      ).toBe(0);
      return replacement;
    };

    it.each(['interrupted', 'revoked', 'empty-store'] as const)(
      'completes shared claim and terminal activation after %s pairing',
      async (state) => {
        const account = await accountWithPasskey();
        if (state !== 'interrupted') {
          const old = await pairComputer(account);
          if (state === 'revoked') {
            await prisma.db.machine.update({
              where: { id: old.machineId },
              data: { revokedAt: new Date() },
            });
          }
        }
        await completePairing(account, await account.openSession(true), true);
      },
    );

    it('re-pairs with the existing passkey after an interrupted first pairing', async () => {
      const account = await accountWithPasskey();
      const later = await account.openSession(true);
      const staged = jest.fn(async () => undefined);

      await expect(
        enrollWithoutProof(
          localPasskeys,
          later.actor,
          new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
        ),
      ).rejects.toBeInstanceOf(AccountProofRequiredException);

      await enrollWithPasskeyProof(
        later.actor,
        account.authenticator,
        new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
        staged,
      );

      expect(staged).toHaveBeenCalledTimes(1);
      expect(await livePasskeys(account.userId)).toBe(2);
    });

    it('re-pairs with the existing passkey after its computer was revoked', async () => {
      const account = await accountWithPasskey();
      const { machineId } = await pairComputer(account);
      await prisma.db.machine.update({
        where: { id: machineId },
        data: { revokedAt: new Date() },
      });
      const later = await account.openSession(true);
      const staged = jest.fn(async () => undefined);

      await enrollWithPasskeyProof(
        later.actor,
        account.authenticator,
        new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
        staged,
      );

      expect(staged).toHaveBeenCalledTimes(1);
    });

    it('names a proof that does not verify as a failed proof, and adds nothing', async () => {
      const account = await accountWithPasskey();
      const later = await account.openSession(true);
      const stranger = new SoftwareAuthenticator(
        RP_ID,
        userHandleFor(account.userId),
      );
      stranger.register(randomBytes(32).toString('base64url'), ORIGIN);

      await expect(
        enrollWithPasskeyProof(
          later.actor,
          stranger,
          new SoftwareAuthenticator(RP_ID, userHandleFor(account.userId)),
        ),
      ).rejects.toBeInstanceOf(AccountProofFailedException);
      expect(await livePasskeys(account.userId)).toBe(1);
    });

    it('repairs after terminal approval: old passkeys and their controllers are revoked, data is kept, and the setup session enrolls a new first passkey', async () => {
      const account = await accountWithPasskey();
      const { machineId, controllerId, enrollmentId } =
        await pairComputer(account);
      const project = await prisma.db.project.create({
        data: {
          organizationId: account.organizationId,
          name: 'Existing workspace',
          description: 'Research and delivery work',
          config: { customSetting: true },
        },
      });
      const task = await prisma.db.task.create({
        data: {
          organizationId: account.organizationId,
          projectId: project.id,
          name: 'Keep this work',
          type: 'STANDARD',
          status: 'ACTIVE',
          config: { notes: 'Existing user content' },
        },
      });
      const issuedAt = new Date();
      const binding = await prisma.db.controllerBrowserBinding.create({
        data: {
          userId: account.userId,
          organizationId: account.organizationId,
          controllerCredentialId: controllerId,
          controllerInstallationId: enrollmentId,
          credentialHash: randomBytes(32).toString('hex'),
          issuedAt,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const authorityFields = {
        controllerCredentialId: controllerId,
        controllerInstallationId: enrollmentId,
        machineId,
        userId: account.userId,
        organizationId: account.organizationId,
        projectId: project.id,
        cadence: 'FIVE_MINUTES' as const,
        policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
        grantDescriptorHash: 'e'.repeat(64),
        targetKind: 'CLI_READ' as const,
        targetId: machineId,
        issuedAt,
      };
      const authorization = await prisma.db.executionAuthorization.create({
        data: {
          ...authorityFields,
          requestId: randomUUID(),
          canonicalIntent: '{}',
          webauthnChallenge: randomBytes(32).toString('base64url'),
          nonce: randomBytes(32).toString('base64url'),
          actionCategory: 'CLI_READ',
          actionType: 'CLI_READ',
          actionPayloadHash: 'f'.repeat(64),
          expiresAt: new Date(issuedAt.getTime() + 120_000),
          consumedAt: issuedAt,
          outcome: 'ADMITTED',
          outcomeRecordedAt: issuedAt,
        },
      });
      const grant = await prisma.db.executionGrant.create({
        data: {
          ...authorityFields,
          authorizationId: authorization.id,
          scope: 'CONTROLLER_DEVICE_WINDOW',
          allowedActions: [...PRISMA_CURRENT_AGENT_OPERATIONS],
          expiresAt: new Date(issuedAt.getTime() + 300_000),
        },
      });
      await account.openSession(false);
      const setup = await account.openSession(true);

      await expect(
        repair.request(account.userId, setup.session.sessionId),
      ).resolves.toEqual({ state: 'REQUESTED' });
      expect(await livePasskeys(account.userId)).toBe(1);

      await expect(repair.decide(account.userId, true)).resolves.toEqual({
        state: 'COMPLETED',
      });

      expect(await livePasskeys(account.userId)).toBe(0);
      const controller =
        await prisma.db.machineControllerCredential.findUniqueOrThrow({
          where: { id: controllerId },
        });
      expect(controller.revokedAt).not.toBeNull();
      expect(
        (
          await prisma.db.executionGrant.findUniqueOrThrow({
            where: { id: grant.id },
          })
        ).revokedAt,
      ).not.toBeNull();
      expect(
        (
          await prisma.db.controllerBrowserBinding.findUniqueOrThrow({
            where: { id: binding.id },
          })
        ).revokedAt,
      ).not.toBeNull();
      expect(
        await prisma.db.project.findUniqueOrThrow({
          where: { id: project.id },
        }),
      ).toEqual(project);
      expect(
        await prisma.db.task.findUniqueOrThrow({ where: { id: task.id } }),
      ).toEqual(task);
      const machine = await prisma.db.machine.findUniqueOrThrow({
        where: { id: machineId },
      });
      expect(machine.authorizationState).toBe('CONTROLLER_ENROLLMENT_REQUIRED');
      expect(publishedReductions).toContainEqual(
        expect.objectContaining({ machineId }),
      );
      const remaining = await prisma.db.browserSessionFamily.findMany({
        where: { userId: account.userId, revokedAt: null },
        select: { sessionId: true },
      });
      expect(remaining).toEqual([{ sessionId: setup.session.sessionId }]);
      expect(
        await prisma.db.organizationMember.count({
          where: { userId: account.userId, isActive: true },
        }),
      ).toBe(1);

      const replacement = await completePairing(account, setup, false);
      expect(await livePasskeys(account.userId)).toBe(1);

      const stale = await localPasskeys.startSignIn();
      await expect(
        localPasskeys.completeSignIn(
          account.authenticator.assert(stale.challenge, ORIGIN),
          {},
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const fresh = await localPasskeys.startSignIn();
      const signedIn = await localPasskeys.completeSignIn(
        replacement.assert(fresh.challenge, ORIGIN),
        {},
      );
      expect(signedIn.response.user.id).toBe(account.userId);
    });

    it('changes nothing when the person declines the repair at the terminal', async () => {
      const account = await accountWithPasskey();
      const setup = await account.openSession(true);
      await repair.request(account.userId, setup.session.sessionId);

      await expect(repair.decide(account.userId, false)).resolves.toEqual({
        state: 'DECLINED',
      });

      expect(await livePasskeys(account.userId)).toBe(1);
      await expect(repair.status(account.userId)).resolves.toEqual({
        state: 'DECLINED',
      });
    });

    it('refuses a repair asked from a session the CLI did not open, naming the cause', async () => {
      const account = await accountWithPasskey();
      const ordinary = await account.openSession(false);

      await expect(
        repair.request(account.userId, ordinary.session.sessionId),
      ).rejects.toMatchObject({
        response: { code: LOCAL_REPAIR_SESSION_NOT_CLI_OPENED },
      });
      await expect(repair.status(account.userId)).resolves.toEqual({
        state: 'NONE',
      });
    });

    it('refuses a repair when there is no passkey to repair, naming the cause', async () => {
      const account = await createLocalAccount();
      const setup = await account.openSession(true);

      await expect(
        repair.request(account.userId, setup.session.sessionId),
      ).rejects.toMatchObject({ response: { code: LOCAL_REPAIR_NO_PASSKEY } });
    });

    it('refuses a terminal decision nobody asked for, and revokes nothing', async () => {
      const account = await accountWithPasskey();

      await expect(repair.decide(account.userId, true)).rejects.toMatchObject({
        response: { code: LOCAL_REPAIR_NOT_REQUESTED },
      });
      expect(await livePasskeys(account.userId)).toBe(1);
    });
  });
});
