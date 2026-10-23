import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus } from "../../../api";
import type { WorkItemResponseDto } from "../../collections/workItems";
import { useProjectPlans } from "../useProjectPlans";
import { useWorkItems } from "../useWorkItems";

vi.mock("../useWorkItems", () => ({
  useWorkItems: vi.fn(),
}));

const mockUseWorkItems = vi.mocked(useWorkItems);
const refetch = vi.fn();

const plan: WorkItemResponseDto = {
  id: "plan-1",
  name: "Canonical Plan",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
};

const setWorkItems = (workItems: WorkItemResponseDto[]): void => {
  mockUseWorkItems.mockReturnValue({
    workItems,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    createTask: vi.fn(),
    createInitiative: vi.fn(),
    updateTask: vi.fn(),
    updateInitiative: vi.fn(),
    remove: vi.fn(),
    refetch,
    markStale: vi.fn(),
  });
};

describe("useProjectPlans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refetch.mockResolvedValue([plan]);
    setWorkItems([plan]);
  });

  it("queries canonical PLAN work items with ordinary statuses", () => {
    const { result } = renderHook(() =>
      useProjectPlans("org-1", "project-1", {
        statuses: [WorkStatus.Active, WorkStatus.Blocked],
      })
    );

    expect(result.current.plans).toEqual([plan]);
    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      {
        enabled: true,
        taskType: "PLAN",
        status: [WorkStatus.Active, WorkStatus.Blocked],
      }
    );
  });

  it.each([undefined, null])(
    "returns standalone Plans with parent %s, including on refetch",
    async (parentTaskId) => {
      const standalone = { ...plan, parentTaskId };
      setWorkItems([standalone]);
      refetch.mockResolvedValue([standalone]);
      const { result } = renderHook(() =>
        useProjectPlans("org-1", "project-1")
      );
      expect(result.current.error).toBeNull();
      expect(result.current.plans).toEqual([standalone]);
      await expect(result.current.refetch()).resolves.toEqual([standalone]);
    }
  );

  it("fails closed when the response contains a non-Plan item", () => {
    setWorkItems([{ ...plan, type: "STANDARD" }]);

    const { result } = renderHook(() => useProjectPlans("org-1", "project-1"));

    expect(result.current.plans).toEqual([]);
    expect(result.current.error?.message).toContain("not a canonical PLAN");
  });

  it("validates refetched results before returning them", async () => {
    refetch.mockResolvedValue([{ ...plan, type: "STANDARD" }]);
    const { result } = renderHook(() => useProjectPlans("org-1", "project-1"));

    await expect(result.current.refetch()).rejects.toThrow(
      "not a canonical PLAN"
    );
  });

  it("disables the generic query until both scope identifiers exist", () => {
    renderHook(() => useProjectPlans(undefined, "project-1"));

    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({ enabled: false, taskType: "PLAN" })
    );
  });
});
