import { Inject, Injectable } from '@nestjs/common';
import { AgentEdgeType } from '../../generated/graphs';
import { OrganizationId, ProjectId } from '../../types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../proposal/pending-edge.service';

/** Seed provenance is independent of document ownership (often a Feature). */
@Injectable()
export class PlanDesignDocLinksService {
  constructor(
    private readonly edges: AgentEdgeClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  async resolve(
    organizationId: OrganizationId,
    projectId: ProjectId,
    planId: string,
  ): Promise<string[]> {
    const edges = await this.edges.findIncident(
      organizationId,
      projectId,
      {
        nodeIds: new Set([planId]),
        types: new Set([AgentEdgeType.DerivesFrom]),
      },
      this.tokenFactory(organizationId, projectId),
    );
    const documents = edges.filter(
      (edge) =>
        edge.sourceNodeId === planId &&
        edge.sourceEntityType === 'TASK' &&
        edge.targetEntityType === 'DESIGN_DOC',
    );
    return [
      ...new Set(
        documents
          .filter((edge) => edge.type === 'DERIVES_FROM')
          .map((edge) => edge.targetNodeId),
      ),
    ];
  }
}
