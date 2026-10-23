import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SearchFilters } from "../SearchFilters";
import type { SearchFilterState } from "../types";
import { EntityType, WorkStatus } from "../../../api";

describe("SearchFilters", () => {
  const mockOnChange = vi.fn<(filters: SearchFilterState) => void>();
  const defaultFilters: SearchFilterState = {
    entityTypes: [],
    statuses: [],
    initiativeId: undefined,
    parentTaskId: undefined,
    threshold: 0.15,
    boostRecent: false,
  };

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it("should render all filter sections", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    expect(
      screen.getByText("Entity Type", { selector: "label" })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Status", { selector: "label" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Initiative ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Parent Task ID")).toBeInTheDocument();
  });

  it("should render in sidebar layout", () => {
    const { container } = render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Check for sidebar-specific styling
    const sidebarElement = container.firstChild as HTMLElement;
    expect(sidebarElement).toHaveStyle({ width: "280px" });
  });

  it("should render in stacked layout", () => {
    const { container } = render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="stacked"
      />
    );

    // Check for stacked layout - no fixed width constraint
    const stackedElement = container.firstChild as HTMLElement;
    expect(stackedElement).not.toHaveStyle({ width: "280px" });
  });

  it("should call onChange when entity type filter changes", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Click on the Entity Type select to open it
    const [entityTypeSelect] = screen.getAllByRole("combobox");
    fireEvent.mouseDown(entityTypeSelect);

    // Select the Task option
    const taskOption = screen.getByRole("option", { name: "Task" });
    fireEvent.click(taskOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypes: ["TASK:STANDARD"],
      })
    );
  });

  it("should call onChange when status filter changes", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Click on the Status select to open it
    const [, statusSelect] = screen.getAllByRole("combobox");
    fireEvent.mouseDown(statusSelect);

    // Select the Active option
    const activeOption = screen.getByRole("option", { name: "Active" });
    fireEvent.click(activeOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: [WorkStatus.Active],
      })
    );
  });

  it("should call onChange when initiative ID filter changes", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    const initiativeInput = screen.getByLabelText("Initiative ID");
    fireEvent.change(initiativeInput, { target: { value: "init-123" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        initiativeId: "init-123",
      })
    );
  });

  it("should call onChange when parent task ID filter changes", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    const parentTaskInput = screen.getByLabelText("Parent Task ID");
    fireEvent.change(parentTaskInput, { target: { value: "task-456" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: "task-456",
      })
    );
  });

  it("should display current filter values for entity types", () => {
    const filtersWithValues: SearchFilterState = {
      ...defaultFilters,
      entityTypes: [EntityType.Task, EntityType.Initiative],
      statuses: [],
    };

    render(
      <SearchFilters
        filters={filtersWithValues}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Check that chips are displayed for selected values
    expect(screen.getByText(EntityType.Task)).toBeInTheDocument();
    expect(screen.getByText(EntityType.Initiative)).toBeInTheDocument();
  });

  it("should display current filter values for statuses", () => {
    const filtersWithValues: SearchFilterState = {
      ...defaultFilters,
      entityTypes: [],
      statuses: [WorkStatus.Active, WorkStatus.Completed],
    };

    render(
      <SearchFilters
        filters={filtersWithValues}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Check that chips are displayed for selected values
    expect(screen.getByText(WorkStatus.Active)).toBeInTheDocument();
    expect(screen.getByText(WorkStatus.Completed)).toBeInTheDocument();
  });

  it("should display current filter values for text inputs", () => {
    const filtersWithValues: SearchFilterState = {
      ...defaultFilters,
      initiativeId: "init-789",
      parentTaskId: "task-012",
    };

    render(
      <SearchFilters
        filters={filtersWithValues}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    const initiativeInput = screen.getByLabelText(
      "Initiative ID"
    ) as HTMLInputElement;
    const parentTaskInput = screen.getByLabelText(
      "Parent Task ID"
    ) as HTMLInputElement;

    expect(initiativeInput.value).toBe("init-789");
    expect(parentTaskInput.value).toBe("task-012");
  });

  it("should handle multiple entity type selections", () => {
    const { rerender } = render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // First selection
    const [entityTypeSelect] = screen.getAllByRole("combobox", {
      hidden: true,
    });
    fireEvent.mouseDown(entityTypeSelect);
    const taskOption = screen.getByRole("option", { name: "Task" });
    fireEvent.click(taskOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypes: ["TASK:STANDARD"],
      })
    );

    mockOnChange.mockClear();

    // Update component with new filters
    const filtersWithTask: SearchFilterState = {
      ...defaultFilters,
      entityTypes: ["TASK:STANDARD"],
    };

    rerender(
      <SearchFilters
        filters={filtersWithTask}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    // Second selection
    const [updatedEntityTypeSelect] = screen.getAllByRole("combobox", {
      hidden: true,
    });
    fireEvent.mouseDown(updatedEntityTypeSelect);
    const initiativeOption = screen.getByRole("option", { name: "Initiative" });
    fireEvent.click(initiativeOption);

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        entityTypes: ["TASK:STANDARD", EntityType.Initiative],
      })
    );
  });

  it("should not render Filters heading in sidebar layout", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="sidebar"
      />
    );

    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
  });

  it("should not render Filters heading in stacked layout", () => {
    render(
      <SearchFilters
        filters={defaultFilters}
        onChange={mockOnChange}
        layout="stacked"
      />
    );

    expect(screen.queryByText("Filters")).not.toBeInTheDocument();
  });
});
