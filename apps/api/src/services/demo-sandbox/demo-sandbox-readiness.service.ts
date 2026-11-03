import { Inject, Injectable, Logger } from '@nestjs/common';
import { DemoSandboxStatus } from '@prisma/client';
import { GraphsClientService } from '../graphs-client.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../service-token-factory';
import type { OrganizationId, ProjectId } from '../../types';
import { errorToLoggable } from '../../utils/logging.util';
import { READINESS_POLL_INTERVAL_MILLISECONDS } from './demo-sandbox.constants';
import type { WorkItemProjectReadinessRequest } from '../../generated/graphs';
import {
  readReadinessWorkItems,
  type CopiedWorkItemExpectation,
} from './template-graph-copy-intent';

const WORK_ITEM_READINESS_BATCH_SIZE = 500;

/** The persisted readiness inputs of one prepared attempt. */
interface ReadinessAttempt {
  organizationId: string;
  projectId: string;
  readinessFeatureIds: string[];
  readinessWorkItems: CopiedWorkItemExpectation[];
  provisioningDeadline: Date;
}

/** Waits for copied features and every captured work item to be ready in Graph. */
@Injectable()
export class DemoSandboxReadinessService {
  private readonly logger = new Logger(DemoSandboxReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphs: GraphsClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  private async connectedFeatureCount(
    attempt: ReadinessAttempt,
  ): Promise<number> {
    const organizationId = attempt.organizationId as OrganizationId;
    const projectId = attempt.projectId as ProjectId;
    const result = await this.graphs.checkFeatureProjectConnection(
      organizationId,
      projectId,
      { featureIds: attempt.readinessFeatureIds },
      this.tokenFactory(organizationId, projectId),
    );
    return result.connectedCount;
  }

  private async verifiedWorkItemCount(
    attempt: ReadinessAttempt,
  ): Promise<number> {
    const organizationId = attempt.organizationId as OrganizationId;
    const projectId = attempt.projectId as ProjectId;
    const token = this.tokenFactory(organizationId, projectId);
    let verifiedCount = 0;

    for (
      let offset = 0;
      offset < attempt.readinessWorkItems.length;
      offset += WORK_ITEM_READINESS_BATCH_SIZE
    ) {
      if (attempt.provisioningDeadline.getTime() - Date.now() <= 0) {
        return verifiedCount;
      }
      const batch = attempt.readinessWorkItems.slice(
        offset,
        offset + WORK_ITEM_READINESS_BATCH_SIZE,
      );
      const request = {
        workItems: batch.map((item) => ({
          id: item.id,
          typeKey: item.typeKey,
          parentTaskId: item.parentTaskId ?? '',
        })),
      } satisfies WorkItemProjectReadinessRequest;
      const result = await this.graphs.checkWorkItemProjectReadiness(
        organizationId,
        projectId,
        request,
        token,
      );
      verifiedCount += result.verifiedCount;
    }

    return verifiedCount;
  }

  private hasMatchingFeatureSet(attempt: ReadinessAttempt): boolean {
    const capturedFeatureIds = attempt.readinessWorkItems
      .filter((item) => item.typeKey === 'FEATURE')
      .map((item) => item.id)
      .sort();
    const persistedFeatureIds = [...attempt.readinessFeatureIds].sort();

    return (
      capturedFeatureIds.length === persistedFeatureIds.length &&
      capturedFeatureIds.every(
        (featureId, index) => featureId === persistedFeatureIds[index],
      )
    );
  }

  /**
   * Polls once per second until every persisted feature and captured work item
   * is ready or the persisted deadline passes. The expected set comes from the
   * durable graph-copy intent written atomically with the clone.
   */
  async waitUntilConnected(sandboxId: string): Promise<boolean> {
    const row = await this.prisma.db.demoSandbox.findUnique({
      where: { id: sandboxId },
      select: {
        organizationId: true,
        projectId: true,
        readinessFeatureIds: true,
        provisioningDeadline: true,
      },
    });
    if (!row?.organizationId || !row.projectId) return false;
    const intent = await this.prisma.db.demoGraphCopyIntent.findUnique({
      where: { projectId: row.projectId },
      select: { command: true },
    });
    if (!intent) return false;
    const readinessWorkItems = readReadinessWorkItems(intent.command);
    const attempt: ReadinessAttempt = {
      organizationId: row.organizationId,
      projectId: row.projectId,
      readinessFeatureIds: row.readinessFeatureIds,
      readinessWorkItems,
      provisioningDeadline: row.provisioningDeadline,
    };
    if (!this.hasMatchingFeatureSet(attempt)) return false;

    const total = attempt.readinessFeatureIds.length;
    const verificationStartedAt = Date.now();
    let recorded = 0;
    let verifiedWorkItemCount = 0;
    for (;;) {
      if (attempt.provisioningDeadline.getTime() - Date.now() <= 0) {
        this.logger.warn('Demo sandbox graph readiness deadline expired', {
          expectedFeatureCount: total,
          connectedFeatureCount: recorded,
          expectedWorkItemCount: attempt.readinessWorkItems.length,
          verifiedWorkItemCount,
          verificationDurationMilliseconds: Date.now() - verificationStartedAt,
        });
        return false;
      }
      try {
        const [connected, verified] = await Promise.all([
          this.connectedFeatureCount(attempt),
          this.verifiedWorkItemCount(attempt),
        ]);
        verifiedWorkItemCount = verified;
        if (attempt.provisioningDeadline.getTime() - Date.now() <= 0) {
          this.logger.warn('Demo sandbox graph readiness deadline expired', {
            expectedFeatureCount: total,
            connectedFeatureCount: connected,
            expectedWorkItemCount: attempt.readinessWorkItems.length,
            verifiedWorkItemCount,
            verificationDurationMilliseconds:
              Date.now() - verificationStartedAt,
          });
          return false;
        }
        if (connected !== recorded) {
          recorded = connected;
          await this.prisma.db.demoSandbox.updateMany({
            where: { id: sandboxId, status: DemoSandboxStatus.PROVISIONING },
            data: { connectedFeatureCount: connected },
          });
        }
        if (
          connected === total &&
          verifiedWorkItemCount === attempt.readinessWorkItems.length
        ) {
          this.logger.log('Demo sandbox graph readiness verified', {
            expectedFeatureCount: total,
            connectedFeatureCount: connected,
            expectedWorkItemCount: attempt.readinessWorkItems.length,
            verifiedWorkItemCount,
            verificationDurationMilliseconds:
              Date.now() - verificationStartedAt,
          });
          return true;
        }
      } catch (error) {
        this.logger.warn('Demo sandbox readiness check unavailable', {
          projectId: attempt.projectId,
          error: errorToLoggable(error),
        });
      }
      const untilDeadline = attempt.provisioningDeadline.getTime() - Date.now();
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(
            READINESS_POLL_INTERVAL_MILLISECONDS,
            Math.max(untilDeadline, 0),
          ),
        ),
      );
    }
  }
}
