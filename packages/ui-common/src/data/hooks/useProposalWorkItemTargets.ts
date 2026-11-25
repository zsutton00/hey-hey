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
import {
  failedProposalTargetRead,
  type ProposalTargetRead,
} from "./proposalTargetRead";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

interface TargetReads {
  client: ApolloClient;
  reads: Record<string, ProposalTargetRead<TaskResponseDto>>;
}

/**
 * Watches each target so the realtime work-item refresh updates open
 * comparisons. One target that is slow or unreadable leaves the others as
 * they are.
 */
export function useProposalWorkItemTargets(
  { organizationId, projectId }: GraphQLProjectScope,
  ids: readonly string[],
): Record<string, ProposalTargetRead<TaskResponseDto>> {
  const client = getProjectGraphQLClient(useApolloClient(), {
    organizationId,
    projectId,
  });
  const idsKey = JSON.stringify([...new Set(ids)].sort());
  const enabled = !!organizationId && !!projectId && ids.length > 0;
  const [result, setResult] = useState<TargetReads>();

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
      // The failure reaches the card through the watched query itself.
      const retry = () => void query.refetch().catch(() => null);

      return query.pipe(
        map(
          ({
            dataState,
            data,
            loading,
            error,
          }): [string, ProposalTargetRead<TaskResponseDto>] => {
            if (!error && dataState === "complete") {
              const item = select(data);
              if (item) {
                return [id, { state: "ready", item }];
              }
            }
            if (!error && loading) {
              return [id, { state: "loading" }];
            }

            const cause = error ?? new Error("The read returned no item");
            return [id, failedProposalTargetRead("TASK", id, cause, retry)];
          },
        ),
      );
    });
    const subscription = combineLatest(reads).subscribe((answers) => {
      setResult({ client, reads: Object.fromEntries(answers) });
    });

    return () => subscription.unsubscribe();
  }, [client, enabled, idsKey, organizationId, projectId]);

  if (!enabled) {
    return {};
  }

  // Answers already held stay on screen while the set of targets changes.
  const held = result?.client === client ? result.reads : {};
  return Object.fromEntries(
    ids.map((id) => [id, held[id] ?? { state: "loading" }]),
  );
}
