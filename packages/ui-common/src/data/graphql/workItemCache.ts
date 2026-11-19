import type { ApolloClient, ObservableQuery } from "@apollo/client";
import {
  WorkItemFieldsFragmentDoc,
  type WorkItemFieldsFragment,
} from "../../graphql/generated/graphql";
import type { WorkItemResponseDto } from "../collections/workItems";
import { activeReads, isObject, variableOf } from "./activeReads";
import {
  getGraphQLClients,
  getProjectGraphQLClient,
  type GraphQLProjectScope,
} from "./client";
import { toWorkItemResponse } from "./records";

/**
 * Keeps work items in the GraphQL cache current. A change either refetches
 * the active reads that show work items, or removes the item from the cache.
 * Nothing here builds a record: a work item enters the cache only through a
 * read of the server, so every view of it shows what the server returned.
 */

/** Reads of one work item, by id. */
const DETAIL_READS: ReadonlySet<string> = new Set([
  "GetWorkItem",
  "GetPlanTaskMonitorPage",
]);

/** Reads of the work items under one root; their members change with the tree. */
const GRAPH_READS: ReadonlySet<string> = new Set(["GetWorkItemGraph"]);

/** Reads whose membership a change to any work item can alter. */
const MEMBERSHIP_READS: ReadonlySet<string> = new Set([
  "GetWorkItems",
  "GetTasksPage",
  "GetActivityWorkItems",
  "GetWorkItemHierarchy",
  "GetAllWorkItemReferences",
  "GetWorkItemReferencePage",
]);

const ALL_WORK_ITEM_READS: ReadonlySet<string> = new Set([
  ...DETAIL_READS,
  ...GRAPH_READS,
  ...MEMBERSHIP_READS,
]);

/** Root fields behind the membership reads. */
const MEMBERSHIP_FIELDS = [
  "workItems",
  "workItemHierarchy",
  "allWorkItemReferences",
  "workItemReferences",
] as const;

const refetch = (query: ObservableQuery) => query.refetch().catch(() => null);

const clientFor = (client: ApolloClient, scope?: GraphQLProjectScope) =>
  scope ? getProjectGraphQLClient(client, scope) : client;

const projectsOf = (client: ApolloClient, scope?: GraphQLProjectScope) =>
  scope ? [clientFor(client, scope)] : [...getGraphQLClients(client)];

/**
 * Drops the cached answers that a change to work items makes stale, without
 * telling mounted views: they ask the server again right after, so they never
 * show a gap. Reads no view is showing keep nothing to go stale, and the next
 * view that mounts asks the server instead of the cache.
 *
 * A graph is the answer to "which items sit under this root", which no single
 * work-item record holds, so graphs are dropped with the membership reads
 * rather than found by the items they already contain.
 */
function dropStaleAnswers(
  projects: readonly ApolloClient[],
  taskId?: string,
): void {
  for (const { cache } of projects) {
    for (const fieldName of MEMBERSHIP_FIELDS) {
      cache.evict({ id: "ROOT_QUERY", fieldName, broadcast: false });
    }
    if (taskId) {
      cache.evict({
        id: "ROOT_QUERY",
        fieldName: "workItem",
        args: { id: taskId },
        broadcast: false,
      });
    }
    const stored = cache.extract();
    for (const key of isObject(stored) ? Object.keys(stored) : []) {
      if (key.startsWith("WorkItem:")) {
        cache.evict({ id: key, fieldName: "graph", broadcast: false });
      }
    }
  }
}

/**
 * A work item changed. Its own reads ask the server again, and so do every
 * list, hierarchy, graph and reference list: a status or parent change can
 * move it between them, and the event does not say which. Without a scope,
 * every project the client holds is refreshed.
 */
export async function refreshWorkItem(
  client: ApolloClient,
  taskId: string,
  scope?: GraphQLProjectScope,
): Promise<void> {
  const project = clientFor(client, scope);
  const detailReads = activeReads(project, DETAIL_READS).filter(
    (query) => variableOf(query, "id") === taskId,
  );
  const sharedReads = activeReads(
    project,
    new Set([...GRAPH_READS, ...MEMBERSHIP_READS]),
  );

  dropStaleAnswers(projectsOf(client, scope), taskId);
  await Promise.all([...detailReads, ...sharedReads].map(refetch));
}

/** A work item was created, or its membership in project lists changed. */
export async function refreshWorkItemLists(
  client: ApolloClient,
  scope?: GraphQLProjectScope,
): Promise<void> {
  const reads = activeReads(
    clientFor(client, scope),
    new Set([...GRAPH_READS, ...MEMBERSHIP_READS]),
  );

  dropStaleAnswers(projectsOf(client, scope));
  await Promise.all(reads.map(refetch));
}

/**
 * A work item was deleted: it leaves every list, detail, hierarchy and graph
 * view of it, and the reads that listed it ask the server again.
 */
export async function evictWorkItem(
  client: ApolloClient,
  taskId: string,
  scope?: GraphQLProjectScope,
): Promise<void> {
  for (const { cache } of projectsOf(client, scope)) {
    for (const __typename of ["WorkItem", "WorkItemReference"]) {
      const id = cache.identify({ __typename, id: taskId });
      if (id) {
        cache.evict({ id });
      }
    }
    cache.gc();
  }

  await refreshWorkItemLists(client, scope);
}

/** After a reconnect, events may have been missed: every shown read asks again. */
export async function refreshShownWorkItemReads(
  client: ApolloClient,
  scope?: GraphQLProjectScope,
): Promise<void> {
  const reads = activeReads(clientFor(client, scope), ALL_WORK_ITEM_READS);

  dropStaleAnswers(projectsOf(client, scope));
  await Promise.all(reads.map(refetch));
}

/**
 * A work item the cache already holds, for callers that need the record
 * before a write (for example to describe a delete). Absent until a read of
 * the server has returned it.
 */
export function readCachedWorkItem(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  taskId: string,
): WorkItemResponseDto | null {
  const project = getProjectGraphQLClient(client, scope);
  const node: WorkItemFieldsFragment | null = project.cache.readFragment({
    id: project.cache.identify({ __typename: "WorkItem", id: taskId }),
    fragment: WorkItemFieldsFragmentDoc,
  });

  return node ? toWorkItemResponse(node) : null;
}
