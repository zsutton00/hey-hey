import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api/api";
import { WorkItemMetadata } from "../WorkItemMetadata";

const recipe = {
  key: "RECIPE",
  name: "Recipe",
  statuses: [
    { name: "Idea", meaning: "NOT_STARTED" },
    { name: "Made", meaning: "FINISHED" },
    { name: "Rejected", meaning: "FINISHED" },
  ],
  capabilities: { supportsSupersession: true },
} as WorkItemTypeDefinitionDto;

vi.mock("../../../data/hooks", () => ({
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: recipe,
    isLoading: false,
  }),
}));

const renderMetadata = (
  status: string,
  onChange = vi.fn(),
  mode: "editable" | "readOnly" = "editable",
) => {
  const field =
    mode === "editable"
      ? { mode, value: status, onChange }
      : { mode, value: status };
  return render(
    <WorkItemMetadata
      fields={{ status: field }}
      organizationId="org-1"
      projectId="project-1"
      taskType="RECIPE"
    />,
  );
};

describe("WorkItemMetadata removed status", () => {
  it("shows one status control with the saved status and a warning, and no separate panel", () => {
    renderMetadata("Testing");

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText("Testing")).toBeInTheDocument();
    expect(screen.getByTestId("retained-status-warning")).toHaveTextContent(
      "Needs a new status",
    );
    expect(screen.queryByTestId("retained-status-panel")).toBeNull();
    expect(screen.queryByText("Choose a new status")).toBeNull();
    expect(screen.queryByText("Save status")).toBeNull();
  });

  it("offers only the type's statuses and Archived, and clears the warning once one is chosen", async () => {
    const onChange = vi.fn();
    const { rerender } = renderMetadata("Testing", onChange);

    await userEvent.click(screen.getByRole("combobox"));
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Idea", "Made", "Rejected", "Archived"]);

    await userEvent.click(screen.getByRole("option", { name: "Made" }));
    expect(onChange).toHaveBeenCalledWith("Made");

    rerender(
      <WorkItemMetadata
        fields={{ status: { mode: "editable", value: "Made", onChange } }}
        organizationId="org-1"
        projectId="project-1"
        taskType="RECIPE"
      />,
    );
    expect(screen.queryByTestId("retained-status-warning")).toBeNull();
  });

  it.each(["Idea", "ARCHIVED"])("shows no warning for %s", (status) => {
    renderMetadata(status);
    expect(screen.queryByTestId("retained-status-warning")).toBeNull();
  });

  it("flags the removed status for read-only viewers too", () => {
    renderMetadata("Testing", vi.fn(), "readOnly");
    expect(screen.getByTestId("retained-status-warning")).toBeInTheDocument();
  });
});
