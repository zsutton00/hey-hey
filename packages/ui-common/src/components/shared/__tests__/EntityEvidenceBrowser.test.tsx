import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  EntityEvidenceBrowser,
  type EntityEvidenceGroup,
} from "../EntityEvidenceBrowser";

const groups: EntityEvidenceGroup[] = [
  {
    id: "tasks",
    label: "Tasks (2)",
    items: [
      {
        id: "task-1",
        entityType: "task",
        title: "Task 1",
        subtitle: "task",
        preview: "Task 1 preview",
        details: "Task 1 details",
      },
      {
        id: "task-2",
        entityType: "task",
        title: "Task 2",
        subtitle: "task",
        preview: "Task 2 preview",
        details: "Task 2 details",
      },
    ],
  },
  {
    id: "messages",
    label: "Messages (1)",
    items: [
      {
        id: "message-1",
        entityType: "message",
        title: "Message 1",
        subtitle: "message",
        preview: "Message preview",
      },
    ],
  },
];

describe("EntityEvidenceBrowser", () => {
  it("renders empty state when there are no items", () => {
    render(
      <EntityEvidenceBrowser
        groups={[]}
        title="Evidence"
        emptyText="Nothing here"
      />
    );

    expect(screen.getByText("Evidence")).toBeInTheDocument();
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("opens modal and renders grouped evidence entries", () => {
    render(
      <EntityEvidenceBrowser
        groups={groups}
        title="Evidence Sources"
        modalTitle="Evidence Details"
        listDataTestId="evidence-modal-list"
      />
    );

    expect(screen.getByText("Task 1")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("entity-evidence-open-more"));

    const modalList = screen.getByTestId("evidence-modal-list");
    expect(within(modalList).getByText("Tasks (2)")).toBeInTheDocument();
    expect(within(modalList).getByText("Messages (1)")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("entity-evidence-toggle-task-1"));
    expect(within(modalList).getByText("Task 1 details")).toBeInTheDocument();
  });

  it("renders single-item entry point with view-details action", () => {
    render(
      <EntityEvidenceBrowser
        groups={[
          {
            id: "single",
            label: "Single (1)",
            items: [
              {
                id: "single-1",
                entityType: "task",
                title: "Only item",
              },
            ],
          },
        ]}
      />
    );

    expect(
      screen.getByTestId("entity-evidence-open-details")
    ).toBeInTheDocument();
  });

  it("renders modal actions and item actions when provided", () => {
    const removeSpy = vi.fn();
    render(
      <EntityEvidenceBrowser
        groups={groups}
        modalActions={<button type="button">Save changes</button>}
        renderItemActions={(item) => (
          <button type="button" onClick={() => removeSpy(item.id)}>
            Remove
          </button>
        )}
      />
    );

    fireEvent.click(screen.getByTestId("entity-evidence-open-more"));
    expect(
      screen.getByTestId("entity-evidence-modal-actions")
    ).toBeInTheDocument();
    expect(screen.getByText("Save changes")).toBeInTheDocument();

    fireEvent.click(
      within(
        screen.getByTestId("entity-evidence-item-actions-task-1")
      ).getByText("Remove")
    );
    expect(removeSpy).toHaveBeenCalledWith("task-1");
  });
});
