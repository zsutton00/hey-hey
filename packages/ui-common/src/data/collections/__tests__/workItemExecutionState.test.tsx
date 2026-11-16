import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WebSocketSubscriptionRequestEventTypesEnum,
  type TaskMonitorStateProjection,
  type WebSocketWorkItemExecutionStateChangedEvent,
  type WorkItemExecutionState,
} from "../../../api";
import { dataClient } from "../../../clients";
import { ProjectContext } from "../../../contexts/ProjectContext";
import { useWorkItemExecutionState } from "../../hooks/useWorkItemExecutionState";
import { readWorkItemExecutionStateDelivery } from "../workItemExecutionState";
import { WebSocketDebugger } from "../../websockets/debug";
import { WebSocketHandler } from "../../websockets/handler";
import { WebSocketService } from "../../../services/webSocketService";

// The real service over a fake socket, so room membership is what the hook
// actually requests rather than something a test assumes.
const socket = vi.hoisted(() => ({
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock("socket.io-client", () => ({ io: vi.fn(() => socket) }));
const services = vi.hoisted(() => ({
  current: null as WebSocketService | null,
}));
vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketService: () => services.current,
}));

// The projections the real CLI Task Monitor owner publishes (the CLI suite
// fails if they drift), delivered through the real read and realtime paths.
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

const record = (
  workItemId: string,
  revision: number,
  projection: TaskMonitorStateProjection,
  status: "CURRENT" | "LAST_KNOWN" = "CURRENT",
): WorkItemExecutionState => ({
  workItemId,
  revision,
  ownerMachineId: "20000000-0000-4000-8000-000000000002",
  acceptedAt: "2026-11-16T10:00:00.000Z",
  state: { type: "TASK_MONITOR", projection },
  freshness: { status, changedAt: "2026-11-16T10:00:00.000Z" },
});

describe("shared work-item execution state", () => {
  let queryClient: QueryClient;
  let handler: WebSocketHandler;
  /** What the platform currently retains, per project then work item. */
  let platform: Record<string, Record<string, WorkItemExecutionState>>;
  let reads: Array<{ url: string; workItemIds: string[] }>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    handler = new WebSocketHandler(
      createStore(),
      new WebSocketDebugger(),
      queryClient,
    );
    platform = { "project-1": {}, "project-2": {} };
    reads = [];
    vi.spyOn(dataClient, "request").mockImplementation(async (config) => {
      const { url, data } = config as {
        url: string;
        data: { workItemIds: string[] };
      };
      reads.push({ url, workItemIds: data.workItemIds });
      const projectId = url.split("/")[4];
      const items = data.workItemIds.map((workItemId) => {
        const executionState = platform[projectId][workItemId];
        return executionState
          ? { result: "RETAINED", workItemId, executionState }
          : { result: "MISSING", workItemId };
      });
      return { data: { data: { items } } } as never;
    });
  });

  afterEach(() => {
    services.current = null;
    vi.restoreAllMocks();
  });

  const view = (workItemId: string, projectId = "project-1") => {
    const scope = { organizationId: "org-1", projectId, navigate: vi.fn() };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ProjectContext.Provider value={scope}>
          {children}
        </ProjectContext.Provider>
      </QueryClientProvider>
    );
    return renderHook(
      ({ id }: { id: string }) => useWorkItemExecutionState(id),
      { wrapper, initialProps: { id: workItemId } },
    );
  };

  /** Hands one realtime event to the handler and lets observers be notified. */
  const deliver = (
    executionState: WorkItemExecutionState,
    projectId = "project-1",
  ) =>
    act(async () => {
      handler.handleEvent({
        type: WebSocketSubscriptionRequestEventTypesEnum.WorkItemExecutionStateChanged,
        timestamp: "2026-11-16T10:00:01.000Z",
        organizationId: "org-1",
        projectId,
        executionState,
      } satisfies WebSocketWorkItemExecutionStateChangedEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

  it("replays the retained state on first use, with freshness apart from the state", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      4,
      projections.failed,
      "LAST_KNOWN",
    );
    const { result } = view("monitor-1");

    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.status).toBe("retained"));
    expect(result.current).toMatchObject({
      revision: 4,
      freshness: { status: "LAST_KNOWN" },
      state: { type: "TASK_MONITOR", projection: projections.failed },
    });
  });

  it("reports an explicit missing state, never an invented one", async () => {
    const { result } = view("monitor-1");

    await waitFor(() =>
      expect(result.current).toMatchObject({ status: "missing" }),
    );
  });

  it("reports a failed read as an error", async () => {
    vi.spyOn(dataClient, "request").mockRejectedValue(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    const { result } = view("monitor-1");

    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("applies newer realtime records and ignores older or repeated ones", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      4,
      projections.running,
    );
    const { result } = view("monitor-1");
    await waitFor(() => expect(result.current.status).toBe("retained"));

    await deliver(record("monitor-1", 6, projections.failed));
    expect(result.current).toMatchObject({
      revision: 6,
      state: { projection: projections.failed },
    });

    // A delayed delivery of the earlier running state must not hide the failure.
    await deliver(record("monitor-1", 5, projections.running));
    await deliver(record("monitor-1", 6, projections.completed));
    expect(result.current).toMatchObject({
      revision: 6,
      state: { projection: projections.failed },
    });

    // The owner goes offline: same state, now explicitly last known.
    await deliver(record("monitor-1", 7, projections.failed, "LAST_KNOWN"));
    expect(result.current).toMatchObject({
      freshness: { status: "LAST_KNOWN" },
      state: { projection: projections.failed },
    });
    expect(reads).toHaveLength(1);
  });

  it("a first report for a missing item arrives without another read", async () => {
    const { result } = view("monitor-1");
    await waitFor(() => expect(result.current.status).toBe("missing"));

    await deliver(record("monitor-1", 1, projections.running));

    expect(result.current).toMatchObject({ status: "retained", revision: 1 });
    expect(reads).toHaveLength(1);
  });

  it("re-reads every loaded item in one batch after the project room is rejoined", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      2,
      projections.running,
    );
    const first = view("monitor-1");
    const second = view("monitor-2");
    await waitFor(() => expect(first.result.current.status).toBe("retained"));
    await waitFor(() => expect(second.result.current.status).toBe("missing"));
    reads.length = 0;

    // Updates were missed while disconnected.
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      5,
      projections.completed,
      "LAST_KNOWN",
    );
    platform["project-1"]["monitor-2"] = record(
      "monitor-2",
      1,
      projections.paused,
    );
    await act(() =>
      handler.refreshLoadedWorkItemExecutionStates("org-1", "project-1"),
    );

    await waitFor(() =>
      expect(first.result.current).toMatchObject({
        revision: 5,
        freshness: { status: "LAST_KNOWN" },
        state: { projection: projections.completed },
      }),
    );
    await waitFor(() =>
      expect(second.result.current).toMatchObject({
        status: "retained",
        state: { projection: projections.paused },
      }),
    );
    expect(reads).toHaveLength(1);
    expect([...reads[0].workItemIds].sort()).toEqual([
      "monitor-1",
      "monitor-2",
    ]);
  });

  it("takes a re-read's freshness at an unchanged revision", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      3,
      projections.running,
    );
    const { result } = view("monitor-1");
    await waitFor(() => expect(result.current.status).toBe("retained"));

    // The owner fell silent without a recorded change; only a read knows.
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      3,
      projections.running,
      "LAST_KNOWN",
    );
    await act(() =>
      handler.refreshLoadedWorkItemExecutionStates("org-1", "project-1"),
    );

    await waitFor(() =>
      expect(result.current).toMatchObject({
        freshness: { status: "LAST_KNOWN" },
      }),
    );
  });

  it("shares one entry between consumers and keeps it live after one leaves", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      1,
      projections.running,
    );
    const docked = view("monitor-1");
    const openItems = view("monitor-1");
    await waitFor(() => expect(docked.result.current.status).toBe("retained"));
    await waitFor(() =>
      expect(openItems.result.current.status).toBe("retained"),
    );
    expect(reads).toHaveLength(1);

    docked.unmount();
    await deliver(record("monitor-1", 2, projections.paused));

    expect(openItems.result.current).toMatchObject({
      revision: 2,
      state: { projection: projections.paused },
    });
    expect(reads).toHaveLength(1);
  });

  it("shows nothing from the previous identity when the item or project changes", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      9,
      projections.failed,
    );
    const { result, rerender } = view("monitor-1");
    await waitFor(() => expect(result.current.status).toBe("retained"));

    rerender({ id: "monitor-2" });
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() =>
      expect(result.current).toMatchObject({ status: "missing" }),
    );

    // The same item id under another project is a different identity, and an
    // update for the first project does not reach it.
    const elsewhere = view("monitor-1", "project-2");
    await waitFor(() =>
      expect(elsewhere.result.current).toMatchObject({ status: "missing" }),
    );
    await deliver(record("monitor-1", 10, projections.completed), "project-1");
    expect(elsewhere.result.current).toMatchObject({ status: "missing" });
  });

  it("qualifies cached state as interrupted while disconnected, until an authorized refresh succeeds", async () => {
    platform["project-1"]["monitor-1"] = record(
      "monitor-1",
      3,
      projections.failed,
    );
    const { result } = view("monitor-1");
    await waitFor(() => expect(result.current.status).toBe("retained"));
    // Nothing has confirmed live delivery yet.
    expect(result.current).toMatchObject({ delivery: "INTERRUPTED" });

    await act(() =>
      handler.refreshLoadedWorkItemExecutionStates("org-1", "project-1"),
    );
    expect(result.current).toMatchObject({
      delivery: "LIVE",
      freshness: { status: "CURRENT" },
    });

    // The connection drops: the owner's reported failure stays, qualified.
    act(() => handler.interruptWorkItemExecutionStateDelivery());
    expect(result.current).toMatchObject({
      delivery: "INTERRUPTED",
      freshness: { status: "CURRENT" },
      state: { projection: projections.failed },
    });

    // A failed recovery read keeps the record and the qualification.
    vi.spyOn(dataClient, "request").mockRejectedValueOnce(
      Object.assign(new Error("forbidden"), { status: 403 }),
    );
    await act(() =>
      expect(
        handler.refreshLoadedWorkItemExecutionStates("org-1", "project-1"),
      ).rejects.toThrow(),
    );
    expect(result.current).toMatchObject({
      delivery: "INTERRUPTED",
      state: { projection: projections.failed },
    });

    // A disconnect during a refresh leaves delivery interrupted.
    const refresh = handler.refreshLoadedWorkItemExecutionStates(
      "org-1",
      "project-1",
    );
    handler.interruptWorkItemExecutionStateDelivery();
    await act(() => refresh);
    expect(result.current).toMatchObject({ delivery: "INTERRUPTED" });

    await act(() =>
      handler.refreshLoadedWorkItemExecutionStates("org-1", "project-1"),
    );
    expect(result.current).toMatchObject({ delivery: "LIVE" });
  });

  describe("project room membership", () => {
    const emitted = (event: "join" | "leave") =>
      socket.emit.mock.calls.filter((call) => call[0] === event);

    const connect = () => {
      socket.connected = false;
      socket.on.mockReset();
      socket.emit.mockReset();
      const service = new WebSocketService(handler);
      service.initialize({ userId: "user-1", organizationId: "org-1" });
      socket.connected = true;
      socket.on.mock.calls.find((call) => call[0] === "connect")![1]();
      socket.on.mock.calls.find((call) => call[0] === "authenticated")![1]({
        status: "success",
        connectionId: "connection-1",
        userId: "user-1",
        projectIds: [],
        conversationIds: [],
        initiativeIds: [],
        designDocIds: [],
      });
      services.current = service;
      return service;
    };

    it("a lone consumer joins its project room and turns live once recovered", async () => {
      platform["project-1"]["monitor-1"] = record(
        "monitor-1",
        1,
        projections.running,
      );
      connect();
      const { result } = view("monitor-1");
      await waitFor(() => expect(result.current.status).toBe("retained"));

      expect(emitted("join").map((call) => call[1])).toEqual([
        { projectId: "project-1" },
      ]);
      expect(result.current).toMatchObject({ delivery: "INTERRUPTED" });

      await act(async () => {
        emitted("join")[0][2]({ status: "success", projectId: "project-1" });
      });
      await waitFor(() =>
        expect(result.current).toMatchObject({ delivery: "LIVE" }),
      );
    });

    it("keeps the room while any consumer remains and interrupts delivery when the last leaves", async () => {
      platform["project-1"]["monitor-1"] = record(
        "monitor-1",
        1,
        projections.failed,
      );
      connect();
      const docked = view("monitor-1");
      const openItems = view("monitor-1");
      await waitFor(() =>
        expect(openItems.result.current.status).toBe("retained"),
      );
      expect(emitted("join")).toHaveLength(1);
      await act(async () => {
        emitted("join")[0][2]({ status: "success", projectId: "project-1" });
      });
      await waitFor(() =>
        expect(openItems.result.current).toMatchObject({ delivery: "LIVE" }),
      );

      docked.unmount();
      expect(emitted("leave")).toHaveLength(0);
      expect(openItems.result.current).toMatchObject({ delivery: "LIVE" });

      openItems.unmount();
      expect(emitted("leave").map((call) => call[1])).toEqual([
        { roomType: "project", roomId: "project-1" },
      ]);

      // A cached entry read after leaving is the owner's failure, qualified.
      const later = view("monitor-1");
      expect(later.result.current).toMatchObject({
        status: "retained",
        delivery: "INTERRUPTED",
        state: { projection: projections.failed },
      });
    });

    it("a refresh begun before leaving the room does not mark the project live", async () => {
      connect();
      const { unmount } = view("monitor-1");
      await waitFor(() => expect(reads).toHaveLength(1));

      const refresh = handler.refreshLoadedWorkItemExecutionStates(
        "org-1",
        "project-1",
      );
      unmount();
      await act(() => refresh);

      expect(
        readWorkItemExecutionStateDelivery(queryClient, "org-1", "project-1"),
      ).toBe("INTERRUPTED");
    });
  });
});
