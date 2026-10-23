import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type {
  ProposalGroupAuthoringSnapshot,
  ProposalGroupApproveAllResult,
  ProposalGroupSnapshot,
} from 'src/generated';
import { OrganizationId, ProjectId } from 'src/types';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ProposalGroupService } from '../services/proposal/proposal-group.service';
import { ProposalGroupDecisionService } from '../services/proposal/proposal-group-decision.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

@ApiTags('Proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@ProjectResourceId('proposalGroup')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/proposal-groups',
)
export class ProposalGroupController {
  constructor(
    private readonly proposalGroupService: ProposalGroupService,
    private readonly decisionService: ProposalGroupDecisionService,
  ) {}

  @Post(':groupId/approve-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Attempt approval for every frozen group member' })
  async approveAll(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<ProposalGroupApproveAllResult> {
    return this.decisionService.approveAll({
      organizationId,
      projectId,
      groupId,
      userId: user.userId,
    });
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Get a canonical proposal group' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'groupId', description: 'Proposal group ID' })
  async findOne(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<ProposalGroupAuthoringSnapshot | ProposalGroupSnapshot> {
    return this.proposalGroupService.findCanonical(
      organizationId,
      projectId,
      groupId,
    );
  }
}
