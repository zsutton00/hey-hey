import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentOrganization } from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import {
  ReportAudience,
  CreateReportDto,
  CreateReportEntityDto,
  CreateReportResponseDto,
  FileTouchIndexEntriesDto,
  FileTouchReferenceCandidatesDto,
  FileTouchServiceHistoryDto,
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  FileTouchTaskHistoryDto,
  FileTouchWorkHistoryDto,
  ReportDto,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportSortBy,
  ReportSortOrder,
  ReportType,
  UpdateReportDto,
} from 'src/generated';
import {
  ListReportsFilters,
  ReportService,
} from 'src/services/reports/report.service';
import { OrganizationId, UserId } from 'src/types';

@ApiTags('Reports')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/reports')
export class ReportController {
  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly reportService: ReportService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({ status: 201, description: 'Created report' })
  async create(
    @Body() dto: CreateReportDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') callerUserId: UserId,
    @Headers('x-project-id') projectIdHeader?: string,
    @Headers('x-agent-session-id') agentSessionIdHeader?: string,
    @Headers('x-conversation-id') conversationIdHeader?: string,
    @Headers('x-message-id') messageIdHeader?: string,
  ): Promise<CreateReportResponseDto> {
    const runContext = this.parseRunContextHeaders({
      projectId: projectIdHeader,
      agentSessionId: agentSessionIdHeader,
      conversationId: conversationIdHeader,
      messageId: messageIdHeader,
    });
    if (
      dto.reportType === ReportType.ProjectReport &&
      (!runContext.projectId ||
        !runContext.agentSessionId ||
        !runContext.conversationId ||
        (dto.projectId !== undefined &&
          dto.projectId !== runContext.projectId) ||
        (dto.sourceExecutionId !== undefined &&
          dto.sourceExecutionId !== runContext.agentSessionId))
    ) {
      throw new BadRequestException(
        'PROJECT_REPORT requires matching authenticated run context',
      );
    }
    const createDto = this.applyRunContextToCreateDto(dto, runContext);

    return this.reportService.create(
      organizationId,
      createDto,
      runContext.conversationId,
      callerUserId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List reports' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'reportType', required: false, enum: ReportType })
  @ApiQuery({ name: 'audience', required: false, enum: ReportAudience })
  @ApiQuery({ name: 'sourceExecutionId', required: false, type: String })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: ReportRelatedEntityType,
  })
  @ApiQuery({ name: 'entityId', required: false, type: String })
  @ApiQuery({
    name: 'relation',
    required: false,
    enum: ReportEntityRelation,
  })
  @ApiQuery({ name: 'parentReportId', required: false, type: String })
  @ApiQuery({ name: 'includeExpired', required: false, type: Boolean })
  @ApiQuery({ name: 'ragEnabled', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ReportSortBy })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ReportSortOrder })
  async findAll(
    @CurrentUser('userId') callerId: string,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('projectId') projectId?: string,
    @Query('reportType') reportType?: ReportType,
    @Query('audience') audience?: ReportAudience,
    @Query('sourceExecutionId') sourceExecutionId?: string,
    @Query('entityType') entityType?: ReportRelatedEntityType,
    @Query('entityId') entityId?: string,
    @Query('relation') relation?: ReportEntityRelation,
    @Query('parentReportId') parentReportId?: string,
    @Query('includeExpired') includeExpired?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: ReportSortBy,
    @Query('sortOrder') sortOrder?: ReportSortOrder,
    @Query('ragEnabled') ragEnabled?: string,
  ): Promise<ReportDto[]> {
    const filters: ListReportsFilters = {
      accessibleProjectIds: await this.projectAccess.accessibleProjectIds(
        callerId,
        organizationId,
      ),
      ...(projectId ? { projectId } : {}),
      ...(reportType ? { reportType } : {}),
      ...(audience ? { audience } : {}),
      ...(sourceExecutionId ? { sourceExecutionId } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(relation ? { relation } : {}),
      ...(parentReportId ? { parentReportId } : {}),
      ...(includeExpired !== undefined
        ? {
            includeExpired: this.parseOptionalBoolean(
              includeExpired,
              'includeExpired',
            ),
          }
        : {}),
      ...(ragEnabled !== undefined
        ? {
            ragEnabled: this.parseOptionalBoolean(ragEnabled, 'ragEnabled'),
          }
        : {}),
      ...(limit !== undefined
        ? { limit: this.parseOptionalPositiveInteger(limit, 'limit') }
        : {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    };

    return this.reportService.findAll(organizationId, filters);
  }

  @Get(':reportId')
  @ApiOperation({ summary: 'Get a report by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'reportId', description: 'Report ID' })
  async findOne(
    @Param('reportId') reportId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ReportDto> {
    return this.reportService.findOne(organizationId, reportId);
  }

  @Patch(':reportId')
  @ApiOperation({ summary: 'Update a report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'reportId', description: 'Report ID' })
  async update(
    @Param('reportId') reportId: string,
    @Body() dto: UpdateReportDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ReportDto> {
    return this.reportService.update(organizationId, reportId, dto);
  }

  @Delete(':reportId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a report' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'reportId', description: 'Report ID' })
  async remove(
    @Param('reportId') reportId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    await this.reportService.remove(organizationId, reportId);
  }

  private parseOptionalBoolean(value: string, fieldName: string): boolean {
    if (value === 'true') {
      return true;
    }

    if (value === 'false') {
      return false;
    }

    throw new BadRequestException(`${fieldName} must be true or false`);
  }

  private parseOptionalPositiveInteger(
    value: string,
    fieldName: string,
  ): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }

    return parsed;
  }

  private parseRunContextHeaders(headers: {
    projectId?: string;
    agentSessionId?: string;
    conversationId?: string;
    messageId?: string;
  }): {
    projectId?: string;
    agentSessionId?: string;
    conversationId?: string;
    messageId?: string;
  } {
    return {
      projectId: this.parseOptionalUuidHeader(
        headers.projectId,
        'X-Project-ID',
      ),
      agentSessionId: this.parseOptionalUuidHeader(
        headers.agentSessionId,
        'X-Agent-Session-ID',
      ),
      conversationId: this.parseOptionalUuidHeader(
        headers.conversationId,
        'X-Conversation-ID',
      ),
      messageId: this.parseOptionalUuidHeader(
        headers.messageId,
        'X-Message-ID',
      ),
    };
  }

  private parseOptionalUuidHeader(
    value: string | undefined,
    headerName: string,
  ): string | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
    if (!uuidPattern.test(value)) {
      throw new BadRequestException(`${headerName} must be a valid UUID`);
    }

    return value;
  }

  private applyRunContextToCreateDto(
    dto: CreateReportDto,
    context: {
      projectId?: string;
      agentSessionId?: string;
      conversationId?: string;
      messageId?: string;
    },
  ): CreateReportDto {
    const callerEntities = dto.entities ?? [];
    const autoAttached = this.buildAutoAttachedContextEntities(
      callerEntities,
      context,
    );

    return {
      ...dto,
      ...(dto.projectId === undefined && context.projectId !== undefined
        ? { projectId: context.projectId }
        : {}),
      ...(dto.sourceExecutionId === undefined &&
      context.agentSessionId !== undefined
        ? { sourceExecutionId: context.agentSessionId }
        : {}),
      ...(dto.entities !== undefined || autoAttached.length > 0
        ? { entities: [...callerEntities, ...autoAttached] }
        : {}),
    };
  }

  private buildAutoAttachedContextEntities(
    callerEntities: CreateReportEntityDto[],
    context: {
      agentSessionId?: string;
      conversationId?: string;
      messageId?: string;
    },
  ): CreateReportEntityDto[] {
    const callerKeys = new Set(
      callerEntities.map((e) => `${e.entityType}:${e.entityId}`),
    );
    const candidates: Array<{
      entityType: ReportRelatedEntityType;
      entityId: string | undefined;
    }> = [
      {
        entityType: ReportRelatedEntityType.AgentSession,
        entityId: context.agentSessionId,
      },
      {
        entityType: ReportRelatedEntityType.Conversation,
        entityId: context.conversationId,
      },
      {
        entityType: ReportRelatedEntityType.Message,
        entityId: context.messageId,
      },
    ];

    return candidates.flatMap(({ entityType, entityId }) => {
      if (!entityId || callerKeys.has(`${entityType}:${entityId}`)) {
        return [];
      }

      return [
        {
          entityType,
          entityId,
          relation: ReportEntityRelation.Context,
        } satisfies CreateReportEntityDto,
      ];
    });
  }
}

@ApiTags('Reports')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId/reports')
export class ProjectReportsController {
  constructor(private readonly reportService: ReportService) {}

  @Get()
  @ApiOperation({
    operationId: 'listProjectReports',
    summary: 'List reports for a project',
    description:
      'List reports scoped to a single project, optionally filtered by ' +
      'one or more report types. Sorted by createdAt DESC by default; ' +
      'limit defaults to 50 (max 200), offset defaults to 0.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'types',
    required: false,
    type: String,
    isArray: true,
    enum: ReportType,
    description:
      'Optional repeated filter narrowing the result set to reports of ' +
      'one or more report types. Repeat the param (?types=A&types=B) ' +
      'for an OR-set.',
  })
  @ApiQuery({ name: 'ragEnabled', required: false, type: Boolean })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, enum: ReportSortBy })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ReportSortOrder })
  async listProjectReports(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('types') types?: string | string[],
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('sortBy') sortBy?: ReportSortBy,
    @Query('sortOrder') sortOrder?: ReportSortOrder,
    @Query('ragEnabled') ragEnabled?: string,
  ): Promise<ReportDto[]> {
    const reportTypes = this.normalizeReportTypes(types);

    const filters: ListReportsFilters = {
      projectId,
      ...(reportTypes !== undefined ? { reportTypes } : {}),
      ...(ragEnabled !== undefined
        ? { ragEnabled: this.parseBoolean(ragEnabled, 'ragEnabled') }
        : {}),
      ...(limit !== undefined
        ? { limit: this.parsePositiveInteger(limit, 'limit') }
        : {}),
      ...(offset !== undefined
        ? { offset: this.parseNonNegativeInteger(offset, 'offset') }
        : {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    };

    return this.reportService.findAll(organizationId, filters);
  }

  @Get('file-touches/by-file')
  @ApiOperation({
    operationId: 'listReportFileTouchesByFile',
    summary: 'List work that touched a file',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ name: 'serviceId', required: true, type: String })
  @ApiQuery({ name: 'path', required: true, type: String })
  async listFileTouchesByFile(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('path') path: string,
  ): Promise<FileTouchIndexEntriesDto> {
    return this.reportService.listFileTouchesByFile({
      organizationId,
      projectId,
      serviceId,
      path,
    });
  }

  @Get('file-touches/by-work')
  @ApiOperation({
    operationId: 'listReportFileTouchesByWork',
    summary: 'List files touched by work',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: [ReportRelatedEntityType.Task],
  })
  @ApiQuery({ name: 'entityId', required: false, type: String })
  @ApiQuery({ name: 'featureId', required: false, type: String })
  @ApiQuery({ name: 'serviceId', required: false, type: String })
  async listFileTouchesByWork(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('entityType') entityType?: ReportRelatedEntityType,
    @Query('entityId', new ParseUUIDPipe({ optional: true })) entityId?: string,
    @Query('featureId', new ParseUUIDPipe({ optional: true }))
    featureId?: string,
    @Query('serviceId') serviceId?: string,
  ): Promise<FileTouchReferenceCandidatesDto> {
    return this.reportService.listFileTouchesByWork({
      organizationId,
      projectId,
      entityType,
      entityId,
      featureId,
      ...(serviceId ? { serviceId } : {}),
    });
  }

  @Get('file-history/by-file')
  @ApiOperation({
    operationId: 'listReportFileHistoryByFile',
    summary: 'List task history for a file',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ name: 'serviceId', required: true, type: String })
  @ApiQuery({ name: 'path', required: true, type: String })
  async listFileHistoryByFile(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('path') path: string,
  ): Promise<FileTouchTaskHistoryDto> {
    return this.reportService.listFileHistoryByFile({
      organizationId,
      projectId,
      serviceId,
      path,
    });
  }

  @Get('file-history/by-service')
  @ApiOperation({
    operationId: 'listReportFileHistoryByService',
    summary: 'List historical files for a Service',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({ name: 'serviceId', required: true, type: String })
  @ApiQuery({ name: 'pathFilter', required: false, type: String })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: FileTouchServiceHistorySortBy,
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: FileTouchServiceHistorySortOrder,
  })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listFileHistoryByService(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('serviceId', ParseUUIDPipe) serviceId: string,
    @Query('pathFilter') pathFilter?: string,
    @Query('sortBy') sortBy?: FileTouchServiceHistorySortBy,
    @Query('sortOrder') sortOrder?: FileTouchServiceHistorySortOrder,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<FileTouchServiceHistoryDto> {
    return this.reportService.listFileHistoryByService({
      organizationId,
      projectId,
      serviceId,
      ...(pathFilter !== undefined ? { pathFilter } : {}),
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
      ...(limit !== undefined
        ? { limit: this.parsePositiveInteger(limit, 'limit') }
        : {}),
    });
  }

  @Get('file-history/by-work')
  @ApiOperation({
    operationId: 'listReportFileHistoryByWork',
    summary: 'List production file history for work',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
    enum: [ReportRelatedEntityType.Task],
  })
  @ApiQuery({ name: 'entityId', required: false, type: String })
  @ApiQuery({ name: 'featureId', required: false, type: String })
  @ApiQuery({ name: 'serviceId', required: false, type: String })
  async listFileHistoryByWork(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('entityType') entityType?: ReportRelatedEntityType,
    @Query('entityId', new ParseUUIDPipe({ optional: true })) entityId?: string,
    @Query('featureId', new ParseUUIDPipe({ optional: true }))
    featureId?: string,
    @Query('serviceId', new ParseUUIDPipe({ optional: true }))
    serviceId?: string,
  ): Promise<FileTouchWorkHistoryDto> {
    return this.reportService.listFileHistoryByWork({
      organizationId,
      projectId,
      entityType,
      entityId,
      featureId,
      ...(serviceId ? { serviceId } : {}),
    });
  }

  private normalizeReportTypes(
    raw: string | string[] | undefined,
  ): ReportType[] | undefined {
    if (raw === undefined) {
      return undefined;
    }

    const values = Array.isArray(raw) ? raw : [raw];
    const trimmed = values
      .flatMap((value) => value.split(','))
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (trimmed.length === 0) {
      return undefined;
    }

    return trimmed as ReportType[];
  }

  private parseBoolean(value: string, fieldName: string): boolean {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    throw new BadRequestException(`${fieldName} must be true or false`);
  }

  private parsePositiveInteger(value: string, fieldName: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }
    return parsed;
  }

  private parseNonNegativeInteger(value: string, fieldName: string): number {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative integer`,
      );
    }
    return parsed;
  }
}
