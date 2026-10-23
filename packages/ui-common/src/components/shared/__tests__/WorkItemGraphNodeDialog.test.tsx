import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  WorkItemTypeScalarField,
  WorkItemTypeSectionDefinitionKindEnum,
  type ProjectedWorkItem,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { WorkItemGraphNodeDialog } from "../WorkItemGraphNodeDialog";

const typeDefinition: WorkItemTypeDefinitionDto = {
  key: "MILESTONE",
  name: "Milestone",
  sections: [],
  allowedStatuses: [],
  requiredScalars: [WorkItemTypeScalarField.DueDate],
};

const presentationTypeDefinition: WorkItemTypeDefinitionDto = {
  ...typeDefinition,
  requiredScalars: [],
  sections: [
    {
      key: "graphPresentation",
      label: "Graph presentation",
      kind: WorkItemTypeSectionDefinitionKindEnum.Json,
      schemaRef: "#/components/schemas/WorkItemGraphNodePresentationValue",
      required: false,
    },
  ],
};

describe("WorkItemGraphNodeDialog", () => {
  it("commits a native date input as the instant for local midnight", async () => {
    const onCommit = vi.fn();
    render(
      <WorkItemGraphNodeDialog
        open
        typeDefinition={typeDefinition}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />
    );

    await userEvent.type(
      screen.getByTestId("work-item-graph-node-name"),
      "Launch milestone"
    );
    fireEvent.change(screen.getByLabelText(/Due date/), {
      target: { value: "2026-07-31" },
    });
    await userEvent.click(screen.getByTestId("work-item-graph-node-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      name: "Launch milestone",
      dueDate: new Date(2026, 6, 31).toISOString(),
      sections: {},
    });
  });

  it("sets and clears authored workflow-step color through the section boundary", async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <WorkItemGraphNodeDialog
        open
        typeDefinition={presentationTypeDefinition}
        onCancel={vi.fn()}
        onCommit={onCommit}
      />
    );

    await userEvent.type(
      screen.getByTestId("work-item-graph-node-name"),
      "Colored step"
    );
    fireEvent.change(screen.getByTestId("work-item-graph-node-section"), {
      target: { value: "#123456" },
    });
    await userEvent.click(screen.getByTestId("work-item-graph-node-commit"));

    expect(onCommit).toHaveBeenCalledWith({
      name: "Colored step",
      sections: {
        graphPresentation: {
          schemaVersion: "work-item-graph-node-presentation.v1",
          color: "#123456",
        },
      },
    });
    unmount();

    const existingNode = {
      identity: { refType: "existing", id: "step-1" },
      label: "Existing colored step",
      type: "workflow_step",
      name: "Existing colored step",
      sections: [
        {
          key: "graphPresentation",
          content: {
            schemaVersion: "work-item-graph-node-presentation.v1",
            color: "#123456",
          },
        },
      ],
      deleted: false,
    } satisfies ProjectedWorkItem;
    const clearCommit = vi.fn();
    render(
      <WorkItemGraphNodeDialog
        open
        node={existingNode}
        typeDefinition={presentationTypeDefinition}
        onCancel={vi.fn()}
        onCommit={clearCommit}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await userEvent.click(screen.getByTestId("work-item-graph-node-commit"));

    expect(clearCommit).toHaveBeenCalledWith({
      name: "Existing colored step",
      sections: {},
      clearSections: ["graphPresentation"],
    });
  });
});
