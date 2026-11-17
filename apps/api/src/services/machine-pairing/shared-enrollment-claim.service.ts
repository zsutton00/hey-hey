import {
  BadRequestException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CompleteMachineEnrollmentClaimRequestDto,
  CompleteMachineEnrollmentClaimResponseDto,
  MachineEnrollmentMode,
} from '@hey-hey/contracts/api/models';
import type { BrowserSessionRequestMetadata } from '../../auth/browser-session.types';
import {
  AccountPasskeyActor,
  AccountPasskeyService,
} from '../../auth/passkeys/account-passkey.service';
import type { EstablishedBrowserSession } from '../../auth/services/browser-session.service';
import {
  AccountProofFailedException,
  AccountProofRequiredException,
  BrowserSessionEndedException,
  PasskeyAlreadyRegisteredException,
} from '../../auth/passkeys/account-passkey.exceptions';
import {
  type BrowserSafeClaimFailureCode,
  MACHINE_ENROLLMENT_ACCOUNT_PROOF_FAILED,
  MACHINE_ENROLLMENT_ACCOUNT_PROOF_REQUIRED,
  MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
  MACHINE_ENROLLMENT_PASSKEY_ALREADY_REGISTERED,
  MACHINE_ENROLLMENT_SESSION_ENDED,
} from '../../common/exceptions/pairing.exceptions';
import { UserId } from '../../types';
import {
  MachineEnrollmentClaimService,
  OrganizationMembership,
} from './machine-enrollment-claim.service';

interface SharedRegistrationRejection {
  /** Names the rule that refused, so the log line alone diagnoses it. */
  reasonCode: string;
  /** What the browser is told; it must be the same cause. */
  publicCode: BrowserSafeClaimFailureCode;
}

const sharedRegistrationRejection = (
  error: HttpException,
): SharedRegistrationRejection => {
  if (error instanceof AccountProofRequiredException) {
    return {
      reasonCode: 'shared_registration_account_proof_required',
      publicCode: MACHINE_ENROLLMENT_ACCOUNT_PROOF_REQUIRED,
    };
  }

  if (error instanceof AccountProofFailedException) {
    return {
      reasonCode: 'shared_registration_account_proof_failed',
      publicCode: MACHINE_ENROLLMENT_ACCOUNT_PROOF_FAILED,
    };
  }

  if (error instanceof PasskeyAlreadyRegisteredException) {
    return {
      reasonCode: 'shared_registration_passkey_already_registered',
      publicCode: MACHINE_ENROLLMENT_PASSKEY_ALREADY_REGISTERED,
    };
  }

  if (error instanceof BrowserSessionEndedException) {
    return {
      reasonCode: 'shared_registration_session_ended',
      publicCode: MACHINE_ENROLLMENT_SESSION_ENDED,
    };
  }

  // A malformed request is the only refusal a newer browser build could fix.
  return {
    reasonCode: `shared_registration_rejected_http_${String(error.getStatus())}`,
    publicCode:
      error instanceof BadRequestException
        ? MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE
        : MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE,
  };
};

export interface SharedClaimCompletion {
  response: CompleteMachineEnrollmentClaimResponseDto;
  session: EstablishedBrowserSession;
}

/**
 * Completes a SHARED_NEW claim: the one credential verified by the controller
 * enrollment ceremony becomes an account sign-in passkey and this claim's
 * staged controller credential in a single transaction, which also replaces
 * the acting browser session. Account proof is verified against the account,
 * never inferred from the enrollment. Only where local composition registers
 * the first-passkey rule may it be omitted, for the account's first passkey. Staging never activates the controller
 * and issues no grant: the computer still confirms locally.
 */
@Injectable()
export class SharedEnrollmentClaimService {
  constructor(
    private readonly claims: MachineEnrollmentClaimService,
    private readonly accountPasskeys: AccountPasskeyService,
  ) {}

  async isSharedClaim(enrollmentId: string): Promise<boolean> {
    return (
      (await this.claims.enrollmentModeOf(enrollmentId)) ===
      MachineEnrollmentMode.SHARED_NEW
    );
  }

  async completeSharedClaim(
    input: CompleteMachineEnrollmentClaimRequestDto,
    userId: UserId,
    memberships: readonly OrganizationMembership[],
    sourceAddress: string | undefined,
    actor: AccountPasskeyActor,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<SharedClaimCompletion> {
    const prepared = await this.claims.prepareCompletion(
      input,
      userId,
      memberships,
      sourceAddress,
      MachineEnrollmentMode.SHARED_NEW,
      this.accountPasskeys.acceptsFirstPasskeyWithoutProof,
    );
    const { verified, enrollment } = prepared;

    let session: EstablishedBrowserSession;
    try {
      session = await this.accountPasskeys.addVerifiedSharedPasskey(
        actor,
        {
          credentialId: verified.credentialId,
          publicKey: verified.credentialPublicKey,
          counter: verified.credentialSignCount,
          transports: verified.credentialTransports,
          backupEligible: verified.credentialBackupEligible,
          backupState: verified.credentialBackupState,
          aaguid: verified.credentialAaguid,
        },
        enrollment.controllerLabel!.slice(0, 100),
        input.accountProof,
        requestMetadata,
        (tx, accountPasskeyId) =>
          this.claims.stageVerifiedCredential(
            tx,
            prepared,
            userId,
            input,
            accountPasskeyId,
          ),
      );
    } catch (error) {
      if (error instanceof HttpException) {
        // Proof failure, an already registered credential or a stale acting
        // session: nothing was committed and the claim stays retryable.
        const rejection = sharedRegistrationRejection(error);

        return this.claims.rejectCompletion(
          userId,
          sourceAddress,
          enrollment.id,
          rejection.reasonCode,
          error instanceof UnauthorizedException,
          rejection.publicCode,
        );
      }
      return this.claims.failStaging(error, prepared, userId, sourceAddress);
    }

    return {
      response: {
        ...this.claims.completionResponse(prepared, input),
        session: session.response,
      },
      session,
    };
  }
}
