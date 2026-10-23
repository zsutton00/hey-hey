import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import { withApiSpan } from 'src/telemetry/api-tracing';
import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AttachToGoalDto,
  AttachToGoalResponseDto,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  CreateTaskDto,
  CreateTaskDependencyDto,
  DetachFromGoalDto,
  DetachFromGoalResponseDto,
  Influence,
  PaginatedWorkItemReferenceResponseDto,
  SupersedeTaskDto,
  TaskAllowedStatusesResponseDto,
  TaskDependencyResponseDto,
  TaskHierarchyResponseDto,
  TaskResponseDto,
  UpdateTaskDto,
  UpdateTaskDependencyDto,
  UpdateTaskResponseDto,
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphParticipationType,
  WorkStatus,
} from 'src/generated';
import { RelationshipType } from 'src/generated/graphs/model/relationshipType';
import { TaskService } from '../services/tasks/task.service';
import { GoalTracksService } from '../services/tasks/goal-tracks.service';
import { TaskSupersedeService } from '../services/tasks/task-supersede.service';
import { WorkItemTypeRegistryService } from '../services/tasks/work-item-type-registry.service';
import { ProposalService } from '../services/proposal/proposal.service';
import type { StampedCreateProposalDto } from '../services/proposal/proposal.types';
import { buildUserRequestorContext } from '../services/proposal/user-requestor-context';
import { explainFieldUpdate } from '../services/proposal/proposal-eli5';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import {
  AgentSessionId,
  OrganizationId,
  InitiativeId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';

const openApiDateTimeSchema = z.string().datetime({ offset: true });
const REFERENCE_SORT_FIELDS = ['name', 'createdAt'] as const;
const REFERENCE_SORT_ORDERS = ['asc', 'desc'] as const;

type ReferenceSortField = (typeof REFERENCE_SORT_FIELDS)[number];
type ReferenceSortOrder = (typeof REFERENCE_SORT_ORDERS)[number];

const assertDueDateMatchesContract = (
  dueDate: string | null | undefined,
): void => {
  if (dueDate == null) return;
  if (!openApiDateTimeSchema.safeParse(dueDate).success) {
    throw new BadRequestException(
      'dueDate must be a full ISO 8601 date-time; date-only values are not accepted.',
    );
  }
};

@ApiTags('tasks')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-items',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class TaskController {
  constructor(
    private readonly taskService: TaskService,
    private readonly proposalService: ProposalService,
    private readonly goalTracksService: GoalTracksService,
    private readonly taskSupersedeService: TaskSupersedeService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new task' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'initiativeId',
    required: false,
    description:
      'Initiative ID. Required for non-FEATURE tasks; may also be provided in the request body.',
  })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 404, description: 'Initiative not found' })
  async create(
    @Body() createTaskDto: CreateTaskDto,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Query('initiativeId') initiativeIdFromQuery: InitiativeId | undefined,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') _currentUserId: UserId,
  ): Promise<TaskResponseDto> {
    assertDueDateMatchesContract(createTaskDto.dueDate);
    const initiativeId = (createTaskDto.initiativeId ||
      initiativeIdFromQuery ||
      undefined) as InitiativeId | undefined;

    if (
      createTaskDto.type === WORK_ITEM_TYPE_KEYS.Standard &&
      !createTaskDto.parentTaskId
    ) {
      throw new BadRequestException('Standard tasks must have a parent task');
    }

    return this.taskService.create(
      organizationId,
      initiativeId,
      createTaskDto,
      projectId,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Get tasks for a project' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'initiativeId',
    required: false,
    description:
      'When provided, restricts results to a single initiative. Omit to list tasks across the organization.',
  })
  @ApiQuery({
    name: 'parentTaskId',
    required: false,
    description:
      'Filter to direct children of a parent task. Omit to retrieve top-level tasks.',
  })
  @ApiQuery({
    name: 'parentTaskIds',
    required: false,
    description:
      'Filter to direct children of a bounded set of parent tasks. Mutually exclusive with parentTaskId and includeDescendants.',
    schema: {
      type: 'array',
      maxItems: 200,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
    style: 'form',
    explode: true,
  })
  @ApiQuery({
    name: 'includeDesignDocCounts',
    required: false,
    description: 'When true, include design doc link counts for each task.',
  })
  @ApiQuery({
    name: 'includeDescendants',
    required: false,
    description:
      "When true and parentTaskId refers to a FEATURE, includes tasks assigned to any descendant feature in that feature's subtree. Defaults to false.",
    schema: { type: 'boolean', default: false },
  })
  @ApiQuery({
    name: 'includeTrackedEntities',
    required: false,
    description:
      'When true or omitted, GOAL work items include embedded TRACKS target snapshots. When false, omit only trackedEntities.',
    schema: { type: 'boolean', default: true },
  })
  @ApiQuery({
    name: 'includeTrackedWorkSummary',
    required: false,
    description:
      'When true, GOAL work items include the compact trackedWorkSummary aggregate, independently of includeTrackedEntities.',
    schema: { type: 'boolean', default: false },
  })
  @ApiQuery({
    name: 'includeAgentSessionCounts',
    required: false,
    description:
      'When true, include codingSessionCount and agentSessionCount for each task.',
  })
  @ApiQuery({
    name: 'includeServiceRelations',
    required: false,
    description: 'When true, include service relation records for each task.',
  })
  @ApiQuery({
    name: 'includeEdges',
    required: false,
    description:
      'When true, include agent-authored graph edges that touch each task (inbound + outbound, deduplicated) under an `edges` field on each TaskResponseDto. Requires an authenticated user token. Omitted edgeTypes preserves the default generic edge behavior.',
  })
  @ApiQuery({
    name: 'edgeTypes',
    required: false,
    description:
      'Agent edge labels to request when includeEdges=true or when filtering by a connected entity. Omit to preserve the default generic edge behavior when no connected entity is supplied; provided values replace the default label list for this request.',
    enum: AgentEdgeType,
    isArray: true,
  })
  @ApiQuery({
    name: 'relatedEntityId',
    required: false,
    description:
      'Select work items directly connected to this entity. Requires relatedEntityType and edgeTypes.',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiQuery({
    name: 'relatedEntityType',
    required: false,
    description:
      'Canonical Graph entity type for relatedEntityId. Requires relatedEntityId and edgeTypes.',
    enum: AgentEdgeEndpointEntityType,
  })
  @ApiQuery({
    name: 'includeSectionKeys',
    required: false,
    description:
      'When provided, include only the requested section keys in each task response.',
    isArray: true,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    description:
      'Filter by task statuses (comma-separated or repeated query params).',
    isArray: true,
    enum: WorkStatus,
  })
  @ApiQuery({
    name: 'taskIds',
    required: false,
    description:
      'Filter to a bounded set of requested task IDs within this organization and project.',
    isArray: true,
  })
  @ApiQuery({
    name: 'type',
    required: false,
    description: 'Filter by work-item type key (built-in or custom).',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number (1-based). Defaults to 1.',
    schema: { type: 'integer', minimum: 1, default: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of tasks per page. Defaults to 50, maximum 500.',
    schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Field to sort tasks by. Defaults to createdAt.',
    enum: ['createdAt', 'updatedAt', 'title', 'status', 'priority'],
  })
  @ApiQuery({
    name: 'sortDir',
    required: false,
    description: 'Sort direction. Defaults to desc.',
    enum: ['asc', 'desc'],
  })
  @ApiResponse({ status: 200, description: 'Tasks retrieved successfully' })
  async findAll(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('initiativeId') initiativeId?: InitiativeId,
    @Query('parentTaskId') parentTaskId?: string,
    @Query('includeDesignDocCounts') includeDesignDocCounts?: string,
    @Query('includeAgentSessionCounts') includeAgentSessionCounts?: string,
    @Query('includeServiceRelations') includeServiceRelations?: string,
    @Query('includeEdges') includeEdges?: string,
    @Query('includeSectionKeys') includeSectionKeys?: string | string[],
    @Query('status') status?: string | string[],
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortDir') sortDir?: string,
    @Query('includeDescendants') includeDescendants?: string,
    @AuthToken() userToken?: string | null,
    @Query('edgeTypes') edgeTypes?: string | string[],
    @Query('taskIds') taskIds?: string | string[],
    @Query('relatedEntityId') relatedEntityId?: string,
    @Query('relatedEntityType') relatedEntityType?: string,
    @Query('includeTrackedEntities') includeTrackedEntities?: string,
    @Query('parentTaskIds') parentTaskIds?: string | string[],
    @Query('includeTrackedWorkSummary') includeTrackedWorkSummary?: string,
  ): Promise<TaskResponseDto[]> {
    const hasParentTaskIdFilter =
      typeof parentTaskId === 'string' && parentTaskId.trim().length > 0;
    const normalizedParentId = hasParentTaskIdFilter
      ? parentTaskId.toLowerCase() === 'null'
        ? null
        : (parentTaskId as TaskId)
      : undefined;
    const normalizedParentIds = this.normalizeUuidList(
      'parentTaskIds',
      parentTaskIds,
      200,
    ) as TaskId[] | undefined;
    if (hasParentTaskIdFilter && normalizedParentIds) {
      throw new BadRequestException(
        'parentTaskId and parentTaskIds are mutually exclusive',
      );
    }

    const includeDescendantsFlag = includeDescendants?.toLowerCase() === 'true';
    const includeTrackedEntitiesFlag =
      includeTrackedEntities?.toLowerCase() !== 'false';
    const includeTrackedWorkSummaryFlag =
      includeTrackedWorkSummary?.toLowerCase() === 'true';
    if (includeDescendantsFlag && normalizedParentIds) {
      throw new BadRequestException(
        'includeDescendants cannot be combined with parentTaskIds',
      );
    }
    const includeDesignDocs = includeDesignDocCounts?.toLowerCase() === 'true';
    const includeAgentSessions =
      includeAgentSessionCounts?.toLowerCase() === 'true';
    const includeServices = includeServiceRelations?.toLowerCase() === 'true';
    const includeEdgesFlag = includeEdges?.toLowerCase() === 'true';
    const requestedEdgeTypes = this.normalizeEdgeTypes(edgeTypes);
    const relatedEntity = this.normalizeRelatedEntity(
      relatedEntityId,
      relatedEntityType,
      requestedEdgeTypes,
    );
    const statuses = this.normalizeStatuses(status);
    const requestedTaskIds = this.normalizeTaskIds(taskIds);
    const sectionKeys = this.normalizeSectionKeys(includeSectionKeys);
    const parsedPage = page !== undefined ? parseInt(page, 10) : undefined;
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : undefined;
    if (parsedPage !== undefined && (isNaN(parsedPage) || parsedPage < 1)) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (parsedLimit !== undefined && (isNaN(parsedLimit) || parsedLimit < 1)) {
      throw new BadRequestException('limit must be a positive integer');
    }

    const validSortByValues = [
      'createdAt',
      'updatedAt',
      'title',
      'status',
      'priority',
    ];
    const validSortDirValues = ['asc', 'desc'];
    if (sortBy !== undefined && !validSortByValues.includes(sortBy)) {
      throw new BadRequestException(
        `sortBy must be one of: ${validSortByValues.join(', ')}`,
      );
    }
    if (sortDir !== undefined && !validSortDirValues.includes(sortDir)) {
      throw new BadRequestException(`sortDir must be one of: asc, desc`);
    }

    const resolvedSortBy = (sortBy ?? 'createdAt') as
      | 'createdAt'
      | 'updatedAt'
      | 'title'
      | 'status'
      | 'priority';
    const resolvedSortDir = (sortDir ?? 'desc') as 'asc' | 'desc';

    const filters = {
      includeDesignDocCounts: includeDesignDocs,
      includeAgentSessionCounts: includeAgentSessions,
      includeServiceRelations: includeServices,
      includeEdges: includeEdgesFlag,
      includeTrackedEntities: includeTrackedEntitiesFlag,
      includeTrackedWorkSummary: includeTrackedWorkSummaryFlag,
      userToken: userToken ?? null,
      projectId,
      ...(requestedEdgeTypes ? { edgeTypes: requestedEdgeTypes } : {}),
      ...(relatedEntity ?? {}),
      ...(sectionKeys ? { includeSectionKeys: sectionKeys } : {}),
      ...(statuses ? { statuses } : {}),
      ...(requestedTaskIds ? { taskIds: requestedTaskIds } : {}),
      ...(hasParentTaskIdFilter ? { parentTaskId: normalizedParentId } : {}),
      ...(normalizedParentIds ? { parentTaskIds: normalizedParentIds } : {}),
      ...(includeDescendantsFlag ? { includeDescendants: true as const } : {}),
      ...(type ? { taskType: type } : {}),
      ...(parsedPage !== undefined ? { page: parsedPage } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
      sortBy: resolvedSortBy,
      sortDir: resolvedSortDir,
    };

    if (initiativeId) {
      return this.taskService.findAll(organizationId, initiativeId, filters);
    }

    return this.taskService.findAllByOrganizationForAdapter(organizationId, {
      ...filters,
      projectId,
    });
  }

  @Get('references')
  @ApiOperation({ summary: 'List lightweight work-item references' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'type',
    required: true,
    description: 'Work-item type key to include in the reference page.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'page',
    required: true,
    description: '1-based page number in the deterministic result set.',
    schema: { type: 'integer', minimum: 1 },
  })
  @ApiQuery({
    name: 'limit',
    required: true,
    description: 'Number of references to return, from 1 through 500.',
    schema: { type: 'integer', minimum: 1, maximum: 500 },
  })
  @ApiQuery({
    name: 'filter',
    required: false,
    description:
      'Optional case-insensitive substring filter on canonical name.',
    schema: { type: 'string' },
  })
  @ApiQuery({
    name: 'statuses',
    required: false,
    description: 'Optional status set applied before counting and pagination.',
    isArray: true,
    enum: WorkStatus,
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    description: 'Reference field used for deterministic ordering.',
    enum: REFERENCE_SORT_FIELDS,
    schema: { default: 'name' },
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    description: 'Direction used for deterministic reference ordering.',
    enum: REFERENCE_SORT_ORDERS,
    schema: { default: 'asc' },
  })
  @ApiResponse({
    status: 200,
    description: 'A deterministic page of lightweight work-item references.',
  })
  @ApiResponse({
    status: 400,
    description: 'Missing or invalid reference query values.',
  })
  async findReferences(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('filter') filter?: string,
    @Query('statuses') statuses?: string | string[],
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ): Promise<PaginatedWorkItemReferenceResponseDto> {
    if (typeof type !== 'string' || type.trim().length === 0) {
      throw new BadRequestException('type is required');
    }

    const parsedPage = this.parseReferencePaginationValue(page, 'page', 1);
    const parsedLimit = this.parseReferencePaginationValue(
      limit,
      'limit',
      1,
      500,
    );

    return this.taskService.findReferences(
      organizationId,
      projectId,
      type.trim(),
      parsedPage,
      parsedLimit,
      filter?.trim() || undefined,
      this.normalizeReferenceStatuses(statuses),
      this.normalizeReferenceSortField(sortBy),
      this.normalizeReferenceSortOrder(sortOrder),
    );
  }

  @Get('allowed-statuses')
  @ApiOperation({
    summary: 'Get the allowed work statuses for each task type',
    description:
      'Returns, per task type, the complete set of work statuses that type ' +
      'permits. This is the single backed source for the frontend status ' +
      'picker — it is a thin read of the per-type allowed-status constant, ' +
      'so the picker never re-derives validity client-side.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Per-type allowed status sets retrieved successfully.',
  })
  getAllowedStatuses(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
  ): TaskAllowedStatusesResponseDto {
    return {
      entries: this.workItemTypeRegistry.getAllowedStatusEntries(projectId),
    };
  }

  @Get(':workItemId/graph')
  @ApiOperation({ summary: 'Get a graph-capable work-item aggregate' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'workItemId', description: 'Work item ID' })
  @ApiResponse({
    status: 200,
    description: 'Graph-capable work-item aggregate retrieved successfully',
  })
  @ApiResponse({ status: 400, description: 'Graph capability is unavailable' })
  @ApiResponse({ status: 401, description: 'Authentication token is required' })
  @ApiResponse({ status: 404, description: 'Work item not found' })
  @ApiQuery({
    name: 'incidentRelationshipTypes',
    required: false,
    description:
      'Exact bounded Contract-participation relationship labels to project. Omit for no participation evidence.',
    enum: WorkItemGraphParticipationType,
    isArray: true,
  })
  async getGraphAggregate(
    @Param('workItemId', ParseUUIDPipe) workItemId: TaskId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @AuthToken() userToken?: string | null,
    @Query('incidentRelationshipTypes')
    incidentRelationshipTypes?: string | string[],
  ): Promise<WorkItemGraphAggregateResponseDto> {
    return this.taskService.getGraphAggregate(
      organizationId,
      projectId,
      workItemId,
      userToken ?? null,
      this.normalizeIncidentRelationshipTypes(incidentRelationshipTypes),
    );
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'Get a specific task by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiQuery({
    name: 'includeDesignDocCounts',
    required: false,
    description: 'When true, include design doc link counts for the task.',
  })
  @ApiQuery({
    name: 'includeAgentSessionCounts',
    required: false,
    description:
      'When true, include codingSessionCount and agentSessionCount for the task.',
  })
  @ApiQuery({
    name: 'includeServiceRelations',
    required: false,
    description: 'When true, include service relation records for the task.',
  })
  @ApiQuery({
    name: 'includeEdges',
    required: false,
    description:
      'When true, include agent-authored graph edges that touch the task (inbound + outbound, deduplicated) under an `edges` field on the TaskResponseDto. Requires an authenticated user token. Omitted edgeTypes preserves the default generic edge behavior.',
  })
  @ApiQuery({
    name: 'edgeTypes',
    required: false,
    description:
      'Agent edge labels to request when includeEdges=true. Omit to preserve the default generic edge behavior; provided values replace the default label list for this request.',
    enum: AgentEdgeType,
    isArray: true,
  })
  @ApiResponse({ status: 200, description: 'Task retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async findOne(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('includeDesignDocCounts') includeDesignDocCounts?: string,
    @Query('includeAgentSessionCounts') includeAgentSessionCounts?: string,
    @Query('includeServiceRelations') includeServiceRelations?: string,
    @Query('includeEdges') includeEdges?: string,
    @AuthToken() userToken?: string | null,
    @Query('edgeTypes') edgeTypes?: string | string[],
  ): Promise<TaskResponseDto> {
    const requestedEdgeTypes = this.normalizeEdgeTypes(edgeTypes);
    const task = requestedEdgeTypes
      ? await this.taskService.findOneByOrganization(
          organizationId,
          taskId,
          includeDesignDocCounts?.toLowerCase() === 'true',
          includeAgentSessionCounts?.toLowerCase() === 'true',
          includeServiceRelations?.toLowerCase() === 'true',
          includeEdges?.toLowerCase() === 'true',
          userToken ?? null,
          requestedEdgeTypes,
        )
      : await this.taskService.findOneByOrganization(
          organizationId,
          taskId,
          includeDesignDocCounts?.toLowerCase() === 'true',
          includeAgentSessionCounts?.toLowerCase() === 'true',
          includeServiceRelations?.toLowerCase() === 'true',
          includeEdges?.toLowerCase() === 'true',
          userToken ?? null,
        );
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  @Get(':taskId/hierarchy')
  @ApiOperation({
    summary: 'Get a task with its parent and children',
    description:
      'Returns the task, its parent (if present), and its direct children.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiQuery({
    name: 'includeDesignDocCounts',
    required: false,
    description:
      'When true, include design doc link counts for the task and related tasks.',
  })
  @ApiQuery({
    name: 'includeAgentSessionCounts',
    required: false,
    description:
      'When true, include codingSessionCount and agentSessionCount for the task and related tasks.',
  })
  @ApiQuery({
    name: 'includeServiceRelations',
    required: false,
    description:
      'When true, include service relation records for the task and related tasks.',
  })
  @ApiResponse({
    status: 200,
    description: 'Task hierarchy retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async findHierarchy(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('includeDesignDocCounts') includeDesignDocCounts?: string,
    @Query('includeAgentSessionCounts') includeAgentSessionCounts?: string,
    @Query('includeServiceRelations') includeServiceRelations?: string,
  ): Promise<TaskHierarchyResponseDto> {
    return this.taskService.findHierarchyByOrganization(
      organizationId,
      taskId,
      includeDesignDocCounts?.toLowerCase() === 'true',
      includeAgentSessionCounts?.toLowerCase() === 'true',
      includeServiceRelations?.toLowerCase() === 'true',
    );
  }

  @Post(':taskId/tracks')
  @ApiOperation({ summary: 'Attach an entity to a goal' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Goal task ID' })
  @ApiResponse({
    status: 201,
    description: 'TRACKS edge created (created: true).',
  })
  @ApiResponse({
    status: 200,
    description:
      'Idempotent re-attach against an entity that was already tracked ' +
      '(created: false).',
  })
  @ApiResponse({
    status: 400,
    description:
      'Source task is not GOAL or target type is outside the permitted set.',
  })
  @ApiResponse({ status: 404, description: 'Goal or target not found' })
  async attachToGoal(
    @Param('taskId', ParseUUIDPipe) taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() body: AttachToGoalDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @AuthToken() userToken: string | null,
    @Req() request: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AttachToGoalResponseDto> {
    const headerValue = request.headers['x-agent-session-id'];
    const rawSessionId = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;
    const sessionId = rawSessionId ? (rawSessionId as AgentSessionId) : null;
    const result = await this.goalTracksService.attachToGoal(
      organizationId,
      projectId,
      taskId,
      body,
      sessionId,
      userToken,
    );
    res.status(result.created ? 201 : 200);
    return result;
  }

  @Delete(':taskId/tracks')
  @ApiOperation({ summary: 'Detach an entity from a goal' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Goal task ID' })
  @ApiResponse({
    status: 200,
    description:
      'Detach result. deleted=true when an existing edge was removed; ' +
      'deleted=false when no edge matched and the call was a no-op.',
  })
  @ApiResponse({ status: 400, description: 'Source task is not GOAL' })
  @ApiResponse({ status: 404, description: 'Goal not found' })
  async detachFromGoal(
    @Param('taskId', ParseUUIDPipe) taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() body: DetachFromGoalDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @AuthToken() userToken: string | null,
  ): Promise<DetachFromGoalResponseDto> {
    return this.goalTracksService.detachFromGoal(
      organizationId,
      projectId,
      taskId,
      body,
      userToken,
    );
  }

  @Post(':taskId/supersede')
  @ApiOperation({
    summary: 'Supersede a task with a named successor',
    description:
      'Supersede transition: authors a single proposal that sets this ' +
      "task's status to SUPERSEDED and declares a SUPERSEDES edge to the " +
      'named successor. Status and edge travel together on one reviewable ' +
      'proposal — the proposal validator rejects either half alone, so the ' +
      'plain status-edit path cannot produce a SUPERSEDED task. A successor ' +
      'id is required, and task types that disallow SUPERSEDED (BUG, GOAL) ' +
      'are rejected. The response mirrors PATCH: `status: APPLIED` when the ' +
      'proposal auto-applies, or `status: PENDING` with the proposal that ' +
      'needs review.',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'ID of the task being superseded' })
  @ApiResponse({
    status: 201,
    description:
      'Supersede proposal authored. Carries `status: APPLIED` with the ' +
      'now-SUPERSEDED task, or `status: PENDING` with the unchanged task ' +
      'and the `proposal` that needs review.',
  })
  @ApiResponse({
    status: 400,
    description:
      'No successor supplied, successor equals the task, the task type ' +
      'disallows SUPERSEDED, or the task is already superseded.',
  })
  @ApiResponse({ status: 404, description: 'Task or successor not found' })
  async supersedeTask(
    @Param('taskId', ParseUUIDPipe) taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() body: SupersedeTaskDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<UpdateTaskResponseDto> {
    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'POST /work-items/:taskId/supersede',
    );
    return this.taskSupersedeService.supersedeTask(
      organizationId,
      projectId,
      taskId,
      body,
      user.userId,
      requestorContext,
    );
  }

  @Get(':taskId/dependencies')
  @ApiOperation({ summary: 'List task dependencies' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description: 'Task dependencies retrieved successfully',
  })
  async listDependencies(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<TaskDependencyResponseDto[]> {
    return this.taskService.listDependenciesByOrganization(
      organizationId,
      taskId,
    );
  }

  @Post(':taskId/dependencies')
  @ApiOperation({ summary: 'Create a task dependency' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiResponse({
    status: 201,
    description: 'Task dependency created successfully',
  })
  async createDependency(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @Body() createDependencyDto: CreateTaskDependencyDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<TaskDependencyResponseDto> {
    return this.taskService.createDependencyByOrganization(
      organizationId,
      taskId,
      createDependencyDto,
      userId,
    );
  }

  @Patch(':taskId/dependencies/:dependencyId')
  @ApiOperation({ summary: 'Update a task dependency' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiParam({ name: 'dependencyId', description: 'Dependency ID' })
  @ApiResponse({
    status: 200,
    description: 'Task dependency updated successfully',
  })
  async updateDependency(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @Param('dependencyId') dependencyId: string,
    @Body() updateDependencyDto: UpdateTaskDependencyDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<TaskDependencyResponseDto> {
    return this.taskService.updateDependencyByOrganization(
      organizationId,
      taskId,
      dependencyId,
      updateDependencyDto,
      userId,
    );
  }

  @Delete(':taskId/dependencies/:dependencyId')
  @ApiOperation({ summary: 'Remove a task dependency' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiParam({ name: 'dependencyId', description: 'Dependency ID' })
  @ApiResponse({
    status: 200,
    description: 'Task dependency removed successfully',
  })
  async removeDependency(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @Param('dependencyId') dependencyId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<TaskDependencyResponseDto> {
    return this.taskService.removeDependencyByOrganization(
      organizationId,
      taskId,
      dependencyId,
    );
  }

  @Patch(':taskId')
  @ApiOperation({ summary: 'Update a task' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiResponse({
    status: 200,
    description:
      'Update accepted. Response carries `status: APPLIED` with the ' +
      'updated task when the change took effect, or `status: PENDING` ' +
      'with the unchanged task and a `proposal` payload otherwise.',
  })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async update(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() updateTaskDto: UpdateTaskDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<UpdateTaskResponseDto> {
    // `reason` is metadata about the edit, not part of the diff to enact.
    // Strip it at the controller boundary so it never lands in the proposal's
    // `updates` payload (which is replayed verbatim by enactUpdate).
    const { reason, ...updates } = updateTaskDto;
    assertDueDateMatchesContract(updates.dueDate);

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'PATCH /work-items/:taskId requires at least one field to change.',
      );
    }

    const requestorContext = buildUserRequestorContext(
      user,
      organizationId,
      request,
      'PATCH /work-items/:taskId',
    );

    const userInfluence: Influence = {
      entityId: user.userId,
      entityType: 'USER',
      reasonType: 'user_reason',
      reasoning: (reason ?? '').trim(),
    };

    const dto: StampedCreateProposalDto = {
      type: 'SINGLE',
      action: 'UPDATE',
      eli5: explainFieldUpdate('task', Object.keys(updates)),
      targetEntityId: taskId,
      targetEntityType: 'TASK',
      updates,
      requestorContext,
      influences: [userInfluence],
    };

    const proposal = await this.proposalService.create(
      organizationId,
      projectId,
      user.userId,
      dto,
    );

    const task = await withApiSpan('work_item.patch.response_read', () =>
      this.taskService.findOneByOrganization(organizationId, taskId),
    );
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found.`);
    }

    if (proposal.status === 'APPROVED') {
      return { status: 'APPLIED', task };
    }
    return { status: 'PENDING', task, proposal };
  }

  @Delete(':taskId')
  @ApiOperation({ summary: 'Archive a task (soft delete)' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'taskId', description: 'Task ID' })
  @ApiResponse({ status: 200, description: 'Task archived successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  async remove(
    @Param('taskId') taskId: TaskId,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<TaskResponseDto> {
    return this.taskService.removeByOrganization(organizationId, taskId);
  }

  private parseReferencePaginationValue(
    raw: string | undefined,
    field: string,
    minimum: number,
    maximum?: number,
  ): number {
    if (raw === undefined || raw.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }

    const parsed = Number(raw);
    const isOutOfRange =
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < minimum ||
      (maximum !== undefined && parsed > maximum);
    if (isOutOfRange) {
      const range =
        maximum === undefined
          ? `at least ${minimum}`
          : `between ${minimum} and ${maximum}`;
      throw new BadRequestException(`${field} must be an integer ${range}`);
    }

    return parsed;
  }

  private normalizeReferenceStatuses(
    statuses?: string | string[],
  ): WorkStatus[] | undefined {
    if (statuses === undefined) return undefined;

    const values = (Array.isArray(statuses) ? statuses : [statuses])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length === 0) return undefined;

    const statusByValue = new Map<string, WorkStatus>(
      Object.values(WorkStatus).map((status) => [status, status]),
    );
    const normalized = values.map((value) => statusByValue.get(value));
    if (normalized.some((status) => status === undefined)) {
      throw new BadRequestException(
        `statuses must contain only WorkStatus values`,
      );
    }

    return [...new Set(normalized.filter((status) => status !== undefined))];
  }

  private normalizeReferenceSortField(sortBy?: string): ReferenceSortField {
    if (sortBy === undefined || sortBy.length === 0) return 'name';
    const match = REFERENCE_SORT_FIELDS.find((field) => field === sortBy);
    if (!match) {
      throw new BadRequestException(
        `sortBy must be one of: ${REFERENCE_SORT_FIELDS.join(', ')}`,
      );
    }
    return match;
  }

  private normalizeReferenceSortOrder(sortOrder?: string): ReferenceSortOrder {
    if (sortOrder === undefined || sortOrder.length === 0) return 'asc';
    const match = REFERENCE_SORT_ORDERS.find((order) => order === sortOrder);
    if (!match) {
      throw new BadRequestException(
        `sortOrder must be one of: ${REFERENCE_SORT_ORDERS.join(', ')}`,
      );
    }
    return match;
  }

  private normalizeStatuses(
    status?: string | string[],
  ): WorkStatus[] | undefined {
    const statuses = Array.isArray(status)
      ? status
      : typeof status === 'string'
        ? status.split(',').map((value) => value.trim())
        : undefined;

    const filteredStatuses = statuses?.filter(
      (value) =>
        value && value !== 'undefined' && value !== 'null' && value !== 'false',
    ) as WorkStatus[] | undefined;

    return filteredStatuses && filteredStatuses.length > 0
      ? filteredStatuses
      : undefined;
  }

  private normalizeSectionKeys(
    includeSectionKeys?: string | string[],
  ): string[] | undefined {
    const keys = Array.isArray(includeSectionKeys)
      ? includeSectionKeys
      : typeof includeSectionKeys === 'string'
        ? includeSectionKeys.split(',')
        : [];
    const normalized = keys
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeTaskIds(taskIds?: string | string[]): TaskId[] | undefined {
    return this.normalizeUuidList('taskIds', taskIds, 200) as
      | TaskId[]
      | undefined;
  }

  private normalizeUuidList(
    field: string,
    input: string | string[] | undefined,
    maxItems: number,
  ): string[] | undefined {
    if (input === undefined) return undefined;
    const values = (Array.isArray(input) ? input : [input])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (values.length === 0) {
      throw new BadRequestException(`${field} must contain at least one UUID`);
    }
    if (values.length > maxItems) {
      throw new BadRequestException(
        `${field} may contain at most ${maxItems} UUIDs`,
      );
    }
    if (new Set(values).size !== values.length) {
      throw new BadRequestException(`${field} must contain unique UUIDs`);
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const value of values) {
      if (!uuidPattern.test(value)) {
        throw new BadRequestException(
          `${field} contains invalid UUID: ${value}`,
        );
      }
    }

    return values;
  }

  private normalizeEdgeTypes(
    edgeTypes?: string | string[],
  ): RelationshipType[] | undefined {
    if (edgeTypes === undefined) {
      return undefined;
    }

    const values = (Array.isArray(edgeTypes) ? edgeTypes : [edgeTypes])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    if (values.length === 0) {
      throw new BadRequestException(
        'edgeTypes must contain at least one AgentEdgeType value',
      );
    }

    const allowedAgentTypes = new Set<string>(Object.values(AgentEdgeType));
    const allowedRelationshipTypes = new Map<string, RelationshipType>(
      Object.values(RelationshipType).map((value) => [value, value]),
    );
    const requestedTypes: RelationshipType[] = [];
    for (const value of values) {
      if (!allowedAgentTypes.has(value)) {
        throw new BadRequestException(
          `edgeTypes must be one of: ${Object.values(AgentEdgeType).join(', ')}`,
        );
      }
      const relationshipType = allowedRelationshipTypes.get(value);
      if (!relationshipType) {
        throw new BadRequestException(
          `edgeTypes value ${value} is not supported by graph traversal`,
        );
      }
      requestedTypes.push(relationshipType);
    }

    return [...new Set(requestedTypes)];
  }

  private normalizeIncidentRelationshipTypes(
    input?: string | string[],
  ): WorkItemGraphParticipationType[] {
    if (input === undefined) return [];
    const values = (Array.isArray(input) ? input : [input])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    const allowed = new Set<string>(
      Object.values(WorkItemGraphParticipationType),
    );
    if (
      values.length > 3 ||
      new Set(values).size !== values.length ||
      values.some((value) => !allowed.has(value))
    ) {
      throw new BadRequestException(
        `incidentRelationshipTypes must contain at most 3 unique values from: ${Object.values(WorkItemGraphParticipationType).join(', ')}`,
      );
    }
    return values as WorkItemGraphParticipationType[];
  }

  private normalizeRelatedEntity(
    relatedEntityId: string | undefined,
    relatedEntityType: string | undefined,
    edgeTypes: RelationshipType[] | undefined,
  ):
    | {
        relatedEntityId: string;
        relatedEntityType: AgentEdgeEndpointEntityType;
      }
    | undefined {
    const hasId = relatedEntityId !== undefined;
    const hasType = relatedEntityType !== undefined;
    if (!hasId && !hasType) {
      return undefined;
    }
    if (!hasId || !hasType) {
      throw new BadRequestException(
        'relatedEntityId and relatedEntityType must be provided together',
      );
    }
    if (!edgeTypes || edgeTypes.length === 0) {
      throw new BadRequestException(
        'edgeTypes is required when filtering by a related entity',
      );
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(relatedEntityId)) {
      throw new BadRequestException('relatedEntityId must be a UUID');
    }

    const allowedTypes = new Set<string>(
      Object.values(AgentEdgeEndpointEntityType),
    );
    if (!allowedTypes.has(relatedEntityType)) {
      throw new BadRequestException(
        `relatedEntityType must be one of: ${Object.values(AgentEdgeEndpointEntityType).join(', ')}`,
      );
    }

    return {
      relatedEntityId,
      relatedEntityType: relatedEntityType as AgentEdgeEndpointEntityType,
    };
  }
}
