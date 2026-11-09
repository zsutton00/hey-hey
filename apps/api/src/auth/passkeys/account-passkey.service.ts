import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import type {
  AccountPasskeyAssertionCredentialDto,
  AccountPasskeyAssertionOptionsDto,
  AccountPasskeyDto,
  AccountPasskeyListDto,
  AccountPasskeyRegistrationCredentialDto,
  AccountPasskeyRegistrationDto,
  AccountPasskeyRegistrationOptionsDto,
  AccountProofDto,
  BrowserAuthResponseDto,
  OrganizationRole,
} from '@hey-hey/contracts/api/models';
import type { AccountPasskey, Prisma } from '@prisma/client';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { UserService } from '../../services/user.service';
import { MachineId, UserId } from '../../types';
import { ControllerEnrollmentEligibilityState } from '@hey-hey/contracts/api/models';
import type { BrowserSessionRequestMetadata } from '../browser-session.types';
import {
  BrowserSessionPrincipal,
  BrowserSessionService,
  EstablishedBrowserSession,
} from '../services/browser-session.service';
import { isLocalAccountEmail } from '../local-account';
import { AccountProofThrottleService } from './account-proof-throttle.service';
import {
  ControllerManagementService,
  type AccountRemovalRevocation,
} from '../../services/controller-management/controller-management.service';
import { isLocalApplication } from '../../deployment-environment';
import {
  FIRST_PASSKEY_AUTHORITY,
  type FirstPasskeyAuthority,
} from './first-passkey-authority';

/** Ceremony lifetime for every account passkey challenge. */
export const ACCOUNT_PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CHALLENGE_BYTES = 32;
const RP_NAME = 'Hey Hey';

export const AccountPasskeyChallengePurpose = {
  SignIn: 'sign_in',
  Register: 'register',
  ProofRegister: 'proof_register',
  ProofRemove: 'proof_remove',
} as const;
type AccountPasskeyChallengePurpose =
  (typeof AccountPasskeyChallengePurpose)[keyof typeof AccountPasskeyChallengePurpose];

/** The signed-in account and the browser session acting on it. */
export interface AccountPasskeyActor {
  userId: UserId;
  browserSessionId: string;
  email: string;
  name: string;
}

interface ConsumedChallenge {
  challenge: string;
  purpose: string;
  userId: string | null;
  browserSessionId: string | null;
  targetPasskeyId: string | null;
}

/**
 * Account-login passkeys: enrollment, management and sign-in. The API owns
 * every WebAuthn verification (via SimpleWebAuthn) and every session
 * decision. Account passkeys and their challenges are separate from
 * controller credentials and never grant controller execution authority.
 */
@Injectable()
export class AccountPasskeyService {
  private readonly logger = new Logger(AccountPasskeyService.name);
  private readonly rpId: string;
  private readonly origin: string;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly browserSessionService: BrowserSessionService,
    private readonly proofThrottle: AccountProofThrottleService,
    private readonly controllerManagement: ControllerManagementService,
    @Optional()
    @Inject(FIRST_PASSKEY_AUTHORITY)
    private readonly firstPasskeyAuthority?: FirstPasskeyAuthority,
  ) {
    this.rpId = requiredConfig(configService, 'ACCOUNT_PASSKEY_RP_ID');
    this.origin = requiredConfig(configService, 'ACCOUNT_PASSKEY_ORIGIN');
    if (new URL(this.origin).origin !== this.origin) {
      throw new Error('ACCOUNT_PASSKEY_ORIGIN must be an origin');
    }
  }

  /** True only where local composition registered the first-passkey rule. */
  get acceptsFirstPasskeyWithoutProof(): boolean {
    return this.firstPasskeyAuthority !== undefined;
  }

  async list(userId: UserId): Promise<AccountPasskeyListDto> {
    const passkeys = await this.prisma.db.accountPasskey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { passkeys: passkeys.map(toDto) };
  }

  async rename(
    userId: UserId,
    passkeyId: string,
    name: string,
  ): Promise<AccountPasskeyDto> {
    const updated = await this.prisma.db.accountPasskey.updateMany({
      where: { id: passkeyId, userId, revokedAt: null },
      data: { name },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Passkey not found');
    }
    const passkey = await this.prisma.db.accountPasskey.findUniqueOrThrow({
      where: { id: passkeyId },
    });
    return toDto(passkey);
  }

  async startRegistration(
    actor: AccountPasskeyActor,
  ): Promise<AccountPasskeyRegistrationOptionsDto> {
    const existing = await this.prisma.db.accountPasskey.findMany({
      where: { userId: actor.userId },
      select: { credentialId: true },
    });
    const challenge = await this.issueChallenge({
      purpose: AccountPasskeyChallengePurpose.Register,
      userId: actor.userId,
      browserSessionId: actor.browserSessionId,
    });
    return {
      challenge,
      rpId: this.rpId,
      rpName: RP_NAME,
      userHandle: userHandleFor(actor.userId),
      userName: actor.email,
      userDisplayName: actor.name,
      excludeCredentialIds: existing.map((p) => p.credentialId),
      timeoutMs: ACCOUNT_PASSKEY_CHALLENGE_TTL_MS,
    };
  }

  async startProof(
    actor: AccountPasskeyActor,
    operation: 'register' | 'remove',
    passkeyId: string | undefined,
  ): Promise<AccountPasskeyAssertionOptionsDto> {
    if (operation === 'remove') {
      const target = passkeyId
        ? await this.prisma.db.accountPasskey.findFirst({
            where: { id: passkeyId, userId: actor.userId, revokedAt: null },
            select: { id: true },
          })
        : null;
      if (!target) {
        throw new NotFoundException('Passkey not found');
      }
    }

    const owned = await this.prisma.db.accountPasskey.findMany({
      where: { userId: actor.userId, revokedAt: null },
      select: { credentialId: true },
    });
    if (owned.length === 0) {
      throw new NotFoundException('No passkey is available for account proof');
    }

    const challenge = await this.issueChallenge({
      purpose:
        operation === 'register'
          ? AccountPasskeyChallengePurpose.ProofRegister
          : AccountPasskeyChallengePurpose.ProofRemove,
      userId: actor.userId,
      browserSessionId: actor.browserSessionId,
      targetPasskeyId: operation === 'remove' ? passkeyId : undefined,
    });
    return {
      challenge,
      rpId: this.rpId,
      allowCredentialIds: owned.map((p) => p.credentialId),
      timeoutMs: ACCOUNT_PASSKEY_CHALLENGE_TTL_MS,
    };
  }

  async startSignIn(): Promise<AccountPasskeyAssertionOptionsDto> {
    const challenge = await this.issueChallenge({
      purpose: AccountPasskeyChallengePurpose.SignIn,
    });
    return {
      challenge,
      rpId: this.rpId,
      allowCredentialIds: [],
      timeoutMs: ACCOUNT_PASSKEY_CHALLENGE_TTL_MS,
    };
  }

  async completeSignIn(
    credential: AccountPasskeyAssertionCredentialDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    try {
      const consumed = await this.consumeChallenge(
        credential.response.clientDataJSON,
        AccountPasskeyChallengePurpose.SignIn,
      );
      const passkey = await this.prisma.db.accountPasskey.findUnique({
        where: { credentialId: credential.id, revokedAt: null },
      });
      if (
        !passkey ||
        credential.response.userHandle !== userHandleFor(passkey.userId)
      ) {
        throw new Error('passkey-not-registered');
      }
      const newCounter = await this.verifyAssertion(
        credential,
        consumed.challenge,
        passkey,
      );

      // Lock the account before touching the passkey, the same order removal
      // uses, so a removal that commits after the pre-check above is seen here.
      const session = await this.prisma.db.$transaction(async (tx) => {
        const user = await this.lockActiveUser(tx, passkey.userId as UserId);
        await this.recordPasskeyUse(tx, passkey.id, newCounter);
        return this.browserSessionService.establishInTransaction(
          tx,
          principalFor(user),
          requestMetadata,
        );
      });
      this.logger.log('Passkey sign-in accepted', {
        eventType: 'ACCOUNT_PASSKEY_SIGN_IN',
        userId: passkey.userId,
        sessionId: session.sessionId,
      });
      return session;
    } catch (error) {
      this.logger.warn('Passkey sign-in rejected', {
        eventType: 'ACCOUNT_PASSKEY_SIGN_IN_REJECTED',
        reason: error instanceof Error ? error.message : 'unknown',
      });
      throw new UnauthorizedException('Passkey sign-in failed');
    }
  }

  async register(
    actor: AccountPasskeyActor,
    dto: AccountPasskeyRegistrationDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    const registration = await this.verifyRegistration(actor, dto.credential);
    return this.addPasskey(
      actor,
      registration,
      dto.name.trim(),
      dto.proof,
      requestMetadata,
    );
  }

  /**
   * Adds sign-in eligibility for a credential that was just verified by the
   * controller enrollment ceremony, in the same transaction that stages its
   * controller enrollment. Account proof is verified here against the
   * credential's own verified public key, never a client-supplied flag.
   * Failure in either step leaves passkeys, sessions and enrollment unchanged.
   */
  async addVerifiedSharedPasskey(
    actor: AccountPasskeyActor,
    credential: SharedEnrollmentCredential,
    name: string,
    proof: AccountProofDto | undefined,
    requestMetadata: BrowserSessionRequestMetadata,
    stageControllerEnrollment: (
      tx: AnyTransactionClient,
      accountPasskeyId: string,
    ) => Promise<void>,
  ): Promise<EstablishedBrowserSession> {
    return this.addPasskey(
      actor,
      {
        credentialId: credential.credentialId,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports,
        deviceType: credential.backupEligible ? 'multiDevice' : 'singleDevice',
        backedUp: credential.backupState,
        aaguid: formatAaguid(credential.aaguid),
      },
      name,
      proof,
      requestMetadata,
      stageControllerEnrollment,
    );
  }

  private async addPasskey(
    actor: AccountPasskeyActor,
    registration: {
      credentialId: string;
      publicKey: Uint8Array;
      counter: number;
      transports: string[];
      deviceType: string;
      backedUp: boolean;
      aaguid: string;
    },
    name: string,
    proof: AccountProofDto | undefined,
    requestMetadata: BrowserSessionRequestMetadata,
    afterCreate?: (
      tx: AnyTransactionClient,
      accountPasskeyId: string,
    ) => Promise<void>,
  ): Promise<EstablishedBrowserSession> {
    const authority =
      proof === undefined ? this.requiredFirstPasskeyAuthority() : undefined;
    const proofPasskey =
      proof === undefined
        ? undefined
        : await this.verifyAccountProof(actor, proof, {
            purpose: AccountPasskeyChallengePurpose.ProofRegister,
          });

    const session = await this.replaceSessionsAfterChange(
      actor,
      'passkey_added',
      requestMetadata,
      async (tx) => {
        await authority?.assertFirstPasskeyAllowed(tx, actor);
        if (proofPasskey) {
          await this.recordPasskeyUse(
            tx,
            proofPasskey.id,
            proofPasskey.newCounter,
          );
        }
        let created: { id: string };
        try {
          created = await tx.accountPasskey.create({
            data: {
              userId: actor.userId,
              credentialId: registration.credentialId,
              publicKey: Buffer.from(registration.publicKey),
              signCount: registration.counter,
              transports: registration.transports,
              deviceType: registration.deviceType,
              backedUp: registration.backedUp,
              aaguid: registration.aaguid,
              name,
            },
            select: { id: true },
          });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new BadRequestException('Passkey is already registered');
          }
          throw error;
        }
        await afterCreate?.(tx, created.id);
      },
    );
    await authority?.firstPasskeyEnrolled(actor);
    return session;
  }

  private requiredFirstPasskeyAuthority(): FirstPasskeyAuthority {
    if (!this.firstPasskeyAuthority) {
      throw new UnauthorizedException('Account proof is required');
    }
    return this.firstPasskeyAuthority;
  }

  async remove(
    actor: AccountPasskeyActor,
    passkeyId: string,
    proof: AccountProofDto,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<EstablishedBrowserSession> {
    const target = await this.prisma.db.accountPasskey.findFirst({
      where: { id: passkeyId, userId: actor.userId, revokedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException('Passkey not found');
    }

    const proofPasskey = await this.verifyAccountProof(actor, proof, {
      purpose: AccountPasskeyChallengePurpose.ProofRemove,
      targetPasskeyId: passkeyId,
    });

    let revocations: AccountRemovalRevocation[] = [];
    const session = await this.replaceSessionsAfterChange(
      actor,
      'passkey_removed',
      requestMetadata,
      async (tx) => {
        if (proofPasskey && proofPasskey.id !== passkeyId) {
          await this.recordPasskeyUse(
            tx,
            proofPasskey.id,
            proofPasskey.newCounter,
          );
        }
        const revokedAt = new Date();
        const removed = await tx.accountPasskey.updateMany({
          where: { id: passkeyId, userId: actor.userId, revokedAt: null },
          data: { revokedAt },
        });
        if (removed.count === 0) {
          throw new NotFoundException('Passkey not found');
        }
        revocations = await this.revokeLinkedControllerAuthority(
          tx,
          passkeyId,
          revokedAt,
        );
      },
    );

    await this.controllerManagement.publishAccountRemovalReductions(
      revocations,
    );
    return session;
  }

  /**
   * Removing an account passkey removes every use of it in this deployment:
   * each linked controller credential, its execution grants and its browser
   * bindings are revoked, and a machine left without an active controller
   * requires controller enrollment again.
   */
  private async revokeLinkedControllerAuthority(
    tx: AnyTransactionClient,
    accountPasskeyId: string,
    revokedAt: Date,
  ): Promise<AccountRemovalRevocation[]> {
    await tx.pendingMachineEnrollment.updateMany({
      where: {
        accountPasskeyId,
        state: {
          in: ['BROWSER_CLAIMED', 'AWAITING_MACHINE_CONFIRMATION'],
        },
      },
      data: { state: 'REJECTED', rejectedAt: revokedAt },
    });

    const linked: LinkedController[] =
      await tx.machineControllerCredential.findMany({
        where: { accountPasskeyId, revokedAt: null },
        select: {
          id: true,
          machineId: true,
          userId: true,
          credentialId: true,
          organizationId: true,
        },
      });
    if (linked.length === 0) {
      return [];
    }

    const controllerIds = linked.map((controller) => controller.id);
    await tx.machineControllerCredential.updateMany({
      where: { id: { in: controllerIds }, revokedAt: null },
      data: { revokedAt },
    });
    await tx.executionGrant.updateMany({
      where: { controllerCredentialId: { in: controllerIds }, revokedAt: null },
      data: { revokedAt },
    });
    await tx.controllerBrowserBinding.updateMany({
      where: {
        controllerCredentialId: { in: controllerIds },
        revokedAt: null,
      },
      data: { revokedAt, revocationReason: 'account_passkey_removed' },
    });

    const machineIds = [
      ...new Set(linked.map((controller) => controller.machineId)),
    ];
    const enrollmentRequired = new Set<string>();
    for (const machineId of machineIds) {
      const remaining = await tx.machineControllerCredential.count({
        where: { machineId, revokedAt: null },
      });
      if (remaining === 0) {
        enrollmentRequired.add(machineId);
        await tx.machine.updateMany({
          where: { id: machineId, revokedAt: null },
          data: { authorizationState: 'CONTROLLER_ENROLLMENT_REQUIRED' },
        });
      }
    }

    return linked.map((controller) => ({
      machineId: controller.machineId as MachineId,
      userId: controller.userId as UserId,
      controllerCredentialId: controller.credentialId,
      revokedAt,
      enrollmentState: enrollmentRequired.has(controller.machineId)
        ? ControllerEnrollmentEligibilityState.ControllerEnrollmentRequired
        : ControllerEnrollmentEligibilityState.Ready,
      organizationId: controller.organizationId,
    }));
  }

  /**
   * One transaction: apply the credential change, advance the account's
   * authorization revision, revoke every earlier browser session (including
   * the acting one) and establish exactly one fresh session for the acting
   * browser. Socket eviction is published only after commit; a rollback
   * leaves credentials, sessions and access unchanged.
   */
  private async replaceSessionsAfterChange(
    actor: AccountPasskeyActor,
    reason: 'passkey_added' | 'passkey_removed',
    requestMetadata: BrowserSessionRequestMetadata,
    change: (tx: AnyTransactionClient) => Promise<void>,
  ): Promise<EstablishedBrowserSession> {
    const committed = await this.prisma.db.$transaction(async (tx) => {
      const user = await this.lockActiveUser(tx, actor.userId);
      await this.assertActingSessionCurrent(tx, actor);
      await change(tx);

      const updated = await tx.user.update({
        where: { id: actor.userId },
        data: { authorizationRevision: { increment: 1 } },
        select: { authorizationRevision: true },
      });
      const revocation =
        await this.browserSessionService.revokeAllForUserInTransaction(
          tx,
          actor.userId,
          new Date(),
          reason,
        );
      const session = await this.browserSessionService.establishInTransaction(
        tx,
        principalFor(user),
        requestMetadata,
      );
      return {
        session,
        revocation,
        revision: updated.authorizationRevision,
      };
    });

    this.browserSessionService.invalidateRevokedSessions(
      committed.revocation.revokedSessionIds,
    );
    this.browserSessionService.invalidateStaleAuthorization(
      actor.userId,
      committed.revision,
    );
    this.logger.log('Account passkey change committed', {
      eventType:
        reason === 'passkey_added'
          ? 'ACCOUNT_PASSKEY_ADDED'
          : 'ACCOUNT_PASSKEY_REMOVED',
      userId: actor.userId,
      revokedSessionCount: committed.revocation.revokedSessionIds.length,
      sessionId: committed.session.sessionId,
    });
    return committed.session;
  }

  private async lockActiveUser(tx: AnyTransactionClient, userId: UserId) {
    await tx.$queryRaw`
      SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE
    `;
    const user = await tx.user.findUnique({
      where: { id: userId },
      include: { memberships: { where: { isActive: true } } },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Account is unavailable');
    }
    return user;
  }

  private async assertActingSessionCurrent(
    tx: AnyTransactionClient,
    actor: AccountPasskeyActor,
  ): Promise<void> {
    const sessions = await tx.$queryRaw<Array<{ revokedAt: Date | null }>>`
      SELECT "revoked_at" AS "revokedAt"
      FROM "browser_session_families"
      WHERE "session_id" = ${actor.browserSessionId}
        AND "user_id" = ${actor.userId}
      FOR UPDATE
    `;
    if (!sessions[0] || sessions[0].revokedAt !== null) {
      throw new UnauthorizedException('Browser session is no longer active');
    }
  }

  private async verifyRegistration(
    actor: AccountPasskeyActor,
    credential: AccountPasskeyRegistrationCredentialDto,
  ) {
    const consumed = await this.consumeChallenge(
      credential.response.clientDataJSON,
      AccountPasskeyChallengePurpose.Register,
    ).catch(() => {
      throw new UnauthorizedException('Passkey registration failed');
    });
    this.assertBoundToActor(consumed, actor);

    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: {
          id: credential.id,
          rawId: credential.rawId,
          type: credential.type,
          authenticatorAttachment:
            credential.authenticatorAttachment ?? undefined,
          clientExtensionResults: {},
          response: {
            clientDataJSON: credential.response.clientDataJSON,
            attestationObject: credential.response.attestationObject,
            transports: [
              ...credential.response.transports,
            ] as AuthenticatorTransportFuture[],
          },
        },
        expectedChallenge: consumed.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpId,
        expectedType: 'webauthn.create',
        requireUserVerification: true,
      });
    } catch {
      throw new UnauthorizedException('Passkey registration failed');
    }
    if (!verification.verified) {
      throw new UnauthorizedException('Passkey registration failed');
    }

    const info = verification.registrationInfo;
    return {
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: [...credential.response.transports],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      aaguid: info.aaguid,
    };
  }

  /**
   * Verifies exactly one form of fresh account proof. Returns the proving
   * passkey (with its new counter) when proof was a passkey assertion.
   */
  private async verifyAccountProof(
    actor: AccountPasskeyActor,
    proof: AccountProofDto,
    binding: {
      purpose: AccountPasskeyChallengePurpose;
      targetPasskeyId?: string;
    },
  ): Promise<{ id: string; newCounter: number } | undefined> {
    const hasPassword = proof.currentPassword !== undefined;
    const hasAssertion = proof.passkeyAssertion !== undefined;
    if (hasPassword === hasAssertion) {
      throw new BadRequestException('Provide exactly one account proof');
    }

    if (proof.currentPassword !== undefined) {
      if (!(await this.proofThrottle.allowPasswordProof(actor.userId))) {
        this.logger.warn('Account proof throttled', {
          eventType: 'ACCOUNT_PROOF_THROTTLED',
          userId: actor.userId,
          method: 'password',
        });
        throw new UnauthorizedException('Account proof failed');
      }
      const user = await this.prisma.db.user.findUnique({
        where: { id: actor.userId },
      });
      const valid =
        user !== null &&
        (await this.userService.validatePassword(user, proof.currentPassword));
      if (!valid) {
        this.logger.warn('Account proof rejected', {
          eventType: 'ACCOUNT_PROOF_REJECTED',
          userId: actor.userId,
          method: 'password',
        });
        throw new UnauthorizedException('Account proof failed');
      }
      return undefined;
    }

    const assertion = proof.passkeyAssertion!;
    try {
      const consumed = await this.consumeChallenge(
        assertion.response.clientDataJSON,
        binding.purpose,
      );
      this.assertBoundToActor(consumed, actor);
      if ((consumed.targetPasskeyId ?? undefined) !== binding.targetPasskeyId) {
        throw new Error('proof-target-mismatch');
      }
      const passkey = await this.prisma.db.accountPasskey.findUnique({
        where: { credentialId: assertion.id, revokedAt: null },
      });
      if (!passkey || passkey.userId !== actor.userId) {
        throw new Error('proof-passkey-not-owned');
      }
      const newCounter = await this.verifyAssertion(
        assertion,
        consumed.challenge,
        passkey,
      );
      return { id: passkey.id, newCounter };
    } catch {
      this.logger.warn('Account proof rejected', {
        eventType: 'ACCOUNT_PROOF_REJECTED',
        userId: actor.userId,
        method: 'passkey',
      });
      throw new UnauthorizedException('Account proof failed');
    }
  }

  private async verifyAssertion(
    credential: AccountPasskeyAssertionCredentialDto,
    expectedChallenge: string,
    passkey: AccountPasskey,
  ): Promise<number> {
    const verification = await verifyAuthenticationResponse({
      response: {
        id: credential.id,
        rawId: credential.rawId,
        type: credential.type,
        authenticatorAttachment:
          credential.authenticatorAttachment ?? undefined,
        clientExtensionResults: {},
        response: {
          clientDataJSON: credential.response.clientDataJSON,
          authenticatorData: credential.response.authenticatorData,
          signature: credential.response.signature,
          userHandle: credential.response.userHandle ?? undefined,
        },
      },
      expectedChallenge,
      expectedOrigin: this.origin,
      expectedRPID: this.rpId,
      expectedType: 'webauthn.get',
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.signCount),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!verification.verified) {
      throw new Error('assertion-not-verified');
    }
    return verification.authenticationInfo.newCounter;
  }

  /**
   * Records use of a passkey that must still be registered. Callers hold the
   * account row lock, so a removal committed since verification fails here
   * and rolls back the session or credential change that depended on it.
   */
  private async recordPasskeyUse(
    tx: AnyTransactionClient,
    passkeyId: string,
    newCounter: number,
  ): Promise<void> {
    const recorded = await tx.accountPasskey.updateMany({
      where: { id: passkeyId, revokedAt: null },
      data: { signCount: newCounter, lastUsedAt: new Date() },
    });
    if (recorded.count === 0) {
      throw new UnauthorizedException('Passkey is no longer registered');
    }
  }

  private assertBoundToActor(
    consumed: ConsumedChallenge,
    actor: AccountPasskeyActor,
  ): void {
    if (
      consumed.userId !== actor.userId ||
      consumed.browserSessionId !== actor.browserSessionId
    ) {
      throw new UnauthorizedException('Passkey ceremony is not bound to you');
    }
  }

  private async issueChallenge(binding: {
    purpose: AccountPasskeyChallengePurpose;
    userId?: UserId;
    browserSessionId?: string;
    targetPasskeyId?: string;
  }): Promise<string> {
    const challenge = randomBytes(CHALLENGE_BYTES).toString('base64url');
    const now = new Date();
    await this.prisma.db.accountPasskeyChallenge.create({
      data: {
        challenge,
        purpose: binding.purpose,
        userId: binding.userId ?? null,
        browserSessionId: binding.browserSessionId ?? null,
        targetPasskeyId: binding.targetPasskeyId ?? null,
        rpId: this.rpId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + ACCOUNT_PASSKEY_CHALLENGE_TTL_MS),
      },
    });
    return challenge;
  }

  /**
   * Atomically consume the unexpired challenge named in the client data for
   * the expected purpose. Concurrent completions have exactly one winner, and
   * a consumed challenge stays consumed even if the ceremony later fails.
   */
  private async consumeChallenge(
    clientDataJSON: string,
    purpose: AccountPasskeyChallengePurpose,
  ): Promise<ConsumedChallenge> {
    const challenge = challengeFromClientData(clientDataJSON);
    const rows = await this.prisma.db.$queryRaw<ConsumedChallenge[]>`
      UPDATE "account_passkey_challenges"
      SET "consumed_at" = clock_timestamp()
      WHERE "challenge" = ${challenge}
        AND "purpose" = ${purpose}
        AND "rp_id" = ${this.rpId}
        AND "consumed_at" IS NULL
        AND "expires_at" > clock_timestamp()
      RETURNING
        "challenge",
        "purpose",
        "user_id" AS "userId",
        "browser_session_id" AS "browserSessionId",
        "target_passkey_id" AS "targetPasskeyId"
    `;
    const consumed = rows[0];
    if (!consumed) {
      throw new Error('challenge-unavailable');
    }
    return consumed;
  }
}

/** Builds the browser-session principal from a locked user row. */
function principalFor(
  user: Prisma.UserGetPayload<{ include: { memberships: true } }>,
): BrowserSessionPrincipal {
  const isLocalAccount =
    isLocalApplication() && isLocalAccountEmail(user.email);
  const memberships = [...user.memberships].sort((left, right) =>
    left.organizationId.localeCompare(right.organizationId),
  );
  return {
    userId: user.id as UserId,
    user: {
      id: user.id as UserId,
      email: user.email,
      name: user.name,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      currentOrganizationId: null,
      ...(isLocalAccount ? { isLocalAccount: true } : {}),
    } satisfies BrowserAuthResponseDto['user'],
    claims: {
      email: user.email,
      name: user.name,
      orgMemberships: memberships.map((membership) => ({
        orgId: membership.organizationId,
        role: membership.role as OrganizationRole,
      })),
      isDevAdmin: user.isDevAdmin,
      devAdminMode: user.devAdminMode,
      ...(isLocalAccount ? { isLocalAccount: true } : {}),
    },
  };
}

interface LinkedController {
  id: string;
  machineId: string;
  userId: string;
  credentialId: string;
  organizationId: string;
}

/** Verified public credential material handed over by controller enrollment. */
export interface SharedEnrollmentCredential {
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
  aaguid: Uint8Array;
}

function formatAaguid(aaguid: Uint8Array): string {
  const hex = Buffer.from(aaguid).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export function userHandleFor(userId: string): string {
  return Buffer.from(userId, 'utf8').toString('base64url');
}

function challengeFromClientData(clientDataJSON: string): string {
  const parsed: unknown = JSON.parse(
    Buffer.from(clientDataJSON, 'base64url').toString('utf8'),
  );
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('challenge' in parsed) ||
    typeof parsed.challenge !== 'string'
  ) {
    throw new Error('client-data-missing-challenge');
  }
  return parsed.challenge;
}

function toDto(passkey: AccountPasskey): AccountPasskeyDto {
  return {
    id: passkey.id,
    name: passkey.name,
    createdAt: passkey.createdAt.toISOString(),
    lastUsedAt: passkey.lastUsedAt?.toISOString() ?? null,
    backedUp: passkey.backedUp,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function requiredConfig(configService: ConfigService, key: string): string {
  const value = configService.get<string>(key)?.trim();
  if (!value) {
    throw new Error(`${key} must be configured`);
  }
  return value;
}
