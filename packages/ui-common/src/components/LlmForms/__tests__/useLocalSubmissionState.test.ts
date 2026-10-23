import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalSubmissionState } from "../useLocalSubmissionState";
import * as conversationEventsModule from "../../Conversation/hooks/useConversationEvents";

describe("useLocalSubmissionState", () => {
  let mockEmit: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockOff: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOn = vi.fn((eventType, handler) => {
      // Return unsubscribe function
      return vi.fn();
    });
    mockOff = vi.fn();

    vi.spyOn(conversationEventsModule, "useConversationEvents").mockReturnValue(
      {
        emit: mockEmit,
        on: mockOn,
        off: mockOff,
        cleanup: vi.fn(),
        getHandlersCount: vi.fn(),
      } as unknown as ReturnType<
        typeof conversationEventsModule.useConversationEvents
      >
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with hasLocallySubmitted as false", () => {
    const { result } = renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: false,
        conversationId: "test-123",
      })
    );

    expect(result.current.hasLocallySubmitted).toBe(false);
    expect(result.current.effectiveIsSubmitted).toBe(false);
  });

  it("should compute effectiveIsSubmitted correctly when neither state is true", () => {
    const { result } = renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: false,
        conversationId: "test-123",
      })
    );

    expect(result.current.effectiveIsSubmitted).toBe(false);
  });

  it("should compute effectiveIsSubmitted correctly when parent isSubmitted is true", () => {
    const { result } = renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: true,
        conversationId: "test-123",
      })
    );

    expect(result.current.effectiveIsSubmitted).toBe(true);
  });

  it("should compute effectiveIsSubmitted correctly when local state is true", () => {
    const { result } = renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: false,
        conversationId: "test-123",
      })
    );

    act(() => {
      result.current.setHasLocallySubmitted(true);
    });

    expect(result.current.hasLocallySubmitted).toBe(true);
    expect(result.current.effectiveIsSubmitted).toBe(true);
  });

  it("should register submission-error event listener", () => {
    renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: false,
        conversationId: "test-123",
      })
    );

    expect(mockOn).toHaveBeenCalledWith(
      "submission-error",
      expect.any(Function)
    );
  });

  it("should keep local state submitted through submission-success, bridging until parent updates", () => {
    const { result, rerender } = renderHook(
      ({ isSubmitted, conversationId }) =>
        useLocalSubmissionState({ isSubmitted, conversationId }),
      {
        initialProps: {
          isSubmitted: false,
          conversationId: "test-123",
        },
      }
    );

    act(() => {
      result.current.setHasLocallySubmitted(true);
    });

    expect(result.current.hasLocallySubmitted).toBe(true);
    expect(result.current.effectiveIsSubmitted).toBe(true);

    // The hook does not subscribe to submission-success, so a successful
    // submit leaves local state intact instead of un-submitting the form.
    expect(mockOn).not.toHaveBeenCalledWith(
      "submission-success",
      expect.any(Function)
    );

    // Local state bridges the submitted UI until the parent prop catches up.
    rerender({ isSubmitted: true, conversationId: "test-123" });

    expect(result.current.hasLocallySubmitted).toBe(true);
    expect(result.current.effectiveIsSubmitted).toBe(true);
  });

  it("should reset local state on submission-error event", () => {
    let errorHandler: ((event: unknown) => void) | null = null;

    mockOn.mockImplementation((eventType, handler) => {
      if (eventType === "submission-error") {
        errorHandler = handler;
      }
      return vi.fn();
    });

    const { result } = renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: false,
        conversationId: "test-123",
      })
    );

    act(() => {
      result.current.setHasLocallySubmitted(true);
    });

    expect(result.current.hasLocallySubmitted).toBe(true);

    // Trigger error event
    if (errorHandler) {
      act(() => {
        errorHandler({});
      });
    }

    expect(result.current.hasLocallySubmitted).toBe(false);
  });

  it("should reset local state when parent isSubmitted becomes false", () => {
    const { result, rerender } = renderHook(
      ({ isSubmitted, conversationId }) =>
        useLocalSubmissionState({ isSubmitted, conversationId }),
      {
        initialProps: {
          isSubmitted: false,
          conversationId: "test-123",
        },
      }
    );

    // Set local state to true
    act(() => {
      result.current.setHasLocallySubmitted(true);
    });

    expect(result.current.hasLocallySubmitted).toBe(true);

    // Update parent prop to true, then back to false
    rerender({ isSubmitted: true, conversationId: "test-123" });
    rerender({ isSubmitted: false, conversationId: "test-123" });

    expect(result.current.hasLocallySubmitted).toBe(false);
  });

  it("should return unsubscribe function from the event listener", () => {
    const unsubscribe = vi.fn();

    mockOn.mockImplementation(() => unsubscribe);

    const { unmount } = renderHook(() =>
      useLocalSubmissionState({
        isSubmitted: false,
        conversationId: "test-123",
      })
    );

    act(() => {
      unmount();
    });

    expect(unsubscribe).toHaveBeenCalled();
  });
});
