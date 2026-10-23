import { vi, beforeEach, describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { ReactNode } from "react";
import { useDeleteTask } from "../useDeleteTask";

// Mock the useWorkItems hook
vi.mock("../useWorkItems", () => ({
  useWorkItems: vi.fn(),
}));

// Mock useWebsocketSubscriptions
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

import { useWorkItems } from "../useWorkItems";

const mockUseWorkItems = useWorkItems as ReturnType<typeof vi.fn>;

describe("useDeleteTask", () => {
  let store: ReturnType<typeof createStore>;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  let mockRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = createStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

    mockRemove = vi.fn();

    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: null,
      remove: mockRemove,
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      refetch: vi.fn(),
      markStale: vi.fn(),
      isFetching: false,
      isFetched: true,
      isReady: true,
      isStale: false,
    });

    vi.clearAllMocks();
  });

  it("should initialize with correct options", () => {
    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
      projectId: "proj-1",
    };

    renderHook(() => useDeleteTask(options), { wrapper });

    expect(mockUseWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "proj-1",
      undefined,
      { initiativeId: "init-1" }
    );
  });

  it("should return deleteTask function", () => {
    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
    };

    const { result } = renderHook(() => useDeleteTask(options), { wrapper });

    expect(result.current.deleteTask).toBeInstanceOf(Function);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("should call remove function when deleteTask is called", async () => {
    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
    };

    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteTask(options), { wrapper });

    const mockCallbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    };

    await act(async () => {
      await result.current.deleteTask("task-1", mockCallbacks);
    });

    expect(mockRemove).toHaveBeenCalledWith("task-1", mockCallbacks);
  });

  it("should handle delete task success", async () => {
    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
    };

    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteTask(options), { wrapper });

    const mockCallbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    };

    await act(async () => {
      await result.current.deleteTask("task-1", mockCallbacks);
    });

    expect(mockRemove).toHaveBeenCalledWith("task-1", mockCallbacks);
  });

  it("should handle delete task error", async () => {
    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
    };

    const mockError = new Error("Delete failed");
    mockRemove.mockRejectedValue(mockError);

    const { result } = renderHook(() => useDeleteTask(options), { wrapper });

    await expect(async () => {
      await act(async () => {
        await result.current.deleteTask("task-1");
      });
    }).rejects.toThrow("Delete failed");

    expect(mockRemove).toHaveBeenCalledWith("task-1", undefined);
  });

  it("should forward loading state from useWorkItems", () => {
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: true,
      error: null,
      remove: mockRemove,
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      refetch: vi.fn(),
      markStale: vi.fn(),
      isFetching: true,
      isFetched: false,
      isReady: false,
      isStale: false,
    });

    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
    };

    const { result } = renderHook(() => useDeleteTask(options), { wrapper });

    expect(result.current.isLoading).toBe(true);
  });

  it("should forward error state from useWorkItems", () => {
    const mockError = new Error("Network error");
    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: mockError,
      remove: mockRemove,
      createTask: vi.fn(),
      createInitiative: vi.fn(),
      updateTask: vi.fn(),
      updateInitiative: vi.fn(),
      refetch: vi.fn(),
      markStale: vi.fn(),
      isFetching: false,
      isFetched: true,
      isReady: false,
      isStale: false,
    });

    const options = {
      organizationId: "org-1",
      initiativeId: "init-1",
    };

    const { result } = renderHook(() => useDeleteTask(options), { wrapper });

    expect(result.current.error).toBe(mockError);
  });
});
