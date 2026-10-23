import { describe, expect, it } from "vitest";
import {
  formatStatus,
  getPlanStatusLabel,
  getStatusColorMapping,
  getStatusLabel,
  isTaskRefining,
} from "../statusUtils";

describe("statusUtils — Plan lifecycle statuses", () => {
  it("presents REFINING explicitly as active refinement", () => {
    expect(getStatusLabel("REFINING")).toBe("Refining");
    expect(getStatusColorMapping("REFINING")).toBe("primary");
    expect(isTaskRefining({ status: "REFINING" })).toBe(true);
  });

  it("presents BLOCKED explicitly as a warning state", () => {
    expect(getStatusLabel("BLOCKED")).toBe("Blocked");
    expect(getStatusColorMapping("BLOCKED")).toBe("warning");
    expect(isTaskRefining({ status: "BLOCKED" })).toBe(false);
  });
});

describe("plan status labels", () => {
  it("labels the canonical Plan draft status without changing other Work Item labels", () => {
    expect(getPlanStatusLabel("BACKLOG")).toBe("Draft");
    expect(getPlanStatusLabel("ACTIVE")).toBe("In progress");
    expect(formatStatus("ON_HOLD")).toBe("On Hold");
  });
});

describe("statusUtils — SUPERSEDED", () => {
  it("renders SUPERSEDED with a clear 'Superseded' label", () => {
    expect(getStatusLabel("SUPERSEDED")).toBe("Superseded");
  });

  it("maps SUPERSEDED to a distinct, muted color", () => {
    const supersededColor = getStatusColorMapping("SUPERSEDED");
    expect(supersededColor).toBe("secondary");
  });

  it("keeps SUPERSEDED visually separate from Cancelled and Archived", () => {
    const supersededColor = getStatusColorMapping("SUPERSEDED");
    expect(supersededColor).not.toBe(getStatusColorMapping("CANCELLED"));
    expect(supersededColor).not.toBe(getStatusColorMapping("ARCHIVED"));
  });
});
