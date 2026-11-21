import type { ApolloClient } from "@apollo/client";
import { useApolloClient } from "@apollo/client/react";
import { useEffect, useState } from "react";
import { combineLatest, map } from "rxjs";
import type { TaskResponseDto } from "../../api";
import { workItemDetailRead } from "../collections/workItemLists";
import {
  getProjectGraphQLClient,
  type GraphQLProjectScope,
} from "../graphql/client";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

interface TargetReadState {
  items: TaskResponseDto[];
  loading: boolean;
  error: Error | undefined;
}

interface TargetRead extends TargetReadState {
  client: ApolloClient;
  idsKey: string;
}

/** Watches each target so the realtime work-item refresh updates open comparisons. */
export function useProposalWorkItemTargets(
  { organizationId, projectId }: GraphQLProjectScope,
  ids: readonly string[],
): TargetReadState {
  const client = getProjectGraphQLClient(useApolloClient(), {
    organizationId,
    projectId,
  });
  const idsKey = JSON.stringify([...new Set(ids)].sort());
  const enabled = !!organizationId && !!projectId && ids.length > 0;
  const [result, setResult] = useState<TargetRead>();

  useWebsocketSubscriptions(
    { projectIds: [projectId], initiativeIds: [] },
    { enabled },
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const targetIds: string[] = JSON.parse(idsKey);
    const reads = targetIds.map((id) => {
      const { document, scope, variables, select } = workItemDetailRead(
        { organizationId, projectId },
        id,
        { includeServiceRelations: true },
      );
      const query = client.watchQuery({
        query: document,
        variables,
        context: scope,
        refetchWritePolicy: "merge",
      });

      return query.pipe(
        map(({ dataState, data, loading, error }) => ({
          item: dataState === "complete" && !error ? select(data) : null,
          loading: loading && !data,
          error,
        })),
      );
    });
    const subscription = combineLatest(reads).subscribe((answers) => {
      setResult({
        client,
        idsKey,
        items: answers.flatMap(({ item }) => (item ? [item] : [])),
        loading: answers.some(({ loading }) => loading),
        error: answers.find(({ error }) => error)?.error,
      });
    });

    return () => subscription.unsubscribe();
  }, [client, enabled, idsKey, organizationId, projectId]);

  if (enabled && result?.client === client && result.idsKey === idsKey) {
    return result;
  }
  return { items: [], loading: enabled, error: undefined };
}
