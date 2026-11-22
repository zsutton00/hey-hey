import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  type AgentEdgeResponseDto,
  type ConversationResponseDto,
  type MessageRecordDto,
  type MessageResponseDto,
  type PaginatedWorkItemReferenceResponseDto,
  type TaskHierarchyResponseDto,
  type WorkItemGraphAggregateResponseDto,
  type WorkItemReferenceDto,
} from "../../api";
import type { WorkItemResponseDto } from "../collections/workItems";
import type {
  ConversationFieldsFragment,
  EdgeType,
  EntityType,
  GetMessageQuery,
  GetWorkItemGraphQuery,
  GetWorkItemHierarchyQuery,
  GetWorkItemReferencePageQuery,
  MessageFieldsFragment,
  WorkItemEdgeFieldsFragment,
  WorkItemPartsFragment,
  WorkItemReferenceFieldsFragment,
} from "../../graphql/generated/graphql";

/**
 * GraphQL answers a field REST leaves out with `null`. REST records omit it,
 * so absent fields are dropped, except the ones REST itself reports as null.
 */
const withoutAbsentFields = (
  node: object,
  nullableByContract: readonly string[],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(node).filter(
      ([field, value]) => value !== null || nullableByContract.includes(field),
    ),
  );

/**
 * The GraphQL schema is derived from the REST DTOs: field names and JSON
 * payloads match, and ids and enums are string-valued. These mappers are the
 * one place a GraphQL node becomes the REST-shaped record the hooks return.
 */
export const toConversationResponse = (
  node: ConversationFieldsFragment & {
    suggestionDecisions?: unknown[] | null;
    goalPmRoutingDecisions?: unknown[] | null;
  },
): ConversationResponseDto =>
  withoutAbsentFields(node, [
    "createdBy",
  ]) as unknown as ConversationResponseDto;

type MessageNode = MessageFieldsFragment & {
  proposals?: unknown[] | null;
  reports?: unknown[] | null;
};

type MessageDetailNode = NonNullable<GetMessageQuery["message"]>;

export const toMessageResponse = (node: MessageNode): MessageResponseDto =>
  withoutAbsentFields(node, ["createdAt"]) as unknown as MessageResponseDto;

/** A message with the replies and parent the single-message read returns. */
export const toMessageDetail = (node: MessageDetailNode): MessageRecordDto => {
  const { parentMessage, responses, ...message } = node;

  return {
    ...toMessageResponse(message),
    responses: (responses ?? []).map(toMessageResponse),
    ...(parentMessage
      ? { parentMessage: toMessageResponse(parentMessage) }
      : {}),
  } as MessageRecordDto;
};

export const toMessageRecord = (node: MessageNode): MessageRecordDto =>
  toMessageResponse(node);

/**
 * GraphQL enums are named by the REST enum's keys, so `DependsOn` on the wire
 * is `DEPENDS_ON` in the REST records the hooks return. These two translate
 * between them for the closed enums the work-item reads use.
 */
type RestEnum = Record<string, string>;

/**
 * The name a REST enum value has in the schema. Both enums are closed, and the
 * schema names each member by the REST enum's key, so a value with no key is a
 * contract mismatch, not a case to guess at.
 */
const graphQLEnumName = <Name extends string>(
  restEnum: RestEnum,
  value: string,
): Name => {
  const entry = Object.entries(restEnum).find(
    ([, restValue]) => restValue === value,
  );
  if (!entry) {
    throw new Error(`"${value}" is not a member of the enum the schema serves`);
  }

  return entry[0] as Name;
};

const toRestEnumValue = (restEnum: RestEnum, name: string): string =>
  restEnum[name] ?? name;

export const edgeTypeName = (type: AgentEdgeType): EdgeType =>
  graphQLEnumName(AgentEdgeType, type);

export const endpointEntityTypeName = (
  type: AgentEdgeEndpointEntityType,
): EntityType => graphQLEnumName(AgentEdgeEndpointEntityType, type);

const withoutTypename = (node: object): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(node).filter(([field]) => field !== "__typename"),
  );

/** A node's own scalar fields, as the REST record carries them. */
const scalarsOf = (
  node: object,
  nullableByContract: readonly string[] = [],
): Record<string, unknown> =>
  withoutAbsentFields(withoutTypename(node), nullableByContract);

const WORK_ITEM_NULLABLE_FIELDS = [
  "initiativeId",
  "parentTaskId",
  "assigneeId",
  "dueDate",
  "archivedAt",
  "designDocCount",
  "codingSessionCount",
  "agentSessionCount",
] as const;

export const toEdgeResponse = (
  edge: WorkItemEdgeFieldsFragment,
): AgentEdgeResponseDto => {
  const { source, target, origin, type, ...rest } = edge;

  return {
    ...scalarsOf(rest),
    type: toRestEnumValue(AgentEdgeType, type),
    sourceNodeId: source.entityId,
    sourceEntityType: source.entityType,
    sourceNodeName: source.name,
    targetNodeId: target.entityId,
    targetEntityType: target.entityType,
    targetNodeName: target.name,
    source: origin,
  } as unknown as AgentEdgeResponseDto;
};

/** The REST work-item record for a node read with any combination of parts. */
export const toWorkItemResponse = (
  node: WorkItemPartsFragment,
): WorkItemResponseDto => {
  const {
    sections,
    edges,
    serviceRelations,
    trackedEntities,
    trackedWorkSummary,
    childCounts,
    ...own
  } = node;

  return {
    ...scalarsOf(own, WORK_ITEM_NULLABLE_FIELDS),
    ...(childCounts ? { childCounts: scalarsOf(childCounts) } : {}),
    ...(sections
      ? { sections: sections.map((s) => scalarsOf(s, ["crdtSnapshotSeq"])) }
      : {}),
    ...(edges ? { edges: edges.map(toEdgeResponse) } : {}),
    ...(serviceRelations
      ? { serviceRelations: serviceRelations.map((r) => scalarsOf(r)) }
      : {}),
    ...(trackedEntities
      ? {
          trackedEntities: trackedEntities.map((entity) =>
            scalarsOf(
              {
                targetEntityId: entity.entityId,
                targetEntityType: entity.entityType,
                title: entity.name,
                status: entity.status,
                dueDate: entity.dueDate,
              },
              ["dueDate"],
            ),
          ),
        }
      : {}),
    ...(trackedWorkSummary
      ? { trackedWorkSummary: scalarsOf(trackedWorkSummary) }
      : {}),
  } as unknown as WorkItemResponseDto;
};

export const toHierarchyResponse = (
  node: GetWorkItemHierarchyQuery["workItemHierarchy"],
): TaskHierarchyResponseDto =>
  ({
    task: toWorkItemResponse(node.task),
    ...(node.parent ? { parent: toWorkItemResponse(node.parent) } : {}),
    children: node.children.map(toWorkItemResponse),
  }) as unknown as TaskHierarchyResponseDto;

type GraphNode = NonNullable<GetWorkItemGraphQuery["workItem"]["graph"]>;

export const toGraphAggregateResponse = (
  graph: GraphNode,
): WorkItemGraphAggregateResponseDto =>
  ({
    root: toWorkItemResponse(graph.root),
    children: graph.children.map(toWorkItemResponse),
    relationships: graph.relationships.map(toEdgeResponse),
    layout: graph.layout ?? null,
    derivedReferences: graph.derivedReferences.map(
      ({ name, ...reference }) => ({
        ...scalarsOf(reference),
        displayName: name,
      }),
    ),
    participation: graph.participation,
  }) as unknown as WorkItemGraphAggregateResponseDto;

export const toReferenceResponse = (
  node: WorkItemReferenceFieldsFragment,
): WorkItemReferenceDto =>
  scalarsOf(node, ["parentTaskId"]) as unknown as WorkItemReferenceDto;

export const toReferencePageResponse = (
  node: GetWorkItemReferencePageQuery["workItemReferences"],
): PaginatedWorkItemReferenceResponseDto => ({
  items: node.items.map(toReferenceResponse),
  pagination: scalarsOf(
    node.pagination,
  ) as unknown as PaginatedWorkItemReferenceResponseDto["pagination"],
});
