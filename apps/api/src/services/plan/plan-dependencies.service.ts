import { Inject, Injectable } from '@nestjs/common';
import {
  AgentEdgeType,
  AgentEdgeEndpointEntityType,
} from '../../generated/graphs';
import { OrganizationId, ProjectId } from '../../types';
import { AgentEdgeClientService } from '../agent-edge-client.service';
import {
  SERVICE_TOKEN_FACTORY,
  type ServiceTokenFactory,
} from '../service-token-factory';

/** Graph direction: the source depends on the target prerequisite. */
@Injectable()
export class PlanDependenciesService {
  constructor(
    private readonly edges: AgentEdgeClientService,
    @Inject(SERVICE_TOKEN_FACTORY)
    private readonly tokenFactory: ServiceTokenFactory,
  ) {}

  async outgoing(
    organizationId: string,
    projectId: string,
    sourceIds: string[],
  ) {
    if (sourceIds.length === 0) return [];
    const sources = new Set(sourceIds);
    const edges = await this.edges.findIncident(
      organizationId as OrganizationId,
      projectId as ProjectId,
      { nodeIds: sources, types: new Set([AgentEdgeType.DependsOn]) },
      this.tokenFactory(
        organizationId as OrganizationId,
        projectId as ProjectId,
      ),
    );
    return edges.filter(
      (edge) =>
        edge.type === AgentEdgeType.DependsOn &&
        edge.sourceEntityType === AgentEdgeEndpointEntityType.Task &&
        edge.targetEntityType === AgentEdgeEndpointEntityType.Task &&
        sources.has(edge.sourceNodeId),
    );
  }
}
