import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  WorkItemTypeGraphEndpointRole,
  type ProjectedWorkItemRelationship,
  type WorkItemTypeGraphRelationshipDeclaration,
} from "../../../api";
import { WorkItemGraphRelationshipDialog } from "../WorkItemGraphRelationshipDialog";

const graphNodeEndpoint = {
  role: WorkItemTypeGraphEndpointRole.GraphNode,
  entityTypes: [AgentEdgeEndpointEntityType.Task],
  workItemTypeKeys: ["workflow_step"],
};

const declarations: readonly WorkItemTypeGraphRelationshipDeclaration[] = [
  {
    edgeType: AgentEdgeType.Conditional,
    category: AgentEdgeCategory.Flow,
    sourceEndpoint: graphNodeEndpoint,
    targetEndpoint: graphNodeEndpoint,
    direction: {
      required: true,
      allowedDirections: [AgentEdgeDirection.Forward],
      predicateRequired: true,
    },
  },
  {
    edgeType: AgentEdgeType.Loop,
    category: AgentEdgeCategory.Flow,
    sourceEndpoint: graphNodeEndpoint,
    targetEndpoint: graphNodeEndpoint,
  },
];

function renderDialog(
  onCommit = vi.fn(),
  relationshipDeclarations = declarations,
  relationship?: ProjectedWorkItemRelationship
) {
  render(
    <ThemeProvider theme={createTheme()}>
      <WorkItemGraphRelationshipDialog
        open
        declarations={relationshipDeclarations}
        relationship={relationship}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />
    </ThemeProvider>
  );
  return onCommit;
}

describe("WorkItemGraphRelationshipDialog", () => {
  it("requires and trims metadata declared for a conditional relationship", () => {
    const onCommit = renderDialog();
    const commit = screen.getByTestId("work-item-graph-relationship-commit");

    expect(commit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Predicate *"), {
      target: { value: "   " },
    });
    expect(commit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Predicate *"), {
      target: { value: "  approved == true  " },
    });
    fireEvent.click(commit);

    expect(onCommit).toHaveBeenCalledWith({
      edgeType: AgentEdgeType.Conditional,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      predicate: "approved == true",
    });
  });

  it("commits LOOP only after it is explicitly selected", () => {
    const onCommit = renderDialog();

    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(screen.getByRole("option", { name: AgentEdgeType.Loop }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      edgeType: AgentEdgeType.Loop,
      category: AgentEdgeCategory.Flow,
    });
  });

  it("enforces the generated predicate requirement without branching on edge identity", () => {
    renderDialog(vi.fn(), [
      {
        edgeType: AgentEdgeType.Conditional,
        category: AgentEdgeCategory.Flow,
        sourceEndpoint: graphNodeEndpoint,
        targetEndpoint: graphNodeEndpoint,
        direction: { predicateRequired: true },
      },
    ]);

    expect(screen.getByLabelText("Predicate *")).toBeInTheDocument();
    expect(
      screen.getByTestId("work-item-graph-relationship-commit")
    ).toBeDisabled();
  });

  it("clears conditional-only fields and preserves explanations when changing an existing relationship type", () => {
    const onCommit = renderDialog(vi.fn(), declarations, {
      identity: { refType: "existing", id: "relationship" },
      label: AgentEdgeType.Conditional,
      source: { refType: "existing", id: "source" },
      target: { refType: "existing", id: "target" },
      edgeType: AgentEdgeType.Conditional,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      predicate: "approved",
      reasoning: "The original reason",
      metadata: {
        label: "Approval path",
        description: "Only continue after approval",
        custom: "preserved",
      },
      deleted: false,
    });

    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(screen.getByRole("option", { name: AgentEdgeType.Loop }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      edgeType: AgentEdgeType.Loop,
      category: AgentEdgeCategory.Flow,
      predicate: null,
      reasoning: "The original reason",
      metadata: {
        label: "Approval path",
        description: "Only continue after approval",
        custom: "preserved",
      },
    });
  });

  it("preserves unrelated metadata when editing one explanation field", () => {
    const onCommit = renderDialog(vi.fn(), declarations, {
      identity: { refType: "existing", id: "relationship" },
      label: AgentEdgeType.Conditional,
      source: { refType: "existing", id: "source" },
      target: { refType: "existing", id: "target" },
      edgeType: AgentEdgeType.Conditional,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      predicate: "approved",
      reasoning: "Keep this reason",
      metadata: {
        label: "Old label",
        description: "Keep this description",
        custom: { preserved: true },
      },
      deleted: false,
    });

    fireEvent.change(screen.getByLabelText("Label"), {
      target: { value: "  New label  " },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      edgeType: AgentEdgeType.Conditional,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      predicate: "approved",
      metadata: {
        label: "New label",
        description: "Keep this description",
        custom: { preserved: true },
      },
    });
  });
});
