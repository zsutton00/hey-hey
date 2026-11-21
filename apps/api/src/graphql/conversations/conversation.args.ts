import { ArgsType, Field, Int } from '@nestjs/graphql';
import type { GraphQLResolveInfo } from 'graphql';
import { selectedFieldNames } from '../selected-fields';

/** Filters shared by the all-conversations and active-conversations reads. */
@ArgsType()
export class ConversationListArgs {
  @Field(() => Int, { nullable: true })
  page?: number;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => [String], {
    nullable: true,
    description:
      'Only for `conversations`; `activeConversations` has no status filter.',
  })
  statuses?: string[];

  @Field(() => [String], { nullable: true })
  workflowNames?: string[];

  @Field({ nullable: true })
  workflowAboutId?: string;

  @Field({ nullable: true })
  workflowAboutType?: string;

  @Field({ nullable: true })
  search?: string;
}

@ArgsType()
export class WorkflowConversationArgs {
  @Field(() => Int, { nullable: true })
  page?: number;

  @Field(() => Int, { nullable: true })
  limit?: number;

  @Field(() => [String], { nullable: true })
  statuses?: string[];

  @Field({ nullable: true })
  sortBy?: string;

  @Field({ nullable: true })
  sortOrder?: string;
}

/** The REST query parameters a conversation list read maps to. */
export function conversationFilters(filters: ConversationListArgs) {
  return {
    page: filters.page ?? undefined,
    limit: filters.limit ?? undefined,
    workflowName: filters.workflowNames?.length
      ? filters.workflowNames
      : undefined,
    workflowAboutId: filters.workflowAboutId ?? undefined,
    workflowAboutType: filters.workflowAboutType ?? undefined,
    search: filters.search ?? undefined,
  };
}

/** REST's `includeSuggestionDecisions` is on exactly when the query selects them. */
export function wantsSuggestionDecisions(
  info: GraphQLResolveInfo,
  path: readonly string[] = [],
): boolean {
  const selected = selectedFieldNames(info, path);

  return (
    selected.has('suggestionDecisions') ||
    selected.has('goalPmRoutingDecisions')
  );
}
