import { ConfigService } from '@nestjs/config';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { MachineEnrollmentState, Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  AbandonMachineEnrollmentClaimRequestDto,
  AbandonMachineEnrollmentClaimResponseDto,
  BeginMachineEnrollmentAwaitingConfirmationDto,
  BeginMachineEnrollmentClaimableDto,
  BeginMachineEnrollmentClaimRequestDto,
  BeginMachineEnrollmentClaimResponseDto,
  CompleteMachineEnrollmentClaimRequestDto,
  CompleteMachineEnrollmentClaimResponseDto,
  MachineEnrollmentWebAuthnRegistrationCredentialDto,
} from '../../generated';
import {
  MACHINE_ENROLLMENT_CLAIM_EXPIRED,
  MACHINE_ENROLLMENT_CLAIM_TERMINAL,
  MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
  MachineEnrollmentClaimFailedException,
  MachineEnrollmentClaimRateLimitException,
} from '../../common/exceptions/pairing.exceptions';
import { PrismaService } from '../../prisma/prisma.service';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../types';
import {
  normalizeEnrollmentCode,
  normalizeEnrollmentSourceAddress,
} from './machine-pairing.service';
import {
  MachineEnrollmentWebAuthnVerifier,
  VerifiedMachineEnrollmentCredential,
} from './machine-enrollment-webauthn-verifier';
import { machineEnrollmentDiagnostic } from './machine-enrollment-diagnostics';
import {
  ControllerBrowserBindingService,
  IssuedControllerBinding,
} from '../controller-authorization/controller-browser-binding.service';

type BrowserSafeClaimFailureCode =
  | typeof MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE
  | typeof MACHINE_ENROLLMENT_CLAIM_EXPIRED
  | typeof MACHINE_ENROLLMENT_CLAIM_TERMINAL
  | typeof MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE;

export const MACHINE_ENROLLMENT_WEBAUTHN_VERIFIER = Symbol(
  'MACHINE_ENROLLMENT_WEBAUTHN_VERIFIER',
);

export const MACHINE_ENROLLMENT_CLAIM_FAILURE_WINDOW_MS = 60 * 1000;
export const MACHINE_ENROLLMENT_ACCOUNT_FAILURE_LIMIT = 50;
export const MACHINE_ENROLLMENT_SOURCE_FAILURE_LIMIT = 50;
export const MACHINE_ENROLLMENT_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MACHINE_ENROLLMENT_PRODUCTION_RP_ID = 'heyhey.dev';
export const MACHINE_ENROLLMENT_PRODUCTION_ORIGIN = 'https://heyhey.dev';

export function resolveMachineEnrollmentWebAuthnConfiguration(
  configService: ConfigService,
): { rpId: string; origin: string } {
  const requireConfig = (key: string): string => {
    const value = configService.get<string>(key);
    if (!value || value.trim().length === 0) {
      throw new Error(`${key} must be explicitly configured`);
    }
    return value;
  };
  const production =
    (configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV) ===
    'production';
  // NODE_ENV describes the runtime mode, including staging deployments.
  // Explicit WebAuthn configuration must be supplied as a complete pair.
  const hasExplicitConfiguration =
    configService.get<string>('MACHINE_ENROLLMENT_WEBAUTHN_RP_ID') !==
      undefined ||
    configService.get<string>('MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN') !==
      undefined;
  const useProductionDefaults = production && !hasExplicitConfiguration;
  const rpId = useProductionDefaults
    ? MACHINE_ENROLLMENT_PRODUCTION_RP_ID
    : requireConfig('MACHINE_ENROLLMENT_WEBAUTHN_RP_ID');
  const origin = useProductionDefaults
    ? MACHINE_ENROLLMENT_PRODUCTION_ORIGIN
    : requireConfig('MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN');

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('MACHINE_ENROLLMENT_WEBAUTHN_ORIGIN must be an origin');
  }
  if (
    parsedOrigin.origin !== origin ||
    !parsedOrigin.hostname ||
    !rpId ||
    rpId.includes('://') ||
    rpId.includes('/') ||
    rpId.includes('\\') ||
    (parsedOrigin.hostname !== rpId &&
      !parsedOrigin.hostname.endsWith(`.${rpId}`))
  ) {
    throw new Error('Machine enrollment WebAuthn configuration is invalid');
  }
  return { rpId, origin };
}

const LIVE_CLAIM_STATES: MachineEnrollmentState[] = [
  MachineEnrollmentState.PENDING,
  MachineEnrollmentState.BROWSER_CLAIMED,
  MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
] as const;

interface OrganizationMembership {
  orgId: string;
}

interface FailureCounts {
  accountCount: number;
  sourceCount: number;
}

class ClaimTransitionFailedError extends Error {}

export type BeginClaimDecision =
  | { kind: 'claim' }
  | { kind: 'resume' }
  | { kind: 'awaiting-machine-confirmation' }
  | { kind: 'unusable'; countAsInvalidAttempt: boolean };

export const decideBeginClaim = (
  enrollment: {
    state: MachineEnrollmentState;
    expiresAt: Date;
    claimantUserId: string | null;
    claimantOrganizationId: string | null;
  },
  claimant: {
    userId: string;
    organizationId: string;
  },
  now: Date,
): BeginClaimDecision => {
  if (enrollment.expiresAt.getTime() <= now.getTime()) {
    return { kind: 'unusable', countAsInvalidAttempt: false };
  }

  const sameClaimant =
    enrollment.claimantUserId === claimant.userId &&
    enrollment.claimantOrganizationId === claimant.organizationId;

  switch (enrollment.state) {
    case MachineEnrollmentState.PENDING:
      return { kind: 'claim' };
    case MachineEnrollmentState.BROWSER_CLAIMED:
      return sameClaimant
        ? { kind: 'resume' }
        : { kind: 'unusable', countAsInvalidAttempt: true };
    case MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION:
      return sameClaimant
        ? { kind: 'awaiting-machine-confirmation' }
        : { kind: 'unusable', countAsInvalidAttempt: true };
    default:
      return { kind: 'unusable', countAsInvalidAttempt: false };
  }
};

@Injectable()
export class MachineEnrollmentClaimService {
  private readonly logger = new Logger(MachineEnrollmentClaimService.name);
  private readonly enrollmentCodeHmacKey: string;
  private readonly webauthnRpId: string;
  private readonly webauthnOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(MACHINE_ENROLLMENT_WEBAUTHN_VERIFIER)
    private readonly webauthnVerifier: MachineEnrollmentWebAuthnVerifier,
    @Inject(ControllerBrowserBindingService)
    private readonly controllerBrowserBindingService = new ControllerBrowserBindingService(
      prisma,
    ),
  ) {
    this.enrollmentCodeHmacKey = this.requireConfig(
      'MACHINE_ENROLLMENT_CODE_HMAC_KEY',
    );

    const webauthn = resolveMachineEnrollmentWebAuthnConfiguration(
      this.configService,
    );
    this.webauthnRpId = webauthn.rpId;
    this.webauthnOrigin = webauthn.origin;
  }

  async issueBrowserBindingForAwaitingConfirmation(params: {
    enrollmentId: string;
    userId: UserId;
    organizationId: OrganizationId;
  }): Promise<IssuedControllerBinding> {
    const pending = this.controllerBrowserBindingService.issuePending();
    const updated = await this.prisma.db.pendingMachineEnrollment.updateMany({
      where: {
        id: params.enrollmentId,
        state: MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
        claimantUserId: params.userId,
        claimantOrganizationId: params.organizationId,
        expiresAt: { gt: pending.issuedAt },
        credentialId: { not: null },
        controllerInstallationId: { not: null },
      },
      data: {
        browserBindingCredentialHash: pending.credentialHash,
        browserBindingIssuedAt: pending.issuedAt,
        browserBindingExpiresAt: pending.expiresAt,
      },
    });
    if (updated.count !== 1) {
      throw new MachineEnrollmentClaimFailedException(
        MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
      );
    }
    return { secret: pending.secret, expiresAt: pending.expiresAt };
  }

  async beginClaim(
    input: BeginMachineEnrollmentClaimRequestDto,
    userId: UserId,
    memberships: readonly OrganizationMembership[],
    sourceAddress: string | undefined,
    userIdentity?: { email: string; name: string },
  ): Promise<BeginMachineEnrollmentClaimResponseDto> {
    const normalizedSourceAddress = this.normalizeSource(sourceAddress);

    let normalizedCode: string;
    try {
      this.assertBeginRequest(input);
      normalizedCode = normalizeEnrollmentCode(input.userCode);
    } catch {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        undefined,
        'invalid_request',
        true,
        MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
      );
    }

    if (!this.hasOrganizationMembership(memberships, input.organizationId)) {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        undefined,
        'organization_substitution',
        true,
      );
    }

    const userCodeHmac = this.hashEnrollmentCode(normalizedCode);
    const enrollment = await this.prisma.db.pendingMachineEnrollment.findUnique(
      {
        where: { userCodeHmac },
      },
    );

    if (!enrollment) {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        undefined,
        'code_lookup_failed',
        true,
      );
    }

    if (
      !(await this.isExistingMachineClaimAllowed(
        enrollment.machineId,
        userId,
        input.organizationId,
      ))
    ) {
      await this.recordLocalOutcomeIfActiveForeignMachine({
        enrollmentId: enrollment.id,
        userId,
        organizationId: input.organizationId,
      });
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        enrollment.id,
        'existing_machine_ownership_mismatch',
        true,
      );
    }

    const now = new Date();
    const locked = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${enrollment.id}, 21))`;
      const current = await tx.pendingMachineEnrollment.findUniqueOrThrow({
        where: { id: enrollment.id },
      });
      const decision = decideBeginClaim(
        current,
        {
          userId,
          organizationId: input.organizationId,
        },
        now,
      );

      if (decision.kind === 'unusable') {
        if (current.expiresAt.getTime() <= now.getTime()) {
          await tx.pendingMachineEnrollment.updateMany({
            where: { id: current.id, state: { in: [...LIVE_CLAIM_STATES] } },
            data: { state: MachineEnrollmentState.EXPIRED, expiredAt: now },
          });
        }
        return { decision, enrollment: current };
      }

      if (decision.kind !== 'claim') return { decision, enrollment: current };

      const challenge = crypto.randomBytes(32).toString('base64url');
      const challengeExpiresAt = new Date(
        Math.min(
          current.expiresAt.getTime(),
          now.getTime() + MACHINE_ENROLLMENT_CHALLENGE_TTL_MS,
        ),
      );
      const claimed = await tx.pendingMachineEnrollment.updateMany({
        where: { id: current.id },
        data: {
          state: MachineEnrollmentState.BROWSER_CLAIMED,
          claimantUserId: userId,
          claimantOrganizationId: input.organizationId,
          controllerInstallationId:
            current.controllerInstallationId ?? crypto.randomUUID(),
          controllerLabel: input.controllerLabel,
          webauthnChallenge: challenge,
          challengeIssuedAt: now,
          challengeExpiresAt,
          browserClaimedAt: now,
        },
      });
      if (claimed.count !== 1) throw new ClaimTransitionFailedError();
      return {
        decision,
        enrollment: await tx.pendingMachineEnrollment.findUniqueOrThrow({
          where: { id: current.id },
        }),
      };
    });

    if (locked.decision.kind === 'unusable') {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        enrollment.id,
        'invalid_state_expiry_or_claimant',
        locked.decision.countAsInvalidAttempt,
        this.classifyKnownEnrollmentFailure(
          locked.enrollment,
          {
            userId,
            organizationId: input.organizationId,
          },
          now,
        ),
      );
    }

    const claimedEnrollment = locked.enrollment;

    this.logger.log(
      'Machine enrollment begin claim decided',
      machineEnrollmentDiagnostic('begin_claim', {
        enrollmentId: claimedEnrollment.id,
        machineId: claimedEnrollment.machineId,
        userId,
        organizationId: input.organizationId,
        decision: locked.decision.kind,
        reasonCode: 'claim_state_decision',
        state: claimedEnrollment.state,
      }),
    );

    if (locked.decision.kind === 'awaiting-machine-confirmation') {
      if (
        !claimedEnrollment.controllerLabel ||
        !claimedEnrollment.credentialFingerprint ||
        claimedEnrollment.credentialBackupEligible === null ||
        claimedEnrollment.credentialBackupState === null
      ) {
        throw new Error(
          'Completed browser claim is missing confirmation evidence',
        );
      }
      return {
        state: 'awaiting-machine-confirmation',
        enrollmentId: claimedEnrollment.id,
        machineId: claimedEnrollment.machineId,
        userId,
        organizationId: input.organizationId as OrganizationId,
        controllerLabel: claimedEnrollment.controllerLabel,
        expiresAt: claimedEnrollment.expiresAt.toISOString(),
        credentialFingerprint: `sha256:${claimedEnrollment.credentialFingerprint}`,
        backupEligible: claimedEnrollment.credentialBackupEligible,
        backupState: claimedEnrollment.credentialBackupState,
      } satisfies BeginMachineEnrollmentAwaitingConfirmationDto;
    }

    if (
      !claimedEnrollment.controllerLabel ||
      !claimedEnrollment.webauthnChallenge
    ) {
      throw new Error('Claimed enrollment is missing browser claim material');
    }

    this.logger.log(
      'Machine enrollment browser claim begun',
      machineEnrollmentDiagnostic('begin_claim', {
        enrollmentId: claimedEnrollment.id,
        machineId: claimedEnrollment.machineId,
        userId,
        organizationId: input.organizationId,
        reasonCode: 'claim_started',
        state: claimedEnrollment.state,
        decision: locked.decision.kind,
      }),
    );

    return {
      state: 'claimable',
      enrollmentId: claimedEnrollment.id,
      machineId: claimedEnrollment.machineId,
      userId,
      organizationId: input.organizationId as OrganizationId,
      machineName: claimedEnrollment.machineName,
      osFamily:
        claimedEnrollment.osFamily as BeginMachineEnrollmentClaimableDto.OsFamilyEnum,
      cliVersion: claimedEnrollment.cliVersion,
      machineKeyFingerprint: `sha256:${claimedEnrollment.machinePublicKeyFingerprint}`,
      controllerLabel: claimedEnrollment.controllerLabel,
      expiresAt: claimedEnrollment.expiresAt.toISOString(),
      registrationOptions: {
        challenge: claimedEnrollment.webauthnChallenge!,
        rp: {
          id: this.webauthnRpId,
          name: 'Hey Hey',
        },
        user: {
          id: Buffer.from(userId).toString('base64url'),
          name: userIdentity?.email ?? (await this.getUserEmail(userId)),
          displayName:
            userIdentity?.name ?? (await this.getUserDisplayName(userId)),
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          userVerification: 'required',
          residentKey: 'preferred',
        },
        attestation: 'none',
      },
    } satisfies BeginMachineEnrollmentClaimableDto;
  }

  async completeClaim(
    input: CompleteMachineEnrollmentClaimRequestDto,
    userId: UserId,
    memberships: readonly OrganizationMembership[],
    sourceAddress: string | undefined,
  ): Promise<CompleteMachineEnrollmentClaimResponseDto> {
    const normalizedSourceAddress = this.normalizeSource(sourceAddress);

    try {
      this.assertCompleteRequest(input);
    } catch {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        undefined,
        'invalid_request',
        true,
        MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
      );
    }

    if (!this.hasOrganizationMembership(memberships, input.organizationId)) {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        undefined,
        'organization_substitution',
        true,
      );
    }

    const enrollment = await this.prisma.db.pendingMachineEnrollment.findUnique(
      {
        where: { id: input.enrollmentId },
      },
    );
    const now = new Date();
    const countOwnershipMismatch =
      !enrollment ||
      (enrollment.state === MachineEnrollmentState.BROWSER_CLAIMED &&
        enrollment.expiresAt.getTime() > now.getTime() &&
        (enrollment.claimantUserId !== userId ||
          enrollment.claimantOrganizationId !== input.organizationId));

    if (
      !enrollment ||
      enrollment.state !== MachineEnrollmentState.BROWSER_CLAIMED ||
      enrollment.claimantUserId !== userId ||
      enrollment.claimantOrganizationId !== input.organizationId ||
      !enrollment.webauthnChallenge ||
      !enrollment.challengeExpiresAt ||
      !enrollment.controllerLabel ||
      !enrollment.controllerInstallationId ||
      enrollment.expiresAt.getTime() <= now.getTime() ||
      enrollment.challengeExpiresAt.getTime() <= now.getTime() ||
      enrollment.challengeConsumedAt !== null
    ) {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        enrollment?.id ?? input.enrollmentId,
        'ownership_state_or_expiry',
        countOwnershipMismatch,
        this.classifyCompletionFailure(
          enrollment,
          userId,
          input.organizationId,
          now,
        ),
      );
    }

    if (
      !(await this.isExistingMachineClaimAllowed(
        enrollment.machineId,
        userId,
        input.organizationId,
      ))
    ) {
      await this.recordLocalOutcomeIfActiveForeignMachine({
        enrollmentId: enrollment.id,
        userId,
        organizationId: input.organizationId,
      });
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        enrollment.id,
        'existing_machine_ownership_mismatch',
        true,
      );
    }

    let verified: VerifiedMachineEnrollmentCredential;
    try {
      verified = await this.webauthnVerifier.verifyRegistration({
        credential: input.credential,
        expectedChallenge: enrollment.webauthnChallenge,
        expectedOrigin: this.webauthnOrigin,
        expectedRpId: this.webauthnRpId,
      });
    } catch {
      return this.failClaim(
        userId,
        normalizedSourceAddress,
        enrollment.id,
        'webauthn_verification_failed',
        true,
        MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
      );
    }

    try {
      const consumedAt = new Date();
      const updated = await this.prisma.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${enrollment.id}, 21))`;

        const result = await tx.pendingMachineEnrollment.updateMany({
          where: {
            id: enrollment.id,
            state: MachineEnrollmentState.BROWSER_CLAIMED,
            claimantUserId: userId,
            claimantOrganizationId: input.organizationId,
            expiresAt: { gt: consumedAt },
            challengeExpiresAt: { gt: consumedAt },
            challengeConsumedAt: null,
            credentialId: null,
          },
          data: {
            state: MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
            awaitingMachineConfirmationAt: consumedAt,
            challengeConsumedAt: consumedAt,
            credentialId: verified.credentialId,
            credentialPublicKeyX: verified.credentialPublicKeyX,
            credentialPublicKeyY: verified.credentialPublicKeyY,
            credentialTransports: verified.credentialTransports,
            credentialAaguid: verified.credentialAaguid,
            credentialSignCount: verified.credentialSignCount,
            credentialBackupEligible: verified.credentialBackupEligible,
            credentialBackupState: verified.credentialBackupState,
            credentialFingerprint: verified.credentialFingerprint,
            credentialVerifiedAt: consumedAt,
          },
        });

        if (result.count !== 1) {
          throw new ClaimTransitionFailedError();
        }
        return result.count;
      });

      if (updated !== 1) {
        throw new ClaimTransitionFailedError();
      }
    } catch (error) {
      if (
        !(error instanceof ClaimTransitionFailedError) &&
        !this.isUniqueConstraintError(error)
      ) {
        throw error;
      }

      return this.failClaim(
        userId,
        normalizedSourceAddress,
        enrollment.id,
        this.isUniqueConstraintError(error)
          ? 'credential_already_retained'
          : 'completion_race_or_state_transition',
        false,
      );
    }

    this.logger.log(
      'Machine enrollment browser claim completed',
      machineEnrollmentDiagnostic('complete_claim', {
        enrollmentId: enrollment.id,
        machineId: enrollment.machineId,
        userId,
        organizationId: input.organizationId,
        credentialFingerprint: `sha256:${verified.credentialFingerprint}`,
        reasonCode: 'awaiting_machine_confirmation',
        state: 'awaiting-machine-confirmation',
        decision: 'accepted',
      }),
    );

    return {
      enrollmentId: enrollment.id,
      machineId: enrollment.machineId,
      organizationId: input.organizationId as OrganizationId,
      state: 'awaiting-machine-confirmation',
      credentialFingerprint: `sha256:${verified.credentialFingerprint}`,
      backupEligible: verified.credentialBackupEligible,
      backupState: verified.credentialBackupState,
      controllerLabel: enrollment.controllerLabel,
    } satisfies CompleteMachineEnrollmentClaimResponseDto;
  }

  async abandonClaim(
    input: AbandonMachineEnrollmentClaimRequestDto,
    userId: UserId,
    memberships: readonly OrganizationMembership[],
  ): Promise<AbandonMachineEnrollmentClaimResponseDto> {
    try {
      this.assertAbandonRequest(input);
    } catch {
      this.logger.warn(
        'Machine enrollment browser claim abandonment rejected',
        machineEnrollmentDiagnostic('failed_transition', {
          userId,
          reasonCode: 'invalid_request',
          decision: 'rejected',
        }),
      );
      throw new MachineEnrollmentClaimFailedException(
        MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
      );
    }

    if (!this.hasOrganizationMembership(memberships, input.organizationId)) {
      this.logger.warn(
        'Machine enrollment browser claim abandonment rejected',
        machineEnrollmentDiagnostic('failed_transition', {
          enrollmentId: input.enrollmentId,
          userId,
          organizationId: input.organizationId,
          reasonCode: 'organization_substitution',
          decision: 'rejected',
        }),
      );
      throw new MachineEnrollmentClaimFailedException();
    }

    const rejectedAt = new Date();
    const abandonment = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.enrollmentId}, 21))`;
      const rejected = await tx.pendingMachineEnrollment.updateMany({
        where: {
          id: input.enrollmentId,
          state: MachineEnrollmentState.BROWSER_CLAIMED,
          claimantUserId: userId,
          claimantOrganizationId: input.organizationId,
          expiresAt: { gt: rejectedAt },
          challengeConsumedAt: null,
        },
        data: {
          state: MachineEnrollmentState.REJECTED,
          rejectedAt,
          challengeConsumedAt: rejectedAt,
        },
      });

      if (rejected.count === 1) {
        return 'browser_claim_rejected' as const;
      }

      const existing = await tx.pendingMachineEnrollment.findUnique({
        where: { id: input.enrollmentId },
        select: {
          state: true,
          claimantUserId: true,
          claimantOrganizationId: true,
          challengeConsumedAt: true,
        },
      });
      if (
        existing?.state !== MachineEnrollmentState.REJECTED ||
        existing.claimantUserId !== userId ||
        existing.claimantOrganizationId !== input.organizationId
      ) {
        return 'rejected' as const;
      }

      if (existing.challengeConsumedAt === null) {
        await tx.pendingMachineEnrollment.updateMany({
          where: {
            id: input.enrollmentId,
            state: MachineEnrollmentState.REJECTED,
            claimantUserId: userId,
            claimantOrganizationId: input.organizationId,
            challengeConsumedAt: null,
          },
          data: { challengeConsumedAt: rejectedAt },
        });
      }

      return 'already_rejected' as const;
    });

    if (abandonment === 'rejected') {
      this.logger.warn(
        'Machine enrollment browser claim abandonment rejected',
        machineEnrollmentDiagnostic('failed_transition', {
          enrollmentId: input.enrollmentId,
          userId,
          organizationId: input.organizationId,
          reasonCode: 'ownership_state_or_expiry',
          decision: 'rejected',
        }),
      );
      throw new MachineEnrollmentClaimFailedException();
    }

    this.logger.log(
      'Machine enrollment browser claim abandoned',
      machineEnrollmentDiagnostic('browser_rejection', {
        enrollmentId: input.enrollmentId,
        userId,
        organizationId: input.organizationId,
        reasonCode:
          abandonment === 'already_rejected'
            ? 'browser_claim_already_rejected'
            : 'browser_claim_abandoned',
        state: 'rejected',
        decision: abandonment,
      }),
    );

    return {
      enrollmentId: input.enrollmentId,
      state: 'rejected',
    } satisfies AbandonMachineEnrollmentClaimResponseDto;
  }

  private async getUserEmail(userId: UserId): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user?.email) {
      throw new MachineEnrollmentClaimFailedException();
    }
    return user.email;
  }

  private async getUserDisplayName(userId: UserId): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    if (!user?.name) {
      throw new MachineEnrollmentClaimFailedException();
    }
    return user.name;
  }

  private async isExistingMachineClaimAllowed(
    machineId: string,
    userId: UserId,
    organizationId: string,
  ): Promise<boolean> {
    const machine = await this.prisma.db.machine?.findUnique({
      where: { id: machineId },
      select: { userId: true, organizationId: true, revokedAt: true },
    });

    return (
      !machine ||
      (machine.revokedAt === null &&
        machine.userId === userId &&
        (machine.organizationId === null ||
          machine.organizationId === organizationId))
    );
  }

  private async recordLocalOutcomeIfActiveForeignMachine(params: {
    enrollmentId: string;
    userId: UserId;
    organizationId: string;
  }): Promise<void> {
    const issuedAt = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${params.enrollmentId}, 21))`;
      const enrollment = await tx.pendingMachineEnrollment.findUnique({
        where: { id: params.enrollmentId },
        select: {
          id: true,
          machineId: true,
          state: true,
          expiresAt: true,
          localOutcomeCode: true,
          localOutcomeIssuedAt: true,
        },
      });
      if (
        !enrollment ||
        !LIVE_CLAIM_STATES.includes(enrollment.state) ||
        enrollment.expiresAt.getTime() <= issuedAt.getTime() ||
        enrollment.localOutcomeCode !== null ||
        enrollment.localOutcomeIssuedAt !== null
      ) {
        return;
      }

      const machine = await tx.machine.findUnique({
        where: { id: enrollment.machineId },
        select: { userId: true, organizationId: true, revokedAt: true },
      });
      const sameMachineOwner =
        machine?.userId === params.userId &&
        (machine.organizationId === null ||
          machine.organizationId === params.organizationId);
      if (!machine || machine.revokedAt !== null || sameMachineOwner) {
        return;
      }

      await tx.pendingMachineEnrollment.updateMany({
        where: {
          id: enrollment.id,
          state: { in: [...LIVE_CLAIM_STATES] },
          expiresAt: { gt: issuedAt },
          localOutcomeCode: null,
          localOutcomeIssuedAt: null,
        },
        data: {
          localOutcomeCode: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
          localOutcomeIssuedAt: issuedAt,
        },
      });
    });
  }

  private async failClaim(
    userId: UserId,
    sourceAddress: string,
    enrollmentId: string | undefined,
    reasonCode: string,
    countAsInvalidAttempt: boolean,
    publicCode: BrowserSafeClaimFailureCode = MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  ): Promise<never> {
    if (!countAsInvalidAttempt) {
      this.logger.warn(
        'Machine enrollment claim unusable',
        machineEnrollmentDiagnostic(
          publicCode === MACHINE_ENROLLMENT_CLAIM_EXPIRED
            ? 'expiry'
            : 'failed_transition',
          {
            enrollmentId,
            userId,
            sourceClass: this.sourceClass(sourceAddress),
            reasonCode,
            countedAsInvalidAttempt: false,
            decision: publicCode,
          },
        ),
      );
      throw new MachineEnrollmentClaimFailedException(publicCode);
    }

    const attemptedAt = new Date();
    const failure = await this.prisma.db.$transaction(async (tx) => {
      await this.lockClaimDimensions(tx, userId, sourceAddress);

      const retainedEnrollmentId = enrollmentId
        ? (
            await tx.pendingMachineEnrollment.findUnique({
              where: { id: enrollmentId },
              select: { id: true },
            })
          )?.id
        : undefined;

      await tx.machineEnrollmentClaimFailure.create({
        data: {
          userId,
          sourceAddress,
          enrollmentId: retainedEnrollmentId ?? null,
          attemptedAt,
        },
      });

      const windowStart = new Date(
        attemptedAt.getTime() - MACHINE_ENROLLMENT_CLAIM_FAILURE_WINDOW_MS,
      );
      const currentCounts = await this.getFailureCounts(
        tx,
        userId,
        sourceAddress,
        windowStart,
      );

      return {
        counts: currentCounts,
        retainedEnrollmentId,
      };
    });

    this.logger.warn(
      'Machine enrollment claim failed',
      machineEnrollmentDiagnostic('failed_transition', {
        enrollmentId: failure.retainedEnrollmentId,
        userId,
        sourceClass: this.sourceClass(sourceAddress),
        accountCount: failure.counts.accountCount,
        sourceCount: failure.counts.sourceCount,
        reasonCode,
        countedAsInvalidAttempt: true,
        decision: publicCode,
      }),
    );

    if (
      failure.counts.accountCount > MACHINE_ENROLLMENT_ACCOUNT_FAILURE_LIMIT ||
      failure.counts.sourceCount > MACHINE_ENROLLMENT_SOURCE_FAILURE_LIMIT
    ) {
      const retryAfterSeconds = Math.ceil(
        MACHINE_ENROLLMENT_CLAIM_FAILURE_WINDOW_MS / 1000,
      );
      this.logger.warn(
        'Machine enrollment claim throttled',
        machineEnrollmentDiagnostic('throttling', {
          enrollmentId: failure.retainedEnrollmentId,
          userId,
          sourceClass: this.sourceClass(sourceAddress),
          accountCount: failure.counts.accountCount,
          sourceCount: failure.counts.sourceCount,
          retryAfterSeconds,
          reasonCode: 'claim_rate_limited',
          decision: 'retry_later',
        }),
      );
      throw new MachineEnrollmentClaimRateLimitException(retryAfterSeconds);
    }
    throw new MachineEnrollmentClaimFailedException(publicCode);
  }

  private classifyKnownEnrollmentFailure(
    enrollment: {
      state: MachineEnrollmentState;
      expiresAt: Date;
      claimantUserId: string | null;
      claimantOrganizationId: string | null;
    },
    claimant: {
      userId: string;
      organizationId: string;
    },
    now: Date,
  ): BrowserSafeClaimFailureCode {
    const sameClaimant =
      enrollment.claimantUserId === claimant.userId &&
      enrollment.claimantOrganizationId === claimant.organizationId;
    if (!sameClaimant) {
      return MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE;
    }
    if (enrollment.expiresAt.getTime() <= now.getTime()) {
      return MACHINE_ENROLLMENT_CLAIM_EXPIRED;
    }
    if (!LIVE_CLAIM_STATES.includes(enrollment.state)) {
      return MACHINE_ENROLLMENT_CLAIM_TERMINAL;
    }
    return MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE;
  }

  private classifyCompletionFailure(
    enrollment: {
      state: MachineEnrollmentState;
      expiresAt: Date;
      challengeExpiresAt: Date | null;
      claimantUserId: string | null;
      claimantOrganizationId: string | null;
    } | null,
    userId: string,
    organizationId: string,
    now: Date,
  ): BrowserSafeClaimFailureCode {
    if (
      !enrollment ||
      enrollment.claimantUserId !== userId ||
      enrollment.claimantOrganizationId !== organizationId
    ) {
      return MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE;
    }
    if (
      enrollment.expiresAt.getTime() <= now.getTime() ||
      (enrollment.challengeExpiresAt?.getTime() ?? Number.POSITIVE_INFINITY) <=
        now.getTime()
    ) {
      return MACHINE_ENROLLMENT_CLAIM_EXPIRED;
    }
    if (enrollment.state !== MachineEnrollmentState.BROWSER_CLAIMED) {
      return MACHINE_ENROLLMENT_CLAIM_TERMINAL;
    }
    return MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE;
  }

  private async getFailureCounts(
    tx: AnyTransactionClient,
    userId: UserId,
    sourceAddress: string,
    windowStart: Date,
  ): Promise<FailureCounts> {
    const [accountCount, sourceCount] = await Promise.all([
      tx.machineEnrollmentClaimFailure.count({
        where: { userId, attemptedAt: { gte: windowStart } },
      }),
      tx.machineEnrollmentClaimFailure.count({
        where: { sourceAddress, attemptedAt: { gte: windowStart } },
      }),
    ]);
    return { accountCount, sourceCount };
  }

  private async lockClaimDimensions(
    tx: AnyTransactionClient,
    userId: UserId,
    sourceAddress: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 31))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sourceAddress}, 32))`;
  }

  private hashEnrollmentCode(code: string): string {
    return crypto
      .createHmac('sha256', this.enrollmentCodeHmacKey)
      .update(code)
      .digest('hex');
  }

  private normalizeSource(sourceAddress: string | undefined): string {
    try {
      return normalizeEnrollmentSourceAddress(sourceAddress);
    } catch {
      throw new MachineEnrollmentClaimFailedException();
    }
  }

  private sourceClass(sourceAddress: string): 'ipv4' | 'ipv6' {
    return sourceAddress.includes(':') ? 'ipv6' : 'ipv4';
  }

  private hasOrganizationMembership(
    memberships: readonly OrganizationMembership[],
    organizationId: string,
  ): boolean {
    return memberships.some(
      (membership) => membership.orgId === organizationId,
    );
  }

  private assertBeginRequest(
    input: BeginMachineEnrollmentClaimRequestDto,
  ): asserts input is BeginMachineEnrollmentClaimRequestDto {
    if (
      !this.hasExactKeys(input, [
        'organizationId',
        'userCode',
        'controllerLabel',
      ]) ||
      !this.isUuid(input.organizationId) ||
      typeof input.userCode !== 'string' ||
      typeof input.controllerLabel !== 'string' ||
      input.controllerLabel.length < 1 ||
      input.controllerLabel.length > 128
    ) {
      throw new Error('invalid-begin-request');
    }
  }

  private assertCompleteRequest(
    input: CompleteMachineEnrollmentClaimRequestDto,
  ): asserts input is CompleteMachineEnrollmentClaimRequestDto {
    if (
      !this.hasExactKeys(input, [
        'enrollmentId',
        'organizationId',
        'credential',
      ]) ||
      !this.isUuid(input.enrollmentId) ||
      !this.isUuid(input.organizationId) ||
      !this.isValidCredentialShape(input.credential)
    ) {
      throw new Error('invalid-complete-request');
    }
  }

  private assertAbandonRequest(
    input: AbandonMachineEnrollmentClaimRequestDto,
  ): asserts input is AbandonMachineEnrollmentClaimRequestDto {
    if (
      !this.hasExactKeys(input, ['enrollmentId', 'organizationId']) ||
      !this.isUuid(input.enrollmentId) ||
      !this.isUuid(input.organizationId)
    ) {
      throw new Error('invalid-abandon-request');
    }
  }

  private isValidCredentialShape(
    credential: MachineEnrollmentWebAuthnRegistrationCredentialDto,
  ): boolean {
    if (
      !credential ||
      typeof credential !== 'object' ||
      !this.hasExactKeys(credential, [
        'id',
        'rawId',
        'type',
        'response',
        'authenticatorAttachment',
      ]) ||
      typeof credential.id !== 'string' ||
      typeof credential.rawId !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(credential.id) ||
      !/^[A-Za-z0-9_-]+$/.test(credential.rawId) ||
      credential.type !== 'public-key' ||
      (credential.authenticatorAttachment !== null &&
        credential.authenticatorAttachment !== 'platform' &&
        credential.authenticatorAttachment !== 'cross-platform')
    ) {
      return false;
    }

    const response = credential.response;
    if (
      !response ||
      typeof response !== 'object' ||
      !this.hasExactKeys(response, [
        'clientDataJSON',
        'attestationObject',
        'transports',
      ]) ||
      typeof response.clientDataJSON !== 'string' ||
      typeof response.attestationObject !== 'string' ||
      !/^[A-Za-z0-9_-]+$/.test(response.clientDataJSON) ||
      !/^[A-Za-z0-9_-]+$/.test(response.attestationObject)
    ) {
      return false;
    }

    if (!response.transports) {
      return false;
    }
    const transports = Array.from(response.transports) as string[];
    const allowedTransports = new Set([
      'usb',
      'nfc',
      'ble',
      'internal',
      'hybrid',
    ]);
    return (
      transports.length === new Set(transports).size &&
      transports.every((transport) => allowedTransports.has(transport))
    );
  }

  private hasExactKeys(value: object, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = [...keys].sort();
    return (
      actualKeys.length === expectedKeys.length &&
      actualKeys.every((key, index) => key === expectedKeys[index])
    );
  }

  private isUuid(value: unknown): value is string {
    return (
      typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    );
  }

  private requireConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value || value.trim().length === 0) {
      throw new Error(`${key} must be explicitly configured`);
    }
    return value;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
