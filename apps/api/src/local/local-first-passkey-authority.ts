import { Injectable, UnauthorizedException } from '@nestjs/common';
import { isLocalApplication } from '../deployment-environment';
import { isLocalAccountEmail } from '../auth/local-account';
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
    const cliOpened =
      (await this.redis
        .getClient()
        .exists(cliOpenedSessionKey(actor.browserSessionId))) === 1;
    const localAccount =
      isLocalApplication() && isLocalAccountEmail(actor.email);
    // The account row is locked by the caller, so this count cannot race
    // another first-passkey enrollment.
    const livePasskeys = await tx.accountPasskey.count({
      where: { userId: actor.userId, revokedAt: null },
    });

    if (!localAccount || !cliOpened || livePasskeys > 0) {
      throw new UnauthorizedException('Account proof is required');
    }
  }

  async firstPasskeyEnrolled(actor: AccountPasskeyActor): Promise<void> {
    await this.redis
      .getClient()
      .del(cliOpenedSessionKey(actor.browserSessionId));
  }
}
