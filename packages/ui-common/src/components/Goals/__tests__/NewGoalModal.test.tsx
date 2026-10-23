import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntityType, TaskSectionKey } from "../../../api";
import { NewGoalModal, type GoalSourceEntityRef } from "../NewGoalModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

describe("NewGoalModal", () => {
  it("submits a payload with name and dueDate on the golden path", async () => {
    const onSubmit = vi.fn();
    render(<NewGoalModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("tasks.form.title"),
      "Ship the thing",
    );
    await userEvent.type(
      within(dialog).getByLabelText("goals.dialog.dueDateLabel"),
      "2026-12-31",
    );

    const createButton = within(dialog).getByRole("button", {
      name: "goals.dialog.createButton",
    });
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [payload, sourceEntityRefs] = onSubmit.mock.calls[0]!;
    expect(payload).toMatchObject({
      name: "Ship the thing",
      dueDate: new Date(2026, 11, 31).toISOString(),
    });
    expect(payload).not.toHaveProperty("parentTaskId");
    expect(payload).not.toHaveProperty("type");
    expect(sourceEntityRefs).toEqual([]);
  });

  it("blocks submit when name is missing", async () => {
    const onSubmit = vi.fn();
    render(<NewGoalModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("goals.dialog.dueDateLabel"),
      "2026-12-31",
    );

    const createButton = within(dialog).getByRole("button", {
      name: "goals.dialog.createButton",
    });
    expect(createButton).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits an undated Goal when the date is blank", async () => {
    const onSubmit = vi.fn();
    render(<NewGoalModal open onClose={vi.fn()} onSubmit={onSubmit} />);

    const dialog = screen.getByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText("tasks.form.title"),
      "Ship the thing",
    );

    const createButton = within(dialog).getByRole("button", {
      name: "goals.dialog.createButton",
    });
    expect(createButton).toBeEnabled();
    await userEvent.click(createButton);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("dueDate");
  });

  it("pre-fills inputs from seed values", () => {
    render(
      <NewGoalModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initialName="Seed goal"
        initialDescription="Seed description"
        initialDueDate="2027-01-15"
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("tasks.form.title")).toHaveValue(
      "Seed goal",
    );
    expect(within(dialog).getByLabelText("tasks.form.description")).toHaveValue(
      "Seed description",
    );
    expect(
      within(dialog).getByLabelText("goals.dialog.dueDateLabel"),
    ).toHaveValue("2027-01-15");
  });

  it("presents an ISO seed as the same local calendar day", () => {
    render(
      <NewGoalModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        initialDueDate={new Date(2027, 0, 15).toISOString()}
      />,
    );

    expect(
      within(screen.getByRole("dialog")).getByLabelText(
        "goals.dialog.dueDateLabel",
      ),
    ).toHaveValue("2027-01-15");
  });

  it("passes seeded sourceEntityRefs through onSubmit unchanged", async () => {
    const sourceEntityRefs: GoalSourceEntityRef[] = [
      { entityType: EntityType.Task, entityId: "task-1" },
      { entityType: EntityType.DesignDoc, entityId: "design-1" },
    ];
    const onSubmit = vi.fn();
    render(
      <NewGoalModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initialName="Seed goal"
        initialDueDate="2027-01-15"
        initialSourceEntityRefs={sourceEntityRefs}
      />,
    );

    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "goals.dialog.createButton" }),
    );

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![1]).toEqual(sourceEntityRefs);
  });

  it("includes a description section when description is provided", async () => {
    const onSubmit = vi.fn();
    render(
      <NewGoalModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        initialName="Seed goal"
        initialDescription="Seed description"
        initialDueDate="2027-01-15"
      />,
    );

    const dialog = screen.getByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "goals.dialog.createButton" }),
    );

    expect(onSubmit.mock.calls[0]![0].sections).toEqual([
      { key: "description", content: "Seed description" },
    ]);
  });
});
