import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { activityHistoryFilterSchema } from 'src/generated/activity-history-contract';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import {
  ActivitySleepDto,
  ActivitySleepDuration,
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationSource,
  CreateActivitySleepDto,
  ActivityMetricContinuationDto,
  ActivityHistoryFilterDto,
  ActivityActorScopeMode,
  EntityType,
  GetCorrelatedActivity200Response,
  ProjectMetricIdentity,
  QueryActivity200Response,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from 'src/generated';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { ActivitySleepService } from 'src/services/activity-correlation/activity-sleep.service';
import { ActivityCorrelationService } from 'src/services/activity-correlation.service';
import { ActivityQueryService } from 'src/services/activity-correlation/activity-query.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';

const validateHistoryFilter = addFormats(
  new Ajv({
    strict: false,
    formats: { 'branded-ProjectId': true, 'branded-UserId': true },
  }),
).compile<ActivityHistoryFilterDto>(activityHistoryFilterSchema);

@ApiTags('ActivityCorrelation')
@Controller('api/v1/organizations/:organizationId/activity-correlations')
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class ActivityCorrelationController {
  constructor(
    private readonly activityCorrelationService: ActivityCorrelationService,
    private readonly activitySleepService: ActivitySleepService,
    @Optional() private readonly activityQueryService?: ActivityQueryService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List recent correlated activity records' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({
    name: 'projectId',
    required: true,
    type: String,
  })
  @ApiQuery({
    name: 'mode',
    required: false,
    enum: RecentActivityCorrelationMode,
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: RecentActivityCorrelationSort,
  })
  @ApiResponse({
    status: 200,
    description: 'Correlated activity records retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({
    status: 502,
    description: 'Failed to retrieve graph context for recent correlations',
  })
  async listCorrelatedActivity(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Query('projectId') projectIdRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('mode') modeRaw?: string,
    @Query('sort') sortRaw?: string,
    @AuthToken() userToken?: string | null,
    @Res({ passthrough: true }) response?: Response,
  ): Promise<GetCorrelatedActivity200Response['data']> {
    const projectId = this.parseRequiredString(
      projectIdRaw,
      'projectId',
    ) as ProjectId;
    const limit = this.parseBoundedInt(limitRaw, 50, 1, 200, 'limit');
    const offset = this.parseBoundedInt(
      offsetRaw,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      'offset',
    );
    const mode = this.parseOptionalEnumValue(
      modeRaw,
      RecentActivityCorrelationMode,
      'mode',
    );
    const sort = this.parseOptionalEnumValue(
      sortRaw,
      RecentActivityCorrelationSort,
      'sort',
    );

    const result = await this.activityCorrelationService.listCorrelatedActivity(
      organizationId,
      {
        userId,
        projectId,
        ...(mode ? { mode } : {}),
        ...(sort ? { sort } : {}),
        limit,
        offset,
      },
      userToken ?? null,
    );

    response?.setHeader('X-Total-Count', String(result.total));
    if (result.nextOffset !== undefined) {
      response?.setHeader('X-Next-Offset', String(result.nextOffset));
    }

    return result.records;
  }

  @Post('sleep')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sleep a recent activity entity' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiResponse({
    status: 200,
    description: 'Activity entity suppression stored successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid activity sleep payload' })
  @ApiResponse({
    status: 503,
    description: 'Activity suppression store is unavailable',
  })
  async sleepActivity(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() dto: CreateActivitySleepDto,
  ): Promise<ActivitySleepDto> {
    return this.activitySleepService.sleepActivity(
      organizationId,
      userId,
      this.parseSleepDto(dto),
    );
  }

  @Get('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Query cross-project Activity evidence' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({
    name: 'entityType',
    required: false,
    isArray: true,
    enum: EntityType,
  })
  @ApiQuery({
    name: 'activityMode',
    required: false,
    enum: ActivityCorrelationMode,
  })
  @ApiQuery({
    name: 'activityType',
    required: false,
    isArray: true,
    enum: ActivityCorrelationActivityType,
  })
  @ApiQuery({
    name: 'source',
    required: false,
    isArray: true,
    enum: ActivityCorrelationSource,
  })
  @ApiQuery({ name: 'serviceId', required: false, type: String })
  @ApiQuery({ name: 'since', required: false, type: String })
  @ApiQuery({ name: 'until', required: false, type: String })
  @ApiQuery({ name: 'affectsMe', required: false, type: Boolean })
  @ApiQuery({ name: 'sinceLastVisit', required: false, type: Boolean })
  @ApiQuery({
    name: 'metric',
    required: false,
    enum: ProjectMetricIdentity,
  })
  @ApiQuery({
    name: 'projectIds',
    required: false,
    isArray: true,
    type: String,
  })
  @ApiQuery({ name: 'windowStart', required: false, type: String })
  @ApiQuery({ name: 'windowEnd', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Cross-project Activity evidence retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid Activity query parameters',
  })
  @ApiResponse({ status: 403, description: 'Activity scope is not accessible' })
  async queryActivity(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Query() rawQuery: Record<string, unknown>,
    @Res({ passthrough: true }) response?: Response,
  ): Promise<QueryActivity200Response['data']> {
    if (!this.activityQueryService) {
      throw new Error('Activity query service is not configured');
    }

    this.assertKnownActivityQueryFields(rawQuery);
    const projectId = this.parseOptionalString(
      rawQuery.projectId,
      'projectId',
    ) as ProjectId | undefined;
    const selectedUserId = this.parseOptionalString(
      rawQuery.userId,
      'userId',
    ) as UserId | undefined;
    const entityTypes = this.parseEnumList(
      rawQuery.entityType,
      EntityType,
      'entityType',
    );
    const activityMode = this.parseOptionalEnumValue(
      this.parseOptionalScalar(rawQuery.activityMode, 'activityMode'),
      ActivityCorrelationMode,
      'activityMode',
    );
    const activityTypes = this.parseEnumList(
      rawQuery.activityType,
      ActivityCorrelationActivityType,
      'activityType',
    );
    const sources = this.parseEnumList(
      rawQuery.source,
      ActivityCorrelationSource,
      'source',
    );
    const serviceId = this.parseOptionalString(rawQuery.serviceId, 'serviceId');
    const since = this.parseOptionalDate(rawQuery.since, 'since');
    const until = this.parseOptionalDate(rawQuery.until, 'until');
    const affectsMe = this.parseOptionalBoolean(
      rawQuery.affectsMe,
      'affectsMe',
    );
    const sinceLastVisit = this.parseOptionalBoolean(
      rawQuery.sinceLastVisit,
      'sinceLastVisit',
    );
    const metricContinuation = this.parseMetricContinuation(rawQuery);
    const limit = this.parseBoundedInt(
      this.parseOptionalScalar(rawQuery.limit, 'limit'),
      50,
      1,
      200,
      'limit',
    );
    const offset = this.parseBoundedInt(
      this.parseOptionalScalar(rawQuery.offset, 'offset'),
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      'offset',
    );

    const historyFilter = this.parseHistoryFilter(rawQuery);
    const ordinaryQuery = {
      organizationId,
      actorUserId: userId,
      ...(projectId ? { projectId } : {}),
      ...(selectedUserId ? { selectedUserId } : {}),
      ...(entityTypes ? { entityTypes } : {}),
      ...(activityMode ? { activityMode } : {}),
      ...(activityTypes ? { activityTypes } : {}),
      ...(sources ? { sources } : {}),
      ...(serviceId ? { serviceId } : {}),
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
      ...(affectsMe === undefined ? {} : { affectsMe }),
      ...(sinceLastVisit === undefined ? {} : { sinceLastVisit }),
      limit,
      offset,
    };
    const result = await this.activityQueryService.queryActivity(
      historyFilter
        ? { organizationId, actorUserId: userId, historyFilter, limit, offset }
        : metricContinuation
          ? { ...ordinaryQuery, metricContinuation }
          : ordinaryQuery,
    );

    response?.setHeader('X-Total-Count', String(result.total));
    if (result.nextOffset !== undefined) {
      response?.setHeader('X-Next-Offset', String(result.nextOffset));
    }

    return result.records;
  }

  @Get('entities/:entityType/:entityId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get correlated activity records for a specific entity',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'entityType', enum: EntityType })
  @ApiParam({ name: 'entityId', description: 'Entity ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiQuery({
    name: 'activityType',
    required: false,
    isArray: true,
    enum: ActivityCorrelationActivityType,
  })
  @ApiQuery({
    name: 'source',
    required: false,
    isArray: true,
    enum: ActivityCorrelationSource,
  })
  @ApiQuery({
    name: 'activityMode',
    required: false,
    enum: ActivityCorrelationMode,
  })
  @ApiResponse({
    status: 200,
    description: 'Correlated activity records retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 404, description: 'Entity not found' })
  @ApiResponse({
    status: 502,
    description: 'Failed to retrieve graph context for correlations',
  })
  async getCorrelatedActivityByEntity(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('entityType') entityTypeRaw: string,
    @Param('entityId') entityId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
    @Query('activityType') activityTypeRaw?: string | string[],
    @Query('source') sourceRaw?: string | string[],
    @Query('activityMode') activityModeRaw?: string,
    @AuthToken() userToken?: string | null,
    @Res({ passthrough: true }) response?: Response,
  ): Promise<QueryActivity200Response['data']> {
    const entityType = this.parseEnumValue(
      entityTypeRaw,
      EntityType,
      'entityType',
    );
    const limit = this.parseBoundedInt(limitRaw, 50, 1, 200, 'limit');
    const offset = this.parseBoundedInt(
      offsetRaw,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
      'offset',
    );
    const activityTypes = this.parseEnumList(
      activityTypeRaw,
      ActivityCorrelationActivityType,
      'activityType',
    );
    const sources = this.parseEnumList(
      sourceRaw,
      ActivityCorrelationSource,
      'source',
    );
    const activityMode = this.parseOptionalEnumValue(
      activityModeRaw,
      ActivityCorrelationMode,
      'activityMode',
    );

    const result = await this.activityCorrelationService.getCorrelatedActivity(
      organizationId,
      {
        entityId,
        entityType,
        userId,
        ...(activityTypes ? { activityTypes } : {}),
        ...(sources ? { sources } : {}),
        ...(activityMode ? { activityMode } : {}),
        limit,
        offset,
      },
      { userToken: userToken ?? null },
    );

    response?.setHeader('X-Total-Count', String(result.total));
    if (result.nextOffset !== undefined) {
      response?.setHeader('X-Next-Offset', String(result.nextOffset));
    }

    return result.records;
  }

  private parseEnumValue<T extends string>(
    raw: string | undefined,
    enumObject: Record<string, T>,
    fieldName: string,
  ): T {
    if (!raw || raw.trim().length === 0) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    const value = raw.trim();
    const allowedValues = Object.values(enumObject);
    if (!allowedValues.includes(value as T)) {
      throw new BadRequestException(
        `${fieldName} contains unsupported value: ${value}`,
      );
    }

    return value as T;
  }

  private parseOptionalEnumValue<T extends string>(
    raw: string | undefined,
    enumObject: Record<string, T>,
    fieldName: string,
  ): T | undefined {
    if (raw === undefined) {
      return undefined;
    }

    return this.parseEnumValue(raw, enumObject, fieldName);
  }

  private parseEnumList<T extends string>(
    raw: unknown,
    enumObject: Record<string, T>,
    fieldName: string,
  ): T[] | undefined {
    if (raw === undefined) {
      return undefined;
    }

    const values = (Array.isArray(raw) ? raw : [raw])
      .flatMap((value) => {
        if (typeof value !== 'string') {
          throw new BadRequestException(`${fieldName} must contain strings`);
        }
        return value.split(',');
      })
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (values.length === 0) {
      throw new BadRequestException(
        `${fieldName} must contain at least one value`,
      );
    }

    const allowedValues = Object.values(enumObject);
    values.forEach((value) => {
      if (!allowedValues.includes(value as T)) {
        throw new BadRequestException(
          `${fieldName} contains unsupported value: ${value}`,
        );
      }
    });

    return values as T[];
  }

  private parseRequiredString(
    raw: string | undefined,
    fieldName: string,
  ): string {
    if (!raw || raw.trim().length === 0) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    return raw.trim();
  }

  private parseOptionalScalar(
    raw: unknown,
    fieldName: string,
  ): string | undefined {
    if (raw === undefined) {
      return undefined;
    }
    if (Array.isArray(raw)) {
      throw new BadRequestException(`${fieldName} must contain one value`);
    }
    if (typeof raw !== 'string' && typeof raw !== 'number') {
      throw new BadRequestException(`${fieldName} must contain a string value`);
    }
    return String(raw);
  }

  private parseOptionalString(
    raw: unknown,
    fieldName: string,
  ): string | undefined {
    const value = this.parseOptionalScalar(raw, fieldName);
    if (value === undefined) {
      return undefined;
    }
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new BadRequestException(`${fieldName} must not be empty`);
    }
    return normalized;
  }

  private parseStringList(
    raw: unknown,
    fieldName: string,
    options: { allowEmpty?: boolean } = {},
  ): string[] | undefined {
    if (raw === undefined) {
      return undefined;
    }

    const values = (Array.isArray(raw) ? raw : [raw])
      .flatMap((value) => {
        if (typeof value !== 'string') {
          throw new BadRequestException(`${fieldName} must contain strings`);
        }
        return value.split(',');
      })
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length === 0 && !options.allowEmpty) {
      throw new BadRequestException(
        `${fieldName} must contain at least one value`,
      );
    }
    return [...new Set(values)];
  }

  private parseOptionalDate(raw: unknown, fieldName: string): Date | undefined {
    const value = this.parseOptionalScalar(raw, fieldName);
    if (value === undefined) {
      return undefined;
    }
    const parsed = new Date(value);
    const isRfc3339DateTime =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
        value,
      );
    if (!isRfc3339DateTime || !Number.isFinite(parsed.getTime())) {
      throw new BadRequestException(
        `${fieldName} must be a valid RFC 3339 date-time`,
      );
    }
    return parsed;
  }

  private parseOptionalBoolean(
    raw: unknown,
    fieldName: string,
  ): boolean | undefined {
    const value = this.parseOptionalScalar(raw, fieldName);
    if (value === undefined) {
      return undefined;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    throw new BadRequestException(`${fieldName} must be true or false`);
  }

  private parseHistoryFilter(
    rawQuery: Record<string, unknown>,
  ): ActivityHistoryFilterDto | undefined {
    if (rawQuery.historyFilter === undefined) return undefined;
    if (
      Object.keys(rawQuery).some(
        (key) => !['historyFilter', 'limit', 'offset'].includes(key),
      )
    ) {
      throw new BadRequestException(
        'historyFilter cannot be combined with other filters',
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(
        this.parseRequiredString(
          this.parseOptionalScalar(rawQuery.historyFilter, 'historyFilter'),
          'historyFilter',
        ),
      );
    } catch {
      throw new BadRequestException('historyFilter must be a JSON object');
    }
    if (
      !validateHistoryFilter(value) ||
      Date.parse(value.windowStart) >= Date.parse(value.windowEnd)
    ) {
      throw new BadRequestException(
        'historyFilter must satisfy the Activity history schema and have start before end',
      );
    }
    return value;
  }

  private parseMetricContinuation(
    rawQuery: Record<string, unknown>,
  ): ActivityMetricContinuationDto | undefined {
    const metricRaw = rawQuery.metric;
    const projectIdsRaw = rawQuery.projectIds;
    const windowStartRaw = rawQuery.windowStart;
    const windowEndRaw = rawQuery.windowEnd;
    const actorScopeRaw = rawQuery.actorScope;
    const actorUserIdRaw = rawQuery.actorUserId;
    const hasAnyValue =
      metricRaw !== undefined ||
      projectIdsRaw !== undefined ||
      windowStartRaw !== undefined ||
      windowEndRaw !== undefined ||
      actorScopeRaw !== undefined ||
      actorUserIdRaw !== undefined;

    if (!hasAnyValue) {
      return undefined;
    }

    const metric = this.parseOptionalEnumValue(
      this.parseOptionalScalar(metricRaw, 'metric'),
      ProjectMetricIdentity,
      'metric',
    );
    const projectIds = this.parseStringList(projectIdsRaw, 'projectIds', {
      allowEmpty: true,
    });
    const windowStart = this.parseOptionalScalar(windowStartRaw, 'windowStart');
    const windowEnd = this.parseOptionalScalar(windowEndRaw, 'windowEnd');
    const actorScope = this.parseOptionalEnumValue(
      this.parseOptionalScalar(actorScopeRaw, 'actorScope'),
      ActivityActorScopeMode,
      'actorScope',
    );
    const actorUserId = this.parseOptionalScalar(actorUserIdRaw, 'actorUserId');
    if (
      metric === undefined ||
      projectIds === undefined ||
      windowStart === undefined ||
      windowEnd === undefined ||
      actorScope === undefined
    ) {
      throw new BadRequestException(
        'Metric Activity queries require metric, projectIds, windowStart, windowEnd, and actorScope',
      );
    }

    if (actorScope === ActivityActorScopeMode.Organization) {
      if (actorUserId !== undefined) {
        throw new BadRequestException(
          'actorUserId is forbidden for organization metric evidence',
        );
      }
    } else if (actorUserId === undefined) {
      throw new BadRequestException(
        'actorUserId is required for personal metric evidence',
      );
    }

    return {
      metric,
      projectIds,
      windowStart,
      windowEnd,
      actorScope:
        actorScope === ActivityActorScopeMode.Personal
          ? { mode: 'PERSONAL', userId: actorUserId as UserId }
          : { mode: 'ORGANIZATION' },
    } satisfies ActivityMetricContinuationDto;
  }

  private assertKnownActivityQueryFields(
    rawQuery: Record<string, unknown>,
  ): void {
    const supported = new Set([
      'historyFilter',
      'projectId',
      'userId',
      'entityType',
      'activityMode',
      'activityType',
      'source',
      'serviceId',
      'since',
      'until',
      'affectsMe',
      'sinceLastVisit',
      'metric',
      'projectIds',
      'windowStart',
      'windowEnd',
      'actorScope',
      'actorUserId',
      'limit',
      'offset',
    ]);
    const unsupported = Object.keys(rawQuery).filter(
      (field) => !supported.has(field),
    );
    if (unsupported.length > 0) {
      throw new BadRequestException(
        `Unsupported Activity query parameter: ${unsupported.sort().join(', ')}`,
      );
    }
  }

  private parseSleepDto(dto: CreateActivitySleepDto): CreateActivitySleepDto {
    return {
      entityId: this.parseRequiredString(dto?.entityId, 'entityId'),
      entityType: this.parseEnumValue(
        dto?.entityType,
        EntityType,
        'entityType',
      ),
      duration: this.parseEnumValue(
        dto?.duration,
        ActivitySleepDuration,
        'duration',
      ),
    } satisfies CreateActivitySleepDto;
  }

  private parseBoundedInt(
    raw: string | undefined,
    defaultValue: number,
    min: number,
    max: number,
    fieldName: string,
  ): number {
    if (raw === undefined) {
      return defaultValue;
    }

    if (raw.trim().length === 0) {
      throw new BadRequestException(
        `${fieldName} must be an integer between ${min} and ${max}`,
      );
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(
        `${fieldName} must be an integer between ${min} and ${max}`,
      );
    }

    return parsed;
  }
}
