import {
  Field,
  ID,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
} from '@hey-hey/contracts/api/models';
import { JSONScalar } from '../conversations/conversation.types';

registerEnumType(AgentEdgeType, { name: 'EdgeType' });
registerEnumType(AgentEdgeEndpointEntityType, { name: 'EntityType' });

/** Sort fields GET work-items accepts. */
export const WorkItemSortField = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  title: 'title',
  status: 'status',
  priority: 'priority',
} as const;
export type WorkItemSortField =
  (typeof WorkItemSortField)[keyof typeof WorkItemSortField];
registerEnumType(WorkItemSortField, { name: 'WorkItemSortField' });

export const SortDirection = { asc: 'asc', desc: 'desc' } as const;
export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];
registerEnumType(SortDirection, { name: 'SortDirection' });

@InputType('WorkItemSort')
export class WorkItemSortInput {
  @Field(() => WorkItemSortField)
  field!: WorkItemSortField;

  @Field(() => SortDirection, { defaultValue: SortDirection.desc })
  direction!: SortDirection;
}

/** Selects work items directly connected to one entity by the given edge types. */
@InputType('RelatedEntityFilter')
export class RelatedEntityFilterInput {
  @Field(() => ID)
  entityId!: string;

  @Field(() => AgentEdgeEndpointEntityType)
  entityType!: AgentEdgeEndpointEntityType;

  @Field(() => [AgentEdgeType])
  edgeTypes!: AgentEdgeType[];
}

/** One section of a work item, keyed by the section key its type declares. */
@ObjectType('WorkItemSection')
export class WorkItemSectionNode {
  @Field(() => ID)
  id!: string;

  @Field()
  key!: string;

  @Field(() => Int)
  order!: number;

  @Field()
  materializedMarkdown!: string;

  @Field(() => ID)
  materializedProposalId!: string;

  @Field(() => Int, { nullable: true })
  crdtSnapshotSeq?: number | null;
}

@ObjectType('WorkItemChildCounts')
export class WorkItemChildCountsNode {
  @Field(() => Int, { nullable: true })
  total?: number;

  @Field(() => Int, { nullable: true })
  done?: number;

  @Field(() => Int, { nullable: true })
  inProgress?: number;

  @Field(() => Int, { nullable: true })
  backlog?: number;
}

@ObjectType('ServiceRelation')
export class ServiceRelationNode {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  serviceId!: string;

  @Field(() => ID)
  taskId!: string;

  @Field({ nullable: true })
  relationType?: string;

  @Field()
  createdAt!: string;
}

/**
 * One end of a relationship. Endpoints can be any entity; when the endpoint is
 * a work item in this project, `workItem` resolves it as a full WorkItem so
 * clients cache one copy of it.
 */
@ObjectType('EntityRef')
export class EntityRefNode {
  @Field(() => ID)
  entityId!: string;

  @Field(() => String, { nullable: true })
  entityType?: string | null;

  @Field(() => String, { nullable: true })
  name?: string | null;
}

/** An agent-authored relationship touching a work item (REST AgentEdgeResponseDto). */
@ObjectType('WorkItemEdge')
export class WorkItemEdgeNode {
  @Field(() => ID)
  id!: string;

  @Field(() => AgentEdgeType)
  type!: AgentEdgeType;

  @Field(() => EntityRefNode)
  source!: EntityRefNode;

  @Field(() => EntityRefNode)
  target!: EntityRefNode;

  /** Work-item type key of the target when it is a work item. */
  @Field(() => String, { nullable: true })
  targetNodeType?: string | null;

  @Field(() => String, { nullable: true })
  category?: string | null;

  @Field(() => String, { nullable: true })
  direction?: string | null;

  @Field(() => String, { nullable: true })
  predicate?: string | null;

  @Field(() => String, { nullable: true })
  actionLabel?: string | null;

  @Field(() => String, { nullable: true })
  transitionRole?: string | null;

  @Field()
  reasoning!: string;

  @Field(() => String, { nullable: true })
  origin?: string | null;

  @Field(() => String, { nullable: true })
  createdBySessionId?: string | null;

  @Field(() => String, { nullable: true })
  lastModifiedBySessionId?: string | null;

  @Field(() => JSONScalar, { nullable: true })
  metadata?: unknown;

  @Field()
  createdAt!: string;

  @Field()
  updatedAt!: string;
}

/** An entity a Goal tracks (REST TrackedEntitySnapshot). */
@ObjectType('TrackedEntity')
export class TrackedEntityNode extends EntityRefNode {
  @Field(() => String, { nullable: true })
  status?: string | null;

  @Field(() => String, { nullable: true })
  dueDate?: string | null;
}

@ObjectType('TrackedWorkSummary')
export class TrackedWorkSummaryNode {
  @Field(() => Int)
  totalCount!: number;

  @Field(() => Int)
  completedCount!: number;

  @Field(() => Int)
  cancelledCount!: number;

  @Field(() => Int)
  pastDueCount!: number;

  @Field(() => Int)
  openUndatedCount!: number;
}

/**
 * A work item of any type. `type` and `status` are open strings: types come
 * from the project's work-item type registry, so the schema cannot list them.
 * Fields beyond the base record (edges, counts, tracked work, graph) are read
 * only when a query selects them.
 */
@ObjectType('WorkItem')
export class WorkItemNode {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field()
  type!: string;

  @Field()
  status!: string;

  @Field()
  organizationId!: string;

  @Field()
  projectId!: string;

  @Field(() => String, { nullable: true })
  initiativeId?: string | null;

  @Field(() => String, { nullable: true })
  parentTaskId?: string | null;

  @Field()
  source!: string;

  @Field({ nullable: true })
  priority?: string;

  @Field({ nullable: true })
  tag?: string;

  @Field(() => String, { nullable: true })
  assigneeId?: string | null;

  @Field({ nullable: true })
  reporterId?: string;

  @Field(() => String, { nullable: true })
  dueDate?: string | null;

  @Field({ nullable: true })
  createdAt?: string;

  @Field({ nullable: true })
  updatedAt?: string;

  @Field(() => String, { nullable: true })
  archivedAt?: string | null;

  @Field(() => WorkItemChildCountsNode, { nullable: true })
  childCounts?: WorkItemChildCountsNode;

  @Field({ nullable: true })
  hasProposalSupport?: boolean;

  /** Launch configuration; its shape is owned by the REST contract. */
  @Field(() => JSONScalar, { nullable: true })
  config?: unknown;
}

/** A work item reached by a graph read expansion (REST WorkItemGraphDerivedReference). */
@ObjectType('WorkItemGraphReference')
export class WorkItemGraphReferenceNode extends EntityRefNode {
  @Field()
  expansionKey!: string;

  @Field()
  projectionKind!: string;

  @Field(() => String, { nullable: true })
  workItemTypeKey?: string | null;

  @Field(() => [ID])
  viaEntityIds!: string[];
}

/** Same data as the REST GET work-items/:id/graph aggregate. */
@ObjectType('WorkItemGraph')
export class WorkItemGraphNode {
  @Field(() => WorkItemNode)
  root!: WorkItemNode;

  @Field(() => [WorkItemNode])
  children!: WorkItemNode[];

  @Field(() => [WorkItemEdgeNode])
  relationships!: WorkItemEdgeNode[];

  /** A validated layout document; its shape is owned by the REST contract. */
  @Field(() => JSONScalar, { nullable: true })
  layout!: unknown;

  @Field(() => [WorkItemGraphReferenceNode])
  derivedReferences!: WorkItemGraphReferenceNode[];

  /** Contract participation evidence, in the REST contract's shape. */
  @Field(() => JSONScalar)
  participation!: unknown;
}

/** A work item with its structural parent and direct children (REST TaskHierarchyResponseDto). */
@ObjectType('WorkItemHierarchy')
export class WorkItemHierarchyNode {
  @Field(() => WorkItemNode)
  task!: WorkItemNode;

  @Field(() => WorkItemNode, { nullable: true })
  parent?: WorkItemNode | null;

  @Field(() => [WorkItemNode])
  children!: WorkItemNode[];
}

/** One lightweight reference to a work item (REST WorkItemReferenceDto). */
@ObjectType('WorkItemReference')
export class WorkItemReferenceNode {
  @Field(() => ID)
  id!: string;

  @Field()
  name!: string;

  @Field()
  type!: string;

  @Field(() => String, { nullable: true })
  parentTaskId!: string | null;
}

@ObjectType('WorkItemReferencePagination')
export class WorkItemReferencePaginationNode {
  @Field(() => Int)
  page!: number;

  @Field(() => Int)
  limit!: number;

  @Field(() => Int)
  total!: number;

  @Field(() => Int)
  totalPages!: number;

  @Field()
  hasNext!: boolean;

  @Field()
  hasPrevious!: boolean;
}

/** Same page as the REST GET work-items/references. */
@ObjectType('WorkItemReferencePage')
export class WorkItemReferencePageNode {
  @Field(() => [WorkItemReferenceNode])
  items!: WorkItemReferenceNode[];

  @Field(() => WorkItemReferencePaginationNode)
  pagination!: WorkItemReferencePaginationNode;
}
