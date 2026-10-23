import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useFinalAssessmentSecondaryActions } from "./useFinalAssessmentSecondaryActions";

const buildInput = () => ({
  onSync: vi.fn(),
  onRequestCodeReview: vi.fn(),
});

describe("useFinalAssessmentSecondaryActions", () => {
  it("returns hardcoded action set on mount", () => {
    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions(buildInput())
    );

    expect(result.current.actions).toHaveLength(2);
    expect(result.current.actions.map((a) => a.id)).toEqual([
      "sync_with_hey_hey",
      "request_code_review",
    ]);
  });

  it("returns idle status for all actions initially", () => {
    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions(buildInput())
    );

    for (const action of result.current.actions) {
      const status = result.current.getActionStatus(action.id);
      expect(status.state).toBe("idle");
      expect(status.notice).toBeNull();
      expect(status.error).toBeNull();
    }
  });

  it("executes sync action and transitions to success", async () => {
    const onSync = vi.fn();
    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions({ ...buildInput(), onSync })
    );

    act(() => {
      result.current.executeAction("sync_with_hey_hey");
    });

    expect(onSync).toHaveBeenCalledTimes(1);
    const status = result.current.getActionStatus("sync_with_hey_hey");
    expect(status.state).toBe("success");
  });

  it("executes async action and transitions through loading to success", async () => {
    let resolveAsync: () => void = () => {};
    const onSync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAsync = resolve;
        })
    );

    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions({ ...buildInput(), onSync })
    );

    act(() => {
      result.current.executeAction("sync_with_hey_hey");
    });

    expect(result.current.getActionStatus("sync_with_hey_hey").state).toBe(
      "loading"
    );
    expect(result.current.isAnyActionInFlight).toBe(true);

    await act(async () => {
      resolveAsync();
    });

    expect(result.current.getActionStatus("sync_with_hey_hey").state).toBe(
      "success"
    );
    expect(result.current.isAnyActionInFlight).toBe(false);
  });

  it("transitions to error state when async action rejects", async () => {
    let rejectAsync: (err: Error) => void = () => {};
    const onSync = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAsync = reject;
        })
    );

    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions({ ...buildInput(), onSync })
    );

    act(() => {
      result.current.executeAction("sync_with_hey_hey");
    });

    await act(async () => {
      rejectAsync(new Error("Sync failed"));
    });

    const status = result.current.getActionStatus("sync_with_hey_hey");
    expect(status.state).toBe("error");
    expect(status.error).toBe("Sync failed");
  });

  it("routes actions to correct handlers", () => {
    const input = buildInput();
    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions(input)
    );

    act(() => {
      result.current.executeAction("request_code_review");
    });
    expect(input.onRequestCodeReview).toHaveBeenCalledTimes(1);
  });

  it("provides distinct labels and icons for each action", () => {
    const { result } = renderHook(() =>
      useFinalAssessmentSecondaryActions(buildInput())
    );

    const labels = result.current.actions.map((a) => a.label);
    const icons = result.current.actions.map((a) => a.icon);

    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
