import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DemoSandboxStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveInactivityTimeoutSeconds } from './demo-sandbox.constants';

const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/**
 * Extends a sandbox's expiry whenever its demo user authenticates, from the
 * browser or a paired CLI. Lives apart from the expiry sweep because the
 * authentication paths call it and must not depend on the teardown services.
 */
@Injectable()
export class DemoSandboxActivityService {
  private readonly logger = new Logger(DemoSandboxActivityService.name);
  private readonly lastWriteByUser = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The in-memory gate spares the database; the conditional update enforces
   * the same one-write-a-minute throttle across API instances and never
   * revives a row whose deadline has passed or that has left ACTIVE. Rows
   * belong to demo users only, so any other user matches nothing. Never
   * throws: activity tracking must not fail the request it observes.
   */
  async recordActivity(userId: string, now = new Date()): Promise<void> {
    this.pruneGate(now.getTime());
    const last = this.lastWriteByUser.get(userId);
    if (
      last !== undefined &&
      now.getTime() - last < ACTIVITY_WRITE_INTERVAL_MS
    ) {
      return;
    }
    this.lastWriteByUser.set(userId, now.getTime());
    try {
      const { count } = await this.prisma.demoSandbox.updateMany({
        where: {
          demoUserId: userId,
          status: DemoSandboxStatus.ACTIVE,
          expiresAt: { gt: now },
          OR: [
            { lastActivityAt: null },
            {
              lastActivityAt: {
                lte: new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS),
              },
            },
          ],
        },
        data: {
          lastActivityAt: now,
          expiresAt: new Date(
            now.getTime() + resolveInactivityTimeoutSeconds(this.config) * 1000,
          ),
        },
      });
      this.logger.debug('Demo sandbox activity recorded', {
        userId,
        refreshed: count,
      });
    } catch (error) {
      this.lastWriteByUser.delete(userId);
      this.logger.error('Demo sandbox activity could not be recorded', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private pruneGate(nowMs: number): void {
    if (this.lastWriteByUser.size < 1_000) return;
    for (const [userId, writtenAt] of this.lastWriteByUser) {
      if (nowMs - writtenAt >= ACTIVITY_WRITE_INTERVAL_MS) {
        this.lastWriteByUser.delete(userId);
      }
    }
  }
}
