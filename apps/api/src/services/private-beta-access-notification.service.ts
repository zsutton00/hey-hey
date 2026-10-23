import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  PrivateBetaAccessNotificationDeliveryState,
  PrivateBetaAccessNotificationRecipientRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import type { PrivateBetaAccessRequestId } from '../types';

const CLAIM_DURATION_MS = 10 * 60_000;
const MAX_BATCH_SIZE = 50;
const MAX_CONCURRENCY = 5;
const MAX_CLAIM_RACES = 3;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
const PRIVATE_BETA_NOTIFICATION_FAILURE_MESSAGE =
  'Private-beta notification delivery failed.';

type ClaimedNotification =
  Prisma.PrivateBetaAccessNotificationAttemptGetPayload<{
    include: { request: true };
  }>;

@Injectable()
export class PrivateBetaAccessNotificationService {
  private readonly logger = new Logger(
    PrivateBetaAccessNotificationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueNotifications(): Promise<number> {
    let processedCount = 0;

    try {
      while (processedCount < MAX_BATCH_SIZE) {
        const claims: ClaimedNotification[] = [];
        const claimLimit = Math.min(
          MAX_CONCURRENCY,
          MAX_BATCH_SIZE - processedCount,
        );

        for (let index = 0; index < claimLimit; index += 1) {
          const claimed = await this.claimNext();
          if (!claimed) break;
          claims.push(claimed);
        }

        if (claims.length === 0) break;

        await Promise.all(claims.map((claim) => this.deliver(claim)));
        processedCount += claims.length;
      }
    } catch (error) {
      this.logger.error('Private-beta notification processing tick failed', {
        processedCount,
        errorType: this.errorType(error),
      });
    }

    return processedCount;
  }

  async claimNext(now = new Date()): Promise<ClaimedNotification | null> {
    for (let race = 0; race < MAX_CLAIM_RACES; race += 1) {
      const candidate =
        await this.prisma.db.privateBetaAccessNotificationAttempt.findFirst({
          where: {
            OR: [
              {
                deliveryState:
                  PrivateBetaAccessNotificationDeliveryState.PENDING,
                nextRetryAt: { lte: now },
              },
              {
                deliveryState:
                  PrivateBetaAccessNotificationDeliveryState.FAILED,
                nextRetryAt: { lte: now },
              },
              {
                deliveryState:
                  PrivateBetaAccessNotificationDeliveryState.PROCESSING,
                claimExpiresAt: { lte: now },
              },
            ],
          },
          orderBy: [{ nextRetryAt: 'asc' }, { createdAt: 'asc' }],
          include: { request: true },
        });

      if (!candidate) {
        this.logger.debug('[claim] no due private-beta notification found', {
          now: now.toISOString(),
        });
        return null;
      }

      const claimToken = randomUUID();
      const claimExpiresAt = new Date(now.getTime() + CLAIM_DURATION_MS);
      const claimWhere: Prisma.PrivateBetaAccessNotificationAttemptWhereInput =
        {
          id: candidate.id,
          deliveryState: candidate.deliveryState,
          ...(candidate.deliveryState ===
          PrivateBetaAccessNotificationDeliveryState.PROCESSING
            ? { claimExpiresAt: { lte: now } }
            : { nextRetryAt: { lte: now } }),
        };

      this.logger.debug('[claim] attempting private-beta notification claim', {
        notificationId: candidate.id,
        requestId: candidate.requestId,
        recipientRole: candidate.recipientRole,
        priorState: candidate.deliveryState,
        priorAttemptCount: candidate.attemptCount,
        claimExpiresAt: claimExpiresAt.toISOString(),
      });

      const claimed =
        await this.prisma.db.privateBetaAccessNotificationAttempt.updateMany({
          where: claimWhere,
          data: {
            deliveryState:
              PrivateBetaAccessNotificationDeliveryState.PROCESSING,
            attemptCount: { increment: 1 },
            claimedAt: now,
            claimExpiresAt,
            claimToken,
            lastAttemptAt: now,
          },
        });

      if (claimed.count !== 1) {
        this.logger.debug('[claim] private-beta notification claim skipped', {
          notificationId: candidate.id,
          requestId: candidate.requestId,
          recipientRole: candidate.recipientRole,
          reason: 'claim predicate no longer matched',
          race,
        });
        continue;
      }

      this.logger.debug('[claim] private-beta notification claimed', {
        notificationId: candidate.id,
        requestId: candidate.requestId,
        recipientRole: candidate.recipientRole,
        attemptCount: candidate.attemptCount + 1,
        claimExpiresAt: claimExpiresAt.toISOString(),
      });

      return {
        ...candidate,
        deliveryState: PrivateBetaAccessNotificationDeliveryState.PROCESSING,
        attemptCount: candidate.attemptCount + 1,
        claimedAt: now,
        claimExpiresAt,
        claimToken,
        lastAttemptAt: now,
      };
    }

    this.logger.debug('[claim] private-beta notification claim skipped', {
      reason: 'claim race limit reached',
    });
    return null;
  }

  private async deliver(claim: ClaimedNotification): Promise<void> {
    const deliveryStartedAt = Date.now();
    this.logger.debug('[delivery] private-beta notification boundary entered', {
      notificationId: claim.id,
      requestId: claim.requestId,
      recipientRole: claim.recipientRole,
      attemptCount: claim.attemptCount,
    });

    try {
      const request = {
        requestId: claim.request.id as PrivateBetaAccessRequestId,
        name: claim.request.name,
        submittedEmail: claim.request.submittedEmail,
        organizationName: claim.request.organizationName,
        teamSize: claim.request.teamSize,
        productContext: claim.request.productContext,
        accessRationale: claim.request.accessRationale,
      };

      if (
        claim.recipientRole ===
        PrivateBetaAccessNotificationRecipientRole.REQUESTER
      ) {
        await this.emailService.sendPrivateBetaAccessRequesterEmail(request);
      } else if (
        claim.recipientRole ===
        PrivateBetaAccessNotificationRecipientRole.EXISTING_ACCOUNT_HOLDER
      ) {
        await this.emailService.sendPrivateBetaAccessExistingAccountEmail(
          request,
        );
      } else {
        await this.emailService.sendPrivateBetaAccessOperatorEmail(request);
      }

      this.logger.debug('[delivery] private-beta email provider accepted', {
        notificationId: claim.id,
        requestId: claim.requestId,
        recipientRole: claim.recipientRole,
        elapsedMs: Date.now() - deliveryStartedAt,
      });
    } catch (error) {
      this.logger.error('[delivery] private-beta email delivery failed', {
        notificationId: claim.id,
        requestId: claim.requestId,
        recipientRole: claim.recipientRole,
        attemptCount: claim.attemptCount,
        elapsedMs: Date.now() - deliveryStartedAt,
        errorType: this.errorType(error),
      });
      await this.recordFailure(claim, error);
      this.logger.debug('[outcome] private-beta notification failed', {
        notificationId: claim.id,
        requestId: claim.requestId,
        recipientRole: claim.recipientRole,
        attemptCount: claim.attemptCount,
        errorType: this.errorType(error),
      });
      return;
    }

    const outcome =
      await this.prisma.db.privateBetaAccessNotificationAttempt.updateMany({
        where: {
          id: claim.id,
          deliveryState: PrivateBetaAccessNotificationDeliveryState.PROCESSING,
          claimToken: claim.claimToken,
        },
        data: {
          deliveryState: PrivateBetaAccessNotificationDeliveryState.SENT,
          deliveredAt: new Date(),
          lastError: null,
          nextRetryAt: null,
          claimedAt: null,
          claimExpiresAt: null,
          claimToken: null,
        },
      });

    if (outcome.count !== 1) {
      this.logger.debug('[outcome] private-beta notification outcome skipped', {
        notificationId: claim.id,
        requestId: claim.requestId,
        recipientRole: claim.recipientRole,
        reason: 'claim token no longer owned',
      });
      return;
    }

    this.logger.debug('[outcome] private-beta notification delivered', {
      notificationId: claim.id,
      requestId: claim.requestId,
      recipientRole: claim.recipientRole,
      attemptCount: claim.attemptCount,
      elapsedMs: Date.now() - deliveryStartedAt,
    });
  }

  private async recordFailure(
    claim: ClaimedNotification,
    error: unknown,
  ): Promise<void> {
    const exhausted = claim.attemptCount >= claim.maxAttempts;
    const nextRetryAt = exhausted
      ? null
      : new Date(Date.now() + this.retryDelayMs(claim.attemptCount));
    const lastError = PRIVATE_BETA_NOTIFICATION_FAILURE_MESSAGE;
    const recorded =
      await this.prisma.db.privateBetaAccessNotificationAttempt.updateMany({
        where: {
          id: claim.id,
          deliveryState: PrivateBetaAccessNotificationDeliveryState.PROCESSING,
          claimToken: claim.claimToken,
        },
        data: {
          deliveryState: PrivateBetaAccessNotificationDeliveryState.FAILED,
          lastError,
          nextRetryAt,
          claimedAt: null,
          claimExpiresAt: null,
          claimToken: null,
        },
      });

    if (recorded.count !== 1) {
      this.logger.debug('[retry] private-beta failure recording skipped', {
        notificationId: claim.id,
        requestId: claim.requestId,
        recipientRole: claim.recipientRole,
        reason: 'claim token no longer owned',
      });
      return;
    }

    this.logger.debug('[retry] private-beta notification retry decision', {
      notificationId: claim.id,
      requestId: claim.requestId,
      recipientRole: claim.recipientRole,
      attemptCount: claim.attemptCount,
      maxAttempts: claim.maxAttempts,
      exhausted,
      nextRetryAt: nextRetryAt?.toISOString() ?? null,
      errorType: this.errorType(error),
    });
  }

  private retryDelayMs(attemptCount: number): number {
    return Math.min(
      60_000 * 2 ** Math.max(attemptCount - 1, 0),
      MAX_RETRY_DELAY_MS,
    );
  }

  private errorType(error: unknown): string {
    return error instanceof Error ? error.name : typeof error;
  }
}
