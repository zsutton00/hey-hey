import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFormDraftAutoSave } from "../useFormDraftAutoSave";

describe("useFormDraftAutoSave", () => {
  const mockStorageKey = "test-form-draft";
  const testValues = { field1: "value1", field2: "value2" };

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should return saveToLocalStorage function and timeout ref", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    expect(result.current).toHaveProperty("saveToLocalStorage");
    expect(result.current).toHaveProperty("saveTimeoutRef");
    expect(typeof result.current.saveToLocalStorage).toBe("function");
    expect(result.current.saveTimeoutRef).toHaveProperty("current");
  });

  it("should debounce localStorage save for 500ms", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    // Should not save immediately
    expect(localStorage.setItem).not.toHaveBeenCalled();

    // Advance time to just before 500ms
    act(() => {
      vi.advanceTimersByTime(499);
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();

    // Advance to 500ms
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      mockStorageKey,
      expect.stringContaining("value1")
    );
  });

  it("should restart debounce when called multiple times", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    // Advance to 400ms (before debounce completes)
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();

    // Call again, resetting debounce timer
    act(() => {
      result.current.saveToLocalStorage({ field1: "updated" });
    });

    // Advance to 450ms (400 + 50), still before second debounce completes
    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();

    // Advance to 500ms after second call
    act(() => {
      vi.advanceTimersByTime(450);
    });

    expect(localStorage.setItem).toHaveBeenCalledOnce();
  });

  it("should not save when form is submitted", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: true,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("should not save when form is disabled", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: true,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("should save valid data to localStorage with timestamp", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const savedData = localStorage.getItem(mockStorageKey);
    expect(savedData).toBeTruthy();

    const parsed = JSON.parse(savedData!);
    expect(parsed).toHaveProperty("values");
    expect(parsed).toHaveProperty("savedAt");
    expect(parsed.values).toEqual(testValues);
  });

  it("should handle localStorage.setItem errors gracefully", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const error = new Error("QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw error;
    });

    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to save form draft:",
      error
    );

    consoleErrorSpy.mockRestore();
  });

  it("should clear timeout on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    expect(result.current.saveTimeoutRef.current).not.toBeNull();

    unmount();

    // After unmount, advancing time should not cause save
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // clearTimeout was called, so saveTimeoutRef should be cleared
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("should update dependencies when isSubmitted changes", () => {
    const { result, rerender } = renderHook(
      ({ isSubmitted, disabled }) =>
        useFormDraftAutoSave({
          storageKey: mockStorageKey,
          isSubmitted,
          disabled,
        }),
      {
        initialProps: { isSubmitted: false, disabled: false },
      }
    );

    // First call should save
    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorage.setItem).toHaveBeenCalledOnce();

    // Clear and change to submitted
    localStorage.clear();
    vi.clearAllMocks();

    rerender({ isSubmitted: true, disabled: false });

    // Second call should not save when submitted
    act(() => {
      result.current.saveToLocalStorage(testValues);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it("should handle empty values correctly", () => {
    const { result } = renderHook(() =>
      useFormDraftAutoSave({
        storageKey: mockStorageKey,
        isSubmitted: false,
        disabled: false,
      })
    );

    act(() => {
      result.current.saveToLocalStorage({});
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      mockStorageKey,
      expect.stringContaining('{"values":{}')
    );
  });
});
