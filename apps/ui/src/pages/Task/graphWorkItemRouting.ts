import type {
  AgentEdgeType,
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  TaskResponseDto,
  WorkItemTypeDefinitionDto,
  WorkItemTypeGraphCapability,
} from "@hey-hey/ui-common/api";
import type { HydratedWorkItemGraphInput } from "@hey-hey/ui-common/components";

export const INSTALLED_GRAPH_RENDERER_KEY = "work-item-graph";
export const INSTALLED_GRAPH_EDITOR_KEY = "work-item-graph-editor";

const AUTHORING_ACTIONS = new Set([
  "createNode",
  "updateNode",
  "deleteNode",
  "createRelationship",
  "updateRelationship",
  "reconnectRelationship",
  "deleteRelationship",
  "replaceLayout",
  "clearLayout",
]);
const FLOW_EDGE_TYPES = new Set(["STANDARD", "CONDITIONAL", "LOOP"]);

export type GraphRootInput = Extract<
  HydratedWorkItemGraphInput,
  { root: ProjectedWorkItem }
>;

export const canAuthorGraph = (
  capability: WorkItemTypeGraphCapability | undefined,
): boolean =>
  Boolean(
    capability?.supportedActions.some((action) =>
      AUTHORING_ACTIONS.has(action),
    ),
  );

export const getReadableGraphEdgeTypes = (
  capability: WorkItemTypeGraphCapability | undefined,
): AgentEdgeType[] =>
  capability
    ? [
        ...new Set(
          capability.readableRelationships.map(
            (relationship) => relationship.edgeType,
          ),
        ),
      ]
    : [];

const identityFor = (id: string): ProjectedWorkItem["identity"] => ({
  refType: "existing",
  id,
});

const materializedSectionContent = (section: {
  materializedMarkdown?: string;
  content?: unknown;
}): unknown =>
  "content" in section ? section.content : (section.materializedMarkdown ?? "");

const toGraphNode = (task: TaskResponseDto): ProjectedWorkItem => ({
  identity: identityFor(task.id),
  label: task.name,
  type: task.type,
  name: task.name,
  ...(task.parentTaskId ? { parent: identityFor(task.parentTaskId) } : {}),
  status: task.status,
  priority: task.priority,
  dueDate: task.dueDate ?? null,
  assigneeId: task.assigneeId ?? null,
  tag: task.tag,
  sections: (task.sections ?? []).map((section) => ({
    key: section.key,
    content: materializedSectionContent(section),
  })),
  deleted: false,
});

const toGraphRelationship = (
  edge: NonNullable<TaskResponseDto["edges"]>[number],
): ProjectedWorkItemRelationship => ({
  identity: { refType: "existing", id: edge.id },
  label: edge.type,
  source: identityFor(edge.sourceNodeId),
  ...(edge.sourceEntityType ? { sourceEntityType: edge.sourceEntityType } : {}),
  target: identityFor(edge.targetNodeId),
  ...(edge.targetEntityType ? { targetEntityType: edge.targetEntityType } : {}),
  edgeType: edge.type,
  category: edge.category ?? (FLOW_EDGE_TYPES.has(edge.type) ? "flow" : "meta"),
  ...(edge.direction != null ? { direction: edge.direction } : {}),
  ...(edge.predicate !== undefined ? { predicate: edge.predicate } : {}),
  reasoning: edge.reasoning ?? null,
  metadata: edge.metadata ?? null,
  deleted: false,
});

export const buildGraphInput = (
  root: TaskResponseDto,
  children: readonly TaskResponseDto[],
  definition: WorkItemTypeDefinitionDto,
  readableEdgeTypes: ReadonlySet<AgentEdgeType>,
): GraphRootInput => {
  const seen = new Set<string>();
  const incidentRelationships = [root, ...children].flatMap((task) =>
    (task.edges ?? []).flatMap((edge) => {
      if (!readableEdgeTypes.has(edge.type) || seen.has(edge.id)) return [];
      seen.add(edge.id);
      return [toGraphRelationship(edge)];
    }),
  );
  return {
    root: toGraphNode(root),
    children: children.map(toGraphNode),
    incidentRelationships,
    typeDefinition: definition,
  };
};

export type GraphWorkItemRouteSelection =
  | { status: "loading" }
  | { status: "unresolved-definition" }
  | { status: "non-graph"; definition: WorkItemTypeDefinitionDto }
  | { status: "invalid-capability"; definition: WorkItemTypeDefinitionDto }
  | { status: "unsupported-renderer"; definition: WorkItemTypeDefinitionDto }
  | { status: "unsupported-editor"; definition: WorkItemTypeDefinitionDto }
  | {
      status: "graph";
      definition: WorkItemTypeDefinitionDto;
      capability: WorkItemTypeGraphCapability;
    };

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRelationshipDeclaration = (
  value: unknown,
): value is WorkItemTypeGraphCapability["readableRelationships"][number] =>
  isRecord(value) &&
  isNonEmptyString(value.edgeType) &&
  isNonEmptyString(value.category) &&
  isEndpointRule(value.sourceEndpoint) &&
  isEndpointRule(value.targetEndpoint) &&
  (value.direction === undefined || isRecord(value.direction));

const isEndpointRule = (value: unknown): boolean =>
  isRecord(value) &&
  isNonEmptyString(value.role) &&
  Array.isArray(value.entityTypes) &&
  value.entityTypes.every(isNonEmptyString) &&
  (value.workItemTypeKeys === undefined ||
    (Array.isArray(value.workItemTypeKeys) &&
      value.workItemTypeKeys.every(isNonEmptyString)));

const isGraphCapability = (
  value: unknown,
): value is WorkItemTypeGraphCapability =>
  isRecord(value) &&
  isNonEmptyString(value.nodeChildType) &&
  isRecord(value.layout) &&
  isNonEmptyString(value.layout.sectionKey) &&
  isNonEmptyString(value.layout.schemaRef) &&
  Array.isArray(value.readableRelationships) &&
  value.readableRelationships.every(isRelationshipDeclaration) &&
  Array.isArray(value.editableRelationships) &&
  value.editableRelationships.every(isRelationshipDeclaration) &&
  isNonEmptyString(value.rendererKey) &&
  isNonEmptyString(value.editorKey) &&
  Array.isArray(value.supportedActions) &&
  value.supportedActions.every(isNonEmptyString);

const hasValidGraphCapability = (
  definition: WorkItemTypeDefinitionDto,
  capability: WorkItemTypeGraphCapability,
): boolean => {
  if (!isGraphCapability(capability) || !Array.isArray(definition.sections)) {
    return false;
  }

  return definition.sections.some(
    (section) =>
      section.key === capability.layout.sectionKey &&
      section.kind === "json" &&
      section.schemaRef === capability.layout.schemaRef,
  );
};

export const selectGraphWorkItemRoute = (input: {
  typeKey: string | null | undefined;
  definition: WorkItemTypeDefinitionDto | undefined;
  isFetched: boolean;
}): GraphWorkItemRouteSelection => {
  if (!input.isFetched) return { status: "loading" };
  if (
    !input.typeKey ||
    !input.definition ||
    input.definition.key !== input.typeKey
  ) {
    return { status: "unresolved-definition" };
  }

  const capability = input.definition.capabilities?.graph;
  if (capability === undefined) {
    return { status: "non-graph", definition: input.definition };
  }
  if (
    !isGraphCapability(capability) ||
    !hasValidGraphCapability(input.definition, capability)
  ) {
    return { status: "invalid-capability", definition: input.definition };
  }
  if (capability.rendererKey !== INSTALLED_GRAPH_RENDERER_KEY) {
    return { status: "unsupported-renderer", definition: input.definition };
  }
  if (capability.editorKey !== INSTALLED_GRAPH_EDITOR_KEY) {
    return { status: "unsupported-editor", definition: input.definition };
  }

  return {
    status: "graph",
    definition: input.definition,
    capability,
  };
};
