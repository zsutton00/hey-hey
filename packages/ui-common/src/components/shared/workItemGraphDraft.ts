import type {
  DiagramGroup,
  ProjectedWorkItem,
  ProjectedWorkItemChangeSetResponse,
  ProjectedWorkItemRelationship,
  ProjectedWorkItemSection,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetLayoutEntry,
  WorkItemChangeSetOperation,
  WorkItemChangeSetPosition,
  WorkItemChangeSetRelationshipIdentity,
  WorkItemCreateOperation,
  WorkItemGraphLayoutNodeRef,
  WorkItemGraphLayoutPreferenceValue,
  WorkItemLayoutClearOperation,
  WorkItemLayoutReplaceOperation,
  WorkItemRelationshipCreateOperation,
  WorkItemRelationshipUpdateOperation,
  WorkItemSectionClearOperation,
  WorkItemSectionReplaceOperation,
  WorkItemTypeDefinitionDto,
  WorkItemTypeGraphCapability,
  WorkItemUpdateOperation,
} from "../../api";
import {
  WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
  type WorkItemGraphLayout,
  compareWorkItemIdentities,
  computeCanonicalWorkItemGraphLayout,
  computePreferredWorkItemGraphLayout,
  type PreferredLayoutDeparture,
  type PreferredWorkItemGraphLayoutResult,
  type PreferredWorkItemGraphShape,
  mergeWorkItemGraphLayout,
  normalizeWorkItemGraphLayout,
  workItemIdentityKey,
} from "./workItemGraphLayout";
import {
  parseDiagramGroups,
  serializeDiagramGroups,
} from "./diagramGroupBoundaries";

export type { WorkItemGraphLayout } from "./workItemGraphLayout";
export {
  WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
  computeCanonicalWorkItemGraphLayout,
  computePreferredWorkItemGraphLayout,
  normalizeWorkItemGraphLayout,
} from "./workItemGraphLayout";

interface RootGraphInput {
  root: ProjectedWorkItem;
  children: readonly ProjectedWorkItem[];
  incidentRelationships: readonly ProjectedWorkItemRelationship[];
  typeDefinition: WorkItemTypeDefinitionDto;
}

interface MutableRootGraphInput {
  root: ProjectedWorkItem;
  children: ProjectedWorkItem[];
  incidentRelationships: ProjectedWorkItemRelationship[];
  typeDefinition: WorkItemTypeDefinitionDto;
}

interface ProjectedRootGraphInput {
  projectedRoot: ProjectedWorkItem;
  children: readonly ProjectedWorkItem[];
  incidentRelationships: readonly ProjectedWorkItemRelationship[];
  typeDefinition: WorkItemTypeDefinitionDto;
}

export type HydratedWorkItemGraphInput =
  RootGraphInput | ProjectedRootGraphInput;

export interface ResolvedWorkItemGraphContext {
  root: ProjectedWorkItem;
  children: readonly ProjectedWorkItem[];
  incidentRelationships: readonly ProjectedWorkItemRelationship[];
  typeDefinition: WorkItemTypeDefinitionDto;
  graphCapability: WorkItemTypeGraphCapability;
  layoutSectionKey: string;
  layoutPreferenceSectionKey: string | null;
  /** Type-declared groups section; null when the type has no groups. */
  groupsSectionKey: string | null;
}

export type WorkItemGraphDraftProjection =
  ProjectedWorkItemChangeSetResponse & {
    effectiveLayout: WorkItemGraphLayout;
    layoutSource: "authored" | "canonical";
    layoutSectionKey: string;
  };

export class WorkItemGraphDraftError extends Error {
  readonly code:
    | "missing_root"
    | "missing_type_definition"
    | "missing_graph_capability"
    | "missing_layout_section"
    | "invalid_layout"
    | "unknown_work_item"
    | "unknown_relationship"
    | "invalid_action";

  constructor(code: WorkItemGraphDraftError["code"], message: string) {
    super(message);
    this.name = "WorkItemGraphDraftError";
    this.code = code;
  }
}

type DraftOperation = WorkItemChangeSetOperation;
type WorkItemFields = Omit<WorkItemCreateOperation, "op" | "ref">;
type WorkItemUpdateFields = Omit<WorkItemUpdateOperation, "op" | "ref">;
type RelationshipDirection = Extract<
  WorkItemRelationshipCreateOperation,
  { direction?: unknown }
>["direction"];
type RelationshipCreateFields = {
  source: WorkItemChangeSetIdentity;
  target: WorkItemChangeSetIdentity;
  edgeType: WorkItemRelationshipCreateOperation["edgeType"];
  category: WorkItemRelationshipCreateOperation["category"];
  direction?: RelationshipDirection;
  predicate?: string | null;
  reasoning?: string | null;
  metadata?: Record<string, unknown> | null;
};
type RelationshipUpdateFields = Omit<
  WorkItemRelationshipUpdateOperation,
  "op" | "ref"
>;

export interface CreateWorkItemDraftInput extends WorkItemFields {
  ref?: Extract<WorkItemChangeSetIdentity, { refType: "temporary" }>;
  position?: WorkItemChangeSetPosition;
}

export interface ReviseWorkItemDraftInput extends WorkItemUpdateFields {
  ref: WorkItemChangeSetIdentity;
  sections?: Readonly<Record<string, unknown>>;
  clearSections?: readonly string[];
}

export interface ConnectWorkItemDraftInput extends RelationshipCreateFields {
  ref?: Extract<
    WorkItemChangeSetRelationshipIdentity,
    { refType: "temporary" }
  >;
}

export interface CreateConnectedWorkItemDraftInput {
  child: CreateWorkItemDraftInput & {
    position: WorkItemChangeSetPosition;
  };
  relationship: Omit<ConnectWorkItemDraftInput, "source" | "target"> & {
    source?: WorkItemChangeSetIdentity;
    target?: WorkItemChangeSetIdentity;
    childEndpoint: "source" | "target";
    otherEndpoint: WorkItemChangeSetIdentity;
  };
}

export interface ReconnectWorkItemDraftInput extends RelationshipUpdateFields {
  ref: WorkItemChangeSetRelationshipIdentity;
}

export interface WorkItemGraphDraftState {
  context: ResolvedWorkItemGraphContext;
  operations: readonly DraftOperation[];
  projection: WorkItemGraphDraftProjection;
  initialProjection: WorkItemGraphDraftProjection;
  isDirty: boolean;
  preferredLayoutDepartures: readonly PreferredLayoutDeparture[];
  preferredLayoutResult: PreferredWorkItemGraphLayoutResult | null;
}

export type WorkItemGraphDraftAction =
  | {
      type: "move";
      child: WorkItemChangeSetIdentity;
      position: WorkItemChangeSetPosition;
      displayedLayout?: readonly WorkItemChangeSetLayoutEntry[];
    }
  | { type: "create"; input: CreateWorkItemDraftInput }
  | { type: "revise"; input: ReviseWorkItemDraftInput }
  | { type: "delete"; child: WorkItemChangeSetIdentity }
  | { type: "connect"; input: ConnectWorkItemDraftInput }
  | { type: "createConnected"; input: CreateConnectedWorkItemDraftInput }
  | { type: "reconnect"; input: ReconnectWorkItemDraftInput }
  | { type: "remove"; relationship: WorkItemChangeSetRelationshipIdentity }
  | { type: "replaceSection"; input: WorkItemSectionReplaceOperation }
  | { type: "clearSection"; input: WorkItemSectionClearOperation }
  | { type: "reset" }
  | { type: "reflow" }
  | { type: "applyPreferredLayout" }
  | { type: "hydrate"; input: HydratedWorkItemGraphInput };

function asRootGraphInput(input: HydratedWorkItemGraphInput): RootGraphInput {
  if ("root" in input) return input;
  return {
    root: input.projectedRoot,
    children: input.children,
    incidentRelationships: input.incidentRelationships,
    typeDefinition: input.typeDefinition,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveGraphCapability(
  typeDefinition: WorkItemTypeDefinitionDto | null | undefined,
): WorkItemTypeGraphCapability {
  if (!typeDefinition) {
    throw new WorkItemGraphDraftError(
      "missing_type_definition",
      "A work-item type definition is required to initialize a graph draft.",
    );
  }
  if (!typeDefinition.capabilities?.graph) {
    throw new WorkItemGraphDraftError(
      "missing_graph_capability",
      `Work-item type ${typeDefinition.key} does not declare a graph capability.`,
    );
  }
  if (!typeDefinition.capabilities.graph.layout?.sectionKey) {
    throw new WorkItemGraphDraftError(
      "missing_layout_section",
      `Work-item type ${typeDefinition.key} does not declare a graph layout section.`,
    );
  }
  return typeDefinition.capabilities.graph;
}

export function resolveWorkItemGraphDraftContext(
  input: HydratedWorkItemGraphInput,
): ResolvedWorkItemGraphContext {
  const normalized = asRootGraphInput(input);
  if (!normalized.root) {
    throw new WorkItemGraphDraftError(
      "missing_root",
      "A graph root is required to initialize a graph draft.",
    );
  }

  const graphCapability = resolveGraphCapability(normalized.typeDefinition);
  return {
    root: normalized.root,
    children: normalized.children,
    incidentRelationships: normalized.incidentRelationships,
    typeDefinition: normalized.typeDefinition,
    graphCapability,
    layoutSectionKey: graphCapability.layout.sectionKey,
    layoutPreferenceSectionKey:
      graphCapability.layoutPreference?.sectionKey ?? null,
    groupsSectionKey: graphCapability.groups?.sectionKey ?? null,
  };
}

function relationshipIdentityKey(
  identity: WorkItemChangeSetRelationshipIdentity,
): string {
  return identity.refType === "existing"
    ? `existing:${identity.id}`
    : `temporary:${identity.tempId}`;
}

function cloneNode(node: ProjectedWorkItem): ProjectedWorkItem {
  return {
    ...node,
    sections: node.sections.map((section) => ({ ...section })),
  };
}

function cloneRelationship(
  relationship: ProjectedWorkItemRelationship,
): ProjectedWorkItemRelationship {
  return { ...relationship };
}

function cloneProjectionInput(
  context: ResolvedWorkItemGraphContext,
): MutableRootGraphInput {
  return {
    root: cloneNode(context.root),
    children: context.children.map(cloneNode),
    incidentRelationships: context.incidentRelationships.map(cloneRelationship),
    typeDefinition: context.typeDefinition,
  };
}

function getNodeByIdentity(
  root: ProjectedWorkItem,
  children: readonly ProjectedWorkItem[],
  identity: WorkItemChangeSetIdentity,
): ProjectedWorkItem | undefined {
  const key = workItemIdentityKey(identity);
  if (workItemIdentityKey(root.identity) === key) return root;
  return children.find((child) => workItemIdentityKey(child.identity) === key);
}

function getRelationshipByIdentity(
  relationships: readonly ProjectedWorkItemRelationship[],
  identity: WorkItemChangeSetRelationshipIdentity,
): ProjectedWorkItemRelationship | undefined {
  const key = relationshipIdentityKey(identity);
  return relationships.find(
    (relationship) => relationshipIdentityKey(relationship.identity) === key,
  );
}

function getSection(
  node: ProjectedWorkItem,
  key: string,
): ProjectedWorkItemSection | undefined {
  return node.sections.find((section) => section.key === key);
}

function collectTemporaryWorkItemRefs(
  context: ResolvedWorkItemGraphContext,
): Set<string> {
  const refs = new Set<string>();
  [context.root, ...context.children].forEach((node) => {
    if (node.identity.refType === "temporary") {
      refs.add(node.identity.tempId);
    }
  });
  return refs;
}

function collectTemporaryRelationshipRefs(
  context: ResolvedWorkItemGraphContext,
): Set<string> {
  const refs = new Set<string>();
  context.incidentRelationships.forEach((relationship) => {
    if (relationship.identity.refType === "temporary") {
      refs.add(relationship.identity.tempId);
    }
  });
  return refs;
}

function parseLayoutNode(value: unknown): WorkItemChangeSetIdentity | null {
  if (!isRecord(value)) return null;
  if (value.refType === "existing" && typeof value.id === "string") {
    return { refType: "existing", id: value.id };
  }
  if (value.refType === "temporary" && typeof value.tempId === "string") {
    return { refType: "temporary", tempId: value.tempId };
  }
  if (
    value.kind === "persistedWorkItem" &&
    typeof value.workItemId === "string"
  ) {
    return { refType: "existing", id: value.workItemId };
  }
  if (
    value.kind === "temporaryWorkItem" &&
    typeof value.temporaryRef === "string"
  ) {
    return { refType: "temporary", tempId: value.temporaryRef };
  }
  return null;
}

function parseLayoutPosition(value: unknown): WorkItemChangeSetPosition | null {
  if (
    !isRecord(value) ||
    typeof value.x !== "number" ||
    typeof value.y !== "number"
  ) {
    return null;
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

function assertFinitePosition(position: WorkItemChangeSetPosition): void {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new WorkItemGraphDraftError(
      "invalid_action",
      "A graph layout position must contain finite logical coordinates.",
    );
  }
}

function parseLayoutContent(content: unknown): WorkItemGraphLayout | null {
  if (content === null || content === undefined) return null;
  if (typeof content === "string" && content.trim().length === 0) return null;
  let value: unknown = content;
  if (typeof content === "string") {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      throw new WorkItemGraphDraftError(
        "invalid_layout",
        "The authored graph layout section is not valid JSON.",
      );
    }
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION
  ) {
    throw new WorkItemGraphDraftError(
      "invalid_layout",
      "The authored graph layout section has an unsupported schema version.",
    );
  }
  if (!Array.isArray(value.nodes)) {
    throw new WorkItemGraphDraftError(
      "invalid_layout",
      "The authored graph layout section must contain a nodes array.",
    );
  }

  const nodes: WorkItemGraphLayout["nodes"] = [];
  for (const nodeValue of value.nodes) {
    if (!isRecord(nodeValue)) {
      throw new WorkItemGraphDraftError(
        "invalid_layout",
        "Each authored graph layout entry must be an object.",
      );
    }
    const node = parseLayoutNode(nodeValue.node);
    const position = parseLayoutPosition(nodeValue.position);
    if (!node || !position) {
      throw new WorkItemGraphDraftError(
        "invalid_layout",
        "Each authored graph layout entry must contain a valid node and finite position.",
      );
    }
    nodes.push({ node, position });
  }
  return { schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION, nodes };
}

function readAuthoredLayout(
  root: ProjectedWorkItem,
  sectionKey: string,
): WorkItemGraphLayout | null {
  const section = getSection(root, sectionKey);
  return section ? parseLayoutContent(section.content) : null;
}

export const WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION: WorkItemGraphLayoutPreferenceValue["schemaVersion"] =
  "work-item-graph-layout-preference.v1";

export function parseWorkItemGraphLayoutPreference(
  content: unknown,
): PreferredWorkItemGraphShape | null {
  if (content === null || content === undefined) return null;
  let value: unknown = content;
  if (typeof content === "string") {
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION ||
    typeof value.rows !== "number" ||
    typeof value.columns !== "number" ||
    !Number.isInteger(value.rows) ||
    !Number.isInteger(value.columns) ||
    value.rows <= 0 ||
    value.columns <= 0
  )
    return null;
  return { rows: value.rows, columns: value.columns };
}

export function serializeWorkItemGraphLayoutPreference(
  preference: PreferredWorkItemGraphShape,
): WorkItemGraphLayoutPreferenceValue {
  return {
    schemaVersion: WORK_ITEM_GRAPH_LAYOUT_PREFERENCE_SCHEMA_VERSION,
    rows: preference.rows,
    columns: preference.columns,
  };
}

function serializeLayoutContent(layout: WorkItemGraphLayout): {
  schemaVersion: typeof WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION;
  nodes: Array<{
    node:
      | { kind: "persistedWorkItem"; workItemId: string }
      | { kind: "temporaryWorkItem"; temporaryRef: string };
    position: WorkItemChangeSetPosition;
  }>;
} {
  return {
    schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
    nodes: layout.nodes.map((entry) => ({
      node:
        entry.node.refType === "existing"
          ? { kind: "persistedWorkItem", workItemId: entry.node.id }
          : { kind: "temporaryWorkItem", temporaryRef: entry.node.tempId },
      position: entry.position,
    })),
  };
}

function replaceSection(
  node: ProjectedWorkItem,
  key: string,
  content: ProjectedWorkItemSection["content"],
): void {
  const sections = new Map(
    node.sections.map((section) => [section.key, section]),
  );
  sections.set(key, { key, content });
  node.sections = [...sections.values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

function clearSection(node: ProjectedWorkItem, key: string): void {
  node.sections = node.sections.filter((section) => section.key !== key);
}

function applyOperation(
  input: MutableRootGraphInput,
  operation: DraftOperation,
): void {
  const root = input.root;
  const node =
    "ref" in operation && operation.ref.refType !== undefined
      ? getNodeByIdentity(root, input.children, operation.ref)
      : undefined;

  switch (operation.op) {
    case "workItem.create": {
      const created: ProjectedWorkItem = {
        identity: operation.ref,
        label: operation.name,
        type: operation.type ?? "STANDARD",
        name: operation.name,
        parent: operation.parent,
        status: operation.status,
        priority: operation.priority,
        dueDate: operation.dueDate ?? null,
        assigneeId: operation.assigneeId ?? null,
        tag: operation.tag,
        sections: [],
        deleted: false,
      };
      if (
        operation.parent &&
        workItemIdentityKey(operation.parent) ===
          workItemIdentityKey(root.identity)
      ) {
        input.children.push(created);
      }
      break;
    }
    case "workItem.update": {
      if (!node) return;
      if (operation.name !== undefined) {
        node.name = operation.name;
        node.label = operation.name;
      }
      if (Object.prototype.hasOwnProperty.call(operation, "parent")) {
        node.parent = operation.parent ?? undefined;
      }
      if (operation.status !== undefined) node.status = operation.status;
      if (operation.priority !== undefined) node.priority = operation.priority;
      if (Object.prototype.hasOwnProperty.call(operation, "dueDate")) {
        node.dueDate = operation.dueDate ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(operation, "assigneeId")) {
        node.assigneeId = operation.assigneeId ?? null;
      }
      if (operation.tag !== undefined) node.tag = operation.tag;
      break;
    }
    case "workItem.delete": {
      if (!node) return;
      node.deleted = true;
      input.incidentRelationships = input.incidentRelationships.map(
        (relationship) =>
          workItemIdentityKey(relationship.source) ===
            workItemIdentityKey(operation.ref) ||
          workItemIdentityKey(relationship.target) ===
            workItemIdentityKey(operation.ref)
            ? { ...relationship, deleted: true }
            : relationship,
      );
      break;
    }
    case "section.replace": {
      if (!node) return;
      replaceSection(node, operation.key, operation.content);
      break;
    }
    case "section.clear": {
      if (!node) return;
      clearSection(node, operation.key);
      break;
    }
    case "relationship.create": {
      input.incidentRelationships.push({
        identity: operation.ref,
        label: operation.edgeType,
        source: operation.source,
        target: operation.target,
        sourceEntityType: "TASK",
        targetEntityType: "TASK",
        edgeType: operation.edgeType,
        category: operation.category,
        direction:
          "direction" in operation
            ? (operation.direction ?? undefined)
            : undefined,
        predicate:
          "predicate" in operation ? (operation.predicate ?? null) : null,
        reasoning: operation.reasoning ?? null,
        metadata: operation.metadata ?? null,
        deleted: false,
      });
      break;
    }
    case "relationship.update": {
      const relationship = getRelationshipByIdentity(
        input.incidentRelationships,
        operation.ref,
      );
      if (!relationship) return;
      if (operation.source) relationship.source = operation.source;
      if (operation.target) relationship.target = operation.target;
      if (operation.sourceEntityType) {
        relationship.sourceEntityType = operation.sourceEntityType;
      }
      if (operation.targetEntityType) {
        relationship.targetEntityType = operation.targetEntityType;
      }
      if (operation.edgeType) {
        relationship.edgeType = operation.edgeType;
        relationship.label = operation.edgeType;
      }
      if (operation.category !== undefined)
        relationship.category = operation.category;
      if (Object.prototype.hasOwnProperty.call(operation, "direction")) {
        relationship.direction = operation.direction;
      }
      if (Object.prototype.hasOwnProperty.call(operation, "predicate")) {
        relationship.predicate = operation.predicate ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(operation, "reasoning")) {
        relationship.reasoning = operation.reasoning ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(operation, "metadata")) {
        relationship.metadata = operation.metadata ?? null;
      }
      break;
    }
    case "relationship.delete": {
      const relationship = getRelationshipByIdentity(
        input.incidentRelationships,
        operation.ref,
      );
      if (relationship) relationship.deleted = true;
      break;
    }
    case "layout.replace": {
      const layoutRoot = getNodeByIdentity(
        root,
        input.children,
        operation.root,
      );
      if (!layoutRoot) return;
      replaceSection(
        layoutRoot,
        operation.sectionKey,
        serializeLayoutContent({
          schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
          nodes: operation.entries.map((entry) => ({
            node: entry.node,
            position: entry.position,
          })),
        }),
      );
      break;
    }
    case "layout.clear": {
      const layoutRoot = getNodeByIdentity(
        root,
        input.children,
        operation.root,
      );
      if (!layoutRoot) return;
      clearSection(layoutRoot, operation.sectionKey);
      break;
    }
  }
}

function buildProjection(
  context: ResolvedWorkItemGraphContext,
  operations: readonly DraftOperation[],
): WorkItemGraphDraftProjection {
  const input = cloneProjectionInput(context);
  operations.forEach((operation) => applyOperation(input, operation));

  const rootKey = workItemIdentityKey(input.root.identity);
  const children = input.children
    .filter(
      (child) =>
        child.parent === undefined ||
        child.parent === null ||
        workItemIdentityKey(child.parent) === rootKey,
    )
    .sort((left, right) =>
      compareWorkItemIdentities(left.identity, right.identity),
    );
  const childKeys = new Set(
    children.map((child) => workItemIdentityKey(child.identity)),
  );
  const relationships = input.incidentRelationships
    .filter(
      (relationship) =>
        workItemIdentityKey(relationship.source) === rootKey ||
        workItemIdentityKey(relationship.target) === rootKey ||
        childKeys.has(workItemIdentityKey(relationship.source)) ||
        childKeys.has(workItemIdentityKey(relationship.target)),
    )
    .sort((left, right) =>
      relationshipIdentityKey(left.identity).localeCompare(
        relationshipIdentityKey(right.identity),
      ),
    );

  const authoredLayout = readAuthoredLayout(
    input.root,
    context.layoutSectionKey,
  );
  const canonicalLayout = computeCanonicalWorkItemGraphLayout({
    children,
    relationships,
  });
  const normalizedAuthoredLayout = authoredLayout
    ? normalizeWorkItemGraphLayout(authoredLayout, children)
    : null;
  const hasCompleteAuthoredLayout =
    authoredLayout !== null &&
    normalizedAuthoredLayout !== null &&
    isCompleteAuthoredLayout(authoredLayout, children);
  const effectiveLayout = hasCompleteAuthoredLayout
    ? mergeWorkItemGraphLayout(
        normalizedAuthoredLayout,
        canonicalLayout,
        new Map(),
      )
    : canonicalLayout;
  const labels: Record<string, string> = {};
  [input.root, ...children].forEach((node) => {
    labels[workItemIdentityKey(node.identity)] = node.name;
  });
  relationships.forEach((relationship) => {
    labels[relationshipIdentityKey(relationship.identity)] = relationship.label;
  });

  return {
    valid: true,
    projectedRoot: input.root,
    children,
    sections: input.root.sections,
    incidentRelationships: relationships,
    identityLabels: labels,
    issues: [],
    warnings: [],
    effectiveLayout,
    layoutSource: hasCompleteAuthoredLayout ? "authored" : "canonical",
    layoutSectionKey: context.layoutSectionKey,
  };
}

export function projectWorkItemGraphDraft(
  input: HydratedWorkItemGraphInput,
  operations: readonly DraftOperation[] = [],
): WorkItemGraphDraftProjection {
  const context = resolveWorkItemGraphDraftContext(input);
  return buildProjection(context, operations);
}

function findProjectedRootLayoutOperation(
  projection: ProjectedWorkItemChangeSetResponse,
  operations: readonly WorkItemChangeSetOperation[],
): WorkItemLayoutReplaceOperation | WorkItemLayoutClearOperation | null {
  const rootKey = workItemIdentityKey(projection.projectedRoot.identity);
  return (
    [...operations]
      .reverse()
      .find(
        (
          operation,
        ): operation is
          WorkItemLayoutReplaceOperation | WorkItemLayoutClearOperation =>
          (operation.op === "layout.replace" ||
            operation.op === "layout.clear") &&
          workItemIdentityKey(operation.root) === rootKey,
      ) ?? null
  );
}

function findProjectedRootAuthoredLayout(
  root: ProjectedWorkItem,
): { sectionKey: string; layout: WorkItemGraphLayout } | null {
  for (const section of root.sections) {
    try {
      const layout = parseLayoutContent(section.content);
      if (layout) return { sectionKey: section.key, layout };
    } catch (error) {
      if (
        !(error instanceof WorkItemGraphDraftError) ||
        error.code !== "invalid_layout"
      ) {
        throw error;
      }
    }
  }
  return null;
}

function isCompleteAuthoredLayout(
  layout: WorkItemGraphLayout,
  children: readonly ProjectedWorkItem[],
): boolean {
  const activeChildCount = children.filter((child) => !child.deleted).length;
  const normalized = normalizeWorkItemGraphLayout(layout, children);
  return (
    layout.nodes.length === activeChildCount &&
    normalized.nodes.length === activeChildCount
  );
}

/**
 * Hydrates the validator-owned projection for review without replaying proposal
 * operations. Layout operations only select the projected root section; for a
 * preference-only proposal, an existing layout-shaped section remains the
 * source of the reviewed authored coordinates.
 */
export function hydrateValidatedWorkItemGraphProjection(
  projection: ProjectedWorkItemChangeSetResponse,
  operations: readonly WorkItemChangeSetOperation[],
): WorkItemGraphDraftProjection {
  const layoutOperation = findProjectedRootLayoutOperation(
    projection,
    operations,
  );
  const existingAuthoredLayout = layoutOperation
    ? null
    : findProjectedRootAuthoredLayout(projection.projectedRoot);
  const canonicalLayout = computeCanonicalWorkItemGraphLayout({
    children: projection.children,
    relationships: projection.incidentRelationships,
  });
  const layoutSectionKey =
    layoutOperation?.sectionKey ?? existingAuthoredLayout?.sectionKey ?? "";

  if (layoutOperation?.op === "layout.clear") {
    return {
      ...projection,
      effectiveLayout: canonicalLayout,
      layoutSource: "canonical",
      layoutSectionKey,
    };
  }

  let authoredLayout = existingAuthoredLayout?.layout ?? null;
  try {
    if (layoutOperation) {
      authoredLayout = readAuthoredLayout(
        projection.projectedRoot,
        layoutOperation.sectionKey,
      );
    }
  } catch (error) {
    if (
      !(error instanceof WorkItemGraphDraftError) ||
      error.code !== "invalid_layout"
    ) {
      throw error;
    }
  }

  if (
    !authoredLayout ||
    !isCompleteAuthoredLayout(authoredLayout, projection.children)
  ) {
    return {
      ...projection,
      effectiveLayout: canonicalLayout,
      layoutSource: "canonical",
      layoutSectionKey,
    };
  }

  return {
    ...projection,
    effectiveLayout: normalizeWorkItemGraphLayout(
      authoredLayout,
      projection.children,
    ),
    layoutSource: "authored",
    layoutSectionKey,
  };
}

export function allocateTemporaryWorkItemIdentity(
  operations: readonly DraftOperation[],
  reserved: ReadonlySet<string> = new Set(),
): Extract<WorkItemChangeSetIdentity, { refType: "temporary" }> {
  const used = new Set(
    operations.flatMap((operation) => {
      if (operation.op === "workItem.create") return [operation.ref.tempId];
      return [];
    }),
  );
  reserved.forEach((tempId) => used.add(tempId));
  let index = 1;
  while (used.has(`draft-work-item-${index}`)) index += 1;
  return { refType: "temporary", tempId: `draft-work-item-${index}` };
}

export function allocateTemporaryRelationshipIdentity(
  operations: readonly DraftOperation[],
  reserved: ReadonlySet<string> = new Set(),
): Extract<WorkItemChangeSetRelationshipIdentity, { refType: "temporary" }> {
  const used = new Set(
    operations.flatMap((operation) => {
      if (operation.op === "relationship.create") return [operation.ref.tempId];
      return [];
    }),
  );
  reserved.forEach((tempId) => used.add(tempId));
  let index = 1;
  while (used.has(`draft-relationship-${index}`)) index += 1;
  return { refType: "temporary", tempId: `draft-relationship-${index}` };
}

function removeLayoutOperations(
  operations: readonly DraftOperation[],
): DraftOperation[] {
  return operations.filter(
    (operation) =>
      operation.op !== "layout.replace" && operation.op !== "layout.clear",
  );
}

function buildLayoutReplaceOperation(
  context: ResolvedWorkItemGraphContext,
  layout: WorkItemGraphLayout,
): WorkItemLayoutReplaceOperation {
  return {
    op: "layout.replace",
    root: context.root.identity,
    sectionKey: context.layoutSectionKey,
    entries: layout.nodes.map((entry) => ({
      node: entry.node,
      position: entry.position,
    })),
  };
}

function withCompleteLayout(
  context: ResolvedWorkItemGraphContext,
  operations: readonly DraftOperation[],
  overrides: ReadonlyMap<string, WorkItemChangeSetPosition> = new Map(),
): DraftOperation[] {
  const current = buildProjection(context, operations);
  const authored = readAuthoredLayout(
    current.projectedRoot,
    context.layoutSectionKey,
  );
  const canonical = computeCanonicalWorkItemGraphLayout({
    children: current.children,
    relationships: current.incidentRelationships,
  });
  const merged = mergeWorkItemGraphLayout(
    authored
      ? normalizeWorkItemGraphLayout(authored, current.children)
      : canonical,
    canonical,
    overrides,
  );
  return [
    ...removeLayoutOperations(operations),
    buildLayoutReplaceOperation(context, merged),
  ];
}

function removeRelationshipOperationsForIdentity(
  operations: readonly DraftOperation[],
  identity: WorkItemChangeSetRelationshipIdentity,
): DraftOperation[] {
  const key = relationshipIdentityKey(identity);
  return operations.filter((operation) => {
    if (
      operation.op !== "relationship.create" &&
      operation.op !== "relationship.update" &&
      operation.op !== "relationship.delete"
    ) {
      return true;
    }
    return relationshipIdentityKey(operation.ref) !== key;
  });
}

function removeInvalidIncidentRelationships(
  context: ResolvedWorkItemGraphContext,
  operations: readonly DraftOperation[],
  child: WorkItemChangeSetIdentity,
): DraftOperation[] {
  const before = buildProjection(context, operations);
  const childKey = workItemIdentityKey(child);
  let next = [...operations];
  before.incidentRelationships
    .filter(
      (relationship) =>
        !relationship.deleted &&
        (workItemIdentityKey(relationship.source) === childKey ||
          workItemIdentityKey(relationship.target) === childKey),
    )
    .forEach((relationship) => {
      next = removeRelationshipOperationsForIdentity(
        next,
        relationship.identity,
      );
      if (relationship.identity.refType === "existing") {
        next.push({ op: "relationship.delete", ref: relationship.identity });
      }
    });
  return next;
}

function removeLayoutEntryForDeletedChild(
  context: ResolvedWorkItemGraphContext,
  operations: readonly DraftOperation[],
  child: WorkItemChangeSetIdentity,
): DraftOperation[] {
  const before = buildProjection(context, operations);
  const authored = readAuthoredLayout(
    before.projectedRoot,
    context.layoutSectionKey,
  );
  if (!authored) return [...operations];

  const childKey = workItemIdentityKey(child);
  const remaining = authored.nodes.filter(
    (entry) => workItemIdentityKey(entry.node) !== childKey,
  );
  const activeChildren = before.children.filter(
    (candidate) =>
      !candidate.deleted &&
      workItemIdentityKey(candidate.identity) !== childKey,
  );
  const canonical = computeCanonicalWorkItemGraphLayout({
    children: activeChildren,
    relationships: before.incidentRelationships,
  });
  const normalized = normalizeWorkItemGraphLayout(
    { schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION, nodes: remaining },
    activeChildren,
  );
  const complete = mergeWorkItemGraphLayout(normalized, canonical, new Map());
  return [
    ...removeLayoutOperations(operations),
    buildLayoutReplaceOperation(context, complete),
  ];
}

/** Member refs share the layout node-ref union with draft identities. */
export function diagramGroupMemberRef(
  identity: WorkItemChangeSetIdentity,
): WorkItemGraphLayoutNodeRef {
  return identity.refType === "existing"
    ? { kind: "persistedWorkItem", workItemId: identity.id }
    : { kind: "temporaryWorkItem", temporaryRef: identity.tempId };
}

export function diagramGroupMemberIdentity(
  member: WorkItemGraphLayoutNodeRef,
): WorkItemChangeSetIdentity {
  return member.kind === "persistedWorkItem"
    ? { refType: "existing", id: member.workItemId }
    : { refType: "temporary", tempId: member.temporaryRef };
}

export function readWorkItemGraphDraftGroups(
  state: Pick<WorkItemGraphDraftState, "context" | "projection">,
): DiagramGroup[] {
  const key = state.context.groupsSectionKey;
  if (!key) return [];
  return parseDiagramGroups(
    state.projection.projectedRoot.sections.find(
      (section) => section.key === key,
    )?.content ?? null,
  );
}

function removeDeletedChildFromGroups(
  context: ResolvedWorkItemGraphContext,
  operations: readonly DraftOperation[],
  child: WorkItemChangeSetIdentity,
): DraftOperation[] {
  const key = context.groupsSectionKey;
  if (!key) return [...operations];
  const rootKey = workItemIdentityKey(context.root.identity);
  const childKey = workItemIdentityKey(child);
  return operations.map((operation) => {
    if (
      operation.op !== "section.replace" ||
      operation.key !== key ||
      workItemIdentityKey(operation.ref) !== rootKey
    ) {
      return operation;
    }
    const groups = parseDiagramGroups(operation.content).map((group) => ({
      ...group,
      members: group.members.filter(
        (member) =>
          workItemIdentityKey(diagramGroupMemberIdentity(member)) !== childKey,
      ),
    }));
    return { ...operation, content: serializeDiagramGroups(groups) };
  });
}

function updateRelationshipOperation(
  operations: readonly DraftOperation[],
  input: ReconnectWorkItemDraftInput,
): DraftOperation[] {
  const key = relationshipIdentityKey(input.ref);
  const withoutPreviousUpdates = operations.filter(
    (operation) =>
      operation.op !== "relationship.update" ||
      relationshipIdentityKey(operation.ref) !== key,
  );
  const previous = [...operations]
    .reverse()
    .find(
      (operation): operation is WorkItemRelationshipUpdateOperation =>
        operation.op === "relationship.update" &&
        relationshipIdentityKey(operation.ref) === key,
    );
  const previousFields: RelationshipUpdateFields = previous
    ? (() => {
        const { op: _op, ref: _ref, ...fields } = previous;
        return fields;
      })()
    : {};
  const { ref: _ref, ...inputFields } = input;
  const merged: WorkItemRelationshipUpdateOperation = {
    op: "relationship.update",
    ref: input.ref,
    ...previousFields,
    ...inputFields,
  };
  return [...withoutPreviousUpdates, merged];
}

function mergeWorkItemUpdate(
  operations: readonly DraftOperation[],
  input: ReviseWorkItemDraftInput,
): DraftOperation[] {
  const key = workItemIdentityKey(input.ref);
  const withoutPreviousUpdates = operations.filter(
    (operation) =>
      operation.op !== "workItem.update" ||
      workItemIdentityKey(operation.ref) !== key,
  );
  const previous = [...operations]
    .reverse()
    .find(
      (operation): operation is WorkItemUpdateOperation =>
        operation.op === "workItem.update" &&
        workItemIdentityKey(operation.ref) === key,
    );
  const {
    ref: _ref,
    sections: _sections,
    clearSections: _clearSections,
    ...fields
  } = input;
  const merged: WorkItemUpdateOperation = {
    op: "workItem.update",
    ref: input.ref,
    ...(previous ? previous : {}),
    ...fields,
  };
  let next: DraftOperation[] = [...withoutPreviousUpdates];
  if (previous || Object.keys(fields).length > 0) {
    next.push(merged);
  }
  for (const keyName of input.clearSections ?? []) {
    next = next.filter(
      (operation) =>
        !(
          (operation.op === "section.replace" ||
            operation.op === "section.clear") &&
          workItemIdentityKey(operation.ref) === key &&
          operation.key === keyName
        ),
    );
    next.push({
      op: "section.clear",
      ref: input.ref,
      key: keyName,
    });
  }
  Object.entries(input.sections ?? {}).forEach(([keyName, content]) => {
    next = next.filter(
      (operation) =>
        !(
          (operation.op === "section.replace" ||
            operation.op === "section.clear") &&
          workItemIdentityKey(operation.ref) === key &&
          operation.key === keyName
        ),
    );
    next.push({
      op: "section.replace",
      ref: input.ref,
      key: keyName,
      content,
    });
  });
  return next;
}

const buildRelationshipCreateOperation = (
  ref: Extract<WorkItemChangeSetRelationshipIdentity, { refType: "temporary" }>,
  fields: RelationshipCreateFields,
): WorkItemRelationshipCreateOperation => {
  const common = {
    op: "relationship.create" as const,
    ref,
    source: fields.source,
    target: fields.target,
    reasoning: fields.reasoning,
    metadata: fields.metadata,
  };
  switch (fields.edgeType) {
    case "CONDITIONAL":
      if (!fields.direction || !fields.predicate) {
        throw new WorkItemGraphDraftError(
          "invalid_action",
          "A conditional flow relationship requires direction and predicate.",
        );
      }
      return {
        ...common,
        edgeType: "CONDITIONAL",
        category: "flow",
        direction: fields.direction,
        predicate: fields.predicate ?? undefined,
      };
    case "STANDARD":
      if (!fields.direction) {
        throw new WorkItemGraphDraftError(
          "invalid_action",
          "A standard flow relationship requires direction.",
        );
      }
      if (fields.predicate) {
        throw new WorkItemGraphDraftError(
          "invalid_action",
          "A standard flow relationship must not declare a predicate.",
        );
      }
      return {
        ...common,
        edgeType: "STANDARD",
        category: "flow",
        direction: fields.direction,
      };
    case "LOOP":
      return {
        ...common,
        edgeType: "LOOP",
        category: "flow",
        predicate: fields.predicate ?? undefined,
      };
    case "RELATED_TO":
      return {
        ...common,
        edgeType: "RELATED_TO",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "DEPENDS_ON":
      return {
        ...common,
        edgeType: "DEPENDS_ON",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "DERIVES_FROM":
      return {
        ...common,
        edgeType: "DERIVES_FROM",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "SUPERSEDES":
      return {
        ...common,
        edgeType: "SUPERSEDES",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "CONTRADICTS":
      return {
        ...common,
        edgeType: "CONTRADICTS",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "EVOLVES":
      return {
        ...common,
        edgeType: "EVOLVES",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "TRACKS":
      return {
        ...common,
        edgeType: "TRACKS",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "PROPOSED_TOGETHER":
      return {
        ...common,
        edgeType: "PROPOSED_TOGETHER",
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
    case "FULFILLED_BY":
    case "GUARANTEES":
    case "IMPLEMENTS":
    case "CONSUMES":
      return {
        ...common,
        edgeType: fields.edgeType,
        category: "meta",
        direction: fields.direction,
        predicate: fields.predicate,
      };
  }
};

function applyDraftAction(
  state: WorkItemGraphDraftState,
  action: Exclude<WorkItemGraphDraftAction, { type: "hydrate" }>,
): WorkItemGraphDraftState {
  if (action.type === "reset") {
    return {
      ...state,
      operations: [],
      projection: state.initialProjection,
      isDirty: false,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "reflow") {
    const operations = [
      ...removeLayoutOperations(state.operations),
      {
        op: "layout.clear",
        root: state.context.root.identity,
        sectionKey: state.context.layoutSectionKey,
      } satisfies WorkItemLayoutClearOperation,
    ];
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "applyPreferredLayout") {
    const current = buildProjection(state.context, state.operations);
    const preferenceSection =
      state.context.layoutPreferenceSectionKey === null
        ? undefined
        : getSection(
            current.projectedRoot,
            state.context.layoutPreferenceSectionKey,
          );
    const preference = parseWorkItemGraphLayoutPreference(
      preferenceSection?.content,
    );
    if (!preference) {
      throw new WorkItemGraphDraftError(
        "invalid_action",
        "A valid preferred row and column shape is required before applying layout.",
      );
    }
    const result = computePreferredWorkItemGraphLayout(
      {
        children: current.children,
        relationships: current.incidentRelationships,
      },
      preference,
    );
    const operations = [
      ...removeLayoutOperations(state.operations),
      buildLayoutReplaceOperation(state.context, result.layout),
    ];
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: result.departures,
      preferredLayoutResult: result,
    };
  }

  if (action.type === "move") {
    assertFinitePosition(action.position);
    const current = buildProjection(state.context, state.operations);
    const child = getNodeByIdentity(
      current.projectedRoot,
      current.children,
      action.child,
    );
    if (!child || child.deleted) {
      throw new WorkItemGraphDraftError(
        "unknown_work_item",
        "A graph layout move must target a projected child work item.",
      );
    }
    const positions = new Map(
      action.displayedLayout?.map(({ node, position }) => {
        assertFinitePosition(position);
        return [workItemIdentityKey(node), position] as const;
      }),
    );
    positions.set(workItemIdentityKey(action.child), action.position);
    const operations = withCompleteLayout(
      state.context,
      state.operations,
      positions,
    );
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "create") {
    if (action.input.position) assertFinitePosition(action.input.position);
    const ref =
      action.input.ref ??
      allocateTemporaryWorkItemIdentity(
        state.operations,
        collectTemporaryWorkItemRefs(state.context),
      );
    const { ref: _ref, position: _position, ...fields } = action.input;
    const operation: WorkItemCreateOperation = {
      op: "workItem.create",
      ref,
      ...fields,
      type: action.input.type ?? state.context.graphCapability.nodeChildType,
      parent: state.context.root.identity,
    };
    let operations: DraftOperation[] = [...state.operations, operation];
    if (action.input.position) {
      operations = withCompleteLayout(
        state.context,
        operations,
        new Map([[workItemIdentityKey(ref), action.input.position]]),
      );
    }
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "createConnected") {
    const childRef = action.input.child.ref;
    if (!childRef || !action.input.relationship.ref) {
      throw new WorkItemGraphDraftError(
        "invalid_action",
        "Atomic graph creation requires reserved child and relationship references.",
      );
    }
    const created = applyDraftAction(state, {
      type: "create",
      input: action.input.child,
    });
    const {
      childEndpoint,
      otherEndpoint,
      source,
      target,
      ...relationshipFields
    } = action.input.relationship;
    const endpoints =
      childEndpoint === "source"
        ? { source: childRef, target: target ?? otherEndpoint }
        : { source: source ?? otherEndpoint, target: childRef };
    return applyDraftAction(created, {
      type: "connect",
      input: { ...relationshipFields, ...endpoints },
    });
  }

  if (action.type === "revise") {
    const node = getNodeByIdentity(
      state.projection.projectedRoot,
      state.projection.children,
      action.input.ref,
    );
    if (!node || node.deleted) {
      throw new WorkItemGraphDraftError(
        "unknown_work_item",
        "A graph revision must target a projected work item.",
      );
    }
    const operations = mergeWorkItemUpdate(state.operations, action.input);
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "delete") {
    const node = getNodeByIdentity(
      state.projection.projectedRoot,
      state.projection.children,
      action.child,
    );
    if (
      !node ||
      node.deleted ||
      workItemIdentityKey(node.identity) ===
        workItemIdentityKey(state.context.root.identity)
    ) {
      throw new WorkItemGraphDraftError(
        "unknown_work_item",
        "A graph delete must target a non-deleted projected child.",
      );
    }
    let operations = removeInvalidIncidentRelationships(
      state.context,
      state.operations,
      action.child,
    );
    operations = [...operations, { op: "workItem.delete", ref: action.child }];
    operations = removeLayoutEntryForDeletedChild(
      state.context,
      operations,
      action.child,
    );
    operations = removeDeletedChildFromGroups(
      state.context,
      operations,
      action.child,
    );
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "connect") {
    const ref =
      action.input.ref ??
      allocateTemporaryRelationshipIdentity(
        state.operations,
        collectTemporaryRelationshipRefs(state.context),
      );
    const { ref: _ref, ...fields } = action.input;
    const operation = buildRelationshipCreateOperation(ref, fields);
    const operations = [...state.operations, operation];
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "reconnect") {
    const relationship = getRelationshipByIdentity(
      state.projection.incidentRelationships,
      action.input.ref,
    );
    if (!relationship || relationship.deleted) {
      throw new WorkItemGraphDraftError(
        "unknown_relationship",
        "A graph reconnect must target a projected relationship.",
      );
    }
    const operations = updateRelationshipOperation(
      state.operations,
      action.input,
    );
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "remove") {
    const relationship = getRelationshipByIdentity(
      state.projection.incidentRelationships,
      action.relationship,
    );
    if (!relationship || relationship.deleted) {
      throw new WorkItemGraphDraftError(
        "unknown_relationship",
        "A graph relationship removal must target a projected relationship.",
      );
    }
    let operations = removeRelationshipOperationsForIdentity(
      state.operations,
      action.relationship,
    );
    if (action.relationship.refType === "existing") {
      operations = [
        ...operations,
        { op: "relationship.delete", ref: action.relationship },
      ];
    }
    return {
      ...state,
      operations,
      projection: buildProjection(state.context, operations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  if (action.type === "replaceSection" || action.type === "clearSection") {
    const input = action.input;
    if (
      !getNodeByIdentity(
        state.projection.projectedRoot,
        state.projection.children,
        input.ref,
      )
    ) {
      throw new WorkItemGraphDraftError(
        "unknown_work_item",
        "A section operation must target a projected work item.",
      );
    }
    const operations = state.operations.filter(
      (operation) =>
        !(
          (operation.op === "section.replace" ||
            operation.op === "section.clear") &&
          workItemIdentityKey(operation.ref) ===
            workItemIdentityKey(input.ref) &&
          operation.key === input.key
        ),
    );
    const nextOperations = [...operations, input];
    return {
      ...state,
      operations: nextOperations,
      projection: buildProjection(state.context, nextOperations),
      isDirty: true,
      preferredLayoutDepartures: [],
      preferredLayoutResult: null,
    };
  }

  throw new WorkItemGraphDraftError(
    "invalid_action",
    "Unsupported graph draft action.",
  );
}

export function workItemGraphDraftReducer(
  state: WorkItemGraphDraftState,
  action: WorkItemGraphDraftAction,
): WorkItemGraphDraftState {
  if (action.type === "hydrate")
    return createWorkItemGraphDraftState(action.input);
  return applyDraftAction(state, action);
}

export function createWorkItemGraphDraftState(
  input: HydratedWorkItemGraphInput,
): WorkItemGraphDraftState {
  const context = resolveWorkItemGraphDraftContext(input);
  const projection = buildProjection(context, []);
  return {
    context,
    operations: [],
    projection,
    initialProjection: projection,
    isDirty: false,
    preferredLayoutDepartures: [],
    preferredLayoutResult: null,
  };
}

export const createWorkItemGraphDraft = createWorkItemGraphDraftState;
