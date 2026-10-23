import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TaskSource,
  TargetEntityType,
  WorkStatus,
  type ProposalResponseDto,
} from "../../../api";
import { useCanonicalPlanMutations } from "../useCanonicalPlanMutations";
import { useWorkItemUpdateMethods } from "../useWorkItemUpdateMethods";

vi.mock("../useWorkItemUpdateMethods", () => ({
  useWorkItemUpdateMethods: vi.fn(),
}));

const mockUseWorkItemUpdateMethods = vi.mocked(useWorkItemUpdateMethods);
const updateTask = vi.fn();
const remove = vi.fn();

const canonicalPlan = {
  id: "plan-1",
  name: "Canonical Plan",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
};

describe("useCanonicalPlanMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateTask.mockResolvedValue(canonicalPlan);
    remove.mockResolvedValue(undefined);
    mockUseWorkItemUpdateMethods.mockReturnValue({
      workItems: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask,
      updateInitiative: vi.fn(),
      remove,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it("updates Plans through the generic Work Item mutation", async () => {
    const { result } = renderHook(() =>
      useCanonicalPlanMutations("org-1", "project-1")
    );

    await expect(
      result.current.updatePlan("plan-1", { status: WorkStatus.Archived })
    ).resolves.toEqual({ status: "applied", plan: canonicalPlan });
    expect(updateTask).toHaveBeenCalledWith(
      "plan-1",
      { status: WorkStatus.Archived },
      expect.objectContaining({ onPendingProposal: expect.any(Function) })
    );
  });

  it("returns a discriminated pending result when approval is required", async () => {
    const proposal: ProposalResponseDto = {
      id: "proposal-1",
      organizationId: "org-1",
      projectId: "project-1",
      type: ProposalType.Single,
      action: ProposalAction.Update,
      status: ProposalStatus.Draft,
      targetEntityId: canonicalPlan.id,
      targetEntityType: TargetEntityType.Task,
      title: "Archive Plan",
      updates: {},
      requestorId: "user-1",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    };
    updateTask.mockImplementation(async (_id, _updates, callbacks) => {
      callbacks?.onPendingProposal?.(proposal, canonicalPlan);
      return canonicalPlan;
    });
    const { result } = renderHook(() =>
      useCanonicalPlanMutations("org-1", "project-1")
    );

    await expect(result.current.updatePlan("plan-1", {})).resolves.toEqual({
      status: "pending",
      plan: canonicalPlan,
      proposal,
    });
  });

  it("rejects a mutation response with the wrong Work Item type", async () => {
    updateTask.mockResolvedValue({ ...canonicalPlan, type: "STANDARD" });
    const { result } = renderHook(() =>
      useCanonicalPlanMutations("org-1", "project-1")
    );

    await expect(result.current.updatePlan("plan-1", {})).rejects.toThrow(
      "not a canonical Plan"
    );
  });

  it("deletes Plans through the generic Work Item mutation", async () => {
    const { result } = renderHook(() =>
      useCanonicalPlanMutations("org-1", "project-1")
    );

    await result.current.deletePlan("plan-1");
    expect(remove).toHaveBeenCalledWith("plan-1");
  });
});
