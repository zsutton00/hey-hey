import { AgentEdgeType } from "../api";

/** A work item as the server holds it; any field a query selects may be set. */
export interface FakeWorkItem {
  id: string;
  name: string;
  type: string;
  status: string;
  parentTaskId?: string | null;
  [field: string]: unknown;
}

const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "org-1";

/** The WorkItem a query selects: base fields plus the parts it switched on. */
export const nodeOf = (
  item: FakeWorkItem,
  variables: Record<string, unknown>,
) => ({
  __typename: "WorkItem",
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  initiativeId: null,
  parentTaskId: null,
  source: "USER",
  priority: null,
  tag: null,
  assigneeId: null,
  reporterId: null,
  dueDate: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  hasProposalSupport: true,
  config: null,
  childCounts: null,
  ...(variables.withSections ? { sections: [] } : {}),
  ...(variables.withEdges ? { edges: [] } : {}),
  ...(variables.withServiceRelations ? { serviceRelations: [] } : {}),
  ...(variables.withTrackedEntities ? { trackedEntities: [] } : {}),
  ...(variables.withTrackedWorkSummary ? { trackedWorkSummary: null } : {}),
  ...(variables.withDesignDocCounts ? { designDocCount: 0 } : {}),
  ...(variables.withAgentSessionCounts
    ? { codingSessionCount: 0, agentSessionCount: 0 }
    : {}),
  ...Object.fromEntries(
    Object.entries(item).filter(([, value]) => value !== undefined),
  ),
  ...(Array.isArray(item.sections)
    ? { sections: item.sections.map(sectionNode) }
    : {}),
  ...(Array.isArray(item.edges) && variables.withEdges
    ? { edges: item.edges.map(edgeNodeOf) }
    : {}),
  ...(item.childCounts && typeof item.childCounts === "object"
    ? {
        childCounts: { __typename: "WorkItemChildCounts", ...item.childCounts },
      }
    : {}),
});

export const referenceOf = (item: FakeWorkItem) => ({
  __typename: "WorkItemReference",
  id: item.id,
  name: item.name,
  type: item.type,
  parentTaskId: item.parentTaskId ?? null,
});

const notFound = {
  status: 404,
  body: {
    errors: [{ message: "Task not found", extensions: { code: "NOT_FOUND" } }],
  },
};

const ok = (data: unknown) => ({ status: 200, body: { data } });

/** Which items a list read selects, by the filters it passed. */
function selected(items: FakeWorkItem[], variables: Record<string, unknown>) {
  const { ids, parentTaskId, parentTaskIds, statuses, type } = variables;

  return items.filter(
    (item) =>
      (!Array.isArray(ids) || ids.includes(item.id)) &&
      (parentTaskId === undefined ||
        (item.parentTaskId ?? null) === parentTaskId) &&
      (!Array.isArray(parentTaskIds) ||
        parentTaskIds.includes(item.parentTaskId)) &&
      (!Array.isArray(statuses) || statuses.includes(item.status)) &&
      (typeof type !== "string" || item.type === type),
  );
}

/** Answers one GraphQL operation the way the endpoint does for these items. */
export function answerWorkItemOperation(
  items: FakeWorkItem[],
  operationName: string,
  variables: Record<string, unknown>,
): { status: number; body: unknown } {
  const find = (id: unknown) => items.find((item) => item.id === id);

  switch (operationName) {
    case "GetWorkItems":
      return ok({
        workItems: selected(items, variables).map((item) =>
          nodeOf(item, variables),
        ),
      });
    case "GetWorkItem": {
      const item = find(variables.id);

      return item ? ok({ workItem: nodeOf(item, variables) }) : notFound;
    }
    case "GetWorkItemHierarchy": {
      const task = find(variables.id);
      if (!task) {
        return notFound;
      }
      const parent = find(task.parentTaskId);

      return ok({
        workItemHierarchy: {
          __typename: "WorkItemHierarchy",
          task: nodeOf(task, variables),
          parent: parent ? nodeOf(parent, variables) : null,
          children: items
            .filter((item) => item.parentTaskId === task.id)
            .map((item) => nodeOf(item, variables)),
        },
      });
    }
    case "GetWorkItemGraph": {
      const root = find(variables.id);
      if (!root) {
        return notFound;
      }
      const member = { withSections: true };

      return ok({
        workItem: {
          __typename: "WorkItem",
          id: root.id,
          graph: {
            __typename: "WorkItemGraph",
            root: nodeOf(root, member),
            children: items
              .filter((item) => item.parentTaskId === root.id)
              .map((item) => nodeOf(item, member)),
            relationships: [],
            layout: null,
            derivedReferences: [],
            participation: { entries: [], summary: {} },
          },
        },
      });
    }
    case "GetAllWorkItemReferences":
      return ok({
        references: items
          .filter((item) => item.type === variables.type)
          .map(referenceOf),
      });
    case "GetWorkItemReferencePage": {
      const matching = items.filter((item) => item.type === variables.type);
      const limit = Number(variables.limit);
      const page = Number(variables.page);
      const totalPages = Math.ceil(matching.length / limit);

      return ok({
        workItemReferences: {
          __typename: "WorkItemReferencePage",
          items: matching
            .slice((page - 1) * limit, page * limit)
            .map(referenceOf),
          pagination: {
            __typename: "WorkItemReferencePagination",
            page,
            limit,
            total: matching.length,
            totalPages,
            hasNext: page < totalPages,
            hasPrevious: page > 1,
          },
        },
      });
    }
    default:
      return {
        status: 400,
        body: { errors: [{ message: `Unexpected ${operationName}` }] },
      };
  }
}

/** The operations the work-item reads make. */
export const WORK_ITEM_OPERATIONS: ReadonlySet<string> = new Set([
  "GetWorkItems",
  "GetWorkItem",
  "GetWorkItemHierarchy",
  "GetWorkItemGraph",
  "GetAllWorkItemReferences",
  "GetWorkItemReferencePage",
]);

/** REST-shaped sections, edges and tracked entities, as GraphQL nodes. */
const sectionNode = (section: Record<string, unknown>) => ({
  __typename: "WorkItemSection",
  materializedProposalId: "",
  crdtSnapshotSeq: null,
  ...section,
});

const entityRefNode = (
  id: unknown,
  entityType: unknown,
  name: unknown,
): Record<string, unknown> => ({
  __typename: "EntityRef",
  entityId: id,
  entityType: entityType ?? null,
  name: name ?? null,
});

export const edgeNodeOf = (edge: Record<string, unknown>) => {
  const edgeTypeNames = Object.fromEntries(
    Object.entries(AgentEdgeType).map(([name, value]) => [value, name]),
  );

  return {
    __typename: "WorkItemEdge",
    category: null,
    direction: null,
    predicate: null,
    actionLabel: null,
    transitionRole: null,
    origin: edge.source ?? null,
    createdBySessionId: null,
    lastModifiedBySessionId: null,
    metadata: null,
    targetNodeType: edge.targetNodeType ?? null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    reasoning: "",
    ...edge,
    type: edgeTypeNames[String(edge.type)] ?? edge.type,
    source: entityRefNode(
      edge.sourceNodeId,
      edge.sourceEntityType,
      edge.sourceNodeName,
    ),
    target: entityRefNode(
      edge.targetNodeId,
      edge.targetEntityType,
      edge.targetNodeName,
    ),
  };
};
