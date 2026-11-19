import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  Args,
  Context,
  ID,
  Info,
  Int,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';
import {
  AgentEdgeType,
  WorkItemGraphParticipationType,
  type AgentEdgeResponseDto,
  type PaginatedWorkItemReferenceResponseDto,
  type TaskHierarchyResponseDto,
  type WorkItemReferenceDto,
  type TaskResponseDto,
  type TrackedEntitySnapshot,
  type WorkItemGraphDerivedReference,
} from '@hey-hey/contracts/api/models';
import { isUUID } from 'class-validator';
import type { GraphQLResolveInfo } from 'graphql';
import { TaskService } from '../../services/tasks/task.service';
import type { InitiativeId, TaskId } from '../../types';
import { normalizeEdgeTypeFilter } from '../../utils/edge-type-filter.util';
import { normalizeStatusFilter } from '../../utils/work-item.util';
import {
  normalizeReferenceSortField,
  normalizeReferenceSortOrder,
  normalizeReferenceStatuses,
  parseReferencePaginationValue,
} from '../../utils/work-item-reference-query.util';
import type { GraphQLRequestContext } from '../graphql-request-context';
import { selectedFieldNames } from '../selected-fields';
import { UseRestErrorCodes } from '../use-rest-error-codes.decorator';
import {
  projectionFilters,
  workItemLoaders,
  type WorkItemProjection,
} from './work-item-loaders';
import {
  RelatedEntityFilterInput,
  ServiceRelationNode,
  TrackedEntityNode,
  TrackedWorkSummaryNode,
  WorkItemEdgeNode,
  WorkItemGraphNode,
  WorkItemGraphReferenceNode,
  WorkItemHierarchyNode,
  WorkItemNode,
  WorkItemReferenceNode,
  WorkItemReferencePageNode,
  WorkItemSectionNode,
  WorkItemSortInput,
} from './work-item.types';

const MAX_ID_FILTER = 200;
const MAX_REFERENCE_PAGE = 500;
const PARTICIPATION_TYPES = new Set<string>(
  Object.values(WorkItemGraphParticipationType),
);

/** Same bounds GET work-items applies to its UUID list filters. */
function uuidList(field: string, values: string[]): TaskId[] {
  if (values.length === 0) {
    throw new BadRequestException(`${field} must contain at least one UUID`);
  }
  if (values.length > MAX_ID_FILTER) {
    throw new BadRequestException(
      `${field} may contain at most ${MAX_ID_FILTER} UUIDs`,
    );
  }
  if (new Set(values).size !== values.length) {
    throw new BadRequestException(`${field} must contain unique UUIDs`);
  }

  const invalid = values.find((value) => !isUUID(value));
  if (invalid) {
    throw new BadRequestException(`${field} contains invalid UUID: ${invalid}`);
  }

  return values as TaskId[];
}

function participationTypes(
  values: string[] | undefined,
): WorkItemGraphParticipationType[] {
  if (!values) {
    return [];
  }

  const valid =
    values.length <= 3 &&
    new Set(values).size === values.length &&
    values.every((value) => PARTICIPATION_TYPES.has(value));
  if (!valid) {
    throw new BadRequestException(
      `incidentRelationshipTypes must contain at most 3 unique values from: ${[...PARTICIPATION_TYPES].join(', ')}`,
    );
  }

  return values as WorkItemGraphParticipationType[];
}

function positive(field: string, value: number | undefined): void {
  if (value !== undefined && value < 1) {
    throw new BadRequestException(`${field} must be a positive integer`);
  }
}

/** A root read returns every declared section only when the query selects them. */
function rootProjection(info: GraphQLResolveInfo): WorkItemProjection {
  return selectedFieldNames(info).has('sections') ? { sectionKeys: 'all' } : {};
}

export function toEdgeNode(edge: AgentEdgeResponseDto): WorkItemEdgeNode {
  return {
    id: edge.id,
    type: edge.type,
    source: {
      entityId: edge.sourceNodeId,
      entityType: edge.sourceEntityType ?? null,
      name: edge.sourceNodeName ?? null,
    },
    target: {
      entityId: edge.targetNodeId,
      entityType: edge.targetEntityType ?? null,
      name: edge.targetNodeName ?? null,
    },
    targetNodeType: edge.targetNodeType ?? null,
    category: edge.category ?? null,
    direction: edge.direction ?? null,
    predicate: edge.predicate ?? null,
    actionLabel: edge.actionLabel ?? null,
    transitionRole: edge.transitionRole ?? null,
    reasoning: edge.reasoning,
    origin: edge.source ?? null,
    createdBySessionId: edge.createdBySessionId ?? null,
    lastModifiedBySessionId: edge.lastModifiedBySessionId ?? null,
    metadata: edge.metadata ?? null,
    createdAt: edge.createdAt,
    updatedAt: edge.updatedAt,
  };
}

function toTrackedEntityNode(
  snapshot: TrackedEntitySnapshot,
): TrackedEntityNode {
  return {
    entityId: snapshot.targetEntityId,
    entityType: snapshot.targetEntityType,
    name: snapshot.title,
    status: snapshot.status ?? null,
    dueDate: snapshot.dueDate ?? null,
  };
}

function toGraphReferenceNode(
  reference: WorkItemGraphDerivedReference,
): WorkItemGraphReferenceNode {
  return {
    entityId: reference.entityId,
    entityType: reference.entityType,
    name: reference.displayName,
    expansionKey: reference.expansionKey,
    projectionKind: reference.projectionKind,
    workItemTypeKey: reference.workItemTypeKey ?? null,
    viaEntityIds: reference.viaEntityIds,
  };
}

/** WorkItemGraph as resolved: root and children stay service records. */
type WorkItemGraphResult = Omit<WorkItemGraphNode, 'root' | 'children'> & {
  root: TaskResponseDto;
  children: TaskResponseDto[];
};

@Resolver(() => WorkItemNode)
@UseRestErrorCodes()
export class WorkItemResolver {
  constructor(private readonly taskService: TaskService) {}

  /** Same read as GET work-items/:taskId, limited to the requested project. */
  @Query(() => WorkItemNode)
  async workItem(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GraphQLRequestContext,
  ): Promise<TaskResponseDto> {
    const loaders = workItemLoaders(context, this.taskService);
    const { organizationId, projectId, userToken } = loaders.scope;
    if (!isUUID(id)) {
      throw new NotFoundException('Task not found');
    }

    const task = await this.taskService.findOneByOrganization(
      organizationId,
      id as TaskId,
      false,
      false,
      false,
      false,
      userToken,
    );
    // REST checks the path id against the project in its guard; GraphQL
    // receives the id as an argument, so the project is checked here.
    if (!task || task.projectId !== projectId) {
      throw new NotFoundException('Task not found');
    }

    loaders.remember([task], { sectionKeys: 'all' });

    return task;
  }

  /**
   * Same read as GET work-items/:taskId/hierarchy. The task, its parent and
   * its children are WorkItem records, so every view of them shares one copy.
   */
  @Query(() => WorkItemHierarchyNode)
  async workItemHierarchy(
    @Args('id', { type: () => ID }) id: string,
    @Context() context: GraphQLRequestContext,
    @Args('includeDesignDocCounts', { nullable: true })
    includeDesignDocCounts?: boolean,
    @Args('includeAgentSessionCounts', { nullable: true })
    includeAgentSessionCounts?: boolean,
  ): Promise<TaskHierarchyResponseDto> {
    const loaders = workItemLoaders(context, this.taskService);
    const { organizationId, projectId } = loaders.scope;
    if (!isUUID(id)) {
      throw new NotFoundException('Task not found');
    }

    const hierarchy = await this.taskService.findHierarchyByOrganization(
      organizationId,
      id as TaskId,
      includeDesignDocCounts === true,
      includeAgentSessionCounts === true,
      false,
    );
    // REST checks the path id against the project in its guard; GraphQL
    // receives the id as an argument, so the project is checked here.
    if (hierarchy.task.projectId !== projectId) {
      throw new NotFoundException('Task not found');
    }

    loaders.remember(
      [
        hierarchy.task,
        ...(hierarchy.parent ? [hierarchy.parent] : []),
        ...hierarchy.children,
      ],
      {
        designDocCounts: includeDesignDocCounts === true,
        agentSessionCounts: includeAgentSessionCounts === true,
      },
    );

    return hierarchy;
  }

  /** Same read as GET work-items/references: one deterministic page. */
  @Query(() => WorkItemReferencePageNode)
  async workItemReferences(
    @Context() context: GraphQLRequestContext,
    @Args('type') type: string,
    @Args('page', { type: () => Int }) page: number,
    @Args('limit', { type: () => Int }) limit: number,
    @Args('filter', { nullable: true }) filter?: string,
    @Args('statuses', { type: () => [String], nullable: true })
    statuses?: string[],
    @Args('sortBy', { nullable: true }) sortBy?: string,
    @Args('sortOrder', { nullable: true }) sortOrder?: string,
  ): Promise<PaginatedWorkItemReferenceResponseDto> {
    const { organizationId, projectId } = workItemLoaders(
      context,
      this.taskService,
    ).scope;
    if (type.trim().length === 0) {
      throw new BadRequestException('type is required');
    }

    return this.taskService.findReferences(
      organizationId,
      projectId,
      type.trim(),
      parseReferencePaginationValue(page, 'page', 1),
      parseReferencePaginationValue(limit, 'limit', 1, 500),
      filter?.trim() || undefined,
      normalizeReferenceStatuses(statuses),
      normalizeReferenceSortField(sortBy),
      normalizeReferenceSortOrder(sortOrder),
    );
  }

  /**
   * Every reference of one type, in name order: the pages of GET
   * work-items/references read until the last one.
   */
  @Query(() => [WorkItemReferenceNode])
  async allWorkItemReferences(
    @Context() context: GraphQLRequestContext,
    @Args('type') type: string,
  ): Promise<WorkItemReferenceDto[]> {
    const { organizationId, projectId } = workItemLoaders(
      context,
      this.taskService,
    ).scope;
    if (type.trim().length === 0) {
      throw new BadRequestException('type is required');
    }

    const references: WorkItemReferenceDto[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.taskService.findReferences(
        organizationId,
        projectId,
        type.trim(),
        page,
        MAX_REFERENCE_PAGE,
      );
      references.push(...result.items);
      if (!result.pagination.hasNext) {
        return references;
      }
    }
  }

  /**
   * Same read as GET work-items. `parentTaskId: null` lists top-level items;
   * omitting it applies no parent filter. Optional parts of each item are
   * read only when selected, in one batched read per part.
   */
  @Query(() => [WorkItemNode])
  async workItems(
    @Context() context: GraphQLRequestContext,
    @Info() info: GraphQLResolveInfo,
    @Args('initiativeId', { type: () => ID, nullable: true })
    initiativeId?: InitiativeId,
    @Args('parentTaskId', { type: () => ID, nullable: true })
    parentTaskId?: string | null,
    @Args('parentTaskIds', { type: () => [ID], nullable: true })
    parentTaskIds?: string[],
    @Args('ids', { type: () => [ID], nullable: true }) ids?: string[],
    @Args('type', { nullable: true }) type?: string,
    @Args('statuses', { type: () => [String], nullable: true })
    statuses?: string[],
    @Args('includeDescendants', { nullable: true })
    includeDescendants?: boolean,
    @Args('relatedTo', { type: () => RelatedEntityFilterInput, nullable: true })
    relatedTo?: RelatedEntityFilterInput,
    @Args('sort', { type: () => WorkItemSortInput, nullable: true })
    sort?: WorkItemSortInput,
    @Args('page', { type: () => Int, nullable: true }) page?: number,
    @Args('limit', { type: () => Int, nullable: true }) limit?: number,
  ): Promise<TaskResponseDto[]> {
    const loaders = workItemLoaders(context, this.taskService);
    const { organizationId, projectId, userToken } = loaders.scope;

    const hasParentTaskId = parentTaskId !== undefined;
    if (hasParentTaskId && parentTaskIds) {
      throw new BadRequestException(
        'parentTaskId and parentTaskIds are mutually exclusive',
      );
    }
    if (includeDescendants && parentTaskIds) {
      throw new BadRequestException(
        'includeDescendants cannot be combined with parentTaskIds',
      );
    }
    positive('page', page);
    positive('limit', limit);

    const normalizedStatuses = normalizeStatusFilter(statuses);
    const projection = rootProjection(info);

    // The service validates the related entity and rejects it without edge types.
    const related = relatedTo
      ? {
          relatedEntityId: relatedTo.entityId,
          relatedEntityType: relatedTo.entityType,
          edgeTypes: normalizeEdgeTypeFilter(relatedTo.edgeTypes),
        }
      : {};

    const filters = {
      ...projectionFilters(projection),
      userToken,
      projectId,
      ...related,
      ...(normalizedStatuses ? { statuses: normalizedStatuses } : {}),
      ...(ids ? { taskIds: uuidList('ids', ids) } : {}),
      ...(hasParentTaskId
        ? { parentTaskId: parentTaskId as TaskId | null }
        : {}),
      ...(parentTaskIds
        ? { parentTaskIds: uuidList('parentTaskIds', parentTaskIds) }
        : {}),
      ...(includeDescendants ? { includeDescendants: true as const } : {}),
      ...(type ? { taskType: type } : {}),
      ...(page !== undefined ? { page } : {}),
      ...(limit !== undefined ? { limit } : {}),
      sortBy: sort?.field ?? 'createdAt',
      sortDir: sort?.direction ?? 'desc',
    };

    const items = initiativeId
      ? await this.taskService.findAll(organizationId, initiativeId, filters)
      : await this.taskService.findAllByOrganizationForAdapter(
          organizationId,
          filters,
        );
    loaders.remember(items, projection);

    return items;
  }

  /** Every declared section, or only `keys`. */
  @ResolveField(() => [WorkItemSectionNode], { nullable: true })
  sections(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
    @Args('keys', { type: () => [String], nullable: true }) keys?: string[],
  ): Promise<TaskResponseDto['sections']> {
    return workItemLoaders(context, this.taskService).sections(
      workItem,
      keys?.length ? keys : undefined,
    );
  }

  /**
   * Agent-authored relationships touching this item. Without `types`, the
   * same default label set GET work-items returns with includeEdges.
   */
  @ResolveField(() => [WorkItemEdgeNode], { nullable: true })
  async edges(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
    @Args('types', { type: () => [AgentEdgeType], nullable: true })
    types?: AgentEdgeType[],
  ): Promise<WorkItemEdgeNode[] | undefined> {
    const edgeTypes = types ? normalizeEdgeTypeFilter(types) : undefined;
    const read = await workItemLoaders(context, this.taskService).withEdges(
      workItem,
      edgeTypes ?? 'default',
    );

    return read?.edges?.map(toEdgeNode);
  }

  @ResolveField(() => Int, { nullable: true })
  async designDocCount(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
  ): Promise<number | null | undefined> {
    const read = await workItemLoaders(context, this.taskService).withPart(
      workItem,
      'designDocCounts',
    );

    return read?.designDocCount;
  }

  @ResolveField(() => Int, { nullable: true })
  async codingSessionCount(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
  ): Promise<number | null | undefined> {
    const read = await workItemLoaders(context, this.taskService).withPart(
      workItem,
      'agentSessionCounts',
    );

    return read?.codingSessionCount;
  }

  @ResolveField(() => Int, { nullable: true })
  async agentSessionCount(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
  ): Promise<number | null | undefined> {
    const read = await workItemLoaders(context, this.taskService).withPart(
      workItem,
      'agentSessionCounts',
    );

    return read?.agentSessionCount;
  }

  @ResolveField(() => [ServiceRelationNode], { nullable: true })
  async serviceRelations(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
  ): Promise<TaskResponseDto['serviceRelations']> {
    const read = await workItemLoaders(context, this.taskService).withPart(
      workItem,
      'serviceRelations',
    );

    return read?.serviceRelations;
  }

  /** What a Goal tracks; empty for other types. */
  @ResolveField(() => [TrackedEntityNode], { nullable: true })
  async trackedEntities(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
  ): Promise<TrackedEntityNode[] | undefined> {
    const read = await workItemLoaders(context, this.taskService).withPart(
      workItem,
      'trackedEntities',
    );

    return read?.trackedEntities?.map(toTrackedEntityNode);
  }

  @ResolveField(() => TrackedWorkSummaryNode, { nullable: true })
  async trackedWorkSummary(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
  ): Promise<TaskResponseDto['trackedWorkSummary']> {
    const read = await workItemLoaders(context, this.taskService).withPart(
      workItem,
      'trackedWorkSummary',
    );

    return read?.trackedWorkSummary;
  }

  /**
   * Same read as GET work-items/:workItemId/graph. Only graph-capable types
   * have one; others fail with the REST error. Read once per item per request.
   */
  @ResolveField(() => WorkItemGraphNode)
  async graph(
    @Parent() workItem: TaskResponseDto,
    @Context() context: GraphQLRequestContext,
    @Args('incidentRelationshipTypes', { type: () => [String], nullable: true })
    incidentRelationshipTypes?: string[],
  ): Promise<WorkItemGraphResult> {
    const loaders = workItemLoaders(context, this.taskService);
    const aggregate = await loaders.graph(
      workItem.id as TaskId,
      participationTypes(incidentRelationshipTypes),
    );
    loaders.remember([aggregate.root, ...aggregate.children], {
      sectionKeys: 'all',
    });

    return {
      root: aggregate.root,
      children: aggregate.children,
      relationships: aggregate.relationships.map(toEdgeNode),
      layout: aggregate.layout,
      derivedReferences: aggregate.derivedReferences.map(toGraphReferenceNode),
      participation: aggregate.participation,
    };
  }
}
