import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ProposalApprovalService,
  type RejectionResult,
} from '../services/proposal/proposal-approval.service';
import type { ProposalValidationResult } from '../services/proposal/proposal-validation.types';
import {
  CreateProposalRequestDto,
  PaginatedProposalsDto,
  QueryProposalsDto,
  ProposalAction,
  RejectProposalDto,
  resolveProposalWindow,
  UpdateProposalDto,
} from '../services/proposal/proposal.dto';
import { ProposalService } from '../services/proposal/proposal.service';
import { parseFutureApplyRequest } from '../services/proposal/future-application';
import type {
  ProjectedWorkItemChangeSetResponse,
  WorkItemChangeSetValidationRequest,
} from '../generated';
import { WorkItemTypeRole } from '../generated';
import type {
  StampedCreateProposalDto,
  TypedProposalResponse,
} from '../services/proposal/proposal.types';
import { buildUserRequestorContext } from '../services/proposal/user-requestor-context';
import { ProposalReconciliationCandidatePipe } from '../pipes/proposal-reconciliation-candidate.pipe';
import type {
  CreateProposalReconciliationCandidate,
  ProposalAgentFixRequest,
  ProposalReconciliationState,
} from '../generated';
import { ProposalAgentFixService } from '../services/proposal/proposal-agent-fix.service';

@ApiTags('Proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@ProjectResourceId('proposal')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/proposals',
)
export class ProposalController {
  constructor(
    private readonly proposalService: ProposalService,
    private readonly approvalService: ProposalApprovalService,
    private readonly agentFix: ProposalAgentFixService,
  ) {}

  /** Records an Agent fix request; the app starts it. Never dispatches a run. */
  @Post(':id/reconciliation/agent-fix-request')
  @HttpCode(HttpStatus.OK)
  async createAgentFixRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
  ): Promise<ProposalAgentFixRequest> {
    return this.agentFix.record(
      organizationId,
      projectId,
      user.userId as UserId,
      id,
    );
  }

  @Get(':id/reconciliation')
  async reconciliation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
  ): Promise<ProposalReconciliationState> {
    return this.proposalService.reconciliationReviewState(
      id,
      organizationId,
      projectId,
    );
  }

  @Post(':id/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body(ProposalReconciliationCandidatePipe)
    dto: CreateProposalReconciliationCandidate,
    @Req() request: Request,
  ): Promise<ProposalReconciliationState> {
    return this.proposalService.reconcile(
      id,
      organizationId,
      projectId,
      user,
      dto,
      buildUserRequestorContext(
        user,
        organizationId,
        request,
        'POST /proposals/:id/reconciliation',
      ),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a proposal' })
  @ApiResponse({ status: 201, description: 'Proposal created' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body(ValidationPipe) dto: CreateProposalRequestDto,
    @Req() request: Request,
  ): Promise<TypedProposalResponse> {
    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'POST /proposals',
    );

    const stampedDto: StampedCreateProposalDto = {
      ...dto,
      requestorContext,
    };

    return this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      stampedDto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List proposals' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({ name: 'type', required: false, enum: ['SINGLE', 'BATCH'] })
  @ApiQuery({
    name: 'action',
    required: false,
    enum: ProposalAction,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['DRAFT', 'APPROVED', 'REJECTED'],
  })
  @ApiQuery({
    name: 'targetEntityType',
    required: false,
    enum: ['TASK', 'DESIGN_DOC'],
  })
  @ApiQuery({
    name: 'workItemRole',
    required: false,
    enum: WorkItemTypeRole,
    description:
      'Registry-owned role scope. project-info includes active project-info registry types plus PLAN and Design Docs.',
  })
  @ApiQuery({ name: 'targetEntityId', required: false })
  @ApiQuery({ name: 'completionDependencyId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'validationSessionId', required: false })
  @ApiQuery({ name: 'windowStart', required: false, type: String })
  @ApiQuery({ name: 'windowEnd', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async findMany(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Query() query: QueryProposalsDto,
  ): Promise<PaginatedProposalsDto> {
    resolveProposalWindow(query);
    return this.proposalService.findMany(organizationId, projectId, query);
  }

  @Get('futures')
  @ApiOperation({
    summary: 'List unapplied futures that depend on a work item',
  })
  async listFutureOffers(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Query('dependencyTaskId', ParseUUIDPipe) dependencyTaskId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvalService.listFutureOffers(
      dependencyTaskId,
      organizationId,
      projectId,
      user.userId,
    );
  }

  @Get('futures/ready')
  @ApiOperation({
    summary: 'List project futures with ready implementation work',
  })
  async listProjectReadyFutures(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    if (limit < 1 || limit > 100 || offset < 0)
      throw new BadRequestException('Invalid pagination');
    return this.approvalService.listProjectReadyFutures(
      organizationId,
      projectId,
      user.userId,
      limit,
      offset,
    );
  }

  @Get('futures/:futureId')
  @ApiOperation({ summary: 'Read one complete reviewed future' })
  async findFuture(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('futureId', ParseUUIDPipe) futureId: string,
  ) {
    return this.proposalService.findFuture(futureId, organizationId, projectId);
  }

  @Get('futures/:futureId/applicability')
  @ApiOperation({ summary: 'Check future applicability without applying' })
  async futureApplicability(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('futureId', ParseUUIDPipe) futureId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvalService.getFutureApplicability(
      futureId,
      organizationId,
      projectId,
      user.userId,
    );
  }

  @Post('futures/:futureId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply one approved future' })
  async applyFuture(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Param('futureId', ParseUUIDPipe) futureId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return this.approvalService.applyFuture(
      futureId,
      organizationId,
      projectId,
      user.userId,
      parseFutureApplyRequest(body),
    );
  }

  @Post(':id/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a proposal',
    description:
      'Runs structural, referential, and permission validation ' +
      'on a persisted proposal. Returns a validation result with ' +
      'categorized errors and warnings. Does not enforce access ' +
      'control — permission issues are reported as warnings.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'id', description: 'Proposal ID' })
  @ApiResponse({ status: 200, description: 'Validation result' })
  @ApiResponse({ status: 404, description: 'Proposal not found' })
  async validate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body() changeSet?: WorkItemChangeSetValidationRequest,
  ): Promise<ProposalValidationResult | ProjectedWorkItemChangeSetResponse> {
    if (changeSet && Array.isArray(changeSet.operations)) {
      return this.proposalService.validateProposal(
        id,
        organizationId,
        projectId,
        user,
        changeSet,
      );
    }
    return this.proposalService.validateProposal(
      id,
      organizationId,
      projectId,
      user,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a proposal by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'id', description: 'Proposal ID' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
  ): Promise<TypedProposalResponse> {
    return this.proposalService.findOne(id, organizationId, projectId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a proposal' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'id', description: 'Proposal ID' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body(ValidationPipe) dto: UpdateProposalDto,
    @AuthToken() userToken: string | null,
  ): Promise<TypedProposalResponse> {
    return this.proposalService.update(
      id,
      organizationId,
      projectId,
      dto,
      user.userId,
      userToken,
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a proposal',
    description:
      'Records a REJECTION vote and sets the proposal status to REJECTED. ' +
      'CREATE proposals may be rejected without a reason; UPDATE and DELETE ' +
      'proposals require a non-blank reason. Rejection is terminal — a ' +
      'rejected proposal cannot be subsequently approved.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'id', description: 'Proposal ID' })
  @ApiResponse({ status: 200, description: 'Proposal rejected' })
  @ApiResponse({ status: 400, description: 'Invalid status transition' })
  @ApiResponse({ status: 404, description: 'Proposal not found' })
  @ApiResponse({ status: 409, description: 'User already voted' })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Body(ValidationPipe) dto: RejectProposalDto,
  ): Promise<RejectionResult> {
    return this.approvalService.reject(
      id,
      organizationId,
      projectId,
      user.userId,
      dto.reason,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a proposal' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'id', description: 'Proposal ID' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
  ): Promise<void> {
    return this.proposalService.delete(id, organizationId, projectId);
  }
}
