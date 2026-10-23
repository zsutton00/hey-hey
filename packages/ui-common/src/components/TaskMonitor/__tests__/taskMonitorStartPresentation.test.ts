import { describe, expect, it } from "vitest";
import { WorkStatus } from "../../../api";
import {
  resolveTaskMonitorLifecycleAction,
  resolveTaskMonitorStartPresentation,
} from "../taskMonitorStartPresentation";

describe("resolveTaskMonitorStartPresentation", () => {
  it.each([
    {
      monitorStatus: WorkStatus.Backlog,
      isSubmitting: false,
      acceptedAwaitingRefresh: false,
      expected: "ready",
    },
    {
      monitorStatus: WorkStatus.Backlog,
      isSubmitting: true,
      acceptedAwaitingRefresh: false,
      expected: "starting",
    },
    {
      monitorStatus: WorkStatus.Backlog,
      isSubmitting: false,
      acceptedAwaitingRefresh: true,
      expected: "starting",
    },
    ...[
      WorkStatus.Active,
      WorkStatus.Completed,
      WorkStatus.Generated,
      WorkStatus.Ready,
      WorkStatus.Verifying,
      WorkStatus.Cancelled,
      WorkStatus.Archived,
      WorkStatus.Superseded,
    ].map((monitorStatus) => ({
      monitorStatus,
      isSubmitting: false,
      acceptedAwaitingRefresh: true,
      expected: "active" as const,
    })),
    {
      monitorStatus: WorkStatus.OnHold,
      isSubmitting: false,
      acceptedAwaitingRefresh: false,
      expected: "ready",
    },
  ] as const)(
    "resolves canonical and transient state to $expected",
    ({ expected, ...options }) => {
      expect(resolveTaskMonitorStartPresentation(options)).toEqual({
        status: expected,
      });
    }
  );

  it.each([
    [WorkStatus.Backlog, "START"],
    [WorkStatus.OnHold, "START"],
    [WorkStatus.Active, "PAUSE"],
    ...[
      WorkStatus.Generated,
      WorkStatus.Ready,
      WorkStatus.RefiningDescription,
      WorkStatus.Refining,
      WorkStatus.Blocked,
      WorkStatus.RefiningDetails,
      WorkStatus.RefiningAcceptanceCriteria,
      WorkStatus.GeneratingDescription,
      WorkStatus.GeneratingDetails,
      WorkStatus.GeneratingDescriptionAndDetails,
      WorkStatus.GeneratingAcceptanceCriteria,
      WorkStatus.GeneratingAll,
      WorkStatus.Verifying,
      WorkStatus.Completed,
      WorkStatus.Cancelled,
      WorkStatus.Archived,
      WorkStatus.Superseded,
    ].map((monitorStatus) => [monitorStatus, null]),
  ] as const)(
    "resolves %s to the canonical lifecycle action",
    (monitorStatus, action) => {
      expect(resolveTaskMonitorLifecycleAction(monitorStatus)).toBe(action);
    }
  );
});
