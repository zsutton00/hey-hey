import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSecondaryActions } from "./useSecondaryActions";
import { unifiedApiClient } from "../../clients/serviceClients";
import type { SecondaryActionConfig } from "../../api";

vi.mock("../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getSecondaryActions: vi.fn(),
  },
}));

const mockGetSecondaryActions = vi.mocked(unifiedApiClient.getSecondaryActions);

const buildAction = (id: string, label: string): SecondaryActionConfig => ({
  id,
  label,
  fieldId: "test-field",
  handler: "suggested_action" as SecondaryActionConfig["handler"],
  type: "BUTTON" as SecondaryActionConfig["type"],
});

describe("useSecondaryActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches actions on mount for given org and uiElement", async () => {
    const actions = [buildAction("a1", "Sync"), buildAction("a2", "Review")];
    mockGetSecondaryActions.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        data: actions,
        timestamp: "",
        statusCode: 200,
      },
    } as never);

    const { result } = renderHook(() =>
      useSecondaryActions("org-1", "coding_prompt_merged_final_assessment")
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetSecondaryActions).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        uiElement: "coding_prompt_merged_final_assessment",
      })
    );
    expect(result.current.actions).toEqual(actions);
    expect(result.current.error).toBeNull();
  });

  it("does not fetch when disabled", () => {
    renderHook(() =>
      useSecondaryActions("org-1", "coding_prompt_merged_final_assessment", {
        enabled: false,
      })
    );

    expect(mockGetSecondaryActions).not.toHaveBeenCalled();
  });

  it("does not fetch when organizationId is undefined", () => {
    renderHook(() =>
      useSecondaryActions(undefined, "coding_prompt_merged_final_assessment")
    );

    expect(mockGetSecondaryActions).not.toHaveBeenCalled();
  });

  it("sets error state on fetch failure", async () => {
    mockGetSecondaryActions.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() =>
      useSecondaryActions("org-1", "coding_prompt_merged_final_assessment")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Network error");
    expect(result.current.actions).toEqual([]);
  });

  it("forwards actionHint as third argument to API call", async () => {
    mockGetSecondaryActions.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        data: [],
        timestamp: "",
        statusCode: 200,
      },
    } as never);

    const { result } = renderHook(() =>
      useSecondaryActions("org-1", "agent_complete", {
        actionHint: "task_complete",
      })
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetSecondaryActions).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        uiElement: "agent_complete",
        actionType: "task_complete",
      })
    );
  });

  it("refetches when refetch is called", async () => {
    mockGetSecondaryActions.mockResolvedValue({
      data: {
        success: true,
        message: "ok",
        data: [],
        timestamp: "",
        statusCode: 200,
      },
    } as never);

    const { result } = renderHook(() =>
      useSecondaryActions("org-1", "coding_prompt_merged_final_assessment")
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockGetSecondaryActions).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(mockGetSecondaryActions).toHaveBeenCalledTimes(2);
    });
  });
});
