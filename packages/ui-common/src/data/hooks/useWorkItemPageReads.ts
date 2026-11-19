import {
  GetActivityWorkItemsDocument,
  GetPlanTaskMonitorPageDocument,
  GetTasksPageDocument,
} from "../../graphql/generated/graphql";
import type { GraphQLProjectScope } from "../graphql/client";
import {
  useGraphQLRead,
  type GraphQLReadSpec,
} from "../graphql/useGraphQLRead";
import type { OperationVariables } from "@apollo/client";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

function useWorkItemPageRead<
  TQuery,
  TVariables extends OperationVariables,
  TData,
>(spec: GraphQLReadSpec<TQuery, TVariables, TData>, enabled: boolean) {
  const ready =
    enabled && !!spec.scope.organizationId && !!spec.scope.projectId;
  useWebsocketSubscriptions(
    { projectIds: [spec.scope.projectId], initiativeIds: [] },
    { enabled: ready },
  );
  return useGraphQLRead(spec, { enabled: ready });
}

export function useTasksPageItems(
  scope: GraphQLProjectScope,
  enabled: boolean,
) {
  return useWorkItemPageRead(
    {
      document: GetTasksPageDocument,
      scope,
      variables: {},
      select: (data) => data.workItems,
    },
    enabled,
  );
}

export function usePlanTaskMonitorPageItem(
  scope: GraphQLProjectScope,
  id: string,
) {
  return useWorkItemPageRead(
    {
      document: GetPlanTaskMonitorPageDocument,
      scope,
      variables: { id },
      select: (data) => data.workItem,
    },
    !!id,
  );
}

export function useActivityWorkItems(
  scope: GraphQLProjectScope,
  ids: string[],
  enabled: boolean,
) {
  return useWorkItemPageRead(
    {
      document: GetActivityWorkItemsDocument,
      scope,
      variables: { ids },
      select: (data) => data.workItems,
    },
    enabled && ids.length > 0,
  );
}
