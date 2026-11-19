import type {
  WorkItemGraphAggregateResponseDto,
  WorkItemGraphParticipationType,
} from "../../api";
import {
  GetWorkItemGraphDocument,
  type GetWorkItemGraphQuery,
  type GetWorkItemGraphQueryVariables,
} from "../../graphql/generated/graphql";
import type { GraphQLProjectScope } from "../graphql/client";
import { toGraphAggregateResponse } from "../graphql/records";
import type { GraphQLReadSpec } from "../graphql/useGraphQLRead";

/**
 * One item's graph aggregate. Its root and children are work-item records
 * shared with every other view of them.
 */
export const workItemGraphRead = (
  scope: GraphQLProjectScope,
  workItemId: string,
  incidentRelationshipTypes: readonly WorkItemGraphParticipationType[] = [],
): GraphQLReadSpec<
  GetWorkItemGraphQuery,
  GetWorkItemGraphQueryVariables,
  WorkItemGraphAggregateResponseDto
> => ({
  document: GetWorkItemGraphDocument,
  variables: {
    id: workItemId,
    incidentRelationshipTypes: [...new Set(incidentRelationshipTypes)].sort(),
  },
  scope,
  select: (data) => toGraphAggregateResponse(data.workItem.graph),
});
