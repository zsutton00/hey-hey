import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TaskMonitorStateProjection,
  WorkItemExecutionState,
} from "../../../api";
import { dataClient } from "../../../clients";
import {
  workItemExecutionStateKeys,
  writeWorkItemExecutionStateEvent,
} from "../../../data/collections/workItemExecutionState";
import { taskMonitorRowStatus } from "../taskMonitorRowSignal";
import { useTaskMonitorRowSignals } from "../useTaskMonitorRowSignals";

const projections: Record<
  "running" | "paused" | "failed" | "completed",
  TaskMonitorStateProjection
> = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../../apps/api/src/services/work-item-execution-state/__tests__/fixtures/task-monitor-state-projections.json",
    ),
    "utf8",
  ),
);

const withExecution = (
  base: TaskMonitorStateProjection,
  execution: Partial<TaskMonitorStateProjection["execution"]>,
): TaskMonitorStateProjection => ({
  ...base,
  execution: { ...base.execution, ...execution },
});

describe("taskMonitorRowStatus", () => {
  const { running, paused, failed, completed } = projections;

  it("maps the committed lifecycle to the five row statuses", () => {
    expect(taskMonitorRowStatus(running)).toBe("running");
    expect(taskMonitorRowStatus(paused)).toBe("paused");
    expect(taskMonitorRowStatus(completed)).toBe("completed");
    expect(
      taskMonitorRowStatus(withExecution(running, { lifecycle: "HALTED" })),
    ).toBe("halted");
  });

  it("shows paused while pausing and running again while resuming", () => {
    expect(
      taskMonitorRowStatus(withExecution(running, { control: "PAUSING" })),
    ).toBe("paused");
    expect(
      taskMonitorRowStatus(withExecution(running, { control: "RESUMING" })),
    ).toBe("running");
  });

  it.each([
    { work: "LAUNCH_JUDGMENT" },
    { work: "OUTCOME_JUDGMENT" },
    { intervention: "PENDING" },
    { intervention: "APPLICATION_FAILED" },
    { intervention: "APPLICATION_STALE" },
    { intervention: "APPLICATION_UNCERTAIN" },
  ] as const)("needs feedback for %o, even while paused", (change) => {
    expect(taskMonitorRowStatus(withExecution(running, change))).toBe(
      "needs_feedback",
    );
    expect(taskMonitorRowStatus(withExecution(paused, change))).toBe(
      "needs_feedback",
    );
  });

  it("presents a failure as its own status, not as needs feedback", () => {
    expect(taskMonitorRowStatus(failed)).toBe("failed");
  });

  it("puts a request awaiting a person's approval after judgment and before running", () => {
    const awaiting: TaskMonitorStateProjection = {
      ...running,
      outstandingPermissions: [
        {
          interventionId: "00000000-0000-4000-8000-000000000001",
          runId: "00000000-0000-4000-8000-000000000002",
          agentSessionId: "00000000-0000-4000-8000-000000000003",
          providerActionId: "a",
          providerSessionId: "p",
          fingerprint: "f",
          action: "run",
          target: "t",
          owner: "HUMAN",
          answerable: true,
        },
      ],
    };
    expect(taskMonitorRowStatus(awaiting)).toBe("awaiting_approval");
    expect(
      taskMonitorRowStatus(
        withExecution(awaiting, { work: "OUTCOME_JUDGMENT" }),
      ),
    ).toBe("needs_feedback");
  });

  it("shows nothing for a monitor that has not started", () => {
    expect(
      taskMonitorRowStatus(withExecution(running, { lifecycle: "ABSENT" })),
    ).toBeNull();
  });
});

describe("useTaskMonitorRowSignals", () => {
  let queryClient: QueryClient;
  let platform: Record<string, WorkItemExecutionState>;
  let reads: string[][];

  const record = (
    workItemId: string,
    revision: number,
    projection: TaskMonitorStateProjection,
  ): WorkItemExecutionState => ({
    workItemId,
    revision,
    ownerMachineId: "20000000-0000-4000-8000-000000000002",
    acceptedAt: "2026-11-16T10:00:00.000Z",
    state: { type: "TASK_MONITOR", projection },
    freshness: { status: "CURRENT", changedAt: "2026-11-16T10:00:00.000Z" },
  });

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    platform = {};
    reads = [];
    vi.spyOn(dataClient, "request").mockImplementation(async (config) => {
      const { workItemIds } = (config as { data: { workItemIds: string[] } })
        .data;
      reads.push(workItemIds);
      const items = workItemIds.map((workItemId) =>
        platform[workItemId]
          ? {
              result: "RETAINED",
              workItemId,
              executionState: platform[workItemId],
            }
          : { result: "MISSING", workItemId },
      );
      return { data: { data: { items } } } as never;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const render = (ids: string[]) =>
    renderHook(
      ({ ids }: { ids: string[] }) =>
        useTaskMonitorRowSignals("org-1", "project-1", ids),
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
        initialProps: { ids },
      },
    );

  const observers = (id: string) =>
    queryClient
      .getQueryCache()
      .find({
        queryKey: workItemExecutionStateKeys.item("org-1", "project-1", id),
      })
      ?.getObserversCount() ?? 0;

  it("shows a monitor's status, updates it on a pushed snapshot, and treats unknown state as no status", async () => {
    platform["m1"] = record("m1", 1, projections.running);
    const { result } = render(["m1", "m2"]);

    await waitFor(() =>
      expect(result.current["m1"]).toMatchObject({
        kind: "status",
        status: "running",
      }),
    );
    expect(result.current["m2"]).toEqual({ kind: "none", reason: "missing" });
    // A stream that has not confirmed it is live is shown as last known.
    expect(result.current["m1"]).toMatchObject({ stale: true });

    act(() => {
      writeWorkItemExecutionStateEvent(
        queryClient,
        "org-1",
        "project-1",
        record("m1", 2, projections.paused),
      );
    });
    await waitFor(() =>
      expect(result.current["m1"]).toMatchObject({ status: "paused" }),
    );
    expect(reads).toEqual([["m1", "m2"]]);
  });

  it("keeps one monitor's subscription when another row goes away, and releases the last", async () => {
    platform["m1"] = record("m1", 1, projections.running);
    platform["m2"] = record("m2", 1, projections.running);
    const first = render(["m1", "m2"]);
    const second = render(["m1"]);
    await waitFor(() => expect(first.result.current["m2"]).toBeDefined());
    expect(observers("m1")).toBe(2);

    first.rerender({ ids: ["m1"] });
    await waitFor(() => expect(observers("m2")).toBe(0));
    expect(observers("m1")).toBe(2);

    second.unmount();
    expect(observers("m1")).toBe(1);
    first.unmount();
    expect(observers("m1")).toBe(0);
  });
});
