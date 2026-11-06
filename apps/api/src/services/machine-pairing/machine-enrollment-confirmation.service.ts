import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  ExecutionGrantScope,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  MachineEnrollmentState,
  PendingMachineEnrollment,
  Prisma,
} from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  ConfirmMachineEnrollmentRequestDto,
  ConfirmMachineEnrollmentResponseDto,
  FirstLocalGrantActivationDto,
  FirstLocalGrantConfirmationDto,
  FirstLocalGrantIntent,
  MachineEnrollmentActivatedBindingDto,
  MachineEnrollmentConfirmationPayloadDto,
  MachineEnrollmentPollReadyDto,
  PollMachineEnrollmentRequestDto,
  PollMachineEnrollmentResponseDto,
} from '@hey-hey/contracts/api/models';
import {
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
  MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE,
  MachineEnrollmentAuthenticationFailedException,
  MachineEnrollmentInvalidTransitionException,
} from '../../common/exceptions/pairing.exceptions';
import { ServerSigningKeyService } from '../../core/server-signing/server-signing-key.service';
import { AgentOperationDispatchService } from '../../core/websockets/agent-operation-dispatch.service';
import { ApiMetricsService } from '../../core/metrics/api-metrics.service';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../types';
import { machineEnrollmentDiagnostic } from './machine-enrollment-diagnostics';
import { ControllerBrowserBindingService } from '../controller-authorization/controller-browser-binding.service';
import { hashControllerAction } from '../../generated/controller-action-contract';
import {
  CURRENT_AGENT_OPERATIONS,
  getControllerDeviceGrantExpiry,
} from '../controller-authorization/controller-authorization-operations';
import {
  FIRST_LOCAL_GRANT_ACTIVATION_SKEW_MS,
  FIRST_LOCAL_GRANT_OUTCOME_REASON,
  firstLocalGrantAction,
  firstLocalGrantDescriptor,
  firstLocalGrantIntentDigest,
  hashControllerDeviceGrantDescriptor,
  resolveFirstLocalGrantIntent,
} from './first-local-grant';

export const MACHINE_ENROLLMENT_MIN_POLL_INTERVAL_MS = 5_000;

const LIVE_MACHINE_ENROLLMENT_STATES: MachineEnrollmentState[] = [
  MachineEnrollmentState.PENDING,
  MachineEnrollmentState.BROWSER_CLAIMED,
  MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
] as const;

class EnrollmentAuthenticationFailure extends Error {}
class EnrollmentInvalidTransition extends Error {}

type ReviewableMachineEnrollment = PendingMachineEnrollment & {
  claimantUserId: string;
  claimantOrganizationId: string;
  controllerLabel: string;
  controllerInstallationId: string;
  credentialId: string;
  credentialPublicKeyX: NonNullable<
    PendingMachineEnrollment['credentialPublicKeyX']
  >;
  credentialPublicKeyY: NonNullable<
    PendingMachineEnrollment['credentialPublicKeyY']
  >;
  credentialSignCount: number;
  credentialBackupEligible: boolean;
  credentialBackupState: boolean;
  credentialFingerprint: string;
  webauthnChallenge: string;
};

type ConfirmableMachineEnrollment = ReviewableMachineEnrollment & {
  confirmationNonce: string;
};

interface ExpectedFirstLocalGrant {
  confirmation: FirstLocalGrantConfirmationDto;
  intent: FirstLocalGrantIntent;
  action: ReturnType<typeof firstLocalGrantAction>;
  grantDescriptor: ReturnType<typeof firstLocalGrantDescriptor>;
  issuedAt: Date;
}

@Injectable()
export class MachineEnrollmentConfirmationService {
  private readonly logger = new Logger(
    MachineEnrollmentConfirmationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly serverSigningKeyService: ServerSigningKeyService,
    @Inject(ControllerBrowserBindingService)
    private readonly controllerBrowserBindingService = new ControllerBrowserBindingService(
      prisma,
    ),
    private readonly agentOperationDispatchService?: AgentOperationDispatchService,
    @Optional()
    private readonly apiMetrics?: ApiMetricsService,
  ) {}

  async poll(
    enrollmentId: string,
    input: PollMachineEnrollmentRequestDto,
  ): Promise<PollMachineEnrollmentResponseDto> {
    let deviceSecret: Buffer;
    try {
      this.assertPollRequest(input);
      deviceSecret = this.decodeBase64(input.deviceSecret, 32);
    } catch {
      throw new MachineEnrollmentAuthenticationFailedException();
    }

    const now = new Date();
    const enrollment = await this.prisma.db.pendingMachineEnrollment.findUnique(
      { where: { id: enrollmentId } },
    );
    try {
      this.assertAuthenticatedEnrollment(enrollment, deviceSecret);
      this.assertPollableEnrollment(enrollment, now);
    } catch (error) {
      this.throwPublicFailure(error);
    }

    try {
      const result = await this.prisma.db.$transaction(async (tx) => {
        await this.lockEnrollment(tx, enrollmentId);
        const current = await tx.pendingMachineEnrollment.findUnique({
          where: { id: enrollmentId },
        });

        this.assertAuthenticatedEnrollment(current, deviceSecret);
        this.assertPollableEnrollment(current, now);

        if (
          current.lastPolledAt &&
          current.lastPolledAt.getTime() +
            MACHINE_ENROLLMENT_MIN_POLL_INTERVAL_MS >
            now.getTime()
        ) {
          throw new EnrollmentInvalidTransition();
        }

        if (
          current.localOutcomeCode !== null &&
          current.localOutcomeCode !==
            MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH
        ) {
          throw new Error('Unsupported machine enrollment local outcome');
        }
        const hasUnconsumedLocalWarning =
          current.localOutcomeCode ===
            MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH &&
          current.localOutcomeConsumedAt === null;
        const localOutcomeConsumedAt = hasUnconsumedLocalWarning ? now : null;

        let confirmationNonce = current.confirmationNonce;
        if (
          current.state === MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION
        ) {
          this.assertReviewEvidence(current);
          confirmationNonce ??= crypto.randomBytes(32).toString('base64url');
        }

        const updated = await tx.pendingMachineEnrollment.updateMany({
          where: {
            id: enrollmentId,
            state: current.state,
            lastPolledAt: current.lastPolledAt,
            ...(hasUnconsumedLocalWarning
              ? {
                  localOutcomeCode: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
                  localOutcomeConsumedAt: null,
                }
              : {}),
          },
          data: {
            lastPolledAt: now,
            ...(localOutcomeConsumedAt ? { localOutcomeConsumedAt } : {}),
            ...(confirmationNonce && !current.confirmationNonce
              ? { confirmationNonce }
              : {}),
          },
        });
        if (updated.count !== 1) {
          throw new EnrollmentInvalidTransition();
        }

        if (hasUnconsumedLocalWarning) {
          return {
            state: 'warning',
            code: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH,
            message: MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH_MESSAGE,
          } satisfies PollMachineEnrollmentResponseDto;
        }

        if (
          current.state !== MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION
        ) {
          return {
            state: 'pending',
          } satisfies PollMachineEnrollmentResponseDto;
        }

        this.assertReviewEvidence(current);
        return this.toReadyResponse(
          current,
          confirmationNonce!,
          await resolveFirstLocalGrantIntent(tx, current),
        );
      });

      this.logger.log(
        'Machine enrollment polled',
        machineEnrollmentDiagnostic('poll', {
          enrollmentId,
          state: result.state,
          reasonCode: 'poll_succeeded',
          decision: result.state,
        }),
      );
      return result;
    } catch (error) {
      if (error instanceof EnrollmentAuthenticationFailure) {
        throw new MachineEnrollmentAuthenticationFailedException();
      }
      if (error instanceof EnrollmentInvalidTransition) {
        throw new MachineEnrollmentInvalidTransitionException();
      }
      throw error;
    }
  }

  async confirm(
    enrollmentId: string,
    input: ConfirmMachineEnrollmentRequestDto,
  ): Promise<ConfirmMachineEnrollmentResponseDto> {
    let deviceSecret: Buffer;
    let signature: Buffer;
    try {
      this.assertConfirmRequest(input);
      deviceSecret = this.decodeBase64(input.deviceSecret, 32);
      signature = this.decodeBase64(input.signature, 64);
    } catch {
      throw new MachineEnrollmentAuthenticationFailedException();
    }

    const enrollment = await this.prisma.db.pendingMachineEnrollment.findUnique(
      { where: { id: enrollmentId } },
    );
    try {
      this.assertAuthenticatedEnrollment(enrollment, deviceSecret);
      this.assertConfirmableEnrollment(enrollment, new Date());
    } catch (error) {
      this.throwPublicFailure(error);
    }

    let expectedConfirmation: MachineEnrollmentConfirmationPayloadDto;
    try {
      expectedConfirmation = this.toConfirmationPayload(
        enrollment,
        await this.expectedFirstLocalGrant(
          this.prisma.db,
          enrollment,
          input.confirmation.firstLocalGrant,
        ),
      );
    } catch (error) {
      this.throwPublicFailure(error);
    }
    if (!this.confirmationsEqual(input.confirmation, expectedConfirmation)) {
      throw new MachineEnrollmentAuthenticationFailedException();
    }

    if (
      !this.verifyMachineSignature(
        enrollment.machinePublicKey,
        expectedConfirmation,
        signature,
      )
    ) {
      this.logger.warn(
        'Machine enrollment confirmation signature rejected',
        machineEnrollmentDiagnostic('local_confirmation', {
          enrollmentId,
          machineId: enrollment.machineId,
          reasonCode: 'signature_verification_failed',
          state: enrollment.state,
          decision: 'rejected',
        }),
      );
      throw new MachineEnrollmentAuthenticationFailedException();
    }

    this.logger.log(
      'Machine enrollment local confirmation verified',
      machineEnrollmentDiagnostic('local_confirmation', {
        enrollmentId,
        machineId: enrollment.machineId,
        reasonCode: 'signature_verification_succeeded',
        state: enrollment.state,
        decision: 'verified',
      }),
    );

    try {
      const activation = await this.prisma.db.$transaction(async (tx) => {
        await this.lockMachine(tx, enrollment.machineId);
        await this.lockEnrollment(tx, enrollmentId);
        const current = await tx.pendingMachineEnrollment.findUnique({
          where: { id: enrollmentId },
        });

        this.assertAuthenticatedEnrollment(current, deviceSecret);
        this.assertConfirmableEnrollment(current, new Date());
        await this.assertSharedAccountPasskeyActive(tx, current);
        const firstLocalGrant = await this.expectedFirstLocalGrant(
          tx,
          current,
          input.confirmation.firstLocalGrant,
        );
        const currentConfirmation = this.toConfirmationPayload(
          current,
          firstLocalGrant,
        );
        if (
          !this.confirmationsEqual(input.confirmation, currentConfirmation) ||
          !this.verifyMachineSignature(
            current.machinePublicKey,
            currentConfirmation,
            signature,
          )
        ) {
          throw new EnrollmentAuthenticationFailure();
        }

        const activatedAt = new Date();
        const transitioned = await tx.pendingMachineEnrollment.updateMany({
          where: {
            id: enrollmentId,
            state: MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION,
            expiresAt: { gt: activatedAt },
            consumedAt: null,
          },
          data: {
            state: MachineEnrollmentState.CONSUMED,
            consumedAt: activatedAt,
            activatedAt,
          },
        });
        if (transitioned.count !== 1) {
          throw new EnrollmentAuthenticationFailure();
        }

        const { credential, credentialHash } = this.generateMachineCredential();
        const existingMachine = await tx.machine?.findUnique?.({
          where: { id: current.machineId },
          select: {
            id: true,
            userId: true,
            organizationId: true,
            publicKey: true,
            revokedAt: true,
          },
        });

        if (existingMachine) {
          if (
            existingMachine.revokedAt !== null ||
            existingMachine.userId !== current.claimantUserId ||
            (existingMachine.organizationId !== null &&
              existingMachine.organizationId !==
                current.claimantOrganizationId) ||
            existingMachine.publicKey !== current.machinePublicKey
          ) {
            throw new EnrollmentAuthenticationFailure();
          }

          await tx.machine.update({
            where: { id: existingMachine.id },
            data: {
              organizationId:
                existingMachine.organizationId ??
                current.claimantOrganizationId,
              tokenHash: credentialHash,
              authorizationProtocolVersion: 2,
              authorizationState: 'READY',
            },
          });
        } else {
          await tx.machine.create({
            data: {
              id: current.machineId,
              userId: current.claimantUserId!,
              organizationId: current.claimantOrganizationId!,
              name: current.machineName,
              publicKey: current.machinePublicKey,
              tokenHash: credentialHash,
              authorizationProtocolVersion: 2,
              authorizationState: 'READY',
              pairedAt: activatedAt,
            },
          });
        }

        const controllerCredential =
          await tx.machineControllerCredential.create({
            data: {
              machineId: current.machineId,
              userId: current.claimantUserId!,
              organizationId: current.claimantOrganizationId!,
              credentialId: current.credentialId!,
              credentialPublicKeyX: current.credentialPublicKeyX!,
              credentialPublicKeyY: current.credentialPublicKeyY!,
              credentialTransports: current.credentialTransports,
              credentialAaguid: current.credentialAaguid,
              credentialSignCount: current.credentialSignCount!,
              credentialBackupEligible: current.credentialBackupEligible!,
              credentialBackupState: current.credentialBackupState!,
              controllerLabel: current.controllerLabel!,
              controllerInstallationId: current.controllerInstallationId,
              credentialFingerprint: current.credentialFingerprint!,
              enrollmentId: current.id,
              accountPasskeyId: current.accountPasskeyId,
              createdAt: activatedAt,
            },
          });

        if (
          current.browserBindingCredentialHash &&
          current.browserBindingIssuedAt &&
          current.browserBindingExpiresAt
        ) {
          await this.controllerBrowserBindingService.activatePending(
            tx,
            {
              credentialHash: current.browserBindingCredentialHash,
              issuedAt: current.browserBindingIssuedAt,
              expiresAt: current.browserBindingExpiresAt,
            },
            {
              controllerInstallationId: current.controllerInstallationId,
              controllerCredentialId: controllerCredential.id,
              userId: current.claimantUserId as UserId,
              organizationId: current.claimantOrganizationId as OrganizationId,
            },
            activatedAt,
          );
        }

        const issuedFirstLocalGrant = firstLocalGrant
          ? await this.issueFirstLocalGrant(tx, {
              expected: firstLocalGrant,
              controllerCredentialRecordId: controllerCredential.id,
              activatedAt,
            })
          : null;

        return {
          credential,
          activatedBinding: this.toActivatedBinding(current),
          firstLocalGrant: issuedFirstLocalGrant,
        };
      });

      this.logger.log(
        'Machine enrollment activated',
        machineEnrollmentDiagnostic('activation', {
          enrollmentId,
          machineId: activation.activatedBinding.machineId,
          userId: activation.activatedBinding.accountId,
          organizationId: activation.activatedBinding.organizationId,
          reasonCode: activation.firstLocalGrant
            ? 'activation_with_first_local_grant'
            : 'activation_succeeded',
          state: 'consumed',
          decision: 'activated_after_local_confirmation',
        }),
      );

      void this.agentOperationDispatchService
        ?.nudgeForMachine(activation.activatedBinding.machineId)
        .then((claimed) => {
          this.apiMetrics?.recordWake(
            'enrollment',
            claimed ? 'claimed' : 'no_eligible_work',
          );
        })
        .catch((error: unknown) => {
          this.apiMetrics?.recordWake('enrollment', 'failed');
          this.logger.warn(
            'Failed to wake pending durable operations after machine enrollment',
            machineEnrollmentDiagnostic('activation', {
              enrollmentId,
              machineId: activation.activatedBinding.machineId,
              userId: activation.activatedBinding.accountId,
              organizationId: activation.activatedBinding.organizationId,
              reasonCode: 'dispatch_wake_failed',
              state: 'consumed',
              decision: 'activation_preserved_for_periodic_retry',
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        });

      return {
        machineCredential: activation.credential,
        serverSigningPublicKey:
          this.serverSigningKeyService.getPublicKeyBase64(),
        authorizationProtocolVersion: 2,
        activatedBinding: activation.activatedBinding,
        ...(activation.firstLocalGrant
          ? { firstLocalGrant: activation.firstLocalGrant }
          : {}),
      } satisfies ConfirmMachineEnrollmentResponseDto;
    } catch (error) {
      if (
        error instanceof EnrollmentAuthenticationFailure ||
        this.isUniqueConstraintError(error)
      ) {
        this.logger.warn(
          'Machine enrollment activation rejected',
          machineEnrollmentDiagnostic('failed_transition', {
            enrollmentId,
            machineId: enrollment.machineId,
            reasonCode: this.isUniqueConstraintError(error)
              ? 'activation_uniqueness_conflict'
              : 'activation_race_or_state_transition',
            state: enrollment.state,
            decision: 'rejected',
          }),
        );
        throw new MachineEnrollmentAuthenticationFailedException();
      }
      throw error;
    }
  }

  /**
   * Validates the first grant the CLI's signed confirmation asks for. The
   * descriptor is rebuilt from the claim's committed intent, the verified
   * credential and the CLI-chosen activation time; any mismatch rejects the
   * confirmation rather than activating without the authority it signed for.
   */
  private async expectedFirstLocalGrant(
    db: Pick<AnyTransactionClient, 'project'>,
    enrollment: PendingMachineEnrollment,
    requested: FirstLocalGrantConfirmationDto | undefined,
  ): Promise<ExpectedFirstLocalGrant | null> {
    if (requested === undefined) {
      return null;
    }
    const intent = await resolveFirstLocalGrantIntent(db, enrollment);
    const now = Date.now();
    if (
      !intent ||
      !enrollment.credentialId ||
      requested.issuedAtMs < intent.issuedAtMs ||
      Math.abs(requested.issuedAtMs - now) >
        FIRST_LOCAL_GRANT_ACTIVATION_SKEW_MS
    ) {
      throw new EnrollmentAuthenticationFailure();
    }
    const issuedAt = new Date(requested.issuedAtMs);
    const action = firstLocalGrantAction(intent, crypto.randomUUID());
    const grantDescriptor = firstLocalGrantDescriptor(
      intent,
      enrollment.credentialId,
      issuedAt,
      action,
    );
    const grantDescriptorHash =
      hashControllerDeviceGrantDescriptor(grantDescriptor);
    if (grantDescriptorHash !== requested.grantDescriptorHash) {
      throw new EnrollmentAuthenticationFailure();
    }
    return {
      confirmation: { issuedAtMs: requested.issuedAtMs, grantDescriptorHash },
      intent,
      action,
      grantDescriptor,
      issuedAt,
    };
  }

  /**
   * Records the first grant as an admitted controller-device authorization,
   * so every later reuse, expiry and revocation path treats it as an ordinary
   * grant. The record has no assertion evidence and is marked with
   * FIRST_LOCAL_GRANT_OUTCOME_REASON, so it is never mistaken for one backed
   * by a passkey assertion. One enrollment activates once, so it issues at
   * most one.
   */
  private async issueFirstLocalGrant(
    tx: AnyTransactionClient,
    params: {
      expected: ExpectedFirstLocalGrant;
      controllerCredentialRecordId: string;
      activatedAt: Date;
    },
  ): Promise<FirstLocalGrantActivationDto> {
    const { intent, action, grantDescriptor, issuedAt } = params.expected;
    const cadence = intent.cadence;
    const recordedAt = new Date(
      Math.max(params.activatedAt.getTime(), issuedAt.getTime()),
    );
    const authorization = await tx.executionAuthorization.create({
      data: {
        requestId: action.requestId,
        canonicalIntent: canonicalizeJcs(intent),
        webauthnChallenge:
          firstLocalGrantIntentDigest(intent).toString('base64url'),
        controllerCredentialId: params.controllerCredentialRecordId,
        controllerInstallationId: intent.controllerInstallationId,
        machineId: intent.machineId,
        userId: intent.userId,
        organizationId: intent.organizationId,
        projectId: intent.projectId,
        cadence,
        policyRevision: intent.policyRevision,
        grantDescriptorHash: params.expected.confirmation.grantDescriptorHash,
        actionCategory: HostActionCategory.CLI_READ,
        actionType: HostAffectingActionType.CLI_READ,
        actionPayloadHash: hashControllerAction(action),
        targetKind: HostActionTargetKind.CLI_READ,
        targetId: intent.target.id,
        agentSessionId: null,
        taskMonitorId: null,
        nonce: intent.nonce,
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 2 * 60 * 1000),
        consumedAt: recordedAt,
        outcome: 'ADMITTED',
        outcomeReason: FIRST_LOCAL_GRANT_OUTCOME_REASON,
        outcomeRecordedAt: recordedAt,
      },
    });
    const grant = await tx.executionGrant.create({
      data: {
        authorizationId: authorization.id,
        scope: ExecutionGrantScope.CONTROLLER_DEVICE_WINDOW,
        controllerCredentialId: params.controllerCredentialRecordId,
        controllerInstallationId: intent.controllerInstallationId,
        machineId: intent.machineId,
        userId: intent.userId,
        organizationId: intent.organizationId,
        projectId: intent.projectId,
        cadence,
        policyRevision: intent.policyRevision,
        grantDescriptorHash: params.expected.confirmation.grantDescriptorHash,
        targetKind: HostActionTargetKind.CLI_READ,
        targetId: intent.target.id,
        allowedActions: CURRENT_AGENT_OPERATIONS.map(
          (operation) => HostAffectingActionType[operation],
        ),
        agentSessionId: null,
        authorizedTurnId: null,
        issuedAt,
        expiresAt: getControllerDeviceGrantExpiry(issuedAt, cadence),
      },
    });
    return {
      authorizationId: authorization.id,
      grantId: grant.id,
      grantDescriptor,
    } satisfies FirstLocalGrantActivationDto;
  }

  /**
   * A shared enrollment may activate only while the account passkey it was
   * created with still exists. The row lock serializes activation against
   * account-passkey removal, so a pending enrollment cannot restore authority
   * that removal has revoked.
   */
  private async assertSharedAccountPasskeyActive(
    tx: AnyTransactionClient,
    enrollment: PendingMachineEnrollment,
  ): Promise<void> {
    if (!enrollment.accountPasskeyId) {
      return;
    }

    const rows = await tx.$queryRaw<{ revoked_at: Date | null }[]>`
      SELECT "revoked_at" FROM "account_passkeys"
      WHERE "id" = ${enrollment.accountPasskeyId} FOR UPDATE
    `;
    if (!rows[0] || rows[0].revoked_at !== null) {
      throw new EnrollmentAuthenticationFailure();
    }
  }

  private async lockEnrollment(
    tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
    enrollmentId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${enrollmentId}, 21))`;
  }

  private async lockMachine(
    tx: Pick<Prisma.TransactionClient, '$executeRaw'>,
    machineId: string,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${machineId}, 42))`;
  }

  private assertAuthenticatedEnrollment(
    enrollment: PendingMachineEnrollment | null,
    deviceSecret: Buffer,
  ): asserts enrollment is PendingMachineEnrollment {
    if (
      !enrollment ||
      typeof enrollment.deviceSecretDigest !== 'string' ||
      !this.matchesDeviceSecret(enrollment.deviceSecretDigest, deviceSecret)
    ) {
      throw new EnrollmentAuthenticationFailure();
    }
  }

  private assertPollableEnrollment(
    enrollment: PendingMachineEnrollment,
    now: Date,
  ): void {
    if (
      !LIVE_MACHINE_ENROLLMENT_STATES.includes(enrollment.state) ||
      enrollment.expiresAt.getTime() <= now.getTime()
    ) {
      throw new EnrollmentAuthenticationFailure();
    }
  }

  private assertConfirmableEnrollment(
    enrollment: PendingMachineEnrollment,
    now: Date,
  ): asserts enrollment is ConfirmableMachineEnrollment {
    if (enrollment.expiresAt.getTime() <= now.getTime()) {
      throw new EnrollmentAuthenticationFailure();
    }
    if (
      enrollment.state === MachineEnrollmentState.PENDING ||
      enrollment.state === MachineEnrollmentState.BROWSER_CLAIMED
    ) {
      throw new EnrollmentInvalidTransition();
    }
    if (
      enrollment.state !== MachineEnrollmentState.AWAITING_MACHINE_CONFIRMATION
    ) {
      throw new EnrollmentAuthenticationFailure();
    }
    this.assertReviewEvidence(enrollment);
    if (!enrollment.confirmationNonce) {
      throw new EnrollmentAuthenticationFailure();
    }
  }

  private assertReviewEvidence(
    enrollment: PendingMachineEnrollment,
  ): asserts enrollment is ReviewableMachineEnrollment {
    if (
      !enrollment.claimantUserId ||
      !enrollment.claimantOrganizationId ||
      !enrollment.controllerLabel ||
      !enrollment.controllerInstallationId ||
      !enrollment.credentialId ||
      !enrollment.credentialFingerprint ||
      !enrollment.webauthnChallenge ||
      !enrollment.credentialPublicKeyX ||
      !enrollment.credentialPublicKeyY ||
      enrollment.credentialSignCount === null ||
      enrollment.credentialBackupEligible === null ||
      enrollment.credentialBackupState === null
    ) {
      throw new EnrollmentAuthenticationFailure();
    }
  }

  private toReadyResponse(
    enrollment: ReviewableMachineEnrollment,
    confirmationNonce: string,
    firstLocalGrant: FirstLocalGrantIntent | null,
  ): MachineEnrollmentPollReadyDto {
    return {
      state: 'ready',
      enrollmentId: enrollment.id,
      machineId: enrollment.machineId,
      machineName: enrollment.machineName,
      osFamily: enrollment.osFamily,
      cliVersion: enrollment.cliVersion,
      machineKeyFingerprint: `sha256:${enrollment.machinePublicKeyFingerprint}`,
      accountId: enrollment.claimantUserId as UserId,
      organizationId: enrollment.claimantOrganizationId as OrganizationId,
      controllerLabel: enrollment.controllerLabel,
      controllerCredentialId: enrollment.credentialId,
      controllerCredentialFingerprint: `sha256:${enrollment.credentialFingerprint}`,
      backupEligible: enrollment.credentialBackupEligible,
      backupState: enrollment.credentialBackupState,
      controllerCredentialPublicKey: this.toPublicKey(enrollment),
      registrationChallenge: enrollment.webauthnChallenge,
      confirmationNonce,
      ...(enrollment.localApprovalProof === null
        ? {}
        : { localApprovalProof: enrollment.localApprovalProof }),
      ...(firstLocalGrant ? { firstLocalGrant } : {}),
      expiresAt: enrollment.expiresAt.toISOString(),
    } satisfies MachineEnrollmentPollReadyDto;
  }

  private toConfirmationPayload(
    enrollment: ConfirmableMachineEnrollment,
    firstLocalGrant: ExpectedFirstLocalGrant | null,
  ): MachineEnrollmentConfirmationPayloadDto {
    return {
      enrollmentId: enrollment.id,
      machineId: enrollment.machineId,
      accountId: enrollment.claimantUserId as UserId,
      organizationId: enrollment.claimantOrganizationId as OrganizationId,
      controllerCredentialId: enrollment.credentialId,
      confirmationNonce: enrollment.confirmationNonce,
      ...(firstLocalGrant
        ? { firstLocalGrant: firstLocalGrant.confirmation }
        : {}),
    } satisfies MachineEnrollmentConfirmationPayloadDto;
  }

  private toPublicKey(
    enrollment: ReviewableMachineEnrollment,
  ): MachineEnrollmentActivatedBindingDto['controllerCredentialPublicKey'] {
    return {
      kty: 'EC',
      crv: 'P-256',
      x: Buffer.from(enrollment.credentialPublicKeyX).toString('base64url'),
      y: Buffer.from(enrollment.credentialPublicKeyY).toString('base64url'),
    };
  }

  private toActivatedBinding(
    enrollment: ReviewableMachineEnrollment,
  ): MachineEnrollmentActivatedBindingDto {
    return {
      enrollmentId: enrollment.id,
      machineId: enrollment.machineId,
      machineName: enrollment.machineName,
      osFamily: enrollment.osFamily,
      cliVersion: enrollment.cliVersion,
      accountId: enrollment.claimantUserId as UserId,
      organizationId: enrollment.claimantOrganizationId as OrganizationId,
      controllerLabel: enrollment.controllerLabel,
      controllerCredentialId: enrollment.credentialId,
      controllerCredentialPublicKey: this.toPublicKey(enrollment),
      controllerCredentialFingerprint: `sha256:${enrollment.credentialFingerprint}`,
      backupEligible: enrollment.credentialBackupEligible,
      backupState: enrollment.credentialBackupState,
    } satisfies MachineEnrollmentActivatedBindingDto;
  }

  private confirmationsEqual(
    actual: MachineEnrollmentConfirmationPayloadDto,
    expected: MachineEnrollmentConfirmationPayloadDto,
  ): boolean {
    return (
      actual.enrollmentId === expected.enrollmentId &&
      actual.machineId === expected.machineId &&
      actual.accountId === expected.accountId &&
      actual.organizationId === expected.organizationId &&
      actual.controllerCredentialId === expected.controllerCredentialId &&
      actual.confirmationNonce === expected.confirmationNonce &&
      actual.firstLocalGrant?.issuedAtMs ===
        expected.firstLocalGrant?.issuedAtMs &&
      actual.firstLocalGrant?.grantDescriptorHash ===
        expected.firstLocalGrant?.grantDescriptorHash
    );
  }

  private verifyMachineSignature(
    machinePublicKey: string,
    confirmation: MachineEnrollmentConfirmationPayloadDto,
    signature: Buffer,
  ): boolean {
    try {
      const publicKey = crypto.createPublicKey(machinePublicKey);
      return crypto.verify(
        null,
        Buffer.from(canonicalizeJcs(confirmation), 'utf8'),
        publicKey,
        signature,
      );
    } catch {
      return false;
    }
  }

  private generateMachineCredential(): {
    credential: string;
    credentialHash: string;
  } {
    const credential = `mch_${crypto.randomBytes(32).toString('base64url')}`;
    return {
      credential,
      credentialHash: crypto
        .createHash('sha256')
        .update(credential)
        .digest('hex'),
    };
  }

  private matchesDeviceSecret(
    storedDigest: string,
    deviceSecret: Buffer,
  ): boolean {
    const expectedDigest = crypto
      .createHash('sha256')
      .update(deviceSecret)
      .digest();
    const actualDigest = Buffer.from(storedDigest, 'hex');
    return (
      actualDigest.length === expectedDigest.length &&
      crypto.timingSafeEqual(actualDigest, expectedDigest)
    );
  }

  private assertPollRequest(
    input: PollMachineEnrollmentRequestDto,
  ): asserts input is PollMachineEnrollmentRequestDto {
    if (
      !input ||
      typeof input !== 'object' ||
      !this.hasExactKeys(input, ['deviceSecret']) ||
      !this.isBase64Shape(input.deviceSecret, 32)
    ) {
      throw new Error('invalid-poll-request');
    }
  }

  private assertConfirmRequest(
    input: ConfirmMachineEnrollmentRequestDto,
  ): asserts input is ConfirmMachineEnrollmentRequestDto {
    if (
      !input ||
      typeof input !== 'object' ||
      !this.hasExactKeys(input, [
        'deviceSecret',
        'confirmation',
        'signature',
      ]) ||
      !this.isBase64Shape(input.deviceSecret, 32) ||
      !this.isBase64Shape(input.signature, 64) ||
      !input.confirmation ||
      typeof input.confirmation !== 'object' ||
      !this.hasExactKeys(input.confirmation, [
        'enrollmentId',
        'machineId',
        'accountId',
        'organizationId',
        'controllerCredentialId',
        'confirmationNonce',
        ...(input.confirmation.firstLocalGrant === undefined
          ? []
          : ['firstLocalGrant']),
      ]) ||
      (input.confirmation.firstLocalGrant !== undefined &&
        !this.isFirstLocalGrantConfirmation(
          input.confirmation.firstLocalGrant,
        )) ||
      !this.isUuid(input.confirmation.enrollmentId) ||
      !this.isUuid(input.confirmation.machineId) ||
      !this.isUuid(input.confirmation.accountId) ||
      !this.isUuid(input.confirmation.organizationId) ||
      !this.isBase64UrlString(input.confirmation.controllerCredentialId) ||
      !this.isBase64UrlString(input.confirmation.confirmationNonce)
    ) {
      throw new Error('invalid-confirm-request');
    }
  }

  private isFirstLocalGrantConfirmation(value: unknown): boolean {
    if (
      typeof value !== 'object' ||
      value === null ||
      !this.hasExactKeys(value, ['issuedAtMs', 'grantDescriptorHash'])
    ) {
      return false;
    }
    const confirmation = value as Record<string, unknown>;
    return (
      Number.isSafeInteger(confirmation['issuedAtMs']) &&
      typeof confirmation['grantDescriptorHash'] === 'string' &&
      /^[a-f0-9]{64}$/.test(confirmation['grantDescriptorHash'])
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

  private isBase64UrlString(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
  }

  private isBase64Shape(value: unknown, byteLength: number): value is string {
    const unpaddedLength = Math.ceil((byteLength * 8) / 6);
    const paddedLength = Math.ceil(byteLength / 3) * 4;
    if (
      typeof value !== 'string' ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value) ||
      (value.length !== unpaddedLength && value.length !== paddedLength)
    ) {
      return false;
    }
    try {
      return this.decodeBase64(value, byteLength).length === byteLength;
    } catch {
      return false;
    }
  }

  private decodeBase64(value: string, byteLength: number): Buffer {
    const decoded = Buffer.from(value, 'base64');
    const canonical = decoded.toString('base64').replace(/=+$/u, '');
    const supplied = value.replace(/=+$/u, '');
    if (decoded.length !== byteLength || canonical !== supplied) {
      throw new Error('invalid-base64');
    }
    return decoded;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private throwPublicFailure(error: unknown): never {
    if (error instanceof EnrollmentAuthenticationFailure) {
      throw new MachineEnrollmentAuthenticationFailedException();
    }
    if (error instanceof EnrollmentInvalidTransition) {
      throw new MachineEnrollmentInvalidTransitionException();
    }
    throw error;
  }
}
