import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { ProjectAccessGuard } from 'src/auth/guards/project-access.guard';
import {
  EntityType,
  type CreateProjectReportRequestDto,
  type ProjectReportActivityPageDto,
  type ProjectReportContextBatchRequestDto,
  type ProjectReportContextBatchResponseDto,
  type ProjectReportContextPageDto,
  type ProjectReportPreviewDto,
  type ProjectReportPreviewRequestDto,
  type ProjectReportRequestDto,
  type RetryProjectReportRequestDto,
} from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ProjectReportActivityService } from 'src/services/project-reports/project-report-activity.service';
import { ProjectReportContextService } from 'src/services/project-reports/project-report-context.service';
import { ProjectReportLaunchService } from 'src/services/project-reports/project-report-launch.service';
import { ProjectReportRequestService } from 'src/services/project-reports/project-report-request.service';
import {
  CreateProjectReportRequestPipe,
  ProjectReportContextBatchPipe,
  ProjectReportPreviewPipe,
  RetryProjectReportRequestPipe,
} from './project-report-request.validation';

@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/project-report-requests',
)
export class ProjectReportRequestController {
  constructor(
    private readonly requests: ProjectReportRequestService,
    private readonly activity: ProjectReportActivityService,
    private readonly context: ProjectReportContextService,
    private readonly launch: ProjectReportLaunchService,
  ) {}

  @Post('preview')
  preview(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Body(ProjectReportPreviewPipe) input: ProjectReportPreviewRequestDto,
  ): Promise<ProjectReportPreviewDto> {
    return this.activity.preview(organizationId, projectId, userId, input);
  }

  @Post()
  async create(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Body(CreateProjectReportRequestPipe) input: CreateProjectReportRequestDto,
  ): Promise<ProjectReportRequestDto> {
    const request = await this.requests.create(
      organizationId,
      projectId,
      userId,
      input,
    );
    await this.launch.prepare(organizationId, projectId, userId, request);
    return this.requests.get(organizationId, projectId, userId, request.id);
  }

  @Get(':requestId')
  get(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ): Promise<ProjectReportRequestDto> {
    return this.requests.get(organizationId, projectId, userId, requestId);
  }

  @Post(':requestId/retry')
  async retry(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body(RetryProjectReportRequestPipe) input: RetryProjectReportRequestDto,
  ): Promise<ProjectReportRequestDto> {
    const request = await this.requests.retry(
      organizationId,
      projectId,
      userId,
      requestId,
      input,
    );
    await this.launch.prepare(organizationId, projectId, userId, request);
    return this.requests.get(organizationId, projectId, userId, requestId);
  }

  @Get(':requestId/activity')
  async activityPage(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Query('attemptId', ParseUUIDPipe) attemptId: string,
    @Headers('x-agent-session-id') agentSessionId: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<ProjectReportActivityPageDto> {
    const { submission } = await this.requests.loadForAgentRead(
      organizationId,
      projectId,
      userId,
      requestId,
      attemptId,
      agentSessionId,
    );
    return await this.activity.page(
      organizationId,
      projectId,
      userId,
      requestId,
      attemptId,
      submission,
      limit,
      offset,
    );
  }

  @Get(':requestId/context')
  async contextPage(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Query('attemptId', ParseUUIDPipe) attemptId: string,
    @Headers('x-agent-session-id') agentSessionId: string | undefined,
    @Query('entityType', new ParseEnumPipe(EntityType)) entityType: EntityType,
    @Query('entityId', ParseUUIDPipe) entityId: string,
  ): Promise<ProjectReportContextPageDto> {
    const { submission } = await this.requests.loadForAgentRead(
      organizationId,
      projectId,
      userId,
      requestId,
      attemptId,
      agentSessionId,
    );
    return await this.context.read({
      organizationId,
      projectId,
      userId,
      requestId,
      attemptId,
      submission,
      subject: { entityType, entityId },
    });
  }

  @Post(':requestId/context\\:batch')
  @HttpCode(HttpStatus.OK)
  async contextBatch(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentUser('userId') userId: UserId,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('x-agent-session-id') agentSessionId: string | undefined,
    @Body(ProjectReportContextBatchPipe)
    input: ProjectReportContextBatchRequestDto,
  ): Promise<ProjectReportContextBatchResponseDto> {
    const { submission } = await this.requests.loadForAgentRead(
      organizationId,
      projectId,
      userId,
      requestId,
      input.attemptId,
      agentSessionId,
    );
    return await this.context.readBatch({
      organizationId,
      projectId,
      userId,
      requestId,
      attemptId: input.attemptId,
      submission,
      subjects: input.subjects,
    });
  }
}
