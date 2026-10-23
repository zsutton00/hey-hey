import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
  WorkItemChangeSetOperation,
  WorkItemCreateOperation,
  WorkItemTypeGraphCapability,
} from "../../api";
import type { WorkItemGraphProposalDraft } from "../../data/hooks/useSubmitWorkItemGraphProposal";
import { WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION } from "./workItemGraphLayout";

export const DIAGRAM_ROOT_TEMP_ID = "diagram-root";

export interface DiagramCreationDraftInput {
  name: string;
  parent?: WorkItemChangeSetIdentity;
  graphCapability: WorkItemTypeGraphCapability;
}

export interface DiagramCreationDraft {
  root: ProjectedWorkItem;
  operations: WorkItemChangeSetOperation[];
  layoutBoundary: WorkItemChangeSetIdentity[];
}

export function diagramCreationProposalDraft(
  draft: DiagramCreationDraft,
  layoutSectionKey: string,
): WorkItemGraphProposalDraft {
  const creates = draft.operations.filter(
    (operation): operation is WorkItemCreateOperation =>
      operation.op === "workItem.create" &&
      operation.ref.tempId !== DIAGRAM_ROOT_TEMP_ID,
  );
  const children: ProjectedWorkItem[] = creates.map((operation) => ({
    identity: operation.ref,
    label: operation.name,
    type: operation.type ?? "DIAGRAM_ELEMENT",
    name: operation.name,
    parent: operation.parent,
    sections: [{ key: "diagramElementMetadata", content: { role: "GENERIC" } }],
    deleted: false,
  }));
  const relationships: ProjectedWorkItemRelationship[] = draft.operations
    .filter((operation) => operation.op === "relationship.create")
    .map((operation) => ({
      identity: operation.ref,
      label: operation.edgeType,
      source: operation.source,
      target: operation.target,
      edgeType: operation.edgeType,
      category: operation.category,
      direction:
        "direction" in operation
          ? (operation.direction ?? undefined)
          : undefined,
      deleted: false,
    }));
  const nodes = draft.layoutBoundary.map((node, index) => ({
    node,
    position: { x: index, y: 0 },
  }));
  return {
    operations: draft.operations,
    isDirty: true,
    projection: {
      valid: true,
      projectedRoot: draft.root,
      children,
      sections: draft.root.sections,
      incidentRelationships: relationships,
      identityLabels: Object.fromEntries([
        ["temporary:diagram-root", draft.root.name],
        ...children.map((child) => [
          `temporary:${child.identity.refType === "temporary" ? child.identity.tempId : child.identity.id}`,
          child.name,
        ]),
      ]),
      issues: [],
      warnings: [],
      effectiveLayout: {
        schemaVersion: WORK_ITEM_GRAPH_LAYOUT_SCHEMA_VERSION,
        nodes,
      },
      layoutSource: "authored",
      layoutSectionKey,
    },
  };
}

/** Creates one reviewable graph envelope; it never writes a placeholder root. */
export function diagramCreationDraft({
  name,
  parent,
  graphCapability,
}: DiagramCreationDraftInput): DiagramCreationDraft {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("A Diagram name is required.");
  const root = { refType: "temporary" as const, tempId: DIAGRAM_ROOT_TEMP_ID };
  const first = { refType: "temporary" as const, tempId: "diagram-element-1" };
  const second = { refType: "temporary" as const, tempId: "diagram-element-2" };
  const layoutSectionKey = graphCapability.layout.sectionKey;
  const childType = graphCapability.nodeChildType;
  const operations: WorkItemChangeSetOperation[] = [
    {
      op: "workItem.create",
      ref: root,
      name: trimmedName,
      type: "DIAGRAM",
      ...(parent ? { parent } : {}),
    },
    {
      op: "section.replace",
      ref: root,
      key: "diagramMetadata",
      content: { kind: "GENERAL", level: "OVERVIEW" },
    },
    {
      op: "workItem.create",
      ref: first,
      name: "Start",
      type: childType,
      parent: root,
    },
    {
      op: "section.replace",
      ref: first,
      key: "diagramElementMetadata",
      content: { role: "GENERIC" },
    },
    {
      op: "workItem.create",
      ref: second,
      name: "Next",
      type: childType,
      parent: root,
    },
    {
      op: "section.replace",
      ref: second,
      key: "diagramElementMetadata",
      content: { role: "GENERIC" },
    },
    {
      op: "relationship.create",
      ref: { refType: "temporary", tempId: "diagram-relationship-1" },
      source: first,
      target: second,
      edgeType: "STANDARD",
      category: "flow",
      direction: "forward",
    },
    {
      op: "layout.replace",
      root,
      sectionKey: layoutSectionKey,
      entries: [
        { node: first, position: { x: 0, y: 0 } },
        { node: second, position: { x: 1, y: 0 } },
      ],
    },
  ];
  return {
    root: {
      identity: root,
      label: trimmedName,
      type: "DIAGRAM",
      name: trimmedName,
      ...(parent ? { parent } : {}),
      sections: [
        {
          key: "diagramMetadata",
          content: { kind: "GENERAL", level: "OVERVIEW" },
        },
      ],
      deleted: false,
    },
    operations,
    layoutBoundary: [first, second],
  };
}
