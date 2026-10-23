import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode, type ReactElement } from "react";
import { outboxEventKeys } from "../collections/outboxEvents";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDebugEventReplay } from "./useDebugEventReplay";

const { replayDebugEvents } = vi.hoisted(() => ({
  replayDebugEvents: vi.fn(),
}));
let client: QueryClient;
let wrapper: ({ children }: { children: ReactNode }) => ReactElement;
let invalidation: ReturnType<typeof vi.spyOn>;
vi.mock("../../clients/serviceClients", () => ({
  eventsClient: { replayDebugEvents },
}));

const response = {
  total: 1,
  truncated: false,
  results: [
    {
      originalEventId: "event-1",
      replayEventId: null,
      eventType: "task.created",
      validationStatus: "VALID" as const,
      fixStatus: "NOT_REQUESTED" as const,
      queueStatus: "NOT_REQUESTED" as const,
      error: null,
    },
  ],
};

describe("useDebugEventReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replayDebugEvents.mockResolvedValue({
      data: { data: response, message: "ok" },
    });
    client = new QueryClient();
    wrapper = ({ children }) =>
      createElement(QueryClientProvider, { client }, children);
    invalidation = vi.spyOn(client, "invalidateQueries");
  });

  it("sends the generated request and leaves outbox data alone for validation", async () => {
    const { result } = renderHook(
      () => useDebugEventReplay({ entityId: "task-1", entityType: "task" }),
      { wrapper }
    );

    await act(async () => {
      await result.current.replay({
        eventId: "event-1",
        mode: "VALIDATE_ONLY",
        projectId: "project-1",
      });
    });

    expect(replayDebugEvents).toHaveBeenCalledWith({
      debugEventReplayRequestDto: {
        eventId: "event-1",
        mode: "VALIDATE_ONLY",
        projectId: "project-1",
      },
    });
    expect(invalidation).not.toHaveBeenCalled();
    expect(result.current.data).toEqual(response);
  });

  it.each(["REEMIT_ORIGINAL", "ATTEMPT_FIX_AND_REEMIT"] as const)(
    "refreshes the scoped outbox collection after %s",
    async (mode) => {
      const { result } = renderHook(
        () => useDebugEventReplay({ entityId: "task-1", entityType: "task" }),
        { wrapper }
      );

      await act(async () => {
        await result.current.replay({
          eventId: "event-1",
          mode,
          projectId: "project-1",
        });
      });

      expect(invalidation).toHaveBeenCalledWith({
        queryKey: outboxEventKeys.entity("task", "task-1"),
        exact: true,
      });
    }
  );

  it("preserves a successful replay result when the outbox refresh fails", async () => {
    invalidation.mockRejectedValueOnce(new Error("Refresh failed"));
    const { result } = renderHook(
      () => useDebugEventReplay({ entityId: "task-1", entityType: "task" }),
      { wrapper }
    );

    await act(async () => {
      await expect(
        result.current.replay({
          eventId: "event-1",
          mode: "REEMIT_ORIGINAL",
          projectId: "project-1",
        })
      ).resolves.toEqual(response);
    });

    expect(result.current.data).toEqual(response);
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("clears a previous result before starting another replay", async () => {
    const { result } = renderHook(
      () => useDebugEventReplay({ entityId: "task-1", entityType: "task" }),
      { wrapper }
    );

    await act(async () => {
      await result.current.replay({
        eventId: "event-1",
        mode: "VALIDATE_ONLY",
        projectId: "project-1",
      });
    });
    expect(result.current.data).toEqual(response);

    replayDebugEvents.mockRejectedValueOnce(new Error("Replay failed"));
    await act(async () => {
      await expect(
        result.current.replay({
          eventId: "event-1",
          mode: "VALIDATE_ONLY",
          projectId: "project-1",
        })
      ).rejects.toThrow("Replay failed");
    });

    expect(result.current.data).toBeNull();
  });

  it("exposes a bounded error when the response has no result payload", async () => {
    replayDebugEvents.mockResolvedValue({
      data: { data: undefined, message: "Replay unavailable" },
    });
    const { result } = renderHook(
      () => useDebugEventReplay({ entityId: "task-1", entityType: "task" }),
      { wrapper }
    );

    await act(async () => {
      await expect(
        result.current.replay({
          eventId: "event-1",
          mode: "VALIDATE_ONLY",
          projectId: "project-1",
        })
      ).rejects.toThrow("Replay unavailable");
    });

    expect(result.current.error).toEqual(new Error("Replay unavailable"));
  });
});
