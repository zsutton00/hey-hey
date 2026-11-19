import type { ApolloClient, ObservableQuery } from "@apollo/client";
import {
  WorkItemFieldsFragmentDoc,
  type WorkItemFieldsFragment,
} from "../../graphql/generated/graphql";
import type { WorkItemResponseDto } from "../collections/workItems";
import { activeReads, holdsEntity, variableOf } from "./activeReads";
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
const ITEM_READS: ReadonlySet<string> = new Set([
  "GetWorkItem",
  "GetWorkItemGraph",
]);

/** Reads whose membership a change to any work item can alter. */
const MEMBERSHIP_READS: ReadonlySet<string> = new Set([
  "GetWorkItems",
  "GetWorkItemHierarchy",
  "GetAllWorkItemReferences",
  "GetWorkItemReferencePage",
]);

const ALL_WORK_ITEM_READS: ReadonlySet<string> = new Set([
  ...ITEM_READS,
  ...MEMBERSHIP_READS,
]);

const refetch = (query: ObservableQuery) => query.refetch().catch(() => null);

const clientFor = (client: ApolloClient, scope?: GraphQLProjectScope) =>
  scope ? getProjectGraphQLClient(client, scope) : client;

/** A list that names its members cannot gain an item it does not name. */
const mayAdmit = (query: ObservableQuery, taskId: string): boolean => {
  const ids = variableOf(query, "ids");

  return !Array.isArray(ids) || ids.includes(taskId);
};

/**
 * A work item changed. Its own reads ask the server again, and so do the
 * lists, hierarchies and reference lists that may now include or omit it:
 * a status or parent change can move it between them. Without a scope, every
 * project the client holds is refreshed.
 */
export async function refreshWorkItem(
  client: ApolloClient,
  taskId: string,
  scope?: GraphQLProjectScope,
): Promise<void> {
  const project = clientFor(client, scope);
  const itemReads = activeReads(project, ITEM_READS).filter(
    (query) =>
      variableOf(query, "id") === taskId ||
      holdsEntity(query.getCurrentResult().data, taskId),
  );
  const membershipReads = activeReads(project, MEMBERSHIP_READS).filter(
    (query) => mayAdmit(query, taskId),
  );

  await Promise.all([...itemReads, ...membershipReads].map(refetch));
}

/** A work item was created, or its membership in project lists changed. */
export async function refreshWorkItemLists(
  client: ApolloClient,
  scope?: GraphQLProjectScope,
): Promise<void> {
  const reads = activeReads(clientFor(client, scope), MEMBERSHIP_READS);

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
  const project = clientFor(client, scope);
  const holders = scope ? [project] : [...getGraphQLClients(client)];

  for (const { cache } of holders) {
    const id = cache.identify({ __typename: "WorkItem", id: taskId });
    if (id) {
      cache.evict({ id });
      cache.gc();
    }
  }

  await refreshWorkItemLists(client, scope);
}

/** After a reconnect, events may have been missed: every shown read asks again. */
export async function refreshShownWorkItemReads(
  client: ApolloClient,
  scope?: GraphQLProjectScope,
): Promise<void> {
  const reads = activeReads(clientFor(client, scope), ALL_WORK_ITEM_READS);

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
