import { BadRequestException, UnauthorizedException } from '@nestjs/common';

/**
 * Named refusals of an account passkey change. Callers that report the
 * refusal elsewhere (a pairing claim, a log line) tell them apart by class,
 * so the real cause is never collapsed into a generic failure.
 */

/** The account already has a passkey and the request proved none. */
export class AccountProofRequiredException extends UnauthorizedException {
  constructor() {
    super('Account proof is required');
  }
}

/** The supplied password or passkey assertion did not verify. */
export class AccountProofFailedException extends UnauthorizedException {
  constructor() {
    super('Account proof failed');
  }
}

/** The new credential is already one of the deployment's account passkeys. */
export class PasskeyAlreadyRegisteredException extends BadRequestException {
  constructor() {
    super('Passkey is already registered');
  }
}

/** The acting browser session was revoked before the change committed. */
export class BrowserSessionEndedException extends UnauthorizedException {
  constructor() {
    super('Browser session is no longer active');
  }
}
