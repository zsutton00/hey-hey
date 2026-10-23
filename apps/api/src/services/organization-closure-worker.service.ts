import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrganizationClosureDueWorkService } from './organization-closure-due-work.service';
import { OrganizationProjectionDeletionCoordinatorService } from './organization-projection-deletion-coordinator.service';

@Injectable()
export class OrganizationClosureWorkerService {
  private readonly logger = new Logger(OrganizationClosureWorkerService.name);
  private readonly batchSize = 10;

  constructor(
    private readonly dueWork: OrganizationClosureDueWorkService,
    private readonly projectionCoordinator: OrganizationProjectionDeletionCoordinatorService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueClosures(): Promise<void> {
    this.logger.debug({
      event: 'organization_closure_batch_started',
      batchSize: this.batchSize,
      handler: this.projectionCoordinator.constructor.name,
    });
    for (let index = 0; index < this.batchSize; index += 1) {
      await this.dueWork.materializeNextReachedSnapshot();
      const execution = await this.dueWork.claimNext();
      if (!execution) {
        this.logger.debug({
          event: 'organization_closure_batch_drained',
          processedCount: index,
        });
        return;
      }

      this.logger.log({
        event: 'organization_closure_dispatch_started',
        organizationId: execution.organizationId,
        markerId: execution.markerId,
        stage: execution.stage,
        attemptCount: execution.attemptCount,
        handler: this.projectionCoordinator.constructor.name,
        claimedAt: execution.claimedAt?.toISOString() ?? null,
        leaseExpiresAt: execution.leaseExpiresAt?.toISOString() ?? null,
      });
      try {
        await this.projectionCoordinator.execute(execution);
        this.logger.log({
          event: 'organization_closure_dispatch_returned',
          organizationId: execution.organizationId,
          markerId: execution.markerId,
          claimedStage: execution.stage,
          attemptCount: execution.attemptCount,
          handler: this.projectionCoordinator.constructor.name,
        });
      } catch (error) {
        this.logger.error({
          event: 'organization_closure_dispatch_failed',
          organizationId: execution.organizationId,
          markerId: execution.markerId,
          stage: execution.stage,
          attemptCount: execution.attemptCount,
          handler: this.projectionCoordinator.constructor.name,
          failureType:
            error instanceof Error ? error.constructor.name : typeof error,
          failure: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
    }
    this.logger.warn({
      event: 'organization_closure_batch_limit_reached',
      batchSize: this.batchSize,
    });
  }
}
