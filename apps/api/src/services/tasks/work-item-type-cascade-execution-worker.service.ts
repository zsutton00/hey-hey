import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  WorkItemTypeCascadeExecution,
  WorkItemTypeCascadeExecutionState,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from 'src/services/proposal/pending-edge.service';
import { ProposalApprovalService } from 'src/services/proposal/proposal-approval.service';
import type { OrganizationId, ProjectId } from 'src/types';
import { WorkItemTypeImpactService } from './work-item-type-impact.service';

@Injectable()
export class WorkItemTypeCascadeExecutionWorkerService {
  private readonly logger = new Logger(
    WorkItemTypeCascadeExecutionWorkerService.name,
  );
  private readonly batchSize = 25;
  private readonly claimDurationMs = 5 * 60_000;
  private readonly maxAttempts = 8;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workItemTypeImpact: WorkItemTypeImpactService,
    private readonly proposalApprovalService: ProposalApprovalService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processDueExecutions(): Promise<void> {
    for (let index = 0; index < this.batchSize; index += 1) {
      const execution = await this.claimNext();
      if (!execution) return;
      await this.execute(execution);
    }
  }

  async claimNext(now = new Date()): Promise<WorkItemTypeCascadeExecution | null> {
    const dueWhere: Prisma.WorkItemTypeCascadeExecutionWhereInput = {
      OR: [
        {
          state: WorkItemTypeCascadeExecutionState.PENDING,
          nextRetryAt: { lte: now },
        },
        {
          state: WorkItemTypeCascadeExecutionState.FAILED,
          nextRetryAt: { lte: now },
        },
        {
          state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
          nextRetryAt: { lte: now },
        },
        {
          state: WorkItemTypeCascadeExecutionState.PROCESSING,
          claimExpiresAt: { lte: now },
        },
      ],
    };
    const candidate = await this.prisma.db.workItemTypeCascadeExecution.findFirst({
      where: dueWhere,
      orderBy: { nextRetryAt: 'asc' },
    });
    if (!candidate) return null;

    const claimToken = uuidv4();
    const claimed =
      await this.prisma.db.workItemTypeCascadeExecution.updateMany({
        where: {
          id: candidate.id,
          ...dueWhere,
        },
        data: {
          state: WorkItemTypeCascadeExecutionState.PROCESSING,
          attemptCount: { increment: 1 },
          claimToken,
          claimedAt: now,
          claimExpiresAt: new Date(now.getTime() + this.claimDurationMs),
          lastError: null,
        },
      });
    if (claimed.count === 0) return null;

    return this.prisma.db.workItemTypeCascadeExecution.findUniqueOrThrow({
      where: { id: candidate.id },
    });
  }

  async execute(execution: WorkItemTypeCascadeExecution): Promise<void> {
    const claimToken = execution.claimToken;
    if (!claimToken) {
      this.logger.warn('Skipping cascade execution without a claim token', {
        executionId: execution.id,
      });
      return;
    }

    let graphCleaned = execution.graphCompletedAt !== null;
    try {
      if (!graphCleaned) {
        const workItemIds = this.readWorkItemIds(execution.workItemIds);
        const token = this.tokenFactory(
          execution.organizationId as OrganizationId,
          execution.projectId as ProjectId,
        );
        const result = await this.workItemTypeImpact.deleteCascadeIncidentEdges(
          execution.organizationId as OrganizationId,
          execution.projectId as ProjectId,
          workItemIds,
          token,
        );
        const marked =
          await this.prisma.db.workItemTypeCascadeExecution.updateMany({
            where: {
              id: execution.id,
              state: WorkItemTypeCascadeExecutionState.PROCESSING,
              claimToken,
            },
            data: {
              state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
              graphCompletedAt: new Date(),
              graphDeletedEdgeCount: result.deletedEdgeCount,
              nextRetryAt: new Date(),
            },
          });
        if (marked.count === 0) return;
        graphCleaned = true;
      }

      await this.proposalApprovalService.finalizeCascadeDeleteExecution(
        execution.id,
        claimToken,
      );
    } catch (error) {
      if (graphCleaned) {
        await this.recordFinalizationFailure(execution, claimToken, error);
      } else {
        await this.recordGraphFailure(execution, claimToken, error);
      }
    }
  }

  /** Requeue exhausted work without recreating the proposal or execution. */
  async recover(executionId: string): Promise<void> {
    const execution =
      await this.prisma.db.workItemTypeCascadeExecution.findUniqueOrThrow({
        where: { id: executionId },
      });
    const state = execution.graphCompletedAt
      ? WorkItemTypeCascadeExecutionState.GRAPH_CLEANED
      : WorkItemTypeCascadeExecutionState.PENDING;
    await this.prisma.db.workItemTypeCascadeExecution.update({
      where: { id: executionId },
      data: {
        state,
        nextRetryAt: new Date(),
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        lastError: null,
      },
    });
    this.logger.log('Requeued cascade execution for recovery', { executionId });
  }

  private readWorkItemIds(value: unknown): string[] {
    if (
      !Array.isArray(value) ||
      !value.every((item): item is string => typeof item === 'string')
    ) {
      throw new Error('Cascade execution contains invalid work-item IDs.');
    }
    return [...new Set(value)].sort();
  }

  private async recordGraphFailure(
    execution: WorkItemTypeCascadeExecution,
    claimToken: string,
    error: unknown,
  ): Promise<void> {
    const exhausted = execution.attemptCount >= this.maxAttempts;
    await this.prisma.db.workItemTypeCascadeExecution.updateMany({
      where: {
        id: execution.id,
        state: WorkItemTypeCascadeExecutionState.PROCESSING,
        claimToken,
      },
      data: {
        state: WorkItemTypeCascadeExecutionState.FAILED,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextRetryAt: exhausted
          ? new Date('9999-12-31T00:00:00.000Z')
          : new Date(Date.now() + this.retryDelayMs(execution.attemptCount)),
        lastError: this.errorMessage(error),
      },
    });
    this.logger.error('Cascade Graph cleanup failed', {
      executionId: execution.id,
      attemptCount: execution.attemptCount,
      exhausted,
      error: this.errorMessage(error),
    });
  }

  private async recordFinalizationFailure(
    execution: WorkItemTypeCascadeExecution,
    claimToken: string,
    error: unknown,
  ): Promise<void> {
    const exhausted = execution.attemptCount >= this.maxAttempts;
    await this.prisma.db.workItemTypeCascadeExecution.updateMany({
      where: {
        id: execution.id,
        state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
        claimToken,
      },
      data: {
        state: WorkItemTypeCascadeExecutionState.GRAPH_CLEANED,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextRetryAt: exhausted
          ? new Date('9999-12-31T00:00:00.000Z')
          : new Date(Date.now() + this.retryDelayMs(execution.attemptCount)),
        lastError: this.errorMessage(error),
      },
    });
    this.logger.error('Cascade API finalization failed', {
      executionId: execution.id,
      attemptCount: execution.attemptCount,
      exhausted,
      error: this.errorMessage(error),
    });
  }

  private retryDelayMs(attemptCount: number): number {
    return Math.min(
      60_000 * 2 ** Math.max(attemptCount - 1, 0),
      60 * 60_000,
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
