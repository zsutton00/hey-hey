import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalDraftRecovery } from "../useLocalDraftRecovery";

const STORAGE_KEY = "test-local-draft";

describe("useLocalDraftRecovery", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("persists dirty values after the debounce interval", () => {
    renderHook(() =>
      useLocalDraftRecovery({
        storageKey: STORAGE_KEY,
        value: "draft content",
        isDirty: true,
        isSaving: false,
        onRestore: vi.fn(),
      })
    );

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual(
      expect.objectContaining({ value: "draft content" })
    );
  });

  it("removes the persisted draft when a dirty value is cleared", () => {
    const { rerender } = renderHook(
      ({ value, isDirty }: { value: string; isDirty: boolean }) =>
        useLocalDraftRecovery({
          storageKey: STORAGE_KEY,
          value,
          isDirty,
          isSaving: false,
          onRestore: vi.fn(),
        }),
      { initialProps: { value: "draft content", isDirty: true } }
    );

    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    rerender({ value: "", isDirty: false });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not remove a draft before initial restoration completes", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ value: "restored content", savedAt: "now" })
    );
    const onRestore = vi.fn();

    renderHook(() =>
      useLocalDraftRecovery({
        storageKey: STORAGE_KEY,
        value: "",
        isDirty: false,
        isSaving: false,
        onRestore,
      })
    );

    expect(onRestore).toHaveBeenCalledWith("restored content");
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("does not clear a newly selected storage key during a key change", () => {
    const nextStorageKey = "next-local-draft";
    localStorage.setItem(
      nextStorageKey,
      JSON.stringify({ value: "next draft", savedAt: "now" })
    );
    const onRestore = vi.fn();

    const { rerender } = renderHook(
      ({ storageKey, value, isDirty }: {
        storageKey: string;
        value: string;
        isDirty: boolean;
      }) =>
        useLocalDraftRecovery({
          storageKey,
          value,
          isDirty,
          isSaving: false,
          onRestore,
        }),
      {
        initialProps: {
          storageKey: STORAGE_KEY,
          value: "current draft",
          isDirty: true,
        },
      }
    );

    rerender({
      storageKey: nextStorageKey,
      value: "",
      isDirty: false,
    });

    expect(onRestore).toHaveBeenCalledWith("next draft");
    expect(localStorage.getItem(nextStorageKey)).not.toBeNull();
  });
});
