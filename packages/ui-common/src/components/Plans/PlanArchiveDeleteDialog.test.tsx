import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../api";
import { useCanonicalPlanMutations } from "../../data";
import { PlanArchiveDeleteDialog } from "./PlanArchiveDeleteDialog";

vi.mock("../../data", () => ({
  useCanonicalPlanMutations: vi.fn(),
}));

const mockUseCanonicalPlanMutations = vi.mocked(useCanonicalPlanMutations);
const updatePlan = vi.fn();
const deletePlan = vi.fn();

const renderDialog = (callbacks: {
  onClose?: () => void;
  onComplete?: () => void;
  onArchived?: () => void;
}) =>
  render(
    <PlanArchiveDeleteDialog
      open
      onClose={callbacks.onClose ?? vi.fn()}
      onComplete={callbacks.onComplete}
      onArchived={callbacks.onArchived}
      planId="plan-1"
      planName="Canonical Plan"
      planStatus={WorkStatus.Active}
      organizationId="org-1"
      projectId="project-1"
    />
  );

describe("PlanArchiveDeleteDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deletePlan.mockResolvedValue(undefined);
    mockUseCanonicalPlanMutations.mockReturnValue({
      updatePlan,
      deletePlan,
      isLoading: false,
      error: null,
    });
  });

  it("reports an archive only when the generic mutation was applied", async () => {
    updatePlan.mockResolvedValue({ status: "applied", plan: {} });
    const onArchived = vi.fn();
    const onComplete = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onArchived, onComplete, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(onArchived).toHaveBeenCalledOnce());
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(updatePlan).toHaveBeenCalledWith("plan-1", {
      status: WorkStatus.Archived,
    });
  });

  it("does not report a pending proposal as an applied archive", async () => {
    updatePlan.mockResolvedValue({ status: "pending", plan: {}, proposal: {} });
    const onArchived = vi.fn();
    const onComplete = vi.fn();
    const onClose = vi.fn();
    renderDialog({ onArchived, onComplete, onClose });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(onArchived).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
