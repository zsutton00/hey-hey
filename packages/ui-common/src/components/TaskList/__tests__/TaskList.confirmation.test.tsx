import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { TaskList } from "../TaskList";
import type { TaskResponseDto } from "../../../api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "common.delete") return "Delete";
      if (key === "common.cancel") return "Cancel";
      if (key === "tasks.deleteConfirm") {
        return `Are you sure you want to delete the task "${params?.title}"? This action cannot be undone.`;
      }
      return key;
    },
  }),
}));

const mockTask: TaskResponseDto = {
  id: "task-1",
  name: "Test Task",
  description: "Test task description",
  organizationId: "org-1",
  initiativeId: "init-1",
  status: "BACKLOG",
  priority: "MEDIUM",
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2023-01-01T00:00:00Z",
};

describe("TaskList Confirmation Dialog", () => {
  beforeEach(() => {
    if (!global.ResizeObserver) {
      global.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    }
  });

  it("should show confirmation dialog when delete button is clicked", async () => {
    render(
      <BrowserRouter>
        <TaskList projectId="proj-1" tasks={[mockTask]} onDelete={vi.fn()} />
      </BrowserRouter>
    );

    const deleteButton = screen.getByLabelText("Delete");
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    expect(screen.getByRole("heading", { name: "Delete" })).toBeInTheDocument();
    expect(
      screen.getByText('Are you sure you want to delete "Test Task"?')
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("should close dialog when cancel button is clicked", async () => {
    render(
      <BrowserRouter>
        <TaskList projectId="proj-1" tasks={[mockTask]} onDelete={vi.fn()} />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByLabelText("Delete"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("should call onDelete when confirm button is clicked", async () => {
    const mockOnDelete = vi.fn();

    render(
      <BrowserRouter>
        <TaskList
          projectId="proj-1"
          tasks={[mockTask]}
          onDelete={mockOnDelete}
        />
      </BrowserRouter>
    );

    fireEvent.click(screen.getByLabelText("Delete"));

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockOnDelete).toHaveBeenCalledWith(mockTask);
    });
  });
});
