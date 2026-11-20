import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  LocalPasskeyRepairState,
  type LocalPasskeyRepairStatusDto,
} from '@hey-hey/contracts/api/models';
import { z } from 'zod';
import { AccountPasskeyService } from '../auth/passkeys/account-passkey.service';
import { RedisService } from '../core/redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserId } from '../types';
import { LocalFirstPasskeyAuthority } from './local-first-passkey-authority';

export const LOCAL_REPAIR_SESSION_NOT_CLI_OPENED =
  'LOCAL_REPAIR_SESSION_NOT_CLI_OPENED' as const;
export const LOCAL_REPAIR_NO_PASSKEY = 'LOCAL_REPAIR_NO_PASSKEY' as const;
export const LOCAL_REPAIR_NOT_REQUESTED = 'LOCAL_REPAIR_NOT_REQUESTED' as const;

/** Long enough to answer at the terminal; a stale request then lapses by itself. */
const REPAIR_TTL_SECONDS = 600;

const repairKey = (userId: UserId): string => `local:passkey-repair:${userId}`;

const repairRecordSchema = z.strictObject({
  state: z.nativeEnum(LocalPasskeyRepairState),
  /** The setup session that asked; it stays signed in to enroll the new passkey. */
  sessionId: z.string().min(1),
});
type RepairRecord = z.infer<typeof repairRecordSchema>;

/**
 * Repair is the one local-only way past a passkey that can no longer be used:
 * the setup page the CLI opened asks, the person confirms at the terminal, and
 * only then are the account's old passkeys revoked with everything they
 * authorized. The account then has no passkey, so the same setup session may
 * enroll a new first one. Projects and work are never touched.
 */
@Injectable()
export class LocalPasskeyRepairService {
  private readonly logger = new Logger(LocalPasskeyRepairService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accountPasskeys: AccountPasskeyService,
    private readonly firstPasskeyAuthority: LocalFirstPasskeyAuthority,
  ) {}

  /** Asked by the setup page. Changes nothing until the terminal confirms. */
  async request(
    userId: UserId,
    browserSessionId: string | undefined,
  ): Promise<LocalPasskeyRepairStatusDto> {
    const cliOpened =
      browserSessionId !== undefined &&
      (await this.firstPasskeyAuthority.isCliOpenedSession(browserSessionId));
    if (!cliOpened) {
      this.logger.warn('Local passkey repair refused', {
        userId,
        reasonCode: LOCAL_REPAIR_SESSION_NOT_CLI_OPENED,
      });
      throw new ForbiddenException({
        message:
          'Repair can only start from the page heyhey local opens. Run heyhey local in your terminal to open it.',
        code: LOCAL_REPAIR_SESSION_NOT_CLI_OPENED,
      });
    }

    const livePasskeys = await this.prisma.db.accountPasskey.count({
      where: { userId, revokedAt: null },
    });
    if (livePasskeys === 0) {
      this.logger.warn('Local passkey repair refused', {
        userId,
        reasonCode: LOCAL_REPAIR_NO_PASSKEY,
      });
      throw new ForbiddenException({
        message:
          'This computer has no passkey to repair. Create a new passkey to continue.',
        code: LOCAL_REPAIR_NO_PASSKEY,
      });
    }

    await this.write(userId, {
      state: LocalPasskeyRepairState.Requested,
      sessionId: browserSessionId,
    });
    this.logger.log('Local passkey repair requested', {
      userId,
      livePasskeys,
    });

    return { state: LocalPasskeyRepairState.Requested };
  }

  async status(userId: UserId): Promise<LocalPasskeyRepairStatusDto> {
    const record = await this.read(userId);

    return { state: record?.state ?? LocalPasskeyRepairState.None };
  }

  /** The person's answer at the terminal, reported by the CLI. */
  async decide(
    userId: UserId,
    approved: boolean,
  ): Promise<LocalPasskeyRepairStatusDto> {
    const record = await this.read(userId);
    if (record?.state !== LocalPasskeyRepairState.Requested) {
      this.logger.warn('Local passkey repair decision refused', {
        userId,
        reasonCode: LOCAL_REPAIR_NOT_REQUESTED,
        state: record?.state ?? LocalPasskeyRepairState.None,
      });
      throw new ConflictException({
        message: 'No repair is waiting for confirmation.',
        code: LOCAL_REPAIR_NOT_REQUESTED,
      });
    }

    if (!approved) {
      await this.write(userId, {
        ...record,
        state: LocalPasskeyRepairState.Declined,
      });
      this.logger.log('Local passkey repair declined at the terminal', {
        userId,
      });

      return { state: LocalPasskeyRepairState.Declined };
    }

    const revoked = await this.accountPasskeys.revokeAllForAccount(
      userId,
      record.sessionId,
    );
    await this.write(userId, {
      ...record,
      state: LocalPasskeyRepairState.Completed,
    });
    this.logger.log('Local passkey repair completed', { userId, ...revoked });

    return { state: LocalPasskeyRepairState.Completed };
  }

  private async read(userId: UserId): Promise<RepairRecord | null> {
    const stored = await this.redis.getClient().get(repairKey(userId));
    if (stored === null) {
      return null;
    }

    const parsed = repairRecordSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) {
      this.logger.warn('Local passkey repair record unreadable; ignored', {
        userId,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
      return null;
    }

    return parsed.data;
  }

  private async write(userId: UserId, record: RepairRecord): Promise<void> {
    await this.redis
      .getClient()
      .set(repairKey(userId), JSON.stringify(record), 'EX', REPAIR_TTL_SECONDS);
  }
}
