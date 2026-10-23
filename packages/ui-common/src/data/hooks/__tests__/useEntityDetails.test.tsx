import { renderHook, waitFor } from "@testing-library/react";
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
import type { PlanWorkItem } from "../../plans/canonicalPlan";
import { useEntityDetails } from "../useEntityDetails";

vi.mock("../useInitiative", () => ({
  useInitiative: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useDesignDoc", () => ({
  useDesignDoc: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useWorkItem", () => ({
  useWorkItem: vi.fn(() => ({
    workItem: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useService", () => ({
  useService: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useMessage", () => ({
  useMessage: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useConversation", () => ({
  useConversation: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useAgentSession", () => ({
  useAgentSession: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

vi.mock("../useProposal", () => ({
  useProposal: vi.fn(() => ({
    proposal: null,
    isLoading: false,
    error: null,
  })),
}));

import { useWorkItem } from "../useWorkItem";
import { useProposal } from "../useProposal";

const mockUseWorkItem = vi.mocked(useWorkItem);
const mockUseProposal = vi.mocked(useProposal);

describe("useEntityDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards includeEdges to the task hook", () => {
    renderHook(() =>
      useEntityDetails({
        entityId: "task-1",
        entityType: "task",
        organizationId: "org-1",
        projectId: "proj-1",
        includeEdges: true,
        enabled: true,
      })
    );

    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "task-1",
      expect.objectContaining({
        projectId: "proj-1",
        includeEdges: true,
      })
    );
  });

  it("leaves includeEdges unset on ordinary task detail reads", () => {
    renderHook(() =>
      useEntityDetails({
        entityId: "task-1",
        entityType: "task",
        organizationId: "org-1",
        projectId: "proj-1",
        enabled: true,
      })
    );

    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "task-1",
      expect.objectContaining({
        projectId: "proj-1",
        includeEdges: undefined,
      })
    );
  });

  it("surfaces hydrated task edge data from the task hook", () => {
    const taskWithEdges = {
      id: "workflow-1",
      edges: [
        {
          id: "edge-1",
          sourceNodeId: "step-1",
          targetNodeId: "step-2",
          type: "STANDARD",
        },
      ],
    };
    mockUseWorkItem.mockReturnValue({
      workItem: taskWithEdges,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useEntityDetails({
        entityId: "workflow-1",
        entityType: "task",
        organizationId: "org-1",
        projectId: "proj-1",
        includeEdges: true,
        enabled: true,
      })
    );

    expect(result.current.data).toBe(taskWithEdges);
  });

  it("routes registered work-item mention types through the task hook", () => {
    const contract = { id: "contract-1", name: "API Contract" };
    mockUseWorkItem.mockReturnValue({
      workItem: contract,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(() =>
      useEntityDetails({
        entityId: "contract-1",
        entityType: "contract",
        organizationId: "org-1",
        projectId: "proj-1",
        enabled: true,
      })
    );

    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "contract-1",
      expect.objectContaining({ enabled: true })
    );
    expect(result.current.data).toBe(contract);
    expect(result.current.error).toBeNull();
  });

  it("routes project-defined work-item mention types through the task hook", () => {
    renderHook(() =>
      useEntityDetails({
        entityId: "request-1",
        entityType: "customer_request",
        organizationId: "org-1",
        projectId: "proj-1",
        enabled: true,
      })
    );

    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "request-1",
      expect.objectContaining({ enabled: true })
    );
  });

  it("loads canonical Plan details through the Work Item hook", () => {
    const plan: PlanWorkItem = {
      id: "plan-1",
      name: "Populated plan",
      type: "PLAN",
      parentTaskId: "feature-1",
      organizationId: "org-1",
      projectId: "proj-1",
      status: WorkStatus.Active,
      source: TaskSource.System,
    };
    mockUseWorkItem.mockReturnValue({
      workItem: plan,
      isLoading: false,
      isFetched: true,
      error: null,
    });

    const { result } = renderHook(() =>
      useEntityDetails({
        entityId: "plan-1",
        entityType: "plan",
        organizationId: "org-1",
        projectId: "proj-1",
        enabled: true,
      })
    );

    expect(mockUseWorkItem).toHaveBeenCalledWith(
      "org-1",
      "task",
      "plan-1",
      expect.objectContaining({ enabled: true, projectId: "proj-1" })
    );
    expect(result.current.data).toBe(plan);
    expect(result.current.error).toBeNull();
  });

  it("loads proposal details through the proposal hook", () => {
    const proposal: ProposalResponseDto = {
      id: "proposal-1",
      organizationId: "org-1",
      projectId: "proj-1",
      type: ProposalType.Single,
      action: ProposalAction.Update,
      status: ProposalStatus.Draft,
      targetEntityId: "task-1",
      targetEntityType: TargetEntityType.Task,
      title: "Clarify proposal mentions",
      updates: {},
      requestorId: "user-1",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    };
    mockUseProposal.mockReturnValue({
      proposal,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: async () => proposal,
      markStale: vi.fn(),
    });

    const { result } = renderHook(() =>
      useEntityDetails({
        entityId: "proposal-1",
        entityType: "proposal",
        organizationId: "org-1",
        projectId: "proj-1",
        enabled: true,
      })
    );

    expect(mockUseProposal).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "proposal-1",
      { enabled: true }
    );
    expect(result.current.data).toBe(proposal);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error for unsupported entity types", async () => {
    const { result } = renderHook(() =>
      useEntityDetails({
        entityId: "project-1",
        entityType: "project",
        organizationId: "org-1",
        enabled: true,
      })
    );

    await waitFor(() => {
      expect(result.current.error?.message).toBe(
        'Entity type "project" not yet supported for preview'
      );
    });
  });
});
