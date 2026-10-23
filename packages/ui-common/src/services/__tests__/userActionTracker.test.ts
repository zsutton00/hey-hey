import { afterEach, describe, expect, it, vi } from "vitest";
import { UserActionTracker } from "../userActionTracker";

describe("UserActionTracker ownership", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps global listeners until the final owner releases", () => {
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    const tracker = new UserActionTracker({
      enableErrorTracking: false,
      enablePerformanceTracking: false,
    });

    tracker.initialize();
    tracker.initialize();
    expect(
      addEventListener.mock.calls.filter(([eventName]) => eventName === "click")
    ).toHaveLength(1);

    tracker.destroy();
    expect(
      removeEventListener.mock.calls.filter(
        ([eventName]) => eventName === "click"
      )
    ).toHaveLength(0);

    tracker.destroy();
    expect(
      removeEventListener.mock.calls.filter(
        ([eventName]) => eventName === "click"
      )
    ).toHaveLength(1);
  });

  it("cleans up only the context-provider registration that owns the cleanup", () => {
    const tracker = new UserActionTracker();
    const firstProvider = vi.fn(() => ({}));
    const secondProvider = vi.fn(() => ({}));
    const unregisterFirst = tracker.registerContextProvider(
      "react-context",
      firstProvider
    );
    const unregisterSecond = tracker.registerContextProvider(
      "react-context",
      secondProvider
    );

    tracker.track({ category: "navigation", action: "page_view" });
    expect(firstProvider).toHaveBeenCalledOnce();
    expect(secondProvider).toHaveBeenCalledOnce();

    unregisterFirst();
    tracker.track({ category: "navigation", action: "page_view" });
    expect(firstProvider).toHaveBeenCalledOnce();
    expect(secondProvider).toHaveBeenCalledTimes(2);

    unregisterSecond();
  });
});
