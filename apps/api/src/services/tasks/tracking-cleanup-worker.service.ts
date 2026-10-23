import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  TrackingCleanupOperation,
  TrackingCleanupOperationStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from 'src/services/proposal/pending-edge.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { GoalTracksService } from './goal-tracks.service';

const OPERATION_KIND = 'REVOKED_TRACKS';

@Injectable()
export class TrackingCleanupWorkerService {
  private readonly logger = new Logger(TrackingCleanupWorkerService.name);
  private readonly batchSize = 25;
  private readonly claimDurationMs = 5 * 60_000;
  private readonly maxAttempts = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly goalTracksService: GoalTracksService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueOperations(): Promise<void> {
    for (let index = 0; index < this.batchSize; index += 1) {
      const operation = await this.claimNext();
      if (!operation) return;
      await this.execute(operation);
    }
  }

  async claimNext(now = new Date()): Promise<TrackingCleanupOperation | null> {
    const candidate = await this.prisma.db.trackingCleanupOperation.findFirst({
      where: {
        OR: [
          {
            status: TrackingCleanupOperationStatus.PENDING,
            nextRetryAt: { lte: now },
          },
          {
            status: TrackingCleanupOperationStatus.FAILED,
            nextRetryAt: { lte: now },
          },
          {
            status: TrackingCleanupOperationStatus.PROCESSING,
            claimExpiresAt: { lte: now },
          },
        ],
      },
      orderBy: { nextRetryAt: 'asc' },
    });
    if (!candidate) return null;

    const claimed = await this.prisma.db.trackingCleanupOperation.updateMany({
      where: {
        id: candidate.id,
        OR: [
          {
            status: TrackingCleanupOperationStatus.PENDING,
            nextRetryAt: { lte: now },
          },
          {
            status: TrackingCleanupOperationStatus.FAILED,
            nextRetryAt: { lte: now },
          },
          {
            status: TrackingCleanupOperationStatus.PROCESSING,
            claimExpiresAt: { lte: now },
          },
        ],
      },
      data: {
        status: TrackingCleanupOperationStatus.PROCESSING,
        attemptCount: { increment: 1 },
        claimedAt: now,
        claimExpiresAt: new Date(now.getTime() + this.claimDurationMs),
        lastError: null,
      },
    });
    if (claimed.count === 0) return null;
    return this.prisma.db.trackingCleanupOperation.findUniqueOrThrow({
      where: { id: candidate.id },
    });
  }

  async execute(operation: TrackingCleanupOperation): Promise<void> {
    try {
      if (operation.operationKind !== OPERATION_KIND) {
        throw new Error(
          `Unsupported tracking cleanup operation: ${operation.operationKind}`,
        );
      }
      const token = this.tokenFactory(
        operation.organizationId as OrganizationId,
        operation.projectId as ProjectId,
      );
      const result =
        await this.goalTracksService.clearRevokedTrackingSourceEdges(
          operation.organizationId as OrganizationId,
          operation.projectId as ProjectId,
          operation.targetTypeKey,
          operation.revokedSourceTypeKeys as string[],
          token,
        );
      const completed =
        await this.prisma.db.trackingCleanupOperation.updateMany({
          where: this.claimedOperationWhere(operation),
          data: {
            status: TrackingCleanupOperationStatus.COMPLETED,
            completedAt: new Date(),
            claimExpiresAt: null,
            clearedRelationshipCount: result.clearedLinkCount,
          },
        });
      if (completed.count > 0) {
        this.logger.log('Completed tracking cleanup operation', {
          operationId: operation.id,
          clearedRelationshipCount: result.clearedLinkCount,
        });
      }
    } catch (error) {
      await this.recordFailure(operation, error);
    }
  }

  /** Requeue an exhausted operation after an operator has resolved its cause. */
  async recover(operationId: string): Promise<void> {
    await this.prisma.db.trackingCleanupOperation.update({
      where: { id: operationId },
      data: {
        status: TrackingCleanupOperationStatus.PENDING,
        nextRetryAt: new Date(),
        claimedAt: null,
        claimExpiresAt: null,
        lastError: null,
      },
    });
    this.logger.log('Requeued tracking cleanup operation for recovery', {
      operationId,
    });
  }

  private async recordFailure(
    operation: TrackingCleanupOperation,
    error: unknown,
  ): Promise<void> {
    const exhausted = operation.attemptCount >= this.maxAttempts;
    const delayMs = Math.min(
      60_000 * 2 ** Math.max(operation.attemptCount - 1, 0),
      60 * 60_000,
    );
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.db.trackingCleanupOperation.updateMany({
      where: this.claimedOperationWhere(operation),
      data: {
        status: TrackingCleanupOperationStatus.FAILED,
        claimExpiresAt: null,
        nextRetryAt: exhausted
          ? new Date('9999-12-31T00:00:00.000Z')
          : new Date(Date.now() + delayMs),
        lastError: message,
      },
    });
    this.logger.error('Tracking cleanup operation failed', {
      operationId: operation.id,
      attemptCount: operation.attemptCount,
      exhausted,
      error: message,
    });
  }

  private claimedOperationWhere(operation: TrackingCleanupOperation) {
    return {
      id: operation.id,
      status: TrackingCleanupOperationStatus.PROCESSING,
      claimedAt: operation.claimedAt,
    };
  }
}
