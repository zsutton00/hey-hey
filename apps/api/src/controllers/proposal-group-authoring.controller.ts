import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AddProposalGroupMemberRequest,
  FinalizeProposalGroupRequest,
  ProposalGroupAuthoringSnapshot,
  ProposalGroupFinalizationResult,
  RemoveProposalGroupMemberRequest,
  ReplaceProposalGroupPrerequisitesRequest,
  StartProposalGroupRequest,
  UpdateProposalGroupMemberRequest,
} from 'src/generated';
import type { OrganizationId, ProjectId } from 'src/types';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ProposalGroupAuthoringService } from '../services/proposal/proposal-group-authoring.service';
import { ProposalGroupFinalizationService } from '../services/proposal/proposal-group-finalization.service';
import { buildUserRequestorContext } from '../services/proposal/user-requestor-context';
import type { StampedCreateProposalDto } from '../services/proposal/proposal.types';

@ApiTags('Proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/proposal-groups',
)
export class ProposalGroupAuthoringController {
  constructor(
    private readonly authoringService: ProposalGroupAuthoringService,
    private readonly finalizationService: ProposalGroupFinalizationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Start proposal-group authoring' })
  async start(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body() dto: StartProposalGroupRequest = {},
  ): Promise<ProposalGroupAuthoringSnapshot> {
    return this.authoringService.start(organizationId, projectId, dto);
  }

  @Post(':groupId/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add a proposal-group member' })
  @ApiParam({ name: 'groupId', description: 'Proposal group ID' })
  async addMember(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: AddProposalGroupMemberRequest,
    @Req() request: Request,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    return this.authoringService.addMember(
      organizationId,
      projectId,
      groupId,
      user.userId,
      {
        ...dto,
        proposal: this.stampProposal(
          dto.proposal,
          user,
          organizationId,
          request,
          'POST /proposal-groups/:groupId/members',
        ),
      },
    );
  }

  @Put(':groupId/members/:memberId')
  @ApiOperation({ summary: 'Replace a proposal-group member draft' })
  async updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateProposalGroupMemberRequest,
    @Req() request: Request,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    return this.authoringService.updateMember(
      organizationId,
      projectId,
      groupId,
      memberId,
      user.userId,
      {
        ...dto,
        proposal: this.stampProposal(
          dto.proposal,
          user,
          organizationId,
          request,
          'PUT /proposal-groups/:groupId/members/:memberId',
        ),
      },
    );
  }

  @Delete(':groupId/members/:memberId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a proposal-group member' })
  async removeMember(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: RemoveProposalGroupMemberRequest,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    return this.authoringService.removeMember(
      organizationId,
      projectId,
      groupId,
      memberId,
      dto,
    );
  }

  @Put(':groupId/members/:memberId/prerequisites')
  @ApiOperation({
    summary: "Replace a proposal-group member's prerequisites",
  })
  async replacePrerequisites(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: ReplaceProposalGroupPrerequisitesRequest,
  ): Promise<ProposalGroupAuthoringSnapshot> {
    return this.authoringService.replacePrerequisites(
      organizationId,
      projectId,
      groupId,
      memberId,
      dto,
    );
  }

  @Post(':groupId/finalize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate and atomically finalize a proposal group',
  })
  async finalize(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: FinalizeProposalGroupRequest,
  ): Promise<ProposalGroupFinalizationResult> {
    return this.finalizationService.finalize(
      organizationId,
      projectId,
      groupId,
      user,
      dto,
    );
  }

  private stampProposal(
    proposal: AddProposalGroupMemberRequest['proposal'],
    user: AuthenticatedUser,
    organizationId: OrganizationId,
    request: Request,
    route: string,
  ): StampedCreateProposalDto {
    return {
      ...proposal,
      requestorContext: buildUserRequestorContext(
        user,
        organizationId,
        request,
        route,
      ),
    };
  }
}
