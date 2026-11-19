import type { ConversationResponseDto, ConversationStatus } from "../../api";
import type {
  GetConversationsQueryVariables,
  GetWorkflowConversationsQueryVariables,
} from "../../graphql/generated/graphql";
import {
  GetActiveConversationsDocument,
  GetActiveConversationsWithDecisionsDocument,
  GetConversationDocument,
  GetConversationsDocument,
  GetConversationsWithDecisionsDocument,
  GetConversationWithDecisionsDocument,
  GetWorkflowConversationsDocument,
  type ConversationFieldsFragment,
} from "../../graphql/generated/graphql";
import type { GraphQLProjectScope } from "../graphql/client";
import { toConversationResponse } from "../graphql/records";
import type { GraphQLReadSpec } from "../graphql/useGraphQLRead";

export type ConversationListFilters = {
  workflowName?: string;
  search?: string;
  workflowAboutId?: string;
  workflowAboutType?: string;
  statuses?: ConversationStatus[];
  includeSuggestionDecisions?: boolean;
};

export type WorkflowConversationListParams = {
  workflowName: string;
  workflowAboutId: string;
  sortBy?: string;
  sortOrder?: string;
  status?: ConversationStatus;
  page?: number;
  limit?: number;
};

type ConversationNode = ConversationFieldsFragment & {
  suggestionDecisions?: unknown[] | null;
  goalPmRoutingDecisions?: unknown[] | null;
};

type ConversationQuery = { conversation: ConversationNode };
type ConversationListQuery = { page: { nodes: ConversationNode[] } };

const LIST_PAGE_SIZE = 100;

export const conversationRead = (
  scope: GraphQLProjectScope,
  conversationId: string,
  includeSuggestionDecisions: boolean,
): GraphQLReadSpec<
  ConversationQuery,
  { id: string },
  ConversationResponseDto
> => ({
  document: includeSuggestionDecisions
    ? GetConversationWithDecisionsDocument
    : GetConversationDocument,
  variables: { id: conversationId },
  scope,
  select: (data) => toConversationResponse(data.conversation),
});

const selectConversations = (
  data: ConversationListQuery,
): ConversationResponseDto[] => data.page.nodes.map(toConversationResponse);

/** With statuses, every conversation matching them; without, the active ones. */
export const conversationListRead = (
  scope: GraphQLProjectScope,
  filters: ConversationListFilters,
): GraphQLReadSpec<
  ConversationListQuery,
  GetConversationsQueryVariables,
  ConversationResponseDto[]
> => {
  const statuses = filters.statuses?.length ? filters.statuses : undefined;
  const withDecisions = filters.includeSuggestionDecisions === true;
  const document = statuses
    ? withDecisions
      ? GetConversationsWithDecisionsDocument
      : GetConversationsDocument
    : withDecisions
      ? GetActiveConversationsWithDecisionsDocument
      : GetActiveConversationsDocument;
  const workflowNames = filters.workflowName?.split(",").filter(Boolean);

  return {
    document,
    variables: {
      ...(statuses ? { statuses } : {}),
      workflowNames: workflowNames?.length ? workflowNames : undefined,
      workflowAboutId: filters.workflowAboutId || undefined,
      workflowAboutType: filters.workflowAboutType || undefined,
      search: filters.search || undefined,
      page: 1,
      limit: LIST_PAGE_SIZE,
    },
    scope,
    select: selectConversations,
  };
};

export const workflowConversationListRead = (
  scope: GraphQLProjectScope,
  params: WorkflowConversationListParams,
): GraphQLReadSpec<
  ConversationListQuery,
  GetWorkflowConversationsQueryVariables,
  ConversationResponseDto[]
> => ({
  document: GetWorkflowConversationsDocument,
  variables: {
    workflowName: params.workflowName,
    workflowAboutId: params.workflowAboutId,
    statuses: params.status ? [params.status] : undefined,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
    page: params.page ?? 1,
    limit: params.limit ?? LIST_PAGE_SIZE,
  },
  scope,
  select: selectConversations,
});
