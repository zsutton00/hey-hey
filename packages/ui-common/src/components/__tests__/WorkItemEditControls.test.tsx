import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { WorkItemEditControls } from "../WorkItemEditControls";
import type { InitiativeResponseDto, TaskResponseDto } from "../../api";
import { WorkStatus, Priority } from "../../api";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "workItems.editor.setReady": "Set Ready",
        "tasks.status.done": "Done",
        "common.edit": "Edit",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock the data hooks
const mockUpdateInitiative = vi.fn();
const mockUpdateTask = vi.fn();

vi.mock("../../data/hooks", () => ({
  useWorkItemUpdateMethods: () => ({
    updateInitiative: mockUpdateInitiative,
    updateTask: mockUpdateTask,
  }),
}));

// Mock the workItems collection
vi.mock("../../data/collections/workItems", () => ({
  isInitiative: (item: unknown) => {
    const anyItem = item as Record<string, unknown>;
    return "acceptanceCriteria" in anyItem && "details" in anyItem;
  },
}));

describe("WorkItemEditControls", () => {
  const mockOnEditModeChange = vi.fn();

  const createInitiative = (
    overrides?: Partial<InitiativeResponseDto>
  ): InitiativeResponseDto =>
    ({
      id: "initiative-1",
      name: "Test Initiative",
      description: "Test description",
      organizationId: "org-1",
      status: WorkStatus.RefiningAcceptanceCriteria,
      priority: Priority.Medium,
      creatorType: "USER",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptanceCriteria: [] as any,
      details: "" as any,
      ...overrides,
    } as InitiativeResponseDto);

  const createTask = (overrides?: Partial<TaskResponseDto>): TaskResponseDto =>
    ({
      id: "task-1",
      name: "Test Task",
      description: "Test description",
      organizationId: "org-1",
      initiativeId: "initiative-1",
      status: WorkStatus.RefiningAcceptanceCriteria,
      priority: Priority.Medium,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...overrides,
    } as TaskResponseDto);

  const defaultProps = {
    organizationId: "org-1",
    projectId: "proj-1",
    onEditModeChange: mockOnEditModeChange,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Refining state - Acceptance Criteria stage", () => {
    it("renders Set Ready button when work item is in REFINING_ACCEPTANCE_CRITERIA status", () => {
      const initiative = createInitiative({
        status: WorkStatus.RefiningAcceptanceCriteria,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      expect(
        screen.getByRole("button", { name: "Set Ready" })
      ).toBeInTheDocument();
    });

    it("calls updateTask with BACKLOG status when Set Ready is clicked for initiative", async () => {
      const initiative = createInitiative({
        status: WorkStatus.RefiningAcceptanceCriteria,
      });

      mockUpdateTask.mockResolvedValue(initiative);

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      const setReadyButton = screen.getByRole("button", { name: "Set Ready" });
      fireEvent.click(setReadyButton);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockUpdateTask).toHaveBeenCalledWith("initiative-1", {
        status: WorkStatus.Backlog,
      });
    });

    it("calls updateTask with BACKLOG status when Set Ready is clicked for task", async () => {
      const task = createTask({
        status: WorkStatus.RefiningAcceptanceCriteria,
      });

      mockUpdateTask.mockResolvedValue(task);

      render(
        <WorkItemEditControls
          workItem={task}
          isEditMode={false}
          {...defaultProps}
          initiativeId="initiative-1"
        />
      );

      const setReadyButton = screen.getByRole("button", { name: "Set Ready" });
      fireEvent.click(setReadyButton);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockUpdateTask).toHaveBeenCalledWith("task-1", {
        status: WorkStatus.Backlog,
      });
    });
  });

  describe("Refining state - Other stages", () => {
    it("renders no buttons when work item is in REFINING_DESCRIPTION status", () => {
      const initiative = createInitiative({
        status: WorkStatus.RefiningDescription,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders no buttons when work item is in REFINING_DETAILS status", () => {
      const task = createTask({
        status: WorkStatus.RefiningDetails,
      });

      render(
        <WorkItemEditControls
          workItem={task}
          isEditMode={false}
          {...defaultProps}
          initiativeId="initiative-1"
        />
      );

      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders Edit/Done toggle when work item is in GENERATED status", () => {
      const initiative = createInitiative({
        status: WorkStatus.Generated,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      // GENERATED status is not in the REFINING_* stages, so it shows Edit/Done toggle
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });
  });

  describe("Done refining state - Edit/Done toggle", () => {
    it("renders Edit button when isEditMode is false", () => {
      const initiative = createInitiative({
        status: WorkStatus.Backlog,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    });

    it("renders Done button when isEditMode is true", () => {
      const initiative = createInitiative({
        status: WorkStatus.Backlog,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={true}
          {...defaultProps}
        />
      );

      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    it("calls onEditModeChange with true when Edit button is clicked", () => {
      const initiative = createInitiative({
        status: WorkStatus.Backlog,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      const editButton = screen.getByRole("button", { name: "Edit" });
      fireEvent.click(editButton);

      expect(mockOnEditModeChange).toHaveBeenCalledWith(true);
    });

    it("calls onEditModeChange with false when Done button is clicked", () => {
      const initiative = createInitiative({
        status: WorkStatus.Backlog,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={true}
          {...defaultProps}
        />
      );

      const doneButton = screen.getByRole("button", { name: "Done" });
      fireEvent.click(doneButton);

      expect(mockOnEditModeChange).toHaveBeenCalledWith(false);
    });

    it("toggles between Edit and Done correctly", () => {
      const initiative = createInitiative({
        status: WorkStatus.Active,
      });

      const { rerender } = render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();

      rerender(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={true}
          {...defaultProps}
        />
      );

      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });
  });

  describe("Button styling", () => {
    it("Set Ready button has success color variant", () => {
      const initiative = createInitiative({
        status: WorkStatus.RefiningAcceptanceCriteria,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      const button = screen.getByRole("button", { name: "Set Ready" });
      expect(button).toHaveClass("MuiButton-colorSuccess");
    });

    it("Edit button is contained when isEditMode is false", () => {
      const initiative = createInitiative({
        status: WorkStatus.Backlog,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={false}
          {...defaultProps}
        />
      );

      const button = screen.getByRole("button", { name: "Edit" });
      expect(button).toHaveClass("MuiButton-containedPrimary");
    });

    it("Done button is outlined when isEditMode is true", () => {
      const initiative = createInitiative({
        status: WorkStatus.Backlog,
      });

      render(
        <WorkItemEditControls
          workItem={initiative}
          isEditMode={true}
          {...defaultProps}
        />
      );

      const button = screen.getByRole("button", { name: "Done" });
      expect(button).toHaveClass("MuiButton-outlinedPrimary");
    });
  });

  describe("Works with different statuses indicating done refining", () => {
    const statusesDoneRefining = [
      WorkStatus.Backlog,
      WorkStatus.Active,
      WorkStatus.OnHold,
      WorkStatus.Completed,
      WorkStatus.Cancelled,
    ];

    statusesDoneRefining.forEach((status) => {
      it(`renders Edit/Done toggle for ${status} status`, () => {
        const initiative = createInitiative({ status });

        render(
          <WorkItemEditControls
            workItem={initiative}
            isEditMode={false}
            {...defaultProps}
          />
        );

        expect(
          screen.getByRole("button", { name: "Edit" })
        ).toBeInTheDocument();
      });
    });
  });
});
