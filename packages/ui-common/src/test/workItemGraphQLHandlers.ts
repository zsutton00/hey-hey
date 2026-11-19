import { http, HttpResponse } from "msw";
import { AgentEdgeType } from "../api";
import type { EdgeType } from "../graphql/generated/graphql";
import {
  answerWorkItemOperation,
  edgeNodeOf,
  nodeOf,
  referenceOf,
  WORK_ITEM_OPERATIONS,
  type FakeWorkItem,
} from "./workItemGraphQLAnswers";

/**
 * MSW handlers for the GraphQL endpoint that serve a project's work items.
 * Pass a function so a test can change the items between reads. Operations
 * that are not work-item reads fall through to the next handler.
 */
export const workItemHandlers = (
  items: FakeWorkItem[] | (() => FakeWorkItem[]),
) => [
  http.post("*/graphql", async ({ request }) => {
    const { operationName, variables = {} } = (await request
      .clone()
      .json()) as {
      operationName: string;
      variables?: Record<string, unknown>;
    };
    if (!WORK_ITEM_OPERATIONS.has(operationName)) {
      return;
    }
    const { status, body } = answerWorkItemOperation(
      typeof items === "function" ? items() : items,
      operationName,
      variables,
    );

    return HttpResponse.json(body as never, { status });
  }),
];

type RestRead = (request: never, options: never) => unknown;

/**
 * The REST reads a suite faked before work items moved to GraphQL. Each is
 * called with the request its GraphQL read stands for, and its answer is
 * served as the GraphQL result.
 */
export interface RestWorkItemReads {
  getTasks?: RestRead;
  getTask?: RestRead;
  listWorkItemReferences?: RestRead;
  getHierarchy?: RestRead;
  getWorkItemGraph?: RestRead;
}

const defined = (fields: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

/** `{ data: { data } }` axios bodies, or the bare value. */
const payload = (response: unknown) =>
  (response as { data?: { data?: unknown } } | undefined)?.data?.data ??
  response;

const referencesNode = (items: unknown[]) =>
  items.map((item) => referenceOf(item as Parameters<typeof referenceOf>[0]));

async function answerFromRead(
  reads: RestWorkItemReads,
  scope: { organizationId: string; projectId: string },
  operationName: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  const call = (read: RestRead | undefined, request: object) => {
    if (!read) {
      throw new Error(`No REST fake for ${operationName}`);
    }

    // A section selection is part of the request even when it is absent.
    return read(
      {
        ...defined({ ...scope, ...request }),
        ...("includeSectionKeys" in request
          ? { includeSectionKeys: request.includeSectionKeys }
          : {}),
      } as never,
      {} as never,
    );
  };

  const { getTask, getTasks, listWorkItemReferences, getWorkItemGraph } = reads;
  switch (operationName) {
    case "GetWorkItems": {
      const items = payload(
        await call(getTasks, {
          taskIds: variables.ids,
          parentTaskId: variables.parentTaskId,
          parentTaskIds: variables.parentTaskIds,
          initiativeId: variables.initiativeId,
          includeDescendants: variables.includeDescendants,
          type: variables.type,
          status: variables.statuses,
          includeSectionKeys: variables.sectionKeys,
          includeEdges: variables.withEdges || undefined,
          edgeTypes: (variables.edgeTypes as EdgeType[] | undefined)?.map(
            (type) => AgentEdgeType[type],
          ),
          includeServiceRelations: variables.withServiceRelations || undefined,
          page: variables.page,
          limit: variables.limit,
        }),
      ) as FakeWorkItem[];

      return {
        workItems: items.map((item) => nodeOf(item, variables)),
      };
    }
    case "GetProposalGraphTarget":
    case "GetTaskPickerAncestor":
    case "GetWorkItemParent":
    case "GetModeAvailability":
    case "GetWorkItem": {
      const withEdges =
        operationName === "GetModeAvailability" ? true : variables.withEdges;
      const item = payload(
        await call(getTask, {
          taskId: variables.id,
          includeServiceRelations: variables.withServiceRelations,
          includeEdges: withEdges,
          edgeTypes: (variables.edgeTypes as EdgeType[] | undefined)?.map(
            (type) => AgentEdgeType[type],
          ),
        }),
      ) as FakeWorkItem | null;
      if (!item) {
        throw Object.assign(new Error("Task not found"), { status: 404 });
      }

      return { workItem: nodeOf(item, { ...variables, withEdges }) };
    }
    case "GetWorkItemHierarchy": {
      const hierarchy = payload(
        await call(reads.getHierarchy, {
          taskId: variables.id,
          includeDesignDocCounts: variables.includeDesignDocCounts,
          includeAgentSessionCounts: variables.includeAgentSessionCounts,
        }),
      ) as {
        task: FakeWorkItem;
        parent?: FakeWorkItem;
        children: FakeWorkItem[];
      };

      return {
        workItemHierarchy: {
          __typename: "WorkItemHierarchy",
          task: nodeOf(hierarchy.task, variables),
          parent: hierarchy.parent ? nodeOf(hierarchy.parent, variables) : null,
          children: hierarchy.children.map((child) => nodeOf(child, variables)),
        },
      };
    }
    case "GetWorkItemGraph": {
      const graph = payload(
        await call(getWorkItemGraph, { workItemId: variables.id }),
      ) as Record<string, unknown> & {
        root: FakeWorkItem;
        children: FakeWorkItem[];
        relationships: Record<string, unknown>[];
      };
      const member = { withSections: true };

      return {
        workItem: {
          __typename: "WorkItem",
          id: variables.id,
          graph: {
            __typename: "WorkItemGraph",
            root: nodeOf(graph.root, member),
            children: graph.children.map((child) => nodeOf(child, member)),
            relationships: graph.relationships.map(edgeNodeOf),
            layout: graph.layout ?? null,
            derivedReferences: [],
            participation: graph.participation ?? { entries: [], summary: {} },
          },
        },
      };
    }
    case "GetAllWorkItemReferences": {
      const references: unknown[] = [];
      for (let page = 1; ; page += 1) {
        const result = payload(
          await call(listWorkItemReferences, {
            type: variables.type,
            page,
            limit: 500,
          }),
        ) as {
          items: unknown[];
          pagination: { hasNext: boolean };
        };
        references.push(...referencesNode(result.items));
        if (!result.pagination.hasNext) {
          return { references };
        }
      }
    }
    case "GetWorkItemReferencePage": {
      const result = payload(
        await call(listWorkItemReferences, {
          type: variables.type,
          page: variables.page,
          limit: variables.limit,
          filter: variables.filter,
          statuses: variables.statuses,
          sortBy: variables.sortBy,
          sortOrder: variables.sortOrder,
        }),
      ) as { items: unknown[]; pagination: Record<string, unknown> };

      return {
        workItemReferences: {
          __typename: "WorkItemReferencePage",
          items: referencesNode(result.items),
          pagination: {
            __typename: "WorkItemReferencePagination",
            ...result.pagination,
          },
        },
      };
    }
    default:
      throw new Error(`Unexpected ${operationName}`);
  }
}

/**
 * MSW handlers that answer the work-item GraphQL reads from REST-shaped
 * fakes, for suites whose own subject is not the read itself. Failures the
 * fake throws become error responses. Other operations fall through.
 */
export const workItemHandlersFromRest = (reads: RestWorkItemReads) => [
  http.post("*/graphql", async ({ request }) => {
    const { operationName, variables = {} } = (await request
      .clone()
      .json()) as {
      operationName: string;
      variables?: Record<string, unknown>;
    };
    if (!WORK_ITEM_OPERATIONS.has(operationName)) {
      return;
    }
    const [, organizationId, projectId] =
      /organizations\/([^/]+)\/projects\/([^/]+)\/graphql/.exec(
        new URL(request.url).pathname,
      ) ?? [];

    try {
      const data = await answerFromRead(
        reads,
        { organizationId, projectId },
        operationName,
        variables,
      );

      return HttpResponse.json({ data } as never);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;

      return HttpResponse.json(
        {
          errors: [
            {
              message: (error as Error).message,
              extensions: { code: "INTERNAL_SERVER_ERROR" },
            },
          ],
        } as never,
        { status },
      );
    }
  }),
];

/**
 * The same, reading the fakes from a mocked REST client at call time, so a
 * suite that reassigns its mock implementations keeps working.
 */
export const workItemHandlersFromClient = (
  client: Record<string, unknown>,
  extra: RestWorkItemReads = {},
) => {
  const lazy =
    (name: string): RestRead =>
    (request, options) =>
      (client[name] as RestRead)(request, options);

  return workItemHandlersFromRest({
    getTasks: lazy("getTasks"),
    getTask: lazy("getTask"),
    listWorkItemReferences: lazy("listWorkItemReferences"),
    getWorkItemGraph: lazy("getWorkItemGraph"),
    ...extra,
  });
};
