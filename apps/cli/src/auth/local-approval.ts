import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { MachineEnrollmentPollReadyDto } from '../shared/api/index';

const PROOF_LABEL = 'heyhey-local-approval-v1';

/**
 * One-time approval secret for first-time `heyhey local` pairing. It lives
 * only in this process, travels only in the fragment of the pairing page the
 * CLI opens, and is spent by the first claim that reaches local review,
 * whether or not that claim's proof matches.
 */
export class LocalApprovalSecret {
  private secret: Buffer | null = randomBytes(32);

  /** URL-fragment form handed to the pairing page this CLI opens. */
  public get fragmentValue(): string {
    if (!this.secret) throw new Error('The local approval secret was already used.');
    return this.secret.toString('base64url');
  }

  /** Spends the secret and reports whether `claim` carries its proof. */
  public consume(claim: MachineEnrollmentPollReadyDto): boolean {
    const secret = this.secret;
    this.secret = null;
    if (!secret || claim.localApprovalProof === undefined) return false;

    const expected = createHmac('sha256', secret)
      .update(
        PROOF_LABEL +
          claim.enrollmentId +
          claim.accountId +
          claim.organizationId +
          claim.controllerCredentialId,
        'utf8',
      )
      .digest();
    secret.fill(0);
    const presented = Buffer.from(claim.localApprovalProof, 'base64url');
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }
}
