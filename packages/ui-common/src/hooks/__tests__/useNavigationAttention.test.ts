import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useNavigationAttention } from "../useNavigationAttention";

describe("useNavigationAttention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should track on initial mount after 3 second debounce", () => {
    const trackMock = vi.fn();
    renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    expect(trackMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3100);

    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "attention",
        entity: {
          type: "task",
          id: "task-123",
        },
      })
    );
  });

  it("should debounce rapid navigation changes", () => {
    const trackMock = vi.fn();
    const { rerender } = renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    rerender({
      entityType: "task" as const,
      entityId: "task-456",
      trackAttention: trackMock,
    });

    rerender({
      entityType: "initiative" as const,
      entityId: "init-789",
      trackAttention: trackMock,
    });

    expect(trackMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3100);

    expect(trackMock).toHaveBeenCalledOnce();
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "attention",
        entity: {
          type: "initiative",
          id: "init-789",
        },
      })
    );
  });

  it("should not fire event if entity does not change", () => {
    const trackMock = vi.fn();
    const { rerender } = renderHook(
      ({ entityType, entityId, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          trackAttention: trackMock,
        },
      }
    );

    // Let the initial mount fire
    vi.advanceTimersByTime(3100);
    trackMock.mockClear();

    // Re-render with same entity
    rerender({
      entityType: "task" as const,
      entityId: "task-123",
      trackAttention: trackMock,
    });

    vi.advanceTimersByTime(3100);

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("should include tab field when provided", () => {
    const trackMock = vi.fn();
    renderHook(
      ({ entityType, entityId, tab, trackAttention }) =>
        useNavigationAttention(entityType, entityId, trackAttention, tab),
      {
        initialProps: {
          entityType: "task" as const,
          entityId: "task-123",
          tab: "editor",
          trackAttention: trackMock,
        },
      }
    );

    vi.advanceTimersByTime(3100);

    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tab: "editor",
      })
    );
  });
});
