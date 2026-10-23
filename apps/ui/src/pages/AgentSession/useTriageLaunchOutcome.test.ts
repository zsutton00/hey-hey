import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRecordDto } from "@hey-hey/ui-common/api";
import {
  TRIAGE_LAUNCH_CONFIRMATION_MS,
  useTriageLaunchOutcome,
} from "./useTriageLaunchOutcome";

const mocks = vi.hoisted(() => ({
  message: undefined as MessageRecordDto | undefined,
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  useMessage: () => ({ data: mocks.message }),
}));

describe("triage launch confirmation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.message = undefined;
  });
  afterEach(() => vi.useRealTimers());
  const mount = () => {
    const onFailure = vi.fn();
    const props = {
      organizationId: "org",
      projectId: "project",
      requestMessageId: "request",
      running: false,
      hasResult: false,
      runtimeError: null as string | null,
      sessionErrored: false,
      onFailure,
    };
    const view = renderHook((input) => useTriageLaunchOutcome(input), {
      initialProps: props,
    });
    act(() => view.result.current.begin());
    return { ...view, props, onFailure };
  };
  const message = (fields: Partial<MessageRecordDto>) =>
    ({ id: "request", type: "USER", ...fields }) as MessageRecordDto;

  it("bounds an unconfirmed launch and never claims cancellation", () => {
    const h = mount();
    act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS - 1));
    expect(h.onFailure).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(h.onFailure).toHaveBeenCalledWith(
      expect.stringContaining("has not been cancelled"),
    );
    expect(h.result.current.isCurrent()).toBe(false);
  });
  it("does not mistake a saved queued request with pending admission for confirmed queueing", () => {
    mocks.message = message({
      executionStatus: "queued",
      executionAdmissionDisposition: "PENDING",
    });
    const h = mount();
    act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS));
    expect(h.onFailure).toHaveBeenCalledOnce();
  });
  it("honors confirmed queueing while still observing terminal delivery failure", () => {
    mocks.message = message({
      executionStatus: "queued",
      executionQueueConfirmed: true,
    });
    const h = mount();
    act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS * 3));
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(h.result.current.queued).toBe(true);
    mocks.message = message({ executionStatus: "failed" });
    h.rerender(h.props);
    expect(h.onFailure).toHaveBeenCalledOnce();
  });
  it.each(["failed", "cancelled"] as const)(
    "fails immediately on %s before any Run activity",
    (executionStatus) => {
      mocks.message = message({ executionStatus });
      const h = mount();
      expect(h.onFailure).toHaveBeenCalledOnce();
    },
  );
  it.each(["activity", "message", "result"] as const)(
    "allows slow successful execution confirmed by %s",
    (signal) => {
      const h = mount();
      if (signal === "message")
        mocks.message = message({ executionStatus: "started" });
      h.rerender({
        ...h.props,
        running: signal === "activity",
        hasResult: signal === "result",
      });
      act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS * 3));
      expect(h.onFailure).not.toHaveBeenCalled();
      h.rerender(h.props);
      act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS * 3));
      expect(h.onFailure).not.toHaveBeenCalled();
    },
  );
  it("clears its deadline and ignores late callbacks when replaced or closed", () => {
    const h = mount();
    const late = h.result.current;
    h.unmount();
    act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS * 2));
    late.fail("Late failure");
    expect(late.isCurrent()).toBe(false);
    expect(h.onFailure).not.toHaveBeenCalled();
    const next = mount();
    expect(next.result.current.isCurrent()).toBe(true);
  });
  it("reports runtime errors once", () => {
    const h = mount();
    h.rerender({ ...h.props, runtimeError: "Rejected" });
    act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS * 2));
    expect(h.onFailure.mock.calls).toEqual([["Rejected"]]);
  });

  it("keeps follow-up errors attached to a review that already has results", () => {
    const h = mount();
    h.rerender({
      ...h.props,
      hasResult: true,
      runtimeError: "Follow-up failed",
    });
    act(() => vi.advanceTimersByTime(TRIAGE_LAUNCH_CONFIRMATION_MS * 2));
    expect(h.onFailure).not.toHaveBeenCalled();
    expect(h.result.current.isCurrent()).toBe(true);
  });
});
