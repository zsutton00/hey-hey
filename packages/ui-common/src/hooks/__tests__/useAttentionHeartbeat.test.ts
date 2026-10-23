import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAttentionHeartbeat } from "../useAttentionHeartbeat";

describe("useAttentionHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset document.hidden to false (visible) before each test
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should emit attention event every 30 seconds while tab is visible", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    // Advance to first heartbeat (30s)
    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "attention",
        entity: { type: "task", id: "task-123" },
      })
    );

    // Advance to second heartbeat (30s more)
    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(2);

    // Advance to third heartbeat
    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(3);
  });

  it("should stop emitting when tab becomes hidden", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);

    // Simulate tab becoming hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: true,
    });

    const event = new Event("visibilitychange");
    document.dispatchEvent(event);

    vi.advanceTimersByTime(30000);
    // Should not emit while hidden
    expect(trackMock).toHaveBeenCalledTimes(1);
  });

  it("should resume emitting when tab becomes visible again", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);

    // Hide tab
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(1);

    // Show tab again
    Object.defineProperty(document, "hidden", {
      writable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    vi.advanceTimersByTime(30000);
    expect(trackMock).toHaveBeenCalledTimes(2);
  });

  it("should include tab field when provided", () => {
    const trackMock = vi.fn();

    renderHook(
      ({ entityType, entityId, tab, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention, tab),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          tab: "comments",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(30000);

    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "comments",
      })
    );
  });

  it("should restart timer when entity changes", () => {
    const trackMock = vi.fn();

    const { rerender } = renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useAttentionHeartbeat(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(15000);
    expect(trackMock).not.toHaveBeenCalled();

    // Change entity
    rerender({
      entityType: "initiative" as const,
      entityId: "init-456",
      trackAttention: trackMock,
    });

    // Timer should reset, so we need 30s from this point
    vi.advanceTimersByTime(15000);
    expect(trackMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(15000);
    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: { type: "initiative", id: "init-456" },
      })
    );
  });
});
