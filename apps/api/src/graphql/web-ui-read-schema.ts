import { NestFactory } from '@nestjs/core';
import {
  GraphQLSchemaBuilderModule,
  GraphQLSchemaFactory,
} from '@nestjs/graphql';
import { lexicographicSortSchema, printSchema } from 'graphql';
import { ConversationResolver } from './conversations/conversation.resolver';
import { ProjectScopeResolver } from './project-scope.resolver';
import { EntityRefResolver } from './work-items/entity-ref.resolver';
import { WorkItemResolver } from './work-items/work-item.resolver';

/**
 * Every resolver the Web UI read endpoint serves. Adding a resolver to the
 * endpoint means adding it here so the published schema file stays complete.
 */
const WEB_UI_READ_RESOLVERS = [
  ProjectScopeResolver,
  ConversationResolver,
  WorkItemResolver,
  EntityRefResolver,
];

/** The endpoint's schema as SDL, sorted the way the endpoint sorts it. */
export async function printWebUiReadSchema(): Promise<string> {
  const app = await NestFactory.createApplicationContext(
    GraphQLSchemaBuilderModule,
    { logger: false },
  );

  try {
    const schema = await app
      .get(GraphQLSchemaFactory)
      .create(WEB_UI_READ_RESOLVERS);

    return `${printSchema(lexicographicSortSchema(schema))}\n`;
  } finally {
    await app.close();
  }
}
