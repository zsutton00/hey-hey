import { vi, beforeEach, describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { ReactNode } from "react";
import { useDeleteImplementationHint } from "../useDeleteImplementationHint";

vi.mock("../useImplementationHints", () => ({
  useImplementationHints: vi.fn(),
}));

import { useImplementationHints } from "../useImplementationHints";

const mockUseImplementationHints = vi.mocked(useImplementationHints);

describe("useDeleteImplementationHint", () => {
  let store: ReturnType<typeof createStore>;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;
  let mockRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = createStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    mockRemove = vi.fn();

    vi.clearAllMocks();
    mockUseImplementationHints.mockReturnValue({
      hints: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: mockRemove,
      refetch: vi.fn(),
      markStale: vi.fn(),
      clearError: vi.fn(),
    });
  });

  it("initializes with the expected organization and service scope", () => {
    renderHook(
      () =>
        useDeleteImplementationHint({
          organizationId: "org-1",
          serviceId: "service-1",
        }),
      { wrapper }
    );

    expect(mockUseImplementationHints).toHaveBeenCalledWith(
      "org-1",
      "service-1"
    );
  });

  it("returns the delete method and forwarded state", () => {
    const { result } = renderHook(
      () =>
        useDeleteImplementationHint({
          organizationId: "org-1",
          serviceId: "service-1",
        }),
      { wrapper }
    );

    expect(result.current.deleteImplementationHint).toBeInstanceOf(Function);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it("delegates deletes to useImplementationHints.remove", async () => {
    mockRemove.mockResolvedValue(undefined);
    const callbacks = {
      onSuccess: vi.fn(),
      onError: vi.fn(),
      onSettled: vi.fn(),
    };

    const { result } = renderHook(
      () =>
        useDeleteImplementationHint({
          organizationId: "org-1",
          serviceId: "service-1",
        }),
      { wrapper }
    );

    await act(async () => {
      await result.current.deleteImplementationHint("hint-1", callbacks);
    });

    expect(mockRemove).toHaveBeenCalledWith("hint-1", callbacks);
  });

  it("propagates delete errors", async () => {
    const error = new Error("Delete failed");
    mockRemove.mockRejectedValue(error);

    const { result } = renderHook(
      () =>
        useDeleteImplementationHint({
          organizationId: "org-1",
          serviceId: "service-1",
        }),
      { wrapper }
    );

    await expect(async () => {
      await act(async () => {
        await result.current.deleteImplementationHint("hint-1");
      });
    }).rejects.toThrow("Delete failed");

    expect(mockRemove).toHaveBeenCalledWith("hint-1", undefined);
  });

  it("forwards loading and error state from useImplementationHints", () => {
    mockUseImplementationHints.mockReturnValue({
      hints: [],
      isLoading: true,
      isFetching: false,
      isFetched: true,
      isReady: false,
      error: "Network error",
      isStale: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: mockRemove,
      refetch: vi.fn(),
      markStale: vi.fn(),
      clearError: vi.fn(),
    });

    const { result } = renderHook(
      () =>
        useDeleteImplementationHint({
          organizationId: "org-1",
          serviceId: "service-1",
        }),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBe("Network error");
  });
});
