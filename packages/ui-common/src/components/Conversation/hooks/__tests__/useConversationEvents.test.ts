import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationEvents } from "../useConversationEvents";
import type { ConversationEvent } from "../useConversationEvents";

describe("useConversationEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset NODE_ENV for each test
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    // Cleanup console spies
    vi.restoreAllMocks();
  });

  it("should initialize with empty handlers", () => {
    const { result } = renderHook(() => useConversationEvents());

    expect(result.current.getHandlersCount()).toBe(0);
  });

  it("should register event handlers", () => {
    const { result } = renderHook(() => useConversationEvents());
    const mockHandler = vi.fn();

    act(() => {
      const unsubscribe = result.current.on("submission-success", mockHandler);
      expect(typeof unsubscribe).toBe("function");
    });

    expect(result.current.getHandlersCount()).toBe(1);
  });

  it("should emit events to registered handlers", () => {
    const { result } = renderHook(() => useConversationEvents());
    const mockHandler = vi.fn();

    act(() => {
      result.current.on("submission-success", mockHandler);
    });

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: { field: "value" } },
    };

    act(() => {
      result.current.emit(testEvent);
    });

    expect(mockHandler).toHaveBeenCalledWith(testEvent);
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });

  it("should handle multiple handlers for the same event type", () => {
    const { result } = renderHook(() => useConversationEvents());
    const mockHandler1 = vi.fn();
    const mockHandler2 = vi.fn();

    act(() => {
      result.current.on("submission-success", mockHandler1);
      result.current.on("submission-success", mockHandler2);
    });

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: { field: "value" } },
    };

    act(() => {
      result.current.emit(testEvent);
    });

    expect(mockHandler1).toHaveBeenCalledWith(testEvent);
    expect(mockHandler2).toHaveBeenCalledWith(testEvent);
    expect(mockHandler1).toHaveBeenCalledTimes(1);
    expect(mockHandler2).toHaveBeenCalledTimes(1);
  });

  it("should handle different event types independently", () => {
    const { result } = renderHook(() => useConversationEvents());
    const successHandler = vi.fn();
    const errorHandler = vi.fn();

    act(() => {
      result.current.on("submission-success", successHandler);
      result.current.on("submission-error", errorHandler);
    });

    const successEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "success-id", data: {} },
    };

    const errorEvent: ConversationEvent = {
      type: "submission-error",
      payload: {
        error: new Error("test"),
        data: {},
        parentMessageId: "parent-id",
      },
    };

    act(() => {
      result.current.emit(successEvent);
    });

    expect(successHandler).toHaveBeenCalledWith(successEvent);
    expect(errorHandler).not.toHaveBeenCalled();

    act(() => {
      result.current.emit(errorEvent);
    });

    expect(errorHandler).toHaveBeenCalledWith(errorEvent);
    expect(successHandler).toHaveBeenCalledTimes(1); // Still only called once
  });

  it("should unsubscribe handlers correctly", () => {
    const { result } = renderHook(() => useConversationEvents());
    const mockHandler = vi.fn();

    let unsubscribe: (() => void) | undefined;
    act(() => {
      unsubscribe = result.current.on("submission-success", mockHandler);
    });

    expect(result.current.getHandlersCount()).toBe(1);

    act(() => {
      unsubscribe!();
    });

    expect(result.current.getHandlersCount()).toBe(0);

    // Emit event after unsubscribe - should not call handler
    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: {} },
    };

    act(() => {
      result.current.emit(testEvent);
    });

    expect(mockHandler).not.toHaveBeenCalled();
  });

  it("should remove specific handlers with off method", () => {
    const { result } = renderHook(() => useConversationEvents());
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    act(() => {
      result.current.on("submission-success", handler1);
      result.current.on("submission-success", handler2);
    });

    expect(result.current.getHandlersCount()).toBe(1); // One event type

    act(() => {
      result.current.off("submission-success", handler1);
    });

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: {} },
    };

    act(() => {
      result.current.emit(testEvent);
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledWith(testEvent);
  });

  it("should remove all handlers for event type with off method", () => {
    const { result } = renderHook(() => useConversationEvents());
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    act(() => {
      result.current.on("submission-success", handler1);
      result.current.on("submission-success", handler2);
    });

    act(() => {
      result.current.off("submission-success");
    });

    expect(result.current.getHandlersCount()).toBe(0);

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: {} },
    };

    act(() => {
      result.current.emit(testEvent);
    });

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).not.toHaveBeenCalled();
  });

  it("should cleanup all handlers", () => {
    const { result } = renderHook(() => useConversationEvents());
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    act(() => {
      result.current.on("submission-success", handler1);
      result.current.on("submission-error", handler2);
    });

    expect(result.current.getHandlersCount()).toBe(2);

    act(() => {
      result.current.cleanup();
    });

    expect(result.current.getHandlersCount()).toBe(0);
  });

  it("should handle version conflict events", () => {
    const { result } = renderHook(() => useConversationEvents());
    const conflictHandler = vi.fn();

    act(() => {
      result.current.on("version-conflict", conflictHandler);
    });

    const conflictEvent: ConversationEvent = {
      type: "version-conflict",
      payload: {
        error: {
          error: "VERSION_CONFLICT",
          message: "Version conflict detected",
          currentVersion: 2,
          expectedVersion: 1,
          latestConversation: {} as any,
        },
        retryFn: vi.fn(),
        originalFormData: { field: "value" },
        parentMessageId: "parent-id",
      },
    };

    act(() => {
      result.current.emit(conflictEvent);
    });

    expect(conflictHandler).toHaveBeenCalledWith(conflictEvent);
  });

  it("should handle optimistic update events", () => {
    const { result } = renderHook(() => useConversationEvents());
    const updateHandler = vi.fn();

    act(() => {
      result.current.on("optimistic-update", updateHandler);
    });

    const updateEvent: ConversationEvent = {
      type: "optimistic-update",
      payload: {
        status: "sending",
        messageId: "msg-id",
      },
    };

    act(() => {
      result.current.emit(updateEvent);
    });

    expect(updateHandler).toHaveBeenCalledWith(updateEvent);
  });

  it("should gracefully handle errors in event handlers", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useConversationEvents());

    const errorHandler = vi.fn().mockImplementation(() => {
      throw new Error("Handler error");
    });
    const successHandler = vi.fn();

    act(() => {
      result.current.on("submission-success", errorHandler);
      result.current.on("submission-success", successHandler);
    });

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: {} },
    };

    act(() => {
      result.current.emit(testEvent);
    });

    // Both handlers should be called, even if one throws
    expect(errorHandler).toHaveBeenCalledWith(testEvent);
    expect(successHandler).toHaveBeenCalledWith(testEvent);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Error in event handler for submission-success:",
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("should handle events without circular detection in non-development mode", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const { result } = renderHook(() => useConversationEvents());
    const handler = vi.fn();

    act(() => {
      result.current.on("submission-success", handler);
    });

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test", data: {} },
    };

    // Should not throw in production
    expect(() => {
      act(() => {
        result.current.emit(testEvent);
      });
    }).not.toThrow();

    expect(handler).toHaveBeenCalledWith(testEvent);

    process.env.NODE_ENV = originalEnv;
  });

  it("should handle no handlers for event type gracefully", () => {
    const { result } = renderHook(() => useConversationEvents());

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test", data: {} },
    };

    expect(() => {
      act(() => {
        result.current.emit(testEvent);
      });
    }).not.toThrow();
  });

  it("should share events across hook instances in the same scope", () => {
    const { result: emitter } = renderHook(() =>
      useConversationEvents("conversation-1")
    );
    const { result: subscriber } = renderHook(() =>
      useConversationEvents("conversation-1")
    );
    const handler = vi.fn();

    act(() => {
      subscriber.current.on("submission-success", handler);
    });

    const testEvent: ConversationEvent = {
      type: "submission-success",
      payload: { messageId: "test-id", data: {} },
    };

    act(() => {
      emitter.current.emit(testEvent);
    });

    expect(handler).toHaveBeenCalledWith(testEvent);
  });

  it("should isolate events across different scopes", () => {
    const { result: scopeOne } = renderHook(() =>
      useConversationEvents("conversation-1")
    );
    const { result: scopeTwo } = renderHook(() =>
      useConversationEvents("conversation-2")
    );
    const handler = vi.fn();

    act(() => {
      scopeTwo.current.on("submission-success", handler);
    });

    act(() => {
      scopeOne.current.emit({
        type: "submission-success",
        payload: { messageId: "test-id", data: {} },
      });
    });

    expect(handler).not.toHaveBeenCalled();
  });
});
