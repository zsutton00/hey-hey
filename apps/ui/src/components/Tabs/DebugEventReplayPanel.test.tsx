import type { DebugOutboxEventDto } from "@hey-hey/ui-common/api";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DebugEventReplayPanel } from "./DebugEventReplayPanel";

const { replay, useDebugEventReplay, useOutboxEvents } = vi.hoisted(() => ({
  replay: vi.fn(),
  useDebugEventReplay: vi.fn(),
  useOutboxEvents: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useDebugEventReplay: (...args: unknown[]) => useDebugEventReplay(...args),
  useOutboxEvents: (...args: unknown[]) => useOutboxEvents(...args),
}));

const event: DebugOutboxEventDto = {
  id: "event-1",
  correlationId: "correlation-1",
  causationId: null,
  sagaId: null,
  eventType: "task.created",
  aggregateType: "TASK",
  aggregateId: "task-1",
  eventVersion: 1,
  payload: {},
  headers: {},
  status: "FAILED",
  retryCount: 0,
  maxRetries: 3,
  createdAt: "2026-08-21T00:00:00.000Z",
  processedAt: null,
  nextRetryAt: null,
  scheduledFor: null,
  lastError: "downstream failed",
  errorCount: 1,
  partitionKey: "task-1",
  sequenceNumber: "1",
  sourceService: "api",
  sourceMethod: "createTask",
  sourceVersion: null,
  userId: null,
  organizationId: "org-1",
  projectId: "project-1",
  conversationId: null,
  workflowId: null,
};

const baseReplayState = {
  data: null,
  error: null,
  isError: false,
  isPending: false,
  isSuccess: false,
  replay,
};

const renderPanel = () =>
  render(
    <DebugEventReplayPanel
      entityId="task-1"
      entityType="task"
      projectId="project-1"
    />,
  );

const chooseMode = async (label: string): Promise<void> => {
  fireEvent.mouseDown(screen.getByLabelText("Operation"));
  fireEvent.click(await screen.findByRole("option", { name: label }));
};

describe("DebugEventReplayPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOutboxEvents.mockReturnValue({
      data: { entityType: "task", entityId: "task-1", count: 1, events: [event] },
      error: null,
      events: [event],
      isLoading: false,
    });
    useDebugEventReplay.mockReturnValue(baseReplayState);
    replay.mockResolvedValue(null);
  });

  it("uses the entity-scoped shared replay hook", () => {
    renderPanel();

    expect(useDebugEventReplay).toHaveBeenCalledWith({
      entityId: "task-1",
      entityType: "task",
    });
    expect(useOutboxEvents).toHaveBeenCalledWith("task", "task-1");
  });

  it("maps VALIDATE_ONLY and runs it without confirmation", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() => {
      expect(replay).toHaveBeenCalledWith({
        eventId: "event-1",
        mode: "VALIDATE_ONLY",
        projectId: "project-1",
      });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["Re-emit original", "REEMIT_ORIGINAL"],
    ["Attempt fix and re-emit", "ATTEMPT_FIX_AND_REEMIT"],
  ] as const)("confirms %s before sending %s", async (label, mode) => {
    renderPanel();
    await chooseMode(label);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(replay).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "The source event and payload remain unchanged",
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(replay).toHaveBeenCalledWith({
        eventId: "event-1",
        mode,
        projectId: "project-1",
      });
    });
  });

  it("cancels a mutating request without calling the provider", async () => {
    renderPanel();
    await chooseMode("Re-emit original");
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(replay).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("renders bounded outcomes with source and replay identities", () => {
    useDebugEventReplay.mockReturnValue({
      ...baseReplayState,
      data: {
        total: 1,
        truncated: true,
        results: [
          {
            originalEventId: "event-1",
            replayEventId: "replay-1",
            eventType: "task.created",
            validationStatus: "INVALID",
            fixStatus: "APPLIED",
            queueStatus: "QUEUED",
            error: "A bounded per-event warning",
          },
        ],
      },
    });

    renderPanel();

    expect(screen.getByText("1 result · response truncated")).toBeInTheDocument();
    expect(screen.getByText("task.created")).toBeInTheDocument();
    expect(screen.getByText("Validation: INVALID · Fix: APPLIED")).toBeInTheDocument();
    expect(screen.getByText("QUEUED")).toBeInTheDocument();
    expect(screen.getByText("Original event: event-1")).toBeInTheDocument();
    expect(screen.getByText("Replay event: replay-1")).toBeInTheDocument();
    expect(screen.getByText("A bounded per-event warning")).toBeInTheDocument();
  });

  it("renders a failed replay request", () => {
    useDebugEventReplay.mockReturnValue({
      ...baseReplayState,
      error: new Error("Replay request failed"),
      isError: true,
    });

    renderPanel();

    expect(screen.getByText("Replay request failed")).toBeInTheDocument();
  });
});
