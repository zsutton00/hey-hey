import { Injectable, Logger } from '@nestjs/common';
import { isLocalApplication } from '../deployment-environment';
import { isLocalAccountEmail } from '../auth/local-account';
import { AccountProofRequiredException } from '../auth/passkeys/account-passkey.exceptions';
import type { AccountPasskeyActor } from '../auth/passkeys/account-passkey.service';
import type { FirstPasskeyAuthority } from '../auth/passkeys/first-passkey-authority';
import { REQUIRED_ABSOLUTE_TTL_SECONDS } from '../auth/services/browser-session.service';
import { RedisService } from '../core/redis/redis.service';
import type { AnyTransactionClient } from '../prisma/prisma.service';

const cliOpenedSessionKey = (sessionId: string): string =>
  `local:cli-opened-session:${sessionId}`;

/**
 * A local account's first passkey needs no account proof when the acting
 * session is one the CLI opened on this computer and the account has no live
 * passkey. The CLI-opened fact is recorded against the session id when the
 * handoff is exchanged and expires with the session's absolute lifetime.
 */
@Injectable()
export class LocalFirstPasskeyAuthority implements FirstPasskeyAuthority {
  private readonly logger = new Logger(LocalFirstPasskeyAuthority.name);

  constructor(private readonly redis: RedisService) {}

  async recordCliOpenedSession(sessionId: string): Promise<void> {
    await this.redis
      .getClient()
      .set(
        cliOpenedSessionKey(sessionId),
        '1',
        'EX',
        REQUIRED_ABSOLUTE_TTL_SECONDS,
      );
  }

  async assertFirstPasskeyAllowed(
    tx: AnyTransactionClient,
    actor: AccountPasskeyActor,
  ): Promise<void> {
    const cliOpened = await this.isCliOpenedSession(actor.browserSessionId);
    const localAccount =
      isLocalApplication() && isLocalAccountEmail(actor.email);
    // The account row is locked by the caller, so this count cannot race
    // another first-passkey enrollment.
    const livePasskeys = await tx.accountPasskey.count({
      where: { userId: actor.userId, revokedAt: null },
    });

    if (!localAccount || !cliOpened || livePasskeys > 0) {
      this.logger.warn('Local first passkey refused', {
        userId: actor.userId,
        localAccount,
        cliOpenedSession: cliOpened,
        livePasskeys,
      });
      throw new AccountProofRequiredException();
    }
  }

  /** True while `sessionId` is a setup session the CLI opened on this computer. */
  async isCliOpenedSession(sessionId: string): Promise<boolean> {
    const recorded = await this.redis
      .getClient()
      .exists(cliOpenedSessionKey(sessionId));

    return recorded === 1;
  }

  async firstPasskeyEnrolled(actor: AccountPasskeyActor): Promise<void> {
    await this.redis
      .getClient()
      .del(cliOpenedSessionKey(actor.browserSessionId));
  }
}
