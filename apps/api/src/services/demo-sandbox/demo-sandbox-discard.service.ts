import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DemoSandboxStage,
  DemoSandboxStatus,
  OrganizationClosureExecutionStage,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId } from '../../types';
import { OrganizationAccountLifecycleService } from '../organization-account-lifecycle.service';

const DISCARD_ACTOR = 'demo-sandbox-discard';
const DISCARD_REASON = 'Demo sandbox provisioning failed';

/**
 * What a discarded attempt leaves behind: no tenancy, only the binding hash and
 * the FAILED stage, so the browser can still learn that its setup failed.
 */
const FAILED_TOMBSTONE = {
  status: DemoSandboxStatus.DELETED,
  stage: DemoSandboxStage.FAILED,
  organizationId: null,
  projectId: null,
  demoUserId: null,
  readinessFeatureIds: [],
  connectedFeatureCount: 0,
} satisfies Prisma.DemoSandboxUncheckedUpdateInput;

/**
 * Discards an attempt that never became accessible. Closure is irreversible
 * and committed before any deletion starts; the existing projection-first
 * deletion pipeline then removes Graph and search projections and, only after
 * both acknowledge, the authoritative rows. The sandbox row itself ends as a
 * FAILED tombstone rather than being deleted.
 */
@Injectable()
export class DemoSandboxDiscardService {
  private readonly logger = new Logger(DemoSandboxDiscardService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrganizationAccountLifecycleService,
  ) {}

  /**
   * Serialized against activation and preparation by the sandbox row lock.
   * Returns false when the attempt already left PROVISIONING (activation or
   * another discard won).
   */
  async discard(sandboxId: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          status: DemoSandboxStatus;
          organizationId: string | null;
          projectId: string | null;
        }>
      >(Prisma.sql`
        SELECT status, organization_id AS "organizationId", project_id AS "projectId"
        FROM demo_sandboxes WHERE id = ${sandboxId} FOR UPDATE
      `);
      const sandbox = rows[0];
      if (!sandbox || sandbox.status !== DemoSandboxStatus.PROVISIONING) {
        return false;
      }
      if (!sandbox.organizationId || !sandbox.projectId) {
        // Preparation never committed, so there is nothing to delete; leaving
        // PROVISIONING releases its slot and makes a late preparation fail.
        await tx.demoSandbox.update({
          where: { id: sandboxId },
          data: FAILED_TOMBSTONE,
        });
        return true;
      }
      await tx.demoSandbox.update({
        where: { id: sandboxId },
        data: {
          status: DemoSandboxStatus.DISCARDING,
          stage: DemoSandboxStage.FAILED,
        },
      });
      // Stops any further clone dispatch for this project.
      await tx.demoGraphCopyIntent.deleteMany({
        where: { projectId: sandbox.projectId },
      });
      await this.lifecycle.closeImmediatelyForSystemOrganization(
        tx,
        sandbox.organizationId as OrganizationId,
        DISCARD_ACTOR,
        DISCARD_REASON,
      );
      return true;
    });
  }

  /**
   * Recovers after a restart without extending any deadline, and completes
   * cleanup once final organization deletion has finished.
   */
  @Interval(30_000)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.discardExpiredAttempts();
      await this.removeFinishedDiscards();
    } finally {
      this.sweeping = false;
    }
  }

  private async discardExpiredAttempts(): Promise<void> {
    const expired = await this.prisma.demoSandbox.findMany({
      where: {
        status: DemoSandboxStatus.PROVISIONING,
        provisioningDeadline: { lte: new Date() },
      },
      select: { id: true },
      take: 20,
    });
    for (const { id } of expired) {
      try {
        await this.discard(id);
      } catch (error) {
        this.logger.error('Demo sandbox discard failed; will retry', {
          sandboxId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async removeFinishedDiscards(): Promise<void> {
    // Select only sandboxes whose final organization deletion has completed, so
    // ones still waiting on deletion cannot occupy the batch and starve the rest.
    const discarding = await this.prisma.demoSandbox.findMany({
      where: {
        status: DemoSandboxStatus.DISCARDING,
        organizationId: { not: null },
      },
      select: { id: true, organizationId: true, demoUserId: true },
    });
    if (discarding.length === 0) return;
    const completed = await this.prisma.organizationClosureExecution.findMany({
      where: {
        organizationId: { in: discarding.map((s) => s.organizationId!) },
        stage: OrganizationClosureExecutionStage.COMPLETED,
      },
      select: { organizationId: true },
    });
    const completedOrganizations = new Set(
      completed.map((execution) => execution.organizationId),
    );
    for (const sandbox of discarding) {
      if (!completedOrganizations.has(sandbox.organizationId!)) continue;
      try {
        // Both projection acknowledgements preceded content deletion. Sessions
        // go with the user row; the sandbox row stays as the FAILED tombstone.
        // The *Many forms keep a concurrent instance's identical cleanup from
        // failing.
        await this.prisma.$transaction(async (tx) => {
          if (sandbox.demoUserId) {
            await tx.user.deleteMany({ where: { id: sandbox.demoUserId } });
          }
          await tx.demoSandbox.updateMany({
            where: { id: sandbox.id, status: DemoSandboxStatus.DISCARDING },
            data: FAILED_TOMBSTONE,
          });
        });
      } catch (error) {
        this.logger.error('Demo sandbox cleanup failed; will retry', {
          sandboxId: sandbox.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
