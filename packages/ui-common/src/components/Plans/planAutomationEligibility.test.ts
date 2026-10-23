import { describe, expect, it } from "vitest";
import { WorkStatus } from "../../api";
import { isRelatedNonTerminalTaskMonitor } from "./planAutomationEligibility";

describe("isRelatedNonTerminalTaskMonitor", () => {
  it("includes backlog Task Monitors", () => {
    expect(
      isRelatedNonTerminalTaskMonitor({
        type: "TASK_MONITOR",
        status: WorkStatus.Backlog,
      })
    ).toBe(true);
  });

  it.each([
    WorkStatus.Completed,
    WorkStatus.Cancelled,
    WorkStatus.Superseded,
    WorkStatus.Archived,
  ])("excludes the terminal status %s", (status) => {
    expect(
      isRelatedNonTerminalTaskMonitor({
        type: "TASK_MONITOR",
        status,
      })
    ).toBe(false);
  });

  it("excludes records archived through archivedAt", () => {
    expect(
      isRelatedNonTerminalTaskMonitor({
        type: "TASK_MONITOR",
        status: WorkStatus.Backlog,
        archivedAt: "2026-07-22T12:00:00.000Z",
      })
    ).toBe(false);
  });
});
