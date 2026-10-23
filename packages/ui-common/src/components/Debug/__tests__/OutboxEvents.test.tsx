import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { OutboxEvents } from "../OutboxEvents";

const useOutboxEventsMock = vi.fn();

vi.mock("../../../data", () => ({
  useOutboxEvents: (...args: unknown[]) => useOutboxEventsMock(...args),
}));

const buildHookResult = (overrides = {}) => ({
  data: {
    entityType: "task",
    entityId: "task-1",
    count: 1,
    events: [
      {
        id: "evt-1",
        correlationId: "corr-1",
        causationId: null,
        sagaId: null,
        eventType: "task.created",
        aggregateType: "task",
        aggregateId: "task-1",
        eventVersion: 1,
        payload: { title: "Task one" },
        headers: { source: "api" },
        status: "PUBLISHED" as const,
        retryCount: 0,
        maxRetries: 3,
        createdAt: "2026-03-10T00:00:00.000Z",
        processedAt: "2026-03-10T00:00:05.000Z",
        nextRetryAt: null,
        scheduledFor: null,
        lastError: null,
        errorCount: 0,
        partitionKey: "task-1",
        sequenceNumber: "12",
        sourceService: "tasks",
        sourceMethod: "createTask",
        sourceVersion: "1.0.0",
        userId: "user-1",
        organizationId: "org-1",
        projectId: "project-1",
        conversationId: null,
        workflowId: null,
      },
    ],
  },
  events: [
    {
      id: "evt-1",
      correlationId: "corr-1",
      causationId: null,
      sagaId: null,
      eventType: "task.created",
      aggregateType: "task",
      aggregateId: "task-1",
      eventVersion: 1,
      payload: { title: "Task one" },
      headers: { source: "api" },
      status: "PUBLISHED" as const,
      retryCount: 0,
      maxRetries: 3,
      createdAt: "2026-03-10T00:00:00.000Z",
      processedAt: "2026-03-10T00:00:05.000Z",
      nextRetryAt: null,
      scheduledFor: null,
      lastError: null,
      errorCount: 0,
      partitionKey: "task-1",
      sequenceNumber: "12",
      sourceService: "tasks",
      sourceMethod: "createTask",
      sourceVersion: "1.0.0",
      userId: "user-1",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: null,
      workflowId: null,
    },
  ],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
  ...overrides,
});

describe("OutboxEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOutboxEventsMock.mockReturnValue(buildHookResult());
  });

  it("renders loading state", () => {
    useOutboxEventsMock.mockReturnValue(
      buildHookResult({
        isLoading: true,
      })
    );

    render(<OutboxEvents entityId="task-1" entityType="task" />);

    expect(screen.getByTestId("outbox-events-loading")).toBeInTheDocument();
  });

  it("renders error state", () => {
    useOutboxEventsMock.mockReturnValue(
      buildHookResult({
        error: new Error("Failed to fetch outbox events"),
      })
    );

    render(<OutboxEvents entityId="task-1" entityType="task" />);

    expect(screen.getByTestId("outbox-events-error")).toHaveTextContent(
      "Failed to fetch outbox events"
    );
  });

  it("renders empty state", () => {
    useOutboxEventsMock.mockReturnValue(
      buildHookResult({
        data: {
          entityType: "task",
          entityId: "task-1",
          count: 0,
          events: [],
        },
        events: [],
      })
    );

    render(<OutboxEvents entityId="task-1" entityType="task" />);

    expect(screen.getByTestId("outbox-events-empty")).toBeInTheDocument();
  });

  it("renders the event summary and payload details", () => {
    render(<OutboxEvents entityId="task-1" entityType="task" />);

    expect(useOutboxEventsMock).toHaveBeenCalledWith("task", "task-1");
    expect(screen.getByTestId("outbox-events")).toBeInTheDocument();
    expect(screen.getByTestId("outbox-events-summary")).toHaveTextContent(
      "1 event"
    );
    expect(screen.getByTestId("outbox-event-evt-1")).toBeInTheDocument();
    expect(screen.getByText("task.created")).toBeInTheDocument();
  });
});
