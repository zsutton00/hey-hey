import type { AnyTransactionClient } from '../../prisma/prisma.service';
import type { AccountPasskeyActor } from './account-passkey.service';

/** Registered only by local composition; hosted never provides it. */
export const FIRST_PASSKEY_AUTHORITY = Symbol('FIRST_PASSKEY_AUTHORITY');

/**
 * Lets a local account enroll its very first passkey without account proof,
 * on the authority of the session the CLI opened on this computer.
 */
export interface FirstPasskeyAuthority {
  /**
   * Runs inside the enrollment transaction after the account row is locked.
   * Throws unless the acting session may enroll the account's first passkey.
   */
  assertFirstPasskeyAllowed(
    tx: AnyTransactionClient,
    actor: AccountPasskeyActor,
  ): Promise<void>;

  /** Runs after the enrollment committed. */
  firstPasskeyEnrolled(actor: AccountPasskeyActor): Promise<void>;
}
