import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api/api";
import { RetainedStatusPanel } from "../RetainedStatusPanel";

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

describe("RetainedStatusPanel", () => {
  it("shows the exact removed status as needing a new status and saves only an explicit replacement", async () => {
    const onReplace = vi.fn();
    render(
      <RetainedStatusPanel
        status="Testing"
        definition={recipe}
        onReplace={onReplace}
      />,
    );

    expect(screen.getByTestId("retained-status-name")).toHaveTextContent(
      "Testing",
    );
    expect(screen.getByText("Needs a new status")).toBeInTheDocument();
    expect(screen.getByTestId("retained-status-save")).toBeDisabled();

    await userEvent.click(screen.getByRole("combobox"));
    const options = within(screen.getByRole("listbox"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual([
      "Choose a new status",
      "Idea",
      "Made",
      "Rejected",
      "Archived",
    ]);

    await userEvent.click(screen.getByRole("option", { name: "Made" }));
    await userEvent.click(screen.getByTestId("retained-status-save"));

    expect(onReplace).toHaveBeenCalledWith("Made");
  });
});
