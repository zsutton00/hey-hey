import { describe, expect, it } from "vitest";
import {
  isLocalRuntimeUnavailable,
  isProvider,
  resolveAgenticLaunchContext,
} from "../agenticRuntimeUtils";

describe("resolveAgenticLaunchContext", () => {
  it("resolves plan, step, and stage ids when all are present", () => {
    expect(
      resolveAgenticLaunchContext({
        planId: "plan-1",
        stepId: "step-1",
        stageId: "stage-1",
      })
    ).toEqual({
      launchPlanId: "plan-1",
      launchStepId: "step-1",
      launchStageId: "stage-1",
    });
  });

  it("resolves nulls when no plan context is present", () => {
    expect(
      resolveAgenticLaunchContext({
        planId: undefined,
        stepId: undefined,
        stageId: undefined,
      })
    ).toEqual({
      launchPlanId: null,
      launchStepId: null,
      launchStageId: null,
    });
  });

  it("resolves plan id with null step and stage when step and stage are missing", () => {
    expect(
      resolveAgenticLaunchContext({
        planId: "plan-1",
        stepId: undefined,
        stageId: undefined,
      })
    ).toEqual({
      launchPlanId: "plan-1",
      launchStepId: null,
      launchStageId: null,
    });
  });
});

describe("isLocalRuntimeUnavailable", () => {
  it("matches axios's spaced 'Network Error' message", () => {
    expect(isLocalRuntimeUnavailable("Network Error")).toBe(true);
  });

  it("still matches the unspaced 'NetworkError' variant", () => {
    expect(isLocalRuntimeUnavailable("NetworkError when fetching")).toBe(true);
  });

  it("matches 'Failed to fetch'", () => {
    expect(isLocalRuntimeUnavailable("Failed to fetch")).toBe(true);
  });

  it("matches ECONNREFUSED", () => {
    expect(
      isLocalRuntimeUnavailable("connect ECONNREFUSED 127.0.0.1:3847")
    ).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(
      isLocalRuntimeUnavailable("Agent execution failed: bad request")
    ).toBe(false);
    expect(isLocalRuntimeUnavailable(null)).toBe(false);
    expect(isLocalRuntimeUnavailable(undefined)).toBe(false);
    expect(isLocalRuntimeUnavailable("")).toBe(false);
  });
});

describe("isProvider", () => {
  it("accepts known provider values", () => {
    expect(isProvider("claude")).toBe(true);
    expect(isProvider("codex")).toBe(true);
    expect(isProvider("opencode")).toBe(true);
  });

  it("rejects unknown values, undefined, and the empty-string fallback", () => {
    expect(isProvider("gemini")).toBe(false);
    expect(isProvider("")).toBe(false);
    expect(isProvider(undefined)).toBe(false);
  });
});
