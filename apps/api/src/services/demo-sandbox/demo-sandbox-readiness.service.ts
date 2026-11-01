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

/** The persisted readiness inputs of one prepared attempt. */
interface ReadinessAttempt {
  organizationId: string;
  projectId: string;
  readinessFeatureIds: string[];
  provisioningDeadline: Date;
}

/** Waits for every copied feature to be connected to its project in Graph. */
@Injectable()
export class DemoSandboxReadinessService {
  private readonly logger = new Logger(DemoSandboxReadinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly graphs: GraphsClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  private async connectedCount(attempt: ReadinessAttempt): Promise<number> {
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

  /**
   * Polls once per second until every persisted feature is connected or the
   * persisted deadline passes, recording the connected count for resume. The
   * feature IDs and deadline are read from the row, so a fresh instance never
   * recomputes or extends them.
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
    const attempt: ReadinessAttempt = {
      organizationId: row.organizationId,
      projectId: row.projectId,
      readinessFeatureIds: row.readinessFeatureIds,
      provisioningDeadline: row.provisioningDeadline,
    };
    const total = attempt.readinessFeatureIds.length;
    let recorded = 0;
    for (;;) {
      if (attempt.provisioningDeadline.getTime() - Date.now() <= 0) {
        return false;
      }
      try {
        const connected = await this.connectedCount(attempt);
        if (connected !== recorded) {
          recorded = connected;
          await this.prisma.db.demoSandbox.updateMany({
            where: { id: sandboxId, status: DemoSandboxStatus.PROVISIONING },
            data: { connectedFeatureCount: connected },
          });
        }
        if (connected >= total) return true;
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
