import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import type { TaskResponseDto } from '@hey-hey/contracts/api/models';
import { TaskService } from '../../services/tasks/task.service';
import type { TaskId } from '../../types';
import type { GraphQLRequestContext } from '../graphql-request-context';
import { UseRestErrorCodes } from '../use-rest-error-codes.decorator';
import { workItemLoaders } from './work-item-loaders';
import {
  EntityRefNode,
  TrackedEntityNode,
  WorkItemGraphReferenceNode,
  WorkItemNode,
} from './work-item.types';

/**
 * The referenced work item, read through the request's batched loader. Null
 * when the reference is not a work item or is not readable in this project.
 */
async function referencedWorkItem(
  reference: EntityRefNode,
  context: GraphQLRequestContext,
  taskService: TaskService,
): Promise<TaskResponseDto | null> {
  if (reference.entityType !== 'TASK') {
    return null;
  }

  const item = await workItemLoaders(context, taskService).workItem(
    reference.entityId as TaskId,
  );

  return item ?? null;
}

@Resolver(() => EntityRefNode)
@UseRestErrorCodes()
export class EntityRefResolver {
  constructor(private readonly taskService: TaskService) {}

  @ResolveField(() => WorkItemNode, { nullable: true })
  workItem(
    @Parent() reference: EntityRefNode,
    @Context() context: GraphQLRequestContext,
  ): Promise<TaskResponseDto | null> {
    return referencedWorkItem(reference, context, this.taskService);
  }
}

@Resolver(() => TrackedEntityNode)
@UseRestErrorCodes()
export class TrackedEntityResolver {
  constructor(private readonly taskService: TaskService) {}

  @ResolveField(() => WorkItemNode, { nullable: true })
  workItem(
    @Parent() reference: TrackedEntityNode,
    @Context() context: GraphQLRequestContext,
  ): Promise<TaskResponseDto | null> {
    return referencedWorkItem(reference, context, this.taskService);
  }
}

@Resolver(() => WorkItemGraphReferenceNode)
@UseRestErrorCodes()
export class WorkItemGraphReferenceResolver {
  constructor(private readonly taskService: TaskService) {}

  @ResolveField(() => WorkItemNode, { nullable: true })
  workItem(
    @Parent() reference: WorkItemGraphReferenceNode,
    @Context() context: GraphQLRequestContext,
  ): Promise<TaskResponseDto | null> {
    return referencedWorkItem(reference, context, this.taskService);
  }
}
