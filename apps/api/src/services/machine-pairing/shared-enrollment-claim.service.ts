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
import { MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE } from '../../common/exceptions/pairing.exceptions';
import { UserId } from '../../types';
import {
  MachineEnrollmentClaimService,
  OrganizationMembership,
} from './machine-enrollment-claim.service';

/**
 * The log reason names which rule refused the shared passkey, so a rejected
 * pairing is diagnosable from its log line alone.
 */
const sharedRegistrationRejectionReason = (error: HttpException): string => {
  if (error instanceof UnauthorizedException) {
    return 'shared_registration_account_proof_rejected';
  }
  if (error instanceof BadRequestException) {
    return 'shared_registration_passkey_already_registered';
  }
  return `shared_registration_rejected_http_${String(error.getStatus())}`;
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
        return this.claims.rejectCompletion(
          userId,
          sourceAddress,
          enrollment.id,
          sharedRegistrationRejectionReason(error),
          error instanceof UnauthorizedException,
          MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE,
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
