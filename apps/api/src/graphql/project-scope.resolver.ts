import { Context, Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import type { GraphQLRequestContext } from './graphql-request-context';
import { UseRestErrorCodes } from './use-rest-error-codes.decorator';

@ObjectType()
export class ProjectScope {
  @Field()
  organizationId!: string;

  @Field()
  projectId!: string;
}

@Resolver(() => ProjectScope)
@UseRestErrorCodes()
export class ProjectScopeResolver {
  /** The project this endpoint is serving, once access to it is confirmed. */
  @Query(() => ProjectScope)
  projectScope(@Context() { req }: GraphQLRequestContext): ProjectScope {
    const { organizationId, projectId } = req.params;

    return { organizationId, projectId };
  }
}
