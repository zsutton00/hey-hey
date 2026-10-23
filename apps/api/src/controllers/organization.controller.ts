import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrganizationId, UserId } from 'src/types';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { extractBrowserSessionRequestMetadata } from '../auth/browser-session-request-metadata';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AdminGuard } from '../auth/guards/admin.guard';
import { BulkInviteResponse } from '../generated';
import { BulkInviteToOrganizationDto } from '../generated';
import { CreateOrganizationDto } from '../generated';
import { InviteToOrganizationDto } from '../generated';
import { OrganizationMemberResponseDto } from '../generated';
import {
  OrganizationAccountLifecycleDto,
  OrganizationReactivationSuccess,
} from '../generated';
import { OrganizationResponseDto } from '../generated';
import { UpdateOrganizationDto } from '../generated';
import {
  AccountEntitlementDto,
  AdminOrganizationDetailDto,
  AdminOrganizationMembersPageDto,
  OrganizationDirectoryPageDto,
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
  MakeBetaAccessOpenEndedRequestDto,
} from '../generated';
import {
  OrganizationProjectEntitlementDto,
  UpdateOrganizationProjectEntitlementDto,
} from '../generated';
import { OrganizationService } from '../services/organization.service';
import { OrganizationAccountLifecycleOwner } from '../services/organization-account-lifecycle.owner';
import { OrganizationProjectEntitlementService } from '../services/organization-project-entitlement.service';
import { AccountEntitlementService } from '../services/account-entitlement.service';
import {
  LLMCostSummary,
  LLMTrackingService,
  ProjectCostSummary,
} from '../services/llm/llm-tracking.service';

@ApiTags('Organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/organizations')
export class OrganizationController {
  constructor(
    private organizationService: OrganizationService,
    private llmCostTrackingService: LLMTrackingService,
    private organizationProjectEntitlementService: OrganizationProjectEntitlementService,
    private organizationAccountLifecycleOwner: OrganizationAccountLifecycleOwner,
    private accountEntitlementService: AccountEntitlementService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Get user's organizations" })
  @ApiResponse({
    status: 200,
    description: "List of user's organizations",
  })
  async getMyOrganizations(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto[]> {
    return this.organizationService.getUserOrganizations(user.userId);
  }

  @Get('directory')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: 'List organizations for the admin directory',
    description:
      'Return a bounded cross-organization directory after the server admin permission has been evaluated.',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    maxLength: 100,
    description: 'Optional organization-name filter.',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: OrganizationDirectorySortBy,
    description: 'Directory field used for deterministic ordering.',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: OrganizationDirectorySortOrder,
    description: 'Direction used for deterministic ordering.',
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
    maxLength: 2048,
    description: 'Opaque continuation cursor for the exact active query.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
    description: 'Maximum number of organizations to return.',
  })
  @ApiResponse({ status: 200, description: 'Authorized directory page.' })
  @ApiResponse({
    status: 400,
    description: 'Invalid directory query or continuation cursor.',
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid bearer authentication.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Authenticated caller is not authorized to list organizations.',
  })
  async listOrganizationDirectory(
    @Query('name') name?: string,
    @Query('sortBy') sortBy?: OrganizationDirectorySortBy,
    @Query('sortOrder') sortOrder?: OrganizationDirectorySortOrder,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<OrganizationDirectoryPageDto> {
    return this.organizationService.listOrganizationDirectory({
      name,
      sortBy,
      sortOrder,
      cursor,
      limit,
    });
  }

  @Get('directory/:organizationId')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Get an admin organization detail' })
  @ApiResponse({ status: 200, description: 'Authorized organization detail.' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not a platform administrator.',
  })
  @ApiResponse({ status: 404, description: 'Organization not found.' })
  async getAdminOrganizationDetail(
    @Param('organizationId') organizationId: OrganizationId,
  ): Promise<AdminOrganizationDetailDto> {
    return this.organizationService.getAdminOrganizationDetail(organizationId);
  }

  @Get('directory/:organizationId/members')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'List members for an admin organization detail' })
  @ApiQuery({ name: 'name', required: false, type: String, maxLength: 100 })
  @ApiQuery({ name: 'cursor', required: false, type: String, maxLength: 2048 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiResponse({
    status: 200,
    description: 'Authorized organization member page.',
  })
  @ApiResponse({
    status: 403,
    description: 'Caller is not a platform administrator.',
  })
  async listAdminOrganizationMembers(
    @CurrentUser('userId') callerId: UserId,
    @Param('organizationId') organizationId: OrganizationId,
    @Query('name') name?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<AdminOrganizationMembersPageDto> {
    return this.organizationService.listAdminOrganizationMembers(
      organizationId,
      callerId,
      { name, cursor, limit },
    );
  }

  @Post('directory/:organizationId/entitlement/make-open-ended')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Make beta access open-ended' })
  @ApiResponse({ status: 200, description: 'Updated canonical entitlement.' })
  @ApiResponse({ status: 400, description: 'Invalid or ineligible request.' })
  @ApiResponse({ status: 401, description: 'Authentication required.' })
  @ApiResponse({ status: 403, description: 'Platform administrator required.' })
  @ApiResponse({
    status: 404,
    description: 'Organization or entitlement not found.',
  })
  @ApiResponse({ status: 409, description: 'Revision or closure conflict.' })
  async makeBetaAccessOpenEnded(
    @Param('organizationId') organizationId: OrganizationId,
    @Body() request: MakeBetaAccessOpenEndedRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AccountEntitlementDto> {
    const entitlement =
      await this.accountEntitlementService.makeBetaAccessOpenEnded(
        organizationId,
        request.expectedRevision,
        { actor: user.userId, reason: request.reason },
      );
    return {
      organizationId: entitlement.organizationId as OrganizationId,
      subscriptionType: entitlement.subscriptionType,
      accessStatus: entitlement.accessStatus,
      accessThroughAt: entitlement.accessThroughAt?.toISOString() ?? null,
      paidThroughAt: entitlement.paidThroughAt?.toISOString() ?? null,
      revision: entitlement.revision,
      updatedAt: entitlement.updatedAt.toISOString(),
    } satisfies AccountEntitlementDto;
  }

  @Get(':organizationId/project-entitlement')
  @UseGuards(OrganizationGuard)
  async getOrganizationProjectEntitlement(
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<OrganizationProjectEntitlementDto> {
    return this.organizationProjectEntitlementService.resolve(organizationId);
  }

  @Patch(':organizationId/project-entitlement')
  @UseGuards(OrganizationGuard)
  async updateOrganizationProjectEntitlement(
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() update: UpdateOrganizationProjectEntitlementDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationProjectEntitlementDto> {
    return this.organizationProjectEntitlementService.updateOverride(
      organizationId,
      user.userId,
      update,
    );
  }

  @Post(':organizationId/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Cancel organization account access' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current lifecycle decision after cancellation',
  })
  async cancelOrganizationAccount(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationAccountLifecycleDto> {
    return this.organizationAccountLifecycleOwner.cancel(
      organizationId,
      user.userId,
    );
  }

  @Get(':organizationId/account-lifecycle')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get organization account lifecycle' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current authoritative organization account lifecycle',
  })
  async getOrganizationAccountLifecycle(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationAccountLifecycleDto> {
    return this.organizationAccountLifecycleOwner.get(
      organizationId,
      user.userId,
    );
  }

  @Post(':organizationId/reactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Reactivate organization account access' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current lifecycle decision after reactivation',
  })
  async reactivateOrganizationAccount(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationReactivationSuccess> {
    return this.organizationAccountLifecycleOwner.reactivate(
      organizationId,
      user.userId,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({
    status: 201,
    description: 'Organization created successfully',
  })
  async createOrganization(
    @Body() createOrganizationDto: CreateOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizationService.createOrganization(
      createOrganizationDto,
      user.userId,
    );
  }

  @Get(':organizationId')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get organization details' })
  @ApiResponse({
    status: 200,
    description: 'Organization details',
  })
  async getOrganization(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizationService.getOrganization(
      organizationId,
      user.userId,
    );
  }

  @Patch(':organizationId')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Update organization' })
  @ApiResponse({
    status: 200,
    description: 'Organization updated successfully',
  })
  async updateOrganization(
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto> {
    return this.organizationService.updateOrganization(
      organizationId,
      updateOrganizationDto,
      user.userId,
    );
  }

  @Get(':organizationId/members')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get organization members' })
  @ApiResponse({
    status: 200,
    description: 'List of organization members',
  })
  async getOrganizationMembers(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationMemberResponseDto[]> {
    return this.organizationService.getOrganizationMembers(
      organizationId,
      user.userId,
    );
  }

  @Post(':organizationId/members')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Invite user to organization' })
  @ApiResponse({
    status: 201,
    description: 'Invitation sent successfully',
  })
  async inviteToOrganization(
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() inviteToOrganizationDto: InviteToOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<OrganizationMemberResponseDto> {
    return this.organizationService.inviteToOrganization(
      organizationId,
      inviteToOrganizationDto,
      user.userId,
      extractBrowserSessionRequestMetadata(request),
    );
  }

  @Delete(':organizationId/members/:userId')
  @UseGuards(OrganizationGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a user from an organization' })
  @ApiResponse({ status: 204, description: 'Member removed successfully' })
  @ApiResponse({
    status: 400,
    description: 'Cannot remove the last owner of the organization',
  })
  @ApiResponse({ status: 404, description: 'Member not found' })
  async removeMember(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('userId') userId: UserId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.organizationService.removeOrganizationMember(
      organizationId,
      userId,
      user.userId,
    );
  }

  @Post(':organizationId/members/bulk-invite')
  @UseGuards(OrganizationGuard)
  @Throttle({ default: { limit: 10, ttl: 3600000 } }) // 10 requests per hour
  @ApiOperation({ summary: 'Bulk invite users to organization' })
  @ApiResponse({
    status: 200,
    description: 'Bulk invitation completed (may contain partial failures)',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request data',
  })
  @ApiResponse({
    status: 403,
    description: 'Insufficient permissions',
  })
  async bulkInviteToOrganization(
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() bulkInviteDto: BulkInviteToOrganizationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<BulkInviteResponse> {
    return this.organizationService.bulkInviteToOrganization(
      organizationId,
      bulkInviteDto,
      user.userId,
      extractBrowserSessionRequestMetadata(request),
    );
  }

  // LLM Cost Tracking Endpoints

  @Get('costs/current-month')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get current month LLM costs for organization' })
  @ApiResponse({
    status: 200,
    description: 'Current month LLM cost summary',
    type: Object,
  })
  async getCurrentMonthCosts(
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<LLMCostSummary> {
    return this.llmCostTrackingService.getCurrentMonthCosts(organizationId);
  }

  @Get('costs/summary')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get LLM cost summary for organization' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (ISO string)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (ISO string)',
  })
  @ApiResponse({
    status: 200,
    description: 'LLM cost summary',
    type: Object,
  })
  async getCostSummary(
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<LLMCostSummary> {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
    const end = endDate ? new Date(endDate) : new Date(); // Default: now

    return this.llmCostTrackingService.getOrganizationCostSummary(
      organizationId,
      start,
      end,
    );
  }

  @Get('costs/projects')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get LLM costs by project for organization' })
  @ApiQuery({
    name: 'startDate',
    required: false,
    description: 'Start date (ISO string)',
  })
  @ApiQuery({
    name: 'endDate',
    required: false,
    description: 'End date (ISO string)',
  })
  @ApiResponse({
    status: 200,
    description: 'LLM costs by project',
    type: [Object],
  })
  async getProjectCosts(
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ProjectCostSummary[]> {
    const start = startDate
      ? new Date(startDate)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
    const end = endDate ? new Date(endDate) : new Date(); // Default: now

    return this.llmCostTrackingService.getProjectCostSummaries(
      organizationId,
      start,
      end,
    );
  }

  @Get('costs/trends')
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: 'Get LLM cost trends for organization' })
  @ApiQuery({
    name: 'days',
    required: false,
    description: 'Number of days (default: 30)',
  })
  @ApiResponse({
    status: 200,
    description: 'LLM cost trends',
    type: [Object],
  })
  async getCostTrends(
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('days') days?: string,
  ): Promise<{ date: string; calls: number; cost: number }[]> {
    const numDays = days ? parseInt(days, 10) : 30;
    return this.llmCostTrackingService.getCostTrends(organizationId, numDays);
  }
}
