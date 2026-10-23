/**
 * Integration tests for Phase 4 conversation hooks
 *
 * Tests the coordination between useConversationEvents, useConversationSubmission,
 * and useConversationScrolling to ensure they work together correctly and
 * break circular dependencies as intended.
 */

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationEvents } from "../useConversationEvents";
import { useConversationSubmission } from "../useConversationSubmission";
import { useConversationScrolling } from "../useConversationScrolling";
import { apiClient } from "../../../../clients/client";
import type {
  ConversationResponseDto,
  ProjectResponseDto,
} from "../../../../api";
import { MessageType, MessageStatus } from "../../../../api";
import type { ConversationMessage } from "../../../../types/conversation";

const mockApiClient = vi.hoisted(() => ({
  postMessage: vi.fn(),
}));
const mockPersistMessage = vi.hoisted(() => vi.fn());
const mockCreateVersionAwareUserMessage = vi.hoisted(() => vi.fn());
const mockCreateOptimisticMessageState = vi.hoisted(() => vi.fn());
const mockRetryWithBackoff = vi.hoisted(() => vi.fn());
const mockIsVersionConflictError = vi.hoisted(() => vi.fn());

// Mock dependencies
vi.mock("../../../../clients/client", () => ({
  apiClient: mockApiClient,
  getApiClient: vi.fn(() => mockApiClient),
  registerApiRuntime: vi.fn(),
  initializeBrowserApiRuntime: vi.fn(),
}));

vi.mock("../../../../utils/conversationVersionHelpers", () => ({
  createVersionAwareUserMessage: mockCreateVersionAwareUserMessage,
  createOptimisticMessageState: mockCreateOptimisticMessageState,
  retryWithBackoff: mockRetryWithBackoff,
  isVersionConflictError: mockIsVersionConflictError,
}));

describe("Conversation Hooks Integration", () => {
  const mockProject: ProjectResponseDto = {
    id: "project-1",
    organizationId: "org-1",
    name: "Test Project",
    description: "Test Description",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockConversation: ConversationResponseDto = {
    id: "conv-1",
    projectId: "project-1",
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockConversationMessage: ConversationMessage = {
    message: {
      id: "msg-1",
      conversationId: "conv-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      type: MessageType.System,
      status: "COMPLETED",
      data: { type: "QUESTIONS" },
      createdAt: "2024-01-01T00:00:00Z",
      parentMessageId: null,
      awaitingResponse: false,
      responses: [],
    },
    state: "completed",
    canEdit: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock utilities
    mockCreateVersionAwareUserMessage.mockReturnValue({
      workflowId: "workflow-1",
      projectId: "project-1",
      data: { test: "data" },
      type: MessageType.User,
      conversationId: "conv-1",
      status: MessageStatus.Completed,
      parentMessageId: "parent-id",
      expectedConversationVersion: 1,
    });

    mockCreateOptimisticMessageState.mockReturnValue({
      parentMessageId: "parent-id",
      formData: { test: "data" },
      status: "sending",
      timestamp: Date.now(),
      expectedVersion: 1,
    });

    mockRetryWithBackoff.mockImplementation(async (fn) => await fn());
    mockIsVersionConflictError.mockReturnValue(false);
    mockApiClient.postMessage.mockResolvedValue({ id: "msg-1" });
    mockPersistMessage.mockImplementation((message) =>
      mockApiClient.postMessage({ postMessageRequest: message })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should coordinate submission and scrolling without circular dependencies", async () => {
    // Setup hooks in separate renders to simulate real usage
    const { result: eventsResult } = renderHook(() => useConversationEvents());

    const { result: submissionResult } = renderHook(() =>
      useConversationSubmission({
        activeConversation: mockConversation,
        project: mockProject,
        agentSessionId: "agent-session-1",
        onPersistMessage: mockPersistMessage,
        onConversationUpdated: undefined,
      })
    );

    const { result: scrollingResult } = renderHook(() =>
      useConversationScrolling({
        conversationId: mockConversation.id,
        scrollPolicy: { mode: "disabled" },
        conversationTimeline: [mockConversationMessage],
      })
    );

    // Test that submission works
    await act(async () => {
      await submissionResult.current.handleNext(
        { field: "value" },
        "parent-id"
      );
    });

    expect(submissionResult.current.isSubmitting).toBe(false);
    expect(mockApiClient.postMessage).toHaveBeenCalled();

    // Test that scrolling works independently
    act(() => {
      scrollingResult.current.handleStepClick(
        1,
        mockConversationMessage.message
      );
    });

    // Test that events system works
    expect(eventsResult.current.getHandlersCount()).toBe(0); // No handlers registered in isolation
  });

  it.skip("should handle version conflicts through event system without circular calls", async () => {
    const versionError = {
      error: "VERSION_CONFLICT",
      message: "Version conflict",
      currentVersion: 2,
      expectedVersion: 1,
      latestConversation: { version: 2 } as any,
    };

    mockIsVersionConflictError.mockReturnValue(true);
    mockRetryWithBackoff.mockRejectedValueOnce(versionError);

    const { result: submissionResult } = renderHook(() =>
      useConversationSubmission({
        activeConversation: mockConversation,
        project: mockProject,
        agentSessionId: "agent-session-1",
        onPersistMessage: mockPersistMessage,
        onConversationUpdated: undefined,
      })
    );

    // This should emit a version-conflict event instead of causing circular calls
    await act(async () => {
      await submissionResult.current.handleNext(
        { field: "value" },
        "parent-id"
      );
    });

    // Should handle the conflict without infinite loops
    expect(submissionResult.current.versionConflictDialog).toMatchObject({
      isOpen: true,
      expectedVersion: 1,
      currentVersion: 2,
    });
  });

  it("reveals once and navigates explicitly without following the form reply", async () => {
    const conversationTimeline = [mockConversationMessage];
    const owner = document.createElement("main");
    const target = document.createElement("article");
    target.dataset.messageId = mockConversationMessage.message.id;
    owner.append(target);
    document.body.append(owner);
    const scrollTo = vi.fn();
    Object.defineProperties(owner, {
      scrollHeight: { configurable: true, value: 1500 },
      clientHeight: { value: 600 },
      scrollTo: { value: scrollTo },
    });
    const ownerRef = { current: owner };

    const { result: submissionResult } = renderHook(() =>
      useConversationSubmission({
        activeConversation: mockConversation,
        project: mockProject,
        agentSessionId: "agent-session-1",
        onPersistMessage: mockPersistMessage,
        onConversationUpdated: undefined,
      })
    );

    const { result: scrollingResult, rerender } = renderHook(
      ({ timeline }) =>
        useConversationScrolling({
          conversationId: mockConversation.id,
          scrollPolicy: { mode: "owned", ownerRef },
          conversationTimeline: timeline,
        }),
      { initialProps: { timeline: conversationTimeline } }
    );

    // Complete the single initial reveal before sending a form response.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 1500,
      behavior: "instant",
    });
    scrollTo.mockClear();

    // Submit form
    await act(async () => {
      await submissionResult.current.handleNext(
        { field: "value" },
        "parent-id"
      );
    });

    // Simulate timeline update after submission
    const newMessage: ConversationMessage = {
      ...mockConversationMessage,
      message: { ...mockConversationMessage.message, id: "msg-2" },
    };

    act(() => {
      rerender({ timeline: [mockConversationMessage, newMessage] });
    });

    // Fast-forward scroll timer
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(mockPersistMessage).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(owner.style.overflowAnchor).toBe("");
    act(() =>
      scrollingResult.current.handleStepClick(
        0,
        mockConversationMessage.message
      )
    );
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 0,
      behavior: "smooth",
    });
    owner.remove();
  });

  it("should handle analysis acknowledgment with proper event coordination", async () => {
    const { result: submissionResult } = renderHook(() =>
      useConversationSubmission({
        activeConversation: mockConversation,
        project: mockProject,
        agentSessionId: "agent-session-1",
        onPersistMessage: mockPersistMessage,
        onConversationUpdated: undefined,
      })
    );

    await act(async () => {
      await submissionResult.current.handleAnalysisAcknowledged(
        "analysis-msg-id"
      );
    });

    expect(mockApiClient.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        postMessageRequest: expect.objectContaining({
          data: { message: "acknowledged" },
          parentMessageId: "analysis-msg-id",
        }),
      })
    );
  });

  it("should handle retry success with proper coordination", async () => {
    const mockOnConversationUpdated = vi.fn().mockResolvedValue(undefined);

    const { result: submissionResult } = renderHook(() =>
      useConversationSubmission({
        activeConversation: mockConversation,
        project: mockProject,
        onPersistMessage: mockPersistMessage,
        onConversationUpdated: mockOnConversationUpdated,
      })
    );

    await act(async () => {
      await submissionResult.current.handleRetrySuccess();
    });

    expect(mockOnConversationUpdated).toHaveBeenCalled();
  });

  it("should prevent infinite loops in development mode", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const { result } = renderHook(() => useConversationEvents());
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Create handler that would cause infinite loop
    const recursiveHandler = vi.fn(() => {
      // This would normally cause infinite recursion
      for (let i = 0; i < 12; i++) {
        result.current.emit({
          type: "submission-success",
          payload: { messageId: `msg-${i}`, data: {} },
        });
      }
    });

    act(() => {
      result.current.on("submission-success", recursiveHandler);
    });

    act(() => {
      result.current.emit({
        type: "submission-success",
        payload: { messageId: "trigger", data: {} },
      });
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Circular event detected!",
      expect.objectContaining({ type: "submission-success" })
    );

    consoleSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });
});
