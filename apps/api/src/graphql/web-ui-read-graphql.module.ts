import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { FlexibleAuthGuard } from '../auth/guards/flexible-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { ScopePathParamsGuard } from '../auth/guards/scope-path-params.guard';
import type { GraphQLRequestContext } from './graphql-request-context';
import { ProjectScopeResolver } from './project-scope.resolver';
import { WebUiReadAccessMiddleware } from './web-ui-read-access.middleware';

/**
 * Written out in full: the endpoint is mounted by Apollo's own middleware, so
 * the Nest global prefix does not apply and `request.params` must carry the
 * scope ids exactly as it does for REST routes.
 */
export const WEB_UI_READ_GRAPHQL_PATH =
  'api/v1/organizations/:organizationId/projects/:projectId/graphql';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      path: WEB_UI_READ_GRAPHQL_PATH,
      useGlobalPrefix: false,
      // Query-only: no Mutation or Subscription type is ever declared, so
      // GraphQL validation rejects mutation operations.
      autoSchemaFile: true,
      sortSchema: true,
      playground: false,
      // Resolver access checks are the gate; do not publish the schema to
      // callers who have not passed them.
      introspection: false,
      // Nested fields such as Conversation.messages must report failures under
      // the REST stable code too; access is decided by the middleware, not guards.
      fieldResolverEnhancers: ['filters'],
      context: ({ req, res }: GraphQLRequestContext) => ({ req, res }),
    }),
  ],
  providers: [
    FlexibleAuthGuard,
    ScopePathParamsGuard,
    JwtAuthGuard,
    OrganizationGuard,
    WebUiReadAccessMiddleware,
    ProjectScopeResolver,
  ],
})
export class WebUiReadGraphqlModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(WebUiReadAccessMiddleware)
      .forRoutes(WEB_UI_READ_GRAPHQL_PATH);
  }
}
