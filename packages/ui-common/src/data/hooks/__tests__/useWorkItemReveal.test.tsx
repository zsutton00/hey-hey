import { vi, beforeEach, describe, it, expect } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { ReactNode } from "react";
import { useWorkItemReveal } from "../useWorkItemReveal";

// Mock the workItemService
vi.mock("../../../services/workItemService", () => ({
  workItemService: {
    deepenWorkItem: vi.fn(),
  },
}));

// Mock useWebsocketSubscriptions
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

import { workItemService } from "../../../services/workItemService";

const mockWorkItemService = vi.mocked(workItemService);

describe("useWorkItemReveal", () => {
  let store: ReturnType<typeof createStore>;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  const mockOnLevelChange = vi.fn();
  const mockOnError = vi.fn();

  beforeEach(() => {
    store = createStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    vi.clearAllMocks();
  });

  it("should initialize with false revealing states", () => {
    const { result } = renderHook(
      () =>
        useWorkItemReveal({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          conversationId: "conv-1",
          currentLevel: "description",
          onLevelChange: mockOnLevelChange,
          onError: mockOnError,
        }),
      { wrapper }
    );

    expect(result.current.isRevealingDetails).toBe(false);
    expect(result.current.isRevealingAcceptanceCriteria).toBe(false);
  });

  it("should handle revealing details as no-op", async () => {
    const { result } = renderHook(
      () =>
        useWorkItemReveal({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          conversationId: "conv-1",
          currentLevel: "description",
          onLevelChange: mockOnLevelChange,
          onError: mockOnError,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleRevealDetails();
    });

    // Details section was removed - handleRevealDetails is a no-op
    expect(mockWorkItemService.deepenWorkItem).not.toHaveBeenCalled();
    expect(result.current.isRevealingDetails).toBe(false);
  });

  it("should handle revealing acceptance criteria successfully", async () => {
    mockWorkItemService.deepenWorkItem.mockResolvedValue({
      updatedWorkItem: { id: "workitem-1" },
      systemResponse: "Acceptance criteria revealed",
      nextLevelContent: "Revealed acceptance criteria content",
    });

    const { result } = renderHook(
      () =>
        useWorkItemReveal({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          conversationId: "conv-1",
          currentLevel: "description",
          onLevelChange: mockOnLevelChange,
          onError: mockOnError,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleRevealAcceptanceCriteria();
    });

    expect(mockWorkItemService.deepenWorkItem).toHaveBeenCalledWith(
      "workitem-1",
      "description"
    );

    expect(mockOnLevelChange).toHaveBeenCalledWith("acceptanceCriteria");
  });

  it("should handle reveal errors", async () => {
    const revealError = new Error("Failed to reveal details");
    mockWorkItemService.deepenWorkItem.mockRejectedValue(revealError);

    const { result } = renderHook(
      () =>
        useWorkItemReveal({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          conversationId: "conv-1",
          currentLevel: "description",
          onLevelChange: mockOnLevelChange,
          onError: mockOnError,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleRevealAcceptanceCriteria();
    });

    expect(mockOnError).toHaveBeenCalledWith("Failed to reveal details");
  });

  it("should set loading states during reveal operations", async () => {
    let resolvePromise: (value: any) => void;
    const delayedPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    mockWorkItemService.deepenWorkItem.mockReturnValue(delayedPromise);

    const { result } = renderHook(
      () =>
        useWorkItemReveal({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          conversationId: "conv-1",
          currentLevel: "description",
          onLevelChange: mockOnLevelChange,
          onError: mockOnError,
        }),
      { wrapper }
    );

    // Start revealing acceptance criteria
    let revealPromise: Promise<void>;
    act(() => {
      revealPromise = result.current.handleRevealAcceptanceCriteria();
    });

    // Wait for the loading state to update
    await waitFor(() => {
      expect(result.current.isRevealingAcceptanceCriteria).toBe(true);
    });
    // Details revealing is always false (removed)
    expect(result.current.isRevealingDetails).toBe(false);

    // Resolve the promise
    act(() => {
      resolvePromise!({ status: "success" });
    });

    await waitFor(() => {
      expect(result.current.isRevealingAcceptanceCriteria).toBe(false);
    });
  });

  it("should not reveal acceptance criteria if not at description level", async () => {
    const { result } = renderHook(
      () =>
        useWorkItemReveal({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          conversationId: "conv-1",
          currentLevel: "acceptanceCriteria",
          onLevelChange: mockOnLevelChange,
          onError: mockOnError,
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.handleRevealAcceptanceCriteria();
    });

    // Should not call deepenWorkItem since currentLevel is not "description"
    expect(mockWorkItemService.deepenWorkItem).not.toHaveBeenCalled();
  });
});
