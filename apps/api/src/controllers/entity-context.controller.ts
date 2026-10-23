import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AuthToken,
  CurrentOrganization,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import type { OrganizationId, ProjectId } from '../types';
import { EntityType } from '../generated/model/entityType';
import {
  EntityContextService,
  type ActiveGoalsResponseDto,
  type DependentTaskDto,
  type EntityContextIncludeFlags,
  type FeatureSkeletonNode,
  type FeatureSyncContextDto,
  type FullEntityContextDto,
  type ListFeaturesResponseDto,
  type RelatedEntityDepth,
} from '../services/entity-context/entity-context.service';
import type { TaskId } from '../types';
import {
  ProposalDetail,
  type ProposalDetail as ProposalDetailType,
} from '../generated/model/proposalDetail';

const LIST_FEATURES_DEFAULT_LIMIT = 200;
const LIST_FEATURES_MAX_LIMIT = 500;
const LIST_FEATURES_DEFAULT_OFFSET = 0;

const ACTIVE_GOALS_DEFAULT_WINDOW_DAYS = 30;
const ACTIVE_GOALS_MAX_WINDOW_DAYS = 365;

@ApiTags('EntityContext')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/entities/:entityType/:entityId',
)
export class EntityContextController {
  constructor(private readonly entityContextService: EntityContextService) {}

  @Get('context')
  @ApiOperation({
    summary: 'Get unified entity context',
    description:
      'Returns proposal lineage, related entities (with each ' +
      'relationship inline), attached agent sessions, available MCP ' +
      'tools, and creation metadata for any entity. Powers contextual ' +
      'menus and lineage display.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiParam({
    name: 'entityType',
    description: 'Entity type',
    enum: Object.values(EntityType),
  })
  @ApiParam({ name: 'entityId', description: 'Entity ID' })
  @ApiQuery({
    name: 'includeRelatedEntities',
    required: false,
    type: Boolean,
    description:
      'Include relatedEntities and agentSessions in the response. ' +
      'Both are derived from the same graph traversal and gated by the ' +
      'same flag. Defaults to true.',
  })
  @ApiQuery({
    name: 'relatedEntityDepth',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 2,
    description:
      'Graph traversal depth used only for relatedEntities and agentSessions. ' +
      'Defaults to one hop.',
  })
  @ApiQuery({
    name: 'includeFeatureHierarchy',
    required: false,
    type: Boolean,
    description: 'Include feature hierarchy in the response. Defaults to true.',
  })
  @ApiQuery({
    name: 'includePlan',
    required: false,
    type: Boolean,
    description:
      'Include canonical Plan placement in the response. Set false to omit only Plan placement. Defaults to true.',
  })
  @ApiQuery({
    name: 'includeProposals',
    required: false,
    type: Boolean,
    description: 'Include proposal history in the response. Defaults to true.',
  })
  @ApiQuery({
    name: 'includeAvailableMcpTools',
    required: false,
    type: Boolean,
    description:
      'Include available MCP tools in the response. Defaults to true.',
  })
  @ApiQuery({
    name: 'proposalDetail',
    required: false,
    enum: Object.values(ProposalDetail),
    description:
      'Proposal representation. Defaults to bounded summaries; full returns complete updates.',
  })
  @ApiResponse({ status: 200, description: 'Entity context returned' })
  @ApiResponse({ status: 400, description: 'Invalid entity type' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async getEntityContext(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('entityType') entityTypeRaw: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @AuthToken() userToken: string | null,
    @Query('includeRelatedEntities') includeRelatedEntities?: string,
    @Query('relatedEntityDepth') relatedEntityDepth?: string,
    @Query('includeFeatureHierarchy') includeFeatureHierarchy?: string,
    @Query('includeProposals') includeProposals?: string,
    @Query('includeAvailableMcpTools') includeAvailableMcpTools?: string,
    @Query('proposalDetail') proposalDetail?: string,
    @Query('includePlan') includePlan?: string,
  ): Promise<FullEntityContextDto> {
    const entityType = this.parseEntityType(entityTypeRaw);

    const includeFlags: EntityContextIncludeFlags = {
      includeRelatedEntities: this.parseBooleanQuery(includeRelatedEntities),
      includeFeatureHierarchy: this.parseBooleanQuery(includeFeatureHierarchy),
      includePlan: this.parseBooleanQuery(includePlan),
      includeProposals: this.parseBooleanQuery(includeProposals),
      includeAvailableMcpTools: this.parseBooleanQuery(
        includeAvailableMcpTools,
      ),
      relatedEntityDepth: this.parseRelatedEntityDepth(relatedEntityDepth),
      proposalDetail: this.parseProposalDetail(proposalDetail),
    };

    return this.entityContextService.getFullEntityContext(
      organizationId,
      projectId as ProjectId,
      entityType,
      entityId,
      userToken,
      includeFlags,
    );
  }

  @Get('dependent-tasks')
  @ApiOperation({
    summary: 'Resolve dependent tasks via agent-authored edges',
    description:
      'Traverses agent-authored topology edges (DEPENDS_ON, DERIVES_FROM, ' +
      'SUPERSEDES, CONTRADICTS, RELATED_TO) to discover tasks connected to ' +
      'the given entity. Returns task content (description, acceptance ' +
      'criteria) and edge reasoning for each dependent task.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiParam({
    name: 'entityType',
    description: 'Entity type',
    enum: Object.values(EntityType),
  })
  @ApiParam({ name: 'entityId', description: 'Entity ID' })
  @ApiResponse({
    status: 200,
    description: 'Dependent tasks resolved from agent-authored edges',
  })
  @ApiResponse({ status: 400, description: 'Invalid entity type' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async getDependentTasks(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('entityType') entityTypeRaw: string,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @AuthToken() userToken: string | null,
  ): Promise<DependentTaskDto[]> {
    this.parseEntityType(entityTypeRaw); // validate entity type

    return this.entityContextService.resolveDependentTasks(
      organizationId,
      projectId as ProjectId,
      entityId,
      userToken,
    );
  }

  private parseBooleanQuery(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    return value !== 'false' && value !== '0';
  }

  private parseRelatedEntityDepth(
    value: string | undefined,
  ): RelatedEntityDepth {
    if (value === undefined) return 1;
    if (value === '1' || value === '2')
      return Number(value) as RelatedEntityDepth;
    throw new BadRequestException('relatedEntityDepth must be 1 or 2');
  }

  private parseProposalDetail(value: string | undefined): ProposalDetailType {
    if (value === undefined || value === ProposalDetail.Summary) {
      return ProposalDetail.Summary;
    }
    if (value === ProposalDetail.Full) return ProposalDetail.Full;
    throw new BadRequestException('proposalDetail must be summary or full');
  }

  private parseEntityType(value: string): EntityType {
    const normalized = value.toUpperCase();
    const values = Object.values(EntityType);
    if (!values.includes(normalized as EntityType)) {
      throw new BadRequestException(`Unsupported entity type: ${value}`);
    }
    return normalized as EntityType;
  }
}

@ApiTags('EntityContext')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/tasks/:taskId',
)
export class FeatureSyncContextController {
  constructor(private readonly entityContextService: EntityContextService) {}

  @Get('feature-sync-context')
  @ApiOperation({
    summary: 'Get ancestor feature chain for the feature-sync sub-agent',
    description:
      'Walks the parent chain above the given task and returns every ' +
      'FEATURE-typed ancestor, inline with its full description and ' +
      'requirements, in walk order (nearest first). Scoped to the ' +
      'feature-sync sub-agent for hierarchy-walk drift and enrichment ' +
      'checks — other sub-agents continue to use the lean get_context.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiParam({
    name: 'taskId',
    description: 'Task ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Ancestor feature chain returned successfully',
  })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async getFeatureSyncContext(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<FeatureSyncContextDto> {
    return this.entityContextService.getFeatureSyncContext(
      organizationId,
      projectId as ProjectId,
      taskId as TaskId,
    );
  }
}

@ApiTags('EntityContext')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId')
export class ProjectFeaturesController {
  constructor(private readonly entityContextService: EntityContextService) {}

  @Get('features')
  @ApiOperation({
    summary: 'List every FEATURE-typed task in the project',
    description:
      'Returns a flat list of all FEATURE-typed tasks in the project, ' +
      'ordered pre-order DFS so reading top-to-bottom shows the ' +
      'hierarchy. Each entry carries parentFeatureId and depth, letting ' +
      "a caller rebuild the tree in O(n). Designed as the bird's-eye " +
      'counterpart to semantic search_features — cheap to call freely ' +
      'for orientation.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description:
      'Maximum number of features to return per page. ' +
      `Defaults to ${LIST_FEATURES_DEFAULT_LIMIT}, ` +
      `capped at ${LIST_FEATURES_MAX_LIMIT}.`,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Offset into the full DFS-ordered result set.',
  })
  @ApiResponse({
    status: 200,
    description: 'Project feature list returned successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid pagination parameters' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async listProjectFeatures(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<ListFeaturesResponseDto> {
    const limit = this.parsePositiveInt(
      limitRaw,
      LIST_FEATURES_DEFAULT_LIMIT,
      'limit',
      { min: 1, max: LIST_FEATURES_MAX_LIMIT },
    );
    const offset = this.parsePositiveInt(
      offsetRaw,
      LIST_FEATURES_DEFAULT_OFFSET,
      'offset',
      { min: 0 },
    );

    return this.entityContextService.listFeatures(
      organizationId,
      projectId as ProjectId,
      limit,
      offset,
    );
  }

  @Get('features/skeleton')
  @ApiOperation({
    summary: "Get the project's feature tree skeleton",
    description:
      "Returns the project's full FEATURE tree as a flat array of " +
      'compact skeleton nodes, ordered pre-order DFS so reading ' +
      'top-to-bottom shows the hierarchy. Each entry carries id, name, ' +
      'tag, status, parentId, depth, and direct (non-recursive) ' +
      'taskCount. The CLI consumes the whole tree at Feature Tree ' +
      "Conversation session init and injects it into the agent's system " +
      'prompt; no pagination — the caller takes the entire array in one ' +
      'response.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Project feature skeleton returned successfully',
  })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async getProjectFeaturesSkeleton(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<FeatureSkeletonNode[]> {
    return this.entityContextService.getProjectFeaturesSkeleton(
      organizationId,
      projectId as ProjectId,
    );
  }

  private parsePositiveInt(
    raw: string | undefined,
    fallback: number,
    name: string,
    bounds: { min: number; max?: number },
  ): number {
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < bounds.min) {
      throw new BadRequestException(
        `${name} must be an integer >= ${bounds.min}`,
      );
    }
    if (bounds.max !== undefined && parsed > bounds.max) {
      throw new BadRequestException(`${name} must not exceed ${bounds.max}`);
    }
    return parsed;
  }
}

@ApiTags('EntityContext')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId/projects/:projectId')
export class ProjectGoalsController {
  constructor(private readonly entityContextService: EntityContextService) {}

  @Get('goals/active')
  @ApiOperation({
    summary: 'List active goals for a user within a look-ahead window',
    description:
      'Returns GOAL-typed tasks whose dueDate falls between now and ' +
      'windowDays from now and whose status is not COMPLETED, ' +
      'CANCELLED, or ARCHIVED. Ordered by dueDate ascending then name ' +
      'ascending. userId is part of the contract for the future ' +
      'membership-join work — today every active goal is project-wide.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({
    name: 'projectId',
    description: 'Project ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'userId',
    required: true,
    type: String,
    description: 'User the active goals are being fetched for.',
  })
  @ApiQuery({
    name: 'windowDays',
    required: false,
    type: Number,
    description:
      `Look-ahead window in days from now. Defaults to ` +
      `${ACTIVE_GOALS_DEFAULT_WINDOW_DAYS}, capped at ` +
      `${ACTIVE_GOALS_MAX_WINDOW_DAYS}.`,
  })
  @ApiResponse({
    status: 200,
    description: 'Active goals returned successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  async listActiveGoals(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
    @Query('windowDays') windowDaysRaw?: string,
  ): Promise<ActiveGoalsResponseDto> {
    const windowDays = this.parsePositiveInt(
      windowDaysRaw,
      ACTIVE_GOALS_DEFAULT_WINDOW_DAYS,
      'windowDays',
      { min: 1, max: ACTIVE_GOALS_MAX_WINDOW_DAYS },
    );

    return this.entityContextService.getActiveGoals(
      organizationId,
      projectId as ProjectId,
      userId,
      windowDays,
    );
  }

  private parsePositiveInt(
    raw: string | undefined,
    fallback: number,
    name: string,
    bounds: { min: number; max?: number },
  ): number {
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < bounds.min) {
      throw new BadRequestException(
        `${name} must be an integer >= ${bounds.min}`,
      );
    }
    if (bounds.max !== undefined && parsed > bounds.max) {
      throw new BadRequestException(`${name} must not exceed ${bounds.max}`);
    }
    return parsed;
  }
}
