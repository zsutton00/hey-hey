import { describe, expect, it } from "vitest";
import {
  ProposalEdgeEndpointMode,
  ProposalEdgeTargetType,
  ProposalEdgeType,
  type ProposalEdgeDeclaration,
  type WorkItemChangeSetValidationRequest,
} from "../../../api";
import { createGraphEdgeSourceLabelResolver } from "../WorkItemGraphProposalRenderer";

const edge = (
  sourceRef?: ProposalEdgeDeclaration["sourceRef"]
): ProposalEdgeDeclaration => ({
  targetEntityId: "proposal-2",
  targetEntityType: ProposalEdgeTargetType.Proposal,
  edgeType: ProposalEdgeType.DependsOn,
  endpointMode: ProposalEdgeEndpointMode.Entity,
  sourceRef,
});

const operations = [
  {
    op: "workItem.create",
    ref: { refType: "temporary", tempId: "step-a" },
    name: "Authored step",
  },
] as unknown as WorkItemChangeSetValidationRequest["operations"];

describe("createGraphEdgeSourceLabelResolver", () => {
  const resolve = createGraphEdgeSourceLabelResolver({
    root: { refType: "temporary", tempId: "root" },
    operations,
    identityLabels: { "existing:el-1": "Existing element" },
    rootLabel: "Diagram",
  });

  it("labels an omitted or root sourceRef as the Diagram", () => {
    expect(resolve(edge())).toBe("Diagram");
    expect(resolve(edge({ refType: "temporary", tempId: "root" }))).toBe(
      "Diagram"
    );
  });

  it("resolves element sources from the projection, then operations", () => {
    expect(resolve(edge({ refType: "existing", id: "el-1" }))).toBe(
      "Existing element"
    );
    expect(resolve(edge({ refType: "temporary", tempId: "step-a" }))).toBe(
      "Authored step"
    );
    expect(resolve(edge({ refType: "temporary", tempId: "missing" }))).toBe(
      "Diagram element"
    );
  });
});
