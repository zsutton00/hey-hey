import { NotFoundException } from '@nestjs/common';
import type {
  TaskResponseDto,
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphParticipationType,
} from '@hey-hey/contracts/api/models';
import type { Request } from 'express';
import type { RelationshipType } from 'src/generated/graphs/model/relationshipType';
import { authTokenFromRequest } from '../../auth/decorators/current-user.decorator';
import {
  ALL_DECLARED_SECTIONS,
  TaskService,
} from '../../services/tasks/task.service';
import type { OrganizationId, ProjectId, TaskId } from '../../types';
import type { GraphQLRequestContext } from '../graphql-request-context';
import { RequestBatchLoader } from '../request-batch-loader';

/** The service reads by id accept at most this many ids per call. */
const MAX_IDS_PER_READ = 200;

/** Optional parts of a work item the list read returns only when asked. */
export interface WorkItemProjection {
  /** Section keys to read, or 'all' for every section the item's type declares. */
  sectionKeys?: string[] | 'all';
  edgeTypes?: RelationshipType[] | 'default';
  designDocCounts?: boolean;
  agentSessionCounts?: boolean;
  serviceRelations?: boolean;
  trackedEntities?: boolean;
  trackedWorkSummary?: boolean;
}

export type ProjectionPart =
  | 'designDocCounts'
  | 'agentSessionCounts'
  | 'serviceRelations'
  | 'trackedEntities'
  | 'trackedWorkSummary';

export interface WorkItemScope {
  organizationId: OrganizationId;
  projectId: ProjectId;
  userToken: string | null;
}

/** Service list-read flags for a projection. Every part not named is off. */
export function projectionFilters(projection: WorkItemProjection) {
  const { edgeTypes } = projection;

  const { sectionKeys } = projection;

  return {
    ...(sectionKeys !== undefined
      ? {
          includeSectionKeys:
            sectionKeys === 'all' ? ALL_DECLARED_SECTIONS : sectionKeys,
        }
      : {}),
    includeEdges: edgeTypes !== undefined,
    ...(Array.isArray(edgeTypes) ? { edgeTypes } : {}),
    includeDesignDocCounts: projection.designDocCounts === true,
    includeAgentSessionCounts: projection.agentSessionCounts === true,
    includeServiceRelations: projection.serviceRelations === true,
    includeTrackedEntities: projection.trackedEntities === true,
    includeTrackedWorkSummary: projection.trackedWorkSummary === true,
  };
}

function edgeKey(edgeTypes: RelationshipType[] | 'default'): string {
  return Array.isArray(edgeTypes)
    ? `edges:${[...edgeTypes].sort().join(',')}`
    : 'edges:default';
}

function sectionsKey(sectionKeys: string[] | 'all'): string {
  return sectionKeys === 'all'
    ? 'sections:all'
    : `sections:${[...sectionKeys].sort().join(',')}`;
}

function partKeys(projection: WorkItemProjection): string[] {
  const parts: ProjectionPart[] = [
    'designDocCounts',
    'agentSessionCounts',
    'serviceRelations',
    'trackedEntities',
    'trackedWorkSummary',
  ];
  const keys: string[] = parts.filter((part) => projection[part] === true);
  if (projection.edgeTypes !== undefined) {
    keys.push(edgeKey(projection.edgeTypes));
  }
  if (projection.sectionKeys !== undefined) {
    keys.push(sectionsKey(projection.sectionKeys));
  }

  return keys;
}

/**
 * Per-request work-item reads. Every work item a query reaches — list rows,
 * edge endpoints, graph children — is read through these loaders, so each
 * optional part is fetched once per request for all items that need it,
 * whichever query path reached them.
 */
export class WorkItemLoaders {
  private readonly loaded = new WeakMap<TaskResponseDto, Set<string>>();
  private readonly loaders = new Map<
    string,
    RequestBatchLoader<TaskId, TaskResponseDto>
  >();
  private readonly graphs = new Map<
    string,
    RequestBatchLoader<TaskId, WorkItemGraphAggregateResponseDto | Error>
  >();

  constructor(
    private readonly taskService: TaskService,
    readonly scope: WorkItemScope,
  ) {}

  /** A work item in this project, or undefined when it is absent or not readable. */
  workItem(id: TaskId): Promise<TaskResponseDto | undefined> {
    return this.loaderFor('base', {}).load(id);
  }

  /**
   * Records items a query already read with `projection`, so their fields are
   * served from that read instead of being fetched again.
   */
  remember(items: TaskResponseDto[], projection: WorkItemProjection): void {
    const keys = partKeys(projection);
    for (const item of items) {
      this.loaderFor('base', {}).prime(item.id as TaskId, item);
      const parts = this.loaded.get(item) ?? new Set<string>();
      keys.forEach((key) => parts.add(key));
      this.loaded.set(item, parts);
    }
  }

  /** The item as read with one optional part, reusing the parent read when it has it. */
  async withPart(
    item: TaskResponseDto,
    part: ProjectionPart,
  ): Promise<TaskResponseDto | undefined> {
    return this.withProjection(item, part, { [part]: true });
  }

  async withEdges(
    item: TaskResponseDto,
    edgeTypes: RelationshipType[] | 'default',
  ): Promise<TaskResponseDto | undefined> {
    return this.withProjection(item, edgeKey(edgeTypes), { edgeTypes });
  }

  /**
   * The item's sections, limited to `keys` when given. An item already read
   * with every declared section is filtered in place rather than re-read.
   */
  async sections(
    item: TaskResponseDto,
    keys: string[] | undefined,
  ): Promise<TaskResponseDto['sections']> {
    const parts = this.loaded.get(item);
    if (parts?.has(sectionsKey('all'))) {
      return keys
        ? item.sections?.filter((section) => keys.includes(section.key))
        : item.sections;
    }

    const sectionKeys = keys ?? 'all';
    const read = await this.withProjection(item, sectionsKey(sectionKeys), {
      sectionKeys,
    });

    return read?.sections;
  }

  /**
   * Graph aggregate for one root. Every root requested in the same tick with
   * the same participation types is read in one batched service call.
   */
  async graph(
    id: TaskId,
    incidentRelationshipTypes: WorkItemGraphParticipationType[],
  ): Promise<WorkItemGraphAggregateResponseDto> {
    const result = await this.graphLoader(incidentRelationshipTypes).load(id);
    if (result instanceof Error) {
      throw result;
    }
    if (!result) {
      throw new NotFoundException('Work item not found');
    }

    return result;
  }

  private graphLoader(
    incidentRelationshipTypes: WorkItemGraphParticipationType[],
  ): RequestBatchLoader<TaskId, WorkItemGraphAggregateResponseDto | Error> {
    const key = [...incidentRelationshipTypes].sort().join(',');
    const existing = this.graphs.get(key);
    if (existing) {
      return existing;
    }

    const { organizationId, projectId, userToken } = this.scope;
    const loader = new RequestBatchLoader<
      TaskId,
      WorkItemGraphAggregateResponseDto | Error
    >(
      (ids) =>
        this.taskService.getGraphAggregates(
          organizationId,
          projectId,
          ids,
          userToken,
          incidentRelationshipTypes,
        ),
      MAX_IDS_PER_READ,
    );
    this.graphs.set(key, loader);

    return loader;
  }

  private async withProjection(
    item: TaskResponseDto,
    key: string,
    projection: WorkItemProjection,
  ): Promise<TaskResponseDto | undefined> {
    if (this.loaded.get(item)?.has(key)) {
      return item;
    }

    return this.loaderFor(key, projection).load(item.id as TaskId);
  }

  private loaderFor(
    key: string,
    projection: WorkItemProjection,
  ): RequestBatchLoader<TaskId, TaskResponseDto> {
    const existing = this.loaders.get(key);
    if (existing) {
      return existing;
    }

    const loader = new RequestBatchLoader<TaskId, TaskResponseDto>(
      async (ids) => {
        const items = await this.readByIds(ids, projection);
        return new Map(items.map((item) => [item.id as TaskId, item]));
      },
      MAX_IDS_PER_READ,
    );
    this.loaders.set(key, loader);

    return loader;
  }

  private readByIds(
    ids: TaskId[],
    projection: WorkItemProjection,
  ): Promise<TaskResponseDto[]> {
    const { organizationId, projectId, userToken } = this.scope;

    return this.taskService.findAllByOrganizationForAdapter(organizationId, {
      ...projectionFilters(projection),
      userToken,
      projectId,
      taskIds: ids,
      limit: ids.length,
    });
  }
}

const loadersByRequest = new WeakMap<Request, WorkItemLoaders>();

/** The scope WebUiReadAccessMiddleware has already authorized, plus the caller's token. */
export function authorizedScope({ req }: GraphQLRequestContext): WorkItemScope {
  return {
    organizationId: req.params.organizationId as OrganizationId,
    projectId: req.params.projectId as ProjectId,
    userToken: authTokenFromRequest(req),
  };
}

/** The work-item loaders for this request, created on first use. */
export function workItemLoaders(
  context: GraphQLRequestContext,
  taskService: TaskService,
): WorkItemLoaders {
  const existing = loadersByRequest.get(context.req);
  if (existing) {
    return existing;
  }

  const loaders = new WorkItemLoaders(taskService, authorizedScope(context));
  loadersByRequest.set(context.req, loaders);

  return loaders;
}
