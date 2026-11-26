import type { ApolloClient, OperationVariables } from "@apollo/client";
import { useApolloClient } from "@apollo/client/react";
import { useEffect, useState } from "react";
import {
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  switchMap,
  type Observable,
} from "rxjs";
import type {
  TaskResponseDto,
  WorkItemGraphAggregateResponseDto,
} from "../../api";
import { extractErrorCode, extractErrorMessage } from "../../utils/errorUtils";
import { workItemGraphRead } from "../collections/workItemGraphs";
import { workItemDetailRead } from "../collections/workItemLists";
import type { WorkItemResponseDto } from "../collections/workItems";
import {
  getProjectGraphQLClient,
  type GraphQLProjectScope,
} from "../graphql/client";
import type { GraphQLReadSpec } from "../graphql/useGraphQLRead";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

/** A Diagram Element that still exists, with the graph of its Diagram. */
export interface DiagramElementReference {
  elementId: string;
  graph: WorkItemGraphAggregateResponseDto;
}

type Read<TData> =
  | { state: "loading" }
  | { state: "ready"; data: TData }
  | { state: "failed"; cause: unknown };

type Resolution =
  | { state: "loading" }
  | { state: "resolved"; reference: DiagramElementReference }
  | { state: "omitted"; reason: string; cause?: unknown };

/** Watches one cached read, so realtime refreshes reach the reference. */
function watchRead<TQuery, TVariables extends OperationVariables, TData>(
  client: ApolloClient,
  {
    document,
    variables,
    scope,
    select,
  }: GraphQLReadSpec<TQuery, TVariables, TData>,
): Observable<Read<TData>> {
  const query = client.watchQuery<TQuery, OperationVariables>({
    query: document,
    variables,
    context: scope,
    refetchWritePolicy: "merge",
  });

  return query.pipe(
    map(({ dataState, data, loading, error }): Read<TData> => {
      // As elsewhere, a failed refresh keeps what the cache still holds.
      const evicted =
        error && client.readQuery({ query: document, variables }) === null;
      if (dataState === "complete" && !evicted) {
        const selected = select(data as TQuery);
        if (selected !== null) {
          return { state: "ready", data: selected };
        }
      }
      if (!error && loading) {
        return { state: "loading" };
      }
      return {
        state: "failed",
        cause: error ?? new Error("The read returned no item"),
      };
    }),
  );
}

const omitted = (reason: string, cause?: unknown): Resolution => ({
  state: "omitted",
  reason,
  cause,
});

const isArchived = (
  item: Pick<TaskResponseDto, "status" | "archivedAt">,
): boolean => item.status === "ARCHIVED" || Boolean(item.archivedAt);

/** The Diagram an element belongs to, or why the element cannot be shown. */
const findElementDiagram = (
  read: Read<WorkItemResponseDto>,
): { diagramId: string } | Resolution => {
  if (read.state === "loading") {
    return { state: "loading" };
  }
  if (read.state === "failed") {
    return omitted("element read failed", read.cause);
  }
  const element = read.data;
  if (element.type.toUpperCase() !== "DIAGRAM_ELEMENT") {
    return omitted(`item is a ${element.type}, not a Diagram Element`);
  }
  if (isArchived(element)) {
    return omitted("element is archived");
  }
  return element.parentTaskId
    ? { diagramId: element.parentTaskId }
    : omitted("element belongs to no Diagram");
};

const resolveInDiagram = (
  elementId: string,
  diagram: Read<WorkItemResponseDto>,
  graph: Read<WorkItemGraphAggregateResponseDto>,
): Resolution => {
  if (diagram.state === "failed") {
    return omitted("Diagram read failed", diagram.cause);
  }
  if (graph.state === "failed") {
    return omitted("Diagram graph read failed", graph.cause);
  }
  if (diagram.state === "loading" || graph.state === "loading") {
    return { state: "loading" };
  }
  if (isArchived(diagram.data)) {
    return omitted("Diagram is archived");
  }
  const isDrawn = graph.data.children.some(
    (child) => child.id === elementId && !isArchived(child),
  );
  return isDrawn
    ? { state: "resolved", reference: { elementId, graph: graph.data } }
    : omitted("element is not in its Diagram's graph");
};

function watchReference(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  elementId: string,
): Observable<Resolution> {
  return watchRead(client, workItemDetailRead(scope, elementId)).pipe(
    map(findElementDiagram),
    distinctUntilChanged(
      (previous, next) => JSON.stringify(previous) === JSON.stringify(next),
    ),
    switchMap((found) => {
      if ("state" in found) {
        return of(found);
      }
      const { diagramId } = found;
      return combineLatest([
        watchRead(client, workItemDetailRead(scope, diagramId)),
        watchRead(
          client,
          // The same graph read as the Diagram view.
          workItemGraphRead(scope, diagramId, [
            "GUARANTEES",
            "IMPLEMENTS",
            "CONSUMES",
          ]),
        ),
      ]).pipe(
        map(([diagram, graph]) => resolveInDiagram(elementId, diagram, graph)),
      );
    }),
  );
}

const describeOmission = (
  elementId: string,
  { reason, cause }: Extract<Resolution, { state: "omitted" }>,
): string => {
  const detail = cause
    ? ` (${extractErrorCode(cause) ?? "no error code"}: ${extractErrorMessage(cause) ?? String(cause)})`
    : "";
  return `Diagram Element ${elementId} omitted: ${reason}${detail}`;
};

interface Resolutions {
  key: string;
  client: ApolloClient;
  byElement: ReadonlyMap<string, Resolution>;
  references: DiagramElementReference[];
}

const NO_REFERENCES: DiagramElementReference[] = [];

/**
 * Reads each referenced Diagram Element, its Diagram and that Diagram's graph.
 * References that no longer resolve are dropped and logged. `isLoading` stays
 * true until every reference has an answer, so a stale one is never counted.
 */
export function useDiagramElementReferences(
  organizationId: string,
  projectId: string,
  elementIds: readonly string[],
): { isLoading: boolean; references: DiagramElementReference[] } {
  const client = getProjectGraphQLClient(useApolloClient(), {
    organizationId,
    projectId,
  });
  const key = JSON.stringify([...new Set(elementIds)]);
  const [result, setResult] = useState<Resolutions>();

  useWebsocketSubscriptions(
    { projectIds: [projectId], initiativeIds: [] },
    { enabled: true },
  );

  useEffect(() => {
    const ids: string[] = JSON.parse(key);
    if (ids.length === 0) {
      return;
    }
    const scope = { organizationId, projectId };
    const logged = new Set<string>();
    const subscription = combineLatest(
      ids.map((id) => watchReference(client, scope, id)),
    ).subscribe((resolutions) => {
      resolutions.forEach((resolution, index) => {
        if (resolution.state !== "omitted") {
          return;
        }
        const message = describeOmission(ids[index]!, resolution);
        if (!logged.has(message)) {
          logged.add(message);
          console.warn(message);
        }
      });
      setResult({
        key,
        client,
        byElement: new Map(ids.map((id, index) => [id, resolutions[index]!])),
        references: resolutions.flatMap((resolution) =>
          resolution.state === "resolved" ? [resolution.reference] : [],
        ),
      });
    });

    return () => subscription.unsubscribe();
  }, [client, key, organizationId, projectId]);

  if (key === "[]") {
    return { isLoading: false, references: NO_REFERENCES };
  }
  const current =
    result?.key === key && result.client === client ? result : undefined;
  const isLoading =
    !current ||
    [...current.byElement.values()].some(({ state }) => state === "loading");

  return {
    isLoading,
    references: isLoading ? NO_REFERENCES : current.references,
  };
}
