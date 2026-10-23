import {
  type ContextRelatedEntityDto,
  EntityType,
  RelationshipValue,
} from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { DesignDocTasksTab } from "./DesignDocTasksTab";

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityIcon: ({ entityType }: { entityType: string }) => (
    <span data-testid="entity-icon">{entityType}</span>
  ),
  EntityNodeStatusChip: ({ status }: { status?: string }) =>
    status ? <span data-testid="status-chip">{status}</span> : null,
}));

const renderTab = (
  tasks: ContextRelatedEntityDto[],
  isLoading = false,
): void => {
  render(
    <MemoryRouter>
      <DesignDocTasksTab
        projectId="project-1"
        tasks={tasks}
        isLoading={isLoading}
      />
    </MemoryRouter>,
  );
};

const buildTask = (
  overrides: Partial<ContextRelatedEntityDto> = {},
): ContextRelatedEntityDto =>
  ({
    entityId: "task-1",
    entityType: EntityType.Task,
    displayName: "Task One",
    relationship: RelationshipValue.RelatedTo,
    ...overrides,
  }) as ContextRelatedEntityDto;

describe("DesignDocTasksTab", () => {
  it("shows the empty state when no tasks are linked", () => {
    renderTab([]);

    expect(screen.getByTestId("design-doc-tasks-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/no tasks linked to this design document/i),
    ).toBeInTheDocument();
  });

  it("renders each task as a navigable list item", () => {
    renderTab([
      buildTask({ entityId: "task-a", displayName: "Task A" }),
      buildTask({ entityId: "task-b", displayName: "Task B" }),
    ]);

    const taskA = screen.getByRole("link", { name: /task a/i });
    expect(taskA).toHaveAttribute("href", "/projects/project-1/tasks/task-a");

    const taskB = screen.getByRole("link", { name: /task b/i });
    expect(taskB).toHaveAttribute("href", "/projects/project-1/tasks/task-b");
  });

  it("renders a loading indicator while context is loading", () => {
    renderTab([], true);

    expect(screen.getByTestId("design-doc-tasks-loading")).toBeInTheDocument();
    expect(screen.getByText(/loading tasks/i)).toBeInTheDocument();
  });
});
