import { Inject, Injectable, Logger } from '@nestjs/common';
import { GraphsClientService } from '../graphs-client.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../service-token-factory';
import type { OrganizationId, ProjectId } from '../../types';
import { errorToLoggable } from '../../utils/logging.util';
import { READINESS_POLL_INTERVAL_MILLISECONDS } from './demo-sandbox.constants';

export interface ReadinessAttempt {
  organizationId: string;
  projectId: string;
  readinessFeatureId: string;
  provisioningDeadline: Date;
}

/** Waits for one sampled copied feature to be connected to its project in Graph. */
@Injectable()
export class DemoSandboxReadinessService {
  private readonly logger = new Logger(DemoSandboxReadinessService.name);

  constructor(
    private readonly graphs: GraphsClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  async isConnected(attempt: ReadinessAttempt): Promise<boolean> {
    const organizationId = attempt.organizationId as OrganizationId;
    const projectId = attempt.projectId as ProjectId;
    const result = await this.graphs.checkFeatureProjectConnection(
      organizationId,
      projectId,
      {
        featureId: attempt.readinessFeatureId,
      },
      this.tokenFactory(organizationId, projectId),
    );
    return result.connected;
  }

  /** Polls once per second until the sample matches or the persisted deadline passes. */
  async waitUntilConnected(attempt: ReadinessAttempt): Promise<boolean> {
    for (;;) {
      const remaining = attempt.provisioningDeadline.getTime() - Date.now();
      if (remaining <= 0) return false;
      try {
        if (await this.isConnected(attempt)) return true;
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
