import { describe, expect, it } from "vitest";
import { activityIdentity, readSettled } from "../projectInfoActivityState";

describe("activity readiness", () => {
  it("never accepts withheld data during fetching, or errors as success", () => {
    const ready = {
      isLoading: false,
      isFetching: false,
      isReady: true,
      error: null,
    };
    expect(readSettled(ready)).toBe(true);
    expect(readSettled({ ...ready, isFetching: true })).toBe(false);
    expect(readSettled({ ...ready, isReady: false })).toBe(false);
    expect(readSettled({ ...ready, error: new Error("failed") })).toBe(false);
  });
  it("distinguishes exact window bounds and absent bounds without delimiter collisions", () => {
    expect(activityIdentity(["a:b", "c"])).not.toBe(
      activityIdentity(["a", "b:c"])
    );
    expect(activityIdentity(["a", undefined])).not.toBe(
      activityIdentity(["a", ""])
    );
  });
});
