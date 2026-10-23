import { vi } from "vitest";
import { shouldSetLoading, manageLoadingState } from "../loadingStates";

describe("shouldSetLoading", () => {
  it("should return true when will fetch and not currently loading", () => {
    expect(shouldSetLoading("test-key", false, true)).toBe(true);
  });

  it("should return false when will not fetch", () => {
    expect(shouldSetLoading("test-key", false, false)).toBe(false);
    expect(shouldSetLoading("test-key", true, false)).toBe(false);
  });

  it("should maintain current state when already loading and will fetch", () => {
    expect(shouldSetLoading("test-key", true, true)).toBe(true);
  });

  it("should maintain current state when not loading and will not fetch", () => {
    expect(shouldSetLoading("test-key", false, false)).toBe(false);
  });

  it("should only change to true when transitioning from not loading to loading", () => {
    // Not loading → will fetch → should load
    expect(shouldSetLoading("test-key", false, true)).toBe(true);

    // Already loading → will fetch → stay loading
    expect(shouldSetLoading("test-key", true, true)).toBe(true);

    // Loading → won't fetch → cleanup to false
    expect(shouldSetLoading("test-key", true, false)).toBe(false);
  });
});

describe("manageLoadingState", () => {
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should dispatch SET_LOADING when state should change to true", () => {
    manageLoadingState("test-key", false, true, mockDispatch);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_LOADING",
      queryKey: "test-key",
      isLoading: true,
    });
  });

  it("should dispatch SET_LOADING false when current loading is true and will not fetch", () => {
    // shouldSetLoading(queryKey, true, false) returns false (cleanup)
    // so manageLoadingState should dispatch SET_LOADING false since true !== false
    manageLoadingState("test-key", true, false, mockDispatch);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_LOADING",
      queryKey: "test-key",
      isLoading: false,
    });
  });

  it("should not dispatch when state should not change", () => {
    // Not loading and won't fetch - no change needed
    manageLoadingState("test-key", false, false, mockDispatch);
    expect(mockDispatch).not.toHaveBeenCalled();

    // Already loading and will fetch - no change needed
    mockDispatch.mockClear();
    manageLoadingState("test-key", true, true, mockDispatch);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("should handle different query keys independently", () => {
    manageLoadingState("key1", false, true, mockDispatch);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_LOADING",
      queryKey: "key1",
      isLoading: true,
    });

    // Second call: true, false -> shouldSetLoading returns false (cleanup), so dispatch SET_LOADING false
    mockDispatch.mockClear();
    manageLoadingState("key2", true, false, mockDispatch);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_LOADING",
      queryKey: "key2",
      isLoading: false,
    });
  });

  it("should prevent unnecessary loading state cycling", () => {
    // Simulate multiple calls with same state - should not dispatch multiple times
    manageLoadingState("test-key", false, false, mockDispatch);
    manageLoadingState("test-key", false, false, mockDispatch);
    manageLoadingState("test-key", false, false, mockDispatch);

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("should handle loading cleanup correctly", () => {
    // Set loading to true first
    manageLoadingState("test-key", false, true, mockDispatch);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_LOADING",
      queryKey: "test-key",
      isLoading: true,
    });

    // Now cleanup - should set to false
    mockDispatch.mockClear();
    manageLoadingState("test-key", true, false, mockDispatch);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_LOADING",
      queryKey: "test-key",
      isLoading: false,
    });
  });
});
