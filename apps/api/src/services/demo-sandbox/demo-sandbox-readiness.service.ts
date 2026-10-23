import { Inject, Injectable, Logger } from '@nestjs/common';
import { GraphsClientService } from '../graphs-client.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../service-token-factory';
import type { OrganizationId, ProjectId } from '../../types';
import { errorToLoggable } from '../../utils/logging.util';
import { READINESS_POLL_INTERVAL_MILLISECONDS } from './demo-sandbox.constants';

// The relationship direction is feature to project, as emitted by Graph's
// TaskRelationshipMapper. A returned row is the complete readiness predicate.
export const READINESS_QUERY =
  'MATCH (f {id: $featureId})-[r:SCOPED_TO_PROJECT]->(p:Project {id: $projectId}) ' +
  'WHERE f.organizationId = $organizationId AND p.organizationId = $organizationId ' +
  'RETURN f, r, p LIMIT 1';

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
    const result = await this.graphs.executeQuery(
      organizationId,
      projectId,
      {
        query: READINESS_QUERY,
        parameters: {
          featureId: attempt.readinessFeatureId,
          projectId,
          organizationId,
        },
      },
      this.tokenFactory(organizationId, projectId),
    );
    return (
      (result.nodes?.length ?? 0) > 0 || (result.relationships?.length ?? 0) > 0
    );
  }

  /** Polls once per second until the sample matches or the persisted deadline passes. */
  async waitUntilConnected(attempt: ReadinessAttempt): Promise<boolean> {
    for (;;) {
      const remaining = attempt.provisioningDeadline.getTime() - Date.now();
      if (remaining <= 0) return false;
      try {
        if (await this.isConnected(attempt)) return true;
      } catch (error) {
        this.logger.warn('Demo sandbox readiness query unavailable', {
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
