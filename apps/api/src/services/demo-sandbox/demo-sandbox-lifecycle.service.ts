import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DemoSandboxStatus, Prisma } from '@prisma/client';
import { BrowserSessionService } from '../../auth/services/browser-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { BrowserSessionId, OrganizationId, UserId } from '../../types';
import {
  MachinePairingService,
  type RevokedMachineReduction,
} from '../machine-pairing/machine-pairing.service';
import { OrganizationAccountDataDeletionService } from '../organization-account-data-deletion.service';
import { OrganizationAccountLifecycleService } from '../organization-account-lifecycle.service';

const DELETION_BATCH_SIZE = 20;
const EXPIRY_ACTOR = 'demo-sandbox-expiry';
const EXPIRY_REASON = 'Demo sandbox expired after inactivity';

interface AccessRevocation {
  organizationId: OrganizationId;
  userId: UserId | null;
  machines: RevokedMachineReduction[];
  revokedSessionIds: BrowserSessionId[];
}

/**
 * Tears a sandbox down once its inactivity timeout passes (activity itself is
 * recorded by DemoSandboxActivityService on the authentication paths): sandbox -> EXPIRING (hidden from resume and
 * provisioning) -> access revoked and organization irreversibly closed ->
 * projection-first final deletion -> demo user removed and row DELETED.
 *
 * Each stage selects only the rows it can act on, so a sandbox whose deletion
 * failed or is waiting on projections can never occupy a slot another
 * sandbox needs. Closing the organization writes its closure execution in the
 * same transaction as the revocation, so that execution marks access as
 * revoked and survives the organization's own deletion.
 */
@Injectable()
export class DemoSandboxLifecycleService {
  private readonly logger = new Logger(DemoSandboxLifecycleService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly browserSessions: BrowserSessionService,
    private readonly machines: MachinePairingService,
    private readonly lifecycle: OrganizationAccountLifecycleService,
    private readonly deletion: OrganizationAccountDataDeletionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.claimExpired(new Date());
      await this.revokePendingAccess();
      await this.startDueDeletions();
      await this.finishCompletedDeletions();
      await this.reportFailedDeletions();
    } finally {
      this.sweeping = false;
    }
  }

  /** Row-level claim: resume and provisioning only ever match ACTIVE rows. */
  private async claimExpired(now: Date): Promise<void> {
    const claimed = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE demo_sandboxes
      SET status = 'EXPIRING'::demo_sandbox_status
      WHERE id IN (
        SELECT id FROM demo_sandboxes
        WHERE status = 'ACTIVE'::demo_sandbox_status AND expires_at <= ${now}
        ORDER BY expires_at
        FOR UPDATE SKIP LOCKED
      )
    `);
    if (claimed > 0) {
      this.logger.log('Demo sandboxes claimed for expiry', { claimed });
    }
  }

  /**
   * Every expiring sandbox without a closure execution still has live
   * access. Unbounded on purpose: a row leaves this set when its revocation
   * commits, and a failing row must not delay another's revocation.
   */
  private async revokePendingAccess(): Promise<void> {
    const pending = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT sandbox.id
        FROM demo_sandboxes sandbox
        WHERE sandbox.status = 'EXPIRING'::demo_sandbox_status
          AND NOT EXISTS (
            SELECT 1 FROM organization_closure_executions execution
            WHERE execution.organization_id = sandbox.organization_id
          )
        ORDER BY sandbox.expires_at
      `,
    );
    for (const { id } of pending) {
      await this.runStep('access revocation', id, async () => {
        const revoked = await this.revokeAccessAndClose(id);
        if (!revoked) return;
        this.browserSessions.invalidateRevokedSessions(
          revoked.revokedSessionIds,
        );
        if (revoked.userId) {
          await this.machines.deliverRevocationReductions(
            revoked.userId,
            revoked.machines,
          );
        }
      });
    }
  }

  /**
   * Only closed sandboxes whose deletion has not started and is due. Once
   * started, later stages are resumed by the projection coordinator and a
   * FAILED execution is final, so neither may take a batch slot.
   */
  private async startDueDeletions(): Promise<void> {
    const due = await this.prisma.$queryRaw<
      Array<{ id: string; organizationId: string }>
    >(Prisma.sql`
      SELECT sandbox.id, sandbox.organization_id AS "organizationId"
      FROM demo_sandboxes sandbox
      JOIN organization_closure_executions execution
        ON execution.organization_id = sandbox.organization_id
      WHERE sandbox.status = 'EXPIRING'::demo_sandbox_status
        AND execution.stage = 'PENDING'::organization_closure_execution_stage
        AND (execution.next_retry_at IS NULL OR execution.next_retry_at <= now())
        AND (execution.lease_expires_at IS NULL OR execution.lease_expires_at <= now())
      ORDER BY sandbox.expires_at
      LIMIT ${DELETION_BATCH_SIZE}
    `);
    for (const { id, organizationId } of due) {
      await this.runStep('final deletion', id, () =>
        this.deletion.executeForOrganization(organizationId as OrganizationId),
      );
    }
  }

  /**
   * One transaction under the row lock: browser sessions, then machine
   * authority, then irreversible closure. Returns null when another instance
   * already moved the row on.
   */
  private async revokeAccessAndClose(
    sandboxId: string,
  ): Promise<AccessRevocation | null> {
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<
        Array<{
          status: DemoSandboxStatus;
          organizationId: string;
          demoUserId: string | null;
        }>
      >(Prisma.sql`
        SELECT status, organization_id AS "organizationId", demo_user_id AS "demoUserId"
        FROM demo_sandboxes WHERE id = ${sandboxId} FOR UPDATE
      `);
      if (!row || row.status !== DemoSandboxStatus.EXPIRING) return null;

      const organizationId = row.organizationId as OrganizationId;
      const userId = row.demoUserId as UserId | null;
      const revokedAt = new Date();
      let machines: RevokedMachineReduction[] = [];
      let revokedSessionIds: BrowserSessionId[] = [];
      if (userId) {
        const sessions =
          await this.browserSessions.revokeAllForUserInTransaction(
            tx,
            userId,
            revokedAt,
            EXPIRY_REASON,
          );
        revokedSessionIds = sessions.revokedSessionIds;
        machines = await this.machines.revokeAllForUserInTransaction(
          tx,
          userId,
          revokedAt,
        );
      }
      await this.lifecycle.closeImmediatelyForSystemOrganization(
        tx,
        organizationId,
        EXPIRY_ACTOR,
        EXPIRY_REASON,
      );
      this.logger.log('Demo sandbox access revoked and organization closed', {
        sandboxId,
        organizationId,
        sessionsRevoked: revokedSessionIds.length,
        machinesRevoked: machines.length,
      });
      return { organizationId, userId, machines, revokedSessionIds };
    });
  }

  /**
   * Once final deletion COMPLETED, removes the demo user and keeps only the
   * binding hash and status (plus the creator hash that the per-address limit
   * counts). Unbounded: a row leaves this set once finished.
   */
  private async finishCompletedDeletions(): Promise<void> {
    const completed = await this.prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`
        SELECT sandbox.id
        FROM demo_sandboxes sandbox
        JOIN organization_closure_executions execution
          ON execution.organization_id = sandbox.organization_id
        WHERE sandbox.status = 'EXPIRING'::demo_sandbox_status
          AND execution.stage = 'COMPLETED'::organization_closure_execution_stage
        ORDER BY sandbox.expires_at
      `,
    );
    for (const { id } of completed) {
      await this.runStep('completion', id, () => this.finish(id));
    }
  }

  private async finish(sandboxId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const sandbox = await tx.demoSandbox.findUnique({
        where: { id: sandboxId },
        select: { demoUserId: true },
      });
      if (sandbox?.demoUserId) {
        await tx.user.deleteMany({ where: { id: sandbox.demoUserId } });
      }
      await tx.demoSandbox.updateMany({
        where: { id: sandboxId, status: DemoSandboxStatus.EXPIRING },
        data: { status: DemoSandboxStatus.DELETED, demoUserId: null },
      });
    });
    this.logger.log('Demo sandbox deleted', { sandboxId });
  }

  /**
   * A FAILED closure execution is final, so its sandbox stays EXPIRING and
   * inaccessible. Logged on every sweep so it stays visible to an operator.
   */
  private async reportFailedDeletions(): Promise<void> {
    const failed = await this.prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        failedAt: Date | null;
        lastFailure: string | null;
      }>
    >(Prisma.sql`
      SELECT sandbox.id,
             sandbox.organization_id AS "organizationId",
             execution.failed_at AS "failedAt",
             execution.last_failure AS "lastFailure"
      FROM demo_sandboxes sandbox
      JOIN organization_closure_executions execution
        ON execution.organization_id = sandbox.organization_id
      WHERE sandbox.status = 'EXPIRING'::demo_sandbox_status
        AND execution.stage = 'FAILED'::organization_closure_execution_stage
      ORDER BY sandbox.expires_at
    `);
    if (failed.length === 0) return;
    this.logger.error('Demo sandboxes stuck after failed final deletion', {
      stuck: failed.length,
      sandboxes: failed,
    });
  }

  private async runStep(
    step: string,
    sandboxId: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error('Demo sandbox expiry step failed; will retry', {
        step,
        sandboxId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
