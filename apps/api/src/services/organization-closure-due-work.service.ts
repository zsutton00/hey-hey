import { Injectable, Logger } from '@nestjs/common';
import {
  OrganizationClosureExecution,
  OrganizationClosureExecutionStage,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { OrganizationId } from '../types';
import { OrganizationAccountLifecycleOwner } from './organization-account-lifecycle.owner';

const CLAIM_DURATION_MS = 5 * 60_000;
const MAX_FAILURE_LENGTH = 2000;
const MAX_RETRY_DELAY_MS = 60 * 60_000;
export const MAX_ORGANIZATION_CLOSURE_ATTEMPTS = 8;

@Injectable()
export class OrganizationClosureDueWorkService {
  private readonly logger = new Logger(OrganizationClosureDueWorkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycleOwner: OrganizationAccountLifecycleOwner,
  ) {}

  async materializeNextReachedSnapshot(now = new Date()): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ organizationId: string }>>(
      Prisma.sql`
        SELECT lifecycle.organization_id AS "organizationId"
        FROM organization_account_lifecycles lifecycle
        LEFT JOIN organization_closure_executions execution
          ON execution.organization_id = lifecycle.organization_id
        WHERE lifecycle.deletion_eligible_at <= ${now}
          AND lifecycle.lifecycle_state IN (
            'ACTIVE'::organization_account_lifecycle_state,
            'SUSPENDED'::organization_account_lifecycle_state,
            'IRREVERSIBLY_CLOSED'::organization_account_lifecycle_state
          )
          AND execution.organization_id IS NULL
        ORDER BY lifecycle.deletion_eligible_at, lifecycle.organization_id
        LIMIT 1
      `,
    );
    const candidate = rows[0];
    if (!candidate) return false;

    await this.lifecycleOwner.materializeReachedClosure(
      candidate.organizationId as OrganizationId,
      now,
    );
    this.logger.log({
      event: 'organization_closure_snapshot_materialized',
      organizationId: candidate.organizationId,
    });
    return true;
  }

  async materializeReachedSnapshot(
    organizationId: OrganizationId,
    now = new Date(),
  ): Promise<void> {
    await this.lifecycleOwner.materializeReachedClosure(organizationId, now);
  }

  async claimNext(
    now = new Date(),
    organizationId?: OrganizationId,
  ): Promise<OrganizationClosureExecution | null> {
    await this.finalizeExhaustedExecutions(now, organizationId);
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + CLAIM_DURATION_MS);
    const rows = await this.prisma.$queryRaw<Array<{ organizationId: string }>>(
      Prisma.sql`
        WITH candidate AS (
          SELECT organization_id
          FROM organization_closure_executions
          WHERE stage NOT IN (
              'COMPLETED'::organization_closure_execution_stage,
              'FAILED'::organization_closure_execution_stage
            )
            AND effective_closure_at <= ${now}
            AND (next_retry_at IS NULL OR next_retry_at <= ${now})
            AND (lease_expires_at IS NULL OR lease_expires_at <= ${now})
            ${organizationId ? Prisma.sql`AND organization_id = ${organizationId}` : Prisma.empty}
          ORDER BY effective_closure_at, organization_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE organization_closure_executions execution
        SET claim_token = ${claimToken},
            claimed_at = ${now},
            lease_expires_at = ${leaseExpiresAt},
            attempt_count = execution.attempt_count + 1,
            attempt_id = ${claimToken},
            started_at = COALESCE(execution.started_at, ${now}),
            last_attempted_at = ${now},
            last_failure = NULL,
            next_retry_at = NULL,
            revision = execution.revision + 1,
            updated_at = ${now}
        FROM candidate
        WHERE execution.organization_id = candidate.organization_id
        RETURNING execution.organization_id AS "organizationId"
      `,
    );
    const claimed = rows[0]
      ? await this.prisma.db.organizationClosureExecution.findUniqueOrThrow({
          where: { organizationId: rows[0].organizationId },
        })
      : null;
    if (claimed) {
      this.logger.log({
        event: 'organization_closure_claimed',
        organizationId: claimed.organizationId,
        stage: claimed.stage,
        attemptCount: claimed.attemptCount,
      });
    }
    return claimed;
  }

  private async finalizeExhaustedExecutions(
    now: Date,
    organizationId?: OrganizationId,
  ): Promise<void> {
    await this.prisma.db.organizationClosureExecution.updateMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        stage: {
          notIn: [
            OrganizationClosureExecutionStage.COMPLETED,
            OrganizationClosureExecutionStage.FAILED,
          ],
        },
        attemptCount: { gte: MAX_ORGANIZATION_CLOSURE_ATTEMPTS },
        AND: [
          {
            OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
          },
          {
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
        ],
      },
      data: {
        stage: OrganizationClosureExecutionStage.FAILED,
        failedAt: now,
        nextRetryAt: null,
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        lastFailure: 'RETRY_BOUND_EXHAUSTED',
        revision: { increment: 1 },
        updatedAt: now,
      },
    });
  }

  async recover(
    organizationId: OrganizationId,
    now = new Date(),
  ): Promise<void> {
    const updated =
      await this.prisma.db.organizationClosureExecution.updateMany({
        where: {
          organizationId,
          stage: {
            notIn: [
              OrganizationClosureExecutionStage.COMPLETED,
              OrganizationClosureExecutionStage.FAILED,
            ],
          },
        },
        data: {
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          lastFailure: null,
          nextRetryAt: now,
          revision: { increment: 1 },
        },
      });
    if (updated.count !== 1) {
      throw new Error('Terminal organization closure cannot be recovered');
    }
    this.logger.log({
      event: 'organization_closure_recovered',
      organizationId,
    });
  }

  async releaseClaim(
    execution: OrganizationClosureExecution,
    error: unknown,
    now = new Date(),
  ): Promise<void> {
    const retryAt = new Date(
      now.getTime() +
        Math.min(
          60_000 * 2 ** Math.max(execution.attemptCount - 1, 0),
          MAX_RETRY_DELAY_MS,
        ),
    );
    const failure = error instanceof Error ? error.message : String(error);
    const updated =
      await this.prisma.db.organizationClosureExecution.updateMany({
        where: {
          organizationId: execution.organizationId,
          claimToken: execution.claimToken,
          attemptId: execution.attemptId,
        },
        data: {
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          nextRetryAt: retryAt,
          lastFailure: failure.slice(0, MAX_FAILURE_LENGTH),
          revision: { increment: 1 },
        },
      });
    if (updated.count !== 1) {
      throw new Error('Organization closure claim was lost while releasing');
    }
    this.logger.warn({
      event: 'organization_closure_retry_scheduled',
      organizationId: execution.organizationId,
      attemptCount: execution.attemptCount,
      nextRetryAt: retryAt.toISOString(),
      failure: failure.slice(0, MAX_FAILURE_LENGTH),
    });
  }

  async failClaim(
    execution: OrganizationClosureExecution,
    error: unknown,
    now = new Date(),
  ): Promise<void> {
    const failure = error instanceof Error ? error.message : String(error);
    const updated =
      await this.prisma.db.organizationClosureExecution.updateMany({
        where: {
          organizationId: execution.organizationId,
          claimToken: execution.claimToken,
          attemptId: execution.attemptId,
        },
        data: {
          stage: OrganizationClosureExecutionStage.FAILED,
          failedAt: now,
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          nextRetryAt: null,
          lastFailure: failure.slice(0, MAX_FAILURE_LENGTH),
          revision: { increment: 1 },
        },
      });
    if (updated.count !== 1) {
      throw new Error('Organization closure claim was lost while failing');
    }
    this.logger.error({
      event: 'organization_closure_terminal_failure',
      organizationId: execution.organizationId,
      attemptCount: execution.attemptCount,
      failedAt: now.toISOString(),
      failure: failure.slice(0, MAX_FAILURE_LENGTH),
    });
  }
}
