import { describe, expect, it } from "vitest";
import type { WorkItemTypeGraphCapability } from "../../../api";
import {
  diagramCreationDraft,
  diagramCreationProposalDraft,
} from "../diagramCreationDraft";

const capability: WorkItemTypeGraphCapability = {
  nodeChildType: "DIAGRAM_ELEMENT",
  layout: { sectionKey: "graphLayout", schemaRef: "#/components/schemas/WorkItemGraphLayoutValue" },
  readableRelationships: [],
  editableRelationships: [],
  rendererKey: "work-item-graph",
  editorKey: "work-item-graph-editor",
  supportedActions: [],
};

describe("diagramCreationDraft", () => {
  it("builds one canonical root, elements, relationship, metadata, and layout envelope", () => {
    const draft = diagramCreationDraft({
      name: "System landscape",
      parent: { refType: "existing", id: "11111111-1111-4111-8111-111111111111" },
      graphCapability: capability,
    });
    expect(draft.root.identity).toEqual({ refType: "temporary", tempId: "diagram-root" });
    expect(draft.operations.map((operation) => operation.op)).toEqual([
      "workItem.create", "section.replace", "workItem.create", "section.replace",
      "workItem.create", "section.replace", "relationship.create", "layout.replace",
    ]);
    expect(draft.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "diagramMetadata", content: { kind: "GENERAL", level: "OVERVIEW" } }),
      expect.objectContaining({ key: "diagramElementMetadata", content: { role: "GENERIC" } }),
      expect.objectContaining({ op: "layout.replace", sectionKey: "graphLayout" }),
    ]));
    expect(draft.layoutBoundary).toHaveLength(2);
  });

  it("rejects an empty Diagram name without producing a draft", () => {
    expect(() => diagramCreationDraft({ name: "  ", graphCapability: capability })).toThrow("name is required");
  });

  it("projects every relationship operation for complete review", () => {
    const draft = diagramCreationDraft({
      name: "System landscape",
      graphCapability: capability,
    });
    const thirdRelationship = {
      op: "relationship.create" as const,
      ref: { refType: "temporary" as const, tempId: "diagram-relationship-2" },
      source: { refType: "temporary" as const, tempId: "diagram-element-2" },
      target: { refType: "temporary" as const, tempId: "diagram-element-1" },
      edgeType: "DEPENDS_ON",
      category: "dependency",
      direction: "reverse",
    };
    draft.operations.splice(draft.operations.length - 1, 0, thirdRelationship);

    const proposal = diagramCreationProposalDraft(draft, "graphLayout");

    expect(proposal.projection.incidentRelationships).toEqual([
      expect.objectContaining({
        identity: { refType: "temporary", tempId: "diagram-relationship-1" },
        edgeType: "STANDARD",
      }),
      expect.objectContaining({
        identity: { refType: "temporary", tempId: "diagram-relationship-2" },
        edgeType: "DEPENDS_ON",
      }),
    ]);
  });
});
