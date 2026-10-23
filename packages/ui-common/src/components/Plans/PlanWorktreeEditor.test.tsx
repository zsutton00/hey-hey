import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  TaskSectionUpdateSource,
  TaskSource,
  WorkStatus,
  type PlanConfigurationV1,
} from "../../api";
import { useCanonicalPlanMutations, type PlanWorkItem } from "../../data";
import { PlanWorktreeEditor } from "./PlanWorktreeEditor";

vi.mock("../../data", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../data")>();
  return { ...original, useCanonicalPlanMutations: vi.fn() };
});

const mockUseCanonicalPlanMutations = vi.mocked(useCanonicalPlanMutations);
const updatePlan = vi.fn();

const plan: PlanWorkItem = {
  id: "plan-1",
  name: "Ship Better Plans",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
};

const configuration = (worktreeBranch: string | null): PlanConfigurationV1 => ({
  schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
  planType: PlanType.Standard,
  worktreeBranch,
});

const renderEditor = (worktreeBranch: string | null) =>
  render(
    <PlanWorktreeEditor
      plan={plan}
      configuration={configuration(worktreeBranch)}
    />
  );

describe("PlanWorktreeEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePlan.mockResolvedValue({ status: "applied", plan });
    mockUseCanonicalPlanMutations.mockReturnValue({
      updatePlan,
      deletePlan: vi.fn(),
      isLoading: false,
      error: null,
    });
  });

  it("writes the schema-backed planConfiguration section", async () => {
    renderEditor(null);
    fireEvent.click(screen.getByTestId("plan-worktree-editor-toggle"));

    expect(screen.getByRole("textbox", { name: "Branch name" })).toHaveValue(
      "ship-better-plans"
    );
    fireEvent.click(screen.getByTestId("plan-worktree-editor-save"));

    await waitFor(() =>
      expect(updatePlan).toHaveBeenCalledWith("plan-1", {
        sections: [
          {
            key: "planConfiguration",
            content: {
              ...configuration(null),
              worktreeBranch: "ship-better-plans",
            },
          },
        ],
        sectionUpdateSource: TaskSectionUpdateSource.User,
      })
    );
  });

  it("trims an applied branch and commits it locally", async () => {
    renderEditor("old-branch");
    fireEvent.change(screen.getByRole("textbox", { name: "Branch name" }), {
      target: { value: "  new-branch  " },
    });
    fireEvent.click(screen.getByTestId("plan-worktree-editor-save"));

    await waitFor(() => expect(updatePlan).toHaveBeenCalledOnce());
    expect(screen.getByRole("textbox", { name: "Branch name" })).toHaveValue(
      "new-branch"
    );
    expect(screen.getByTestId("plan-worktree-editor-save")).toBeDisabled();
  });

  it("does not present a pending proposal as a saved worktree", async () => {
    updatePlan.mockResolvedValue({
      status: "pending",
      plan,
      proposal: { id: "proposal-1" },
    });
    renderEditor("persisted-branch");
    fireEvent.change(screen.getByRole("textbox", { name: "Branch name" }), {
      target: { value: "proposed-branch" },
    });
    fireEvent.click(screen.getByTestId("plan-worktree-editor-save"));

    expect(
      await screen.findByTestId("plan-worktree-editor-pending")
    ).toHaveTextContent("awaiting proposal approval");
    expect(screen.getByRole("textbox", { name: "Branch name" })).toHaveValue(
      "persisted-branch"
    );
  });

  it("restores the persisted branch after an update error", async () => {
    updatePlan.mockRejectedValue(new Error("Update failed"));
    renderEditor("persisted-branch");
    fireEvent.change(screen.getByRole("textbox", { name: "Branch name" }), {
      target: { value: "unsaved-branch" },
    });
    fireEvent.click(screen.getByTestId("plan-worktree-editor-save"));

    expect(
      await screen.findByTestId("plan-worktree-editor-save-error")
    ).toHaveTextContent("Update failed");
    expect(screen.getByRole("textbox", { name: "Branch name" })).toHaveValue(
      "persisted-branch"
    );
  });
});
