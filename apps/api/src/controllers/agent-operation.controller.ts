import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AgentOperationSnapshot } from '../generated';
import { AgentOperationRegistryService } from '../services/agent-operation/agent-operation-registry.service';
import { OrganizationId, ProjectId, UserId } from '../types';

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-operations',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class AgentOperationController {
  constructor(private readonly operations: AgentOperationRegistryService) {}

  @Get(':operationId')
  getAgentOperation(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('projectId') projectId: ProjectId,
    @Param('operationId') operationId: string,
  ): Promise<AgentOperationSnapshot> {
    return this.operations.getSnapshot({
      operationId,
      organizationId,
      projectId,
      userId,
    });
  }
}
