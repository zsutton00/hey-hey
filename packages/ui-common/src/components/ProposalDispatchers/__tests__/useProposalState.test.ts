import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposalStatus } from "../../../api";
import {
  __resetForTests,
  getEntry,
  setLifecycle,
} from "../proposalSelectedStateCache";
import { useProposalState } from "../useProposalState";

afterEach(() => {
  __resetForTests();
});

const pending = (id: string) => ({ id, status: ProposalStatus.Pending });
const approved = (id: string) => ({ id, status: ProposalStatus.Approved });

describe("useProposalState", () => {
  it("seeds state from the proposal status when nothing is cached", () => {
    const { result } = renderHook(() =>
      useProposalState([pending("p-1"), approved("p-2")]),
    );
    expect(result.current.getState("p-1")).toEqual({ state: "pending" });
    expect(result.current.getState("p-2")).toEqual({ state: "applied" });
  });

  it("seeds applied from the cache even when the proposal is Pending", () => {
    setLifecycle("p-1", "applied");
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    expect(result.current.getState("p-1")).toEqual({ state: "applied" });
  });

  it("seeds rejected from the cache even when the proposal is Pending", () => {
    setLifecycle("p-1", "rejected");
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    expect(result.current.getState("p-1")).toEqual({ state: "rejected" });
  });

  it("applyItem writes the applied lifecycle to the cache on success", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    const onApply = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await result.current.applyItem("p-1", onApply);
    });
    expect(onApply).toHaveBeenCalledWith("p-1");
    expect(result.current.getState("p-1")).toEqual({ state: "applied" });
    expect(getEntry("p-1")?.lifecycle).toBe("applied");
  });

  it("coalesces duplicate apply attempts and invokes completion once", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    let resolveApply: (() => void) | undefined;
    const onApply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveApply = resolve;
        }),
    );
    const onApplied = vi.fn();

    await act(async () => {
      const first = result.current.applyItem("p-1", onApply, onApplied);
      const duplicate = result.current.applyItem("p-1", onApply, onApplied);
      resolveApply?.();
      await Promise.all([first, duplicate]);
    });

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("keeps a durably applied proposal applied when completion notification fails", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onApplied = vi.fn().mockRejectedValue(new Error("navigation failed"));

    await act(async () => {
      await result.current.applyItem("p-1", onApply, onApplied);
    });

    expect(result.current.getState("p-1")).toEqual({ state: "applied" });
    expect(getEntry("p-1")?.lifecycle).toBe("applied");
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("applyItem leaves the cache untouched on failure", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    const onApply = vi.fn().mockRejectedValue(new Error("nope"));
    await act(async () => {
      await result.current.applyItem("p-1", onApply);
    });
    expect(result.current.getState("p-1")).toEqual({
      state: "failed",
      error: "nope",
    });
    expect(getEntry("p-1")).toBeUndefined();
  });

  it("preserves the API failure message and diagnostic on apply failure", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    const onApply = vi.fn().mockRejectedValue({
      response: {
        data: {
          message: "Projection requires retry",
          diagnostic: {
            issues: [
              {
                field: "parentTaskId",
                code: "PROJECTION_RETRY",
                reason: "The parent changed before enactment.",
                layer: "referential",
              },
            ],
            issueCount: 1,
            truncated: false,
            correlationId: "corr-1",
          },
        },
      },
    });

    await act(async () => {
      await result.current.applyItem("p-1", onApply);
    });

    expect(result.current.getState("p-1")).toEqual({
      state: "failed",
      error: "Projection requires retry",
      diagnostic: {
        issues: [
          {
            field: "parentTaskId",
            code: "PROJECTION_RETRY",
            reason: "The parent changed before enactment.",
            layer: "referential",
          },
        ],
        issueCount: 1,
        truncated: false,
        correlationId: "corr-1",
      },
    });
  });

  it("rejectItem writes the rejected lifecycle to the cache on success", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    const onReject = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await result.current.rejectItem("p-1", onReject, "not a fit");
    });
    expect(onReject).toHaveBeenCalledWith("p-1", "not a fit");
    expect(result.current.getState("p-1")).toEqual({ state: "rejected" });
    expect(getEntry("p-1")?.lifecycle).toBe("rejected");
  });

  it("rejectItem leaves the cache untouched on failure", async () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    const onReject = vi.fn().mockRejectedValue(new Error("server down"));
    await act(async () => {
      await result.current.rejectItem("p-1", onReject, "reason");
    });
    expect(result.current.getState("p-1")).toEqual({
      state: "failed",
      error: "server down",
    });
    expect(getEntry("p-1")).toBeUndefined();
  });

  it("propagates a cache write from a sibling consumer to a live hook", () => {
    const { result } = renderHook(() => useProposalState([pending("p-1")]));
    expect(result.current.getState("p-1")).toEqual({ state: "pending" });

    act(() => {
      setLifecycle("p-1", "applied");
    });

    expect(result.current.getState("p-1")).toEqual({ state: "applied" });
  });

  it("__resetForTests isolates state across renders", () => {
    setLifecycle("p-1", "applied");
    const first = renderHook(() => useProposalState([pending("p-1")]));
    expect(first.result.current.getState("p-1")).toEqual({ state: "applied" });

    __resetForTests();

    const second = renderHook(() => useProposalState([pending("p-1")]));
    expect(second.result.current.getState("p-1")).toEqual({ state: "pending" });
  });
});
