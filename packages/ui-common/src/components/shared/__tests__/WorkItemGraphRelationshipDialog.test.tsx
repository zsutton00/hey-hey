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
  {
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    sourceEndpoint: graphNodeEndpoint,
    targetEndpoint: graphNodeEndpoint,
    direction: {
      required: true,
      allowedDirections: [AgentEdgeDirection.Forward],
    },
  },
];

function renderDialog(
  onCommit = vi.fn(),
  relationshipDeclarations = declarations,
  relationship?: ProjectedWorkItemRelationship,
  actionLabelRequired = false,
  transitionRoleRequired = false,
) {
  render(
    <ThemeProvider theme={createTheme()}>
      <WorkItemGraphRelationshipDialog
        open
        declarations={relationshipDeclarations}
        relationship={relationship}
        actionLabelRequired={actionLabelRequired}
        transitionRoleRequired={transitionRoleRequired}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />
    </ThemeProvider>,
  );
  return onCommit;
}

describe("WorkItemGraphRelationshipDialog", () => {
  it("requires an action for UX flow transitions before committing", () => {
    const onCommit = renderDialog(vi.fn(), declarations, undefined, true);
    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(
      screen.getByRole("option", { name: AgentEdgeType.Standard }),
    );
    const action = screen.getByLabelText("Action label *");
    const commit = screen.getByTestId("work-item-graph-relationship-commit");
    expect(action).toBeRequired();
    expect(commit).toBeDisabled();
    fireEvent.change(action, { target: { value: "  tap Continue  " } });
    fireEvent.click(commit);
    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ actionLabel: "tap Continue" }),
    );
  });

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

  it("captures an action label on a STANDARD flow relationship", () => {
    const onCommit = renderDialog();

    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(
      screen.getByRole("option", { name: AgentEdgeType.Standard }),
    );
    fireEvent.change(screen.getByLabelText("Action label (optional)"), {
      target: { value: "  tap Continue  " },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      edgeType: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      actionLabel: "tap Continue",
    });
  });

  const standardRelationship = (
    transitionRole?: ProjectedWorkItemRelationship["transitionRole"],
  ): ProjectedWorkItemRelationship => ({
    identity: { refType: "existing", id: "relationship" },
    label: AgentEdgeType.Standard,
    source: { refType: "existing", id: "source" },
    target: { refType: "existing", id: "target" },
    edgeType: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
    actionLabel: "tap Continue",
    transitionRole,
    reasoning: "Keep this reason",
    deleted: false,
  });

  it("sets a transition role separately from the action label", () => {
    const onCommit = renderDialog();

    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(
      screen.getByRole("option", { name: AgentEdgeType.Standard }),
    );
    fireEvent.change(screen.getByLabelText("Action label (optional)"), {
      target: { value: "tap Retry" },
    });
    fireEvent.mouseDown(screen.getByLabelText("Transition role"));
    fireEvent.click(screen.getByRole("option", { name: "Error path" }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      edgeType: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      actionLabel: "tap Retry",
      transitionRole: "ERROR_PATH",
    });
  });

  it("leaves a new transition unclassified and preserves an untouched role", () => {
    const created = renderDialog();
    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(
      screen.getByRole("option", { name: AgentEdgeType.Standard }),
    );
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    expect(created.mock.calls[0][0]).not.toHaveProperty("transitionRole");
  });

  it("does not resubmit an existing role the author did not touch", () => {
    const onCommit = renderDialog(
      vi.fn(),
      declarations,
      standardRelationship("RECOVERY"),
    );

    expect(screen.getByLabelText("Transition role")).toHaveTextContent(
      "Recovery",
    );
    fireEvent.change(screen.getByLabelText("Action label (optional)"), {
      target: { value: "tap Back" },
    });
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit.mock.calls[0][0]).not.toHaveProperty("transitionRole");
  });

  it("requires a transition role when the Diagram demands one", () => {
    const onCommit = renderDialog(
      vi.fn(),
      declarations,
      undefined,
      false,
      true,
    );
    fireEvent.mouseDown(screen.getByLabelText("Relationship *"));
    fireEvent.click(
      screen.getByRole("option", { name: AgentEdgeType.Standard }),
    );
    expect(
      screen.getByTestId("work-item-graph-relationship-commit"),
    ).toBeDisabled();

    fireEvent.mouseDown(screen.getByLabelText("Transition role *"));
    expect(
      screen.queryByRole("option", { name: "Unclassified" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("option", { name: "Primary progression" }),
    );
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));

    expect(onCommit).toHaveBeenCalledWith(
      expect.objectContaining({ transitionRole: "PRIMARY_PROGRESSION" }),
    );
  });

  it("changes and explicitly clears an existing transition role", () => {
    const changed = renderDialog(
      vi.fn(),
      declarations,
      standardRelationship("PRIMARY_PROGRESSION"),
    );
    fireEvent.mouseDown(screen.getByLabelText("Transition role"));
    fireEvent.click(screen.getByRole("option", { name: "Recovery" }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    expect(changed.mock.calls[0][0]).toMatchObject({
      transitionRole: "RECOVERY",
    });
  });

  it("offers Return for going back without a failure", () => {
    const onCommit = renderDialog(
      vi.fn(),
      declarations,
      standardRelationship("PRIMARY_PROGRESSION"),
    );
    fireEvent.mouseDown(screen.getByLabelText("Transition role"));
    fireEvent.click(screen.getByRole("option", { name: "Return" }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    expect(onCommit.mock.calls[0][0]).toMatchObject({
      transitionRole: "RETURN",
    });
  });

  it("submits a null role when an existing role is changed to Unclassified", () => {
    const cleared = renderDialog(
      vi.fn(),
      declarations,
      standardRelationship("ERROR_PATH"),
    );
    fireEvent.mouseDown(screen.getByLabelText("Transition role"));
    fireEvent.click(screen.getByRole("option", { name: "Unclassified" }));
    fireEvent.click(screen.getByTestId("work-item-graph-relationship-commit"));
    expect(cleared.mock.calls[0][0]).toMatchObject({ transitionRole: null });
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
      screen.getByTestId("work-item-graph-relationship-commit"),
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
      actionLabel: "tap Continue",
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
      actionLabel: "tap Continue",
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
