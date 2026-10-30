import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockedFunction } from "vitest";
import { useConversationSubmission } from "../useConversationSubmission";
import { useConversationEvents } from "../useConversationEvents";
import { createVersionAwareUserMessage } from "../../../../utils/conversationVersionHelpers";
import { useRetryWithBackoff } from "../../../../hooks/useRetryWithBackoff";
import { logVersionInfo } from "../../../../utils/versionUtils";
import { isVersionConflictError } from "../../../../types/conversation";
import type {
  ConversationResponseDto,
  ProjectResponseDto,
} from "../../../../api";
import { MessageType, MessageStatus } from "../../../../api";

// Mock dependencies
const mockApiClient = vi.hoisted(() => ({
  postMessage: vi.fn(),
})) as { postMessage: ReturnType<typeof vi.fn> };

type RetryWithBackoffFn = ReturnType<
  typeof useRetryWithBackoff
>["retryWithBackoff"];

const mockRetryWithBackoff = vi.hoisted(() =>
  vi.fn(),
) as MockedFunction<RetryWithBackoffFn>;
const mockPersistMessage = vi.hoisted(() => vi.fn());
const mockSubmitWorkflowAnswer = vi.hoisted(() => vi.fn());
const mockUseConversationMessages = vi.hoisted(() => vi.fn());

vi.mock("../useConversationEvents");
vi.mock("../../../../hooks/useRetryWithBackoff", () => ({
  useRetryWithBackoff: () => ({
    retryWithBackoff: mockRetryWithBackoff,
  }),
}));
vi.mock("../../../../clients/client", () => ({
  apiClient: mockApiClient,
}));
vi.mock(
  "../../../../data/hooks/submitControllerAuthorizedWorkflowAnswer",
  () => ({
    submitControllerAuthorizedWorkflowAnswer: mockSubmitWorkflowAnswer,
  }),
);
vi.mock("../../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: mockUseConversationMessages,
}));
vi.mock("../../../../utils/conversationVersionHelpers");
vi.mock("../../../../utils/versionUtils");
vi.mock("../../../../types/conversation");

const mockUseConversationEvents = useConversationEvents as MockedFunction<
  typeof useConversationEvents
>;
const mockCreateVersionAwareUserMessage =
  createVersionAwareUserMessage as MockedFunction<
    typeof createVersionAwareUserMessage
  >;
const mockLogVersionInfo = logVersionInfo as MockedFunction<
  typeof logVersionInfo
>;
const mockIsVersionConflictError = isVersionConflictError as MockedFunction<
  typeof isVersionConflictError
>;

describe("useConversationSubmission", () => {
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

  const mockEmit = vi.fn();
  const mockOn = vi.fn();
  const mockSmartPolling = {
    triggerAggressivePolling: vi.fn(),
  };

  const defaultProps = {
    activeConversation: mockConversation,
    project: mockProject,
    onPersistMessage: mockPersistMessage,
    onConversationUpdated: undefined,
    agentSessionId: "agent-session-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseConversationMessages.mockReturnValue({ data: [], orderedData: [] });
    mockPersistMessage.mockImplementation((message) =>
      mockApiClient.postMessage({ postMessageRequest: message }),
    );

    // Mock useConversationEvents
    mockUseConversationEvents.mockReturnValue({
      emit: mockEmit,
      on: mockOn,
      off: vi.fn(),
      cleanup: vi.fn(),
      getHandlersCount: vi.fn().mockReturnValue(0),
    });

    // Mock event subscriptions
    mockOn.mockImplementation(() => vi.fn());

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

    mockRetryWithBackoff.mockImplementation(async (fn) => await fn());
    mockIsVersionConflictError.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should initialize with default state", () => {
    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    expect(result.current.isSubmitting).toBe(false);
    expect(result.current.versionConflictDialog).toBeNull();
    expect(typeof result.current.handleNext).toBe("function");
    expect(typeof result.current.handleRetrySuccess).toBe("function");
    expect(typeof result.current.handleAnalysisAcknowledged).toBe("function");
  });

  it("should set up event listeners on mount", () => {
    renderHook(() => useConversationSubmission(defaultProps));

    // Should register for version-conflict and retry-requested events
    expect(mockOn).toHaveBeenCalledTimes(2);
    expect(mockOn).toHaveBeenCalledWith(
      "version-conflict",
      expect.any(Function),
    );
    expect(mockOn).toHaveBeenCalledWith(
      "retry-requested",
      expect.any(Function),
    );
  });

  it("should handle successful form submission", async () => {
    mockApiClient.postMessage.mockResolvedValueOnce({ id: "msg-1" } as any);

    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    await act(async () => {
      await result.current.handleNext({ field: "value" }, "parent-id");
    });

    expect(result.current.isSubmitting).toBe(false);
    expect(mockCreateVersionAwareUserMessage).toHaveBeenCalledWith(
      { field: "value" },
      "parent-id",
      mockConversation,
      "project-1",
      undefined,
    );
    expect(mockRetryWithBackoff).toHaveBeenCalled();
    expect(mockPersistMessage).toHaveBeenCalledWith(expect.any(Object));
    expect(mockApiClient.postMessage).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-success",
      payload: { messageId: "parent-id", data: { field: "value" } },
    });
  });

  it("should handle submission with a persistence callback", async () => {
    const onPersistMessage = vi.fn().mockResolvedValue({ id: "msg-1" });
    const props = { ...defaultProps, onPersistMessage };

    const { result } = renderHook(() => useConversationSubmission(props));

    await act(async () => {
      await result.current.handleNext({ field: "value" }, "parent-id");
    });

    expect(onPersistMessage).toHaveBeenCalledWith(expect.any(Object));
    expect(mockApiClient.postMessage).not.toHaveBeenCalled();
  });

  it("routes a feature-owned structured submission without nested authorization", async () => {
    const onDirectTrigger = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useConversationSubmission({ ...defaultProps, onDirectTrigger }),
    );

    await act(async () => {
      await result.current.handleNext({ field: "value" }, "parent-id");
    });

    expect(onDirectTrigger).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        parentMessageId: "parent-id",
      }),
    );
    expect(mockPersistMessage).not.toHaveBeenCalled();
    expect(mockApiClient.postMessage).not.toHaveBeenCalled();
  });

  it("routes every onboarding answer through the explicit onboarding owner", async () => {
    const onSubmitOnboardingReply = vi.fn().mockResolvedValue(undefined);
    const onboardingConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "onboarding",
      version: 4,
    };
    const answers = {
      project_concept: "A graph-backed project workspace",
      choice: "CREATE_INITIATIVE",
      review: {
        action: "APPROVED",
        payload: { name: "Project discovery" },
      },
    };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: onboardingConversation,
        onSubmitOnboardingReply,
      }),
    );

    await act(async () => {
      await result.current.handleNext(answers, "parent-id");
    });

    expect(onSubmitOnboardingReply).toHaveBeenCalledWith({
      parentMessageId: "parent-id",
      answers,
    });
    expect(mockPersistMessage).not.toHaveBeenCalled();
    expect(mockSubmitWorkflowAnswer).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-success",
      payload: { messageId: "parent-id", data: answers },
    });
  });

  describe("awaiting workflow progress after an accepted onboarding reply", () => {
    const onboardingConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "onboarding",
      version: 4,
    };
    const prompt = {
      id: "parent-id",
      type: MessageType.System,
      status: MessageStatus.Completed,
      awaitingResponse: true,
      data: {},
      responses: [],
    } as any;
    const persistedReply = {
      id: "reply-1",
      type: MessageType.User,
      status: MessageStatus.Completed,
      parentMessageId: "parent-id",
      data: {},
    } as any;
    const setMessages = (
      tree: readonly unknown[],
      ordered: readonly unknown[],
    ) => {
      mockUseConversationMessages.mockReturnValue({
        data: tree,
        orderedData: ordered,
      });
    };

    it("stays locked through a stale refetch until the reply is persisted", async () => {
      setMessages([prompt], [prompt]);
      const onSubmitOnboardingReply = vi.fn().mockResolvedValue(undefined);
      const onConversationUpdated = vi.fn().mockResolvedValue(undefined);
      const { result, rerender } = renderHook(() =>
        useConversationSubmission({
          ...defaultProps,
          activeConversation: onboardingConversation,
          onSubmitOnboardingReply,
          onConversationUpdated,
        }),
      );

      await act(async () => {
        await result.current.handleNext({ answer: "yes" }, "parent-id");
      });
      expect(onConversationUpdated).toHaveBeenCalled();
      expect(result.current.isSubmitting).toBe(true);

      // Stale refetch: same content, new references.
      setMessages([{ ...prompt }], [{ ...prompt }]);
      rerender();
      expect(result.current.isSubmitting).toBe(true);

      const answered = { ...prompt, responses: [persistedReply] };
      setMessages([answered], [answered, persistedReply]);
      rerender();
      expect(result.current.isSubmitting).toBe(false);

      // Progress clears the marker durably.
      setMessages([prompt], [prompt]);
      rerender();
      expect(result.current.isSubmitting).toBe(false);
    });

    it("stays locked when workflow activity lands before the reply", async () => {
      setMessages([prompt], [prompt]);
      const { result, rerender } = renderHook(() =>
        useConversationSubmission({
          ...defaultProps,
          activeConversation: onboardingConversation,
          onSubmitOnboardingReply: vi.fn().mockResolvedValue(undefined),
        }),
      );

      await act(async () => {
        await result.current.handleNext({ answer: "yes" }, "parent-id");
      });
      expect(result.current.isSubmitting).toBe(true);

      // The prompt stops awaiting and a processing message arrives before the
      // persisted reply; the form still reads as unanswered, so stay locked.
      const settled = { ...prompt, awaitingResponse: false };
      const processing = {
        id: "processing-1",
        type: MessageType.System,
        status: MessageStatus.Completed,
        data: {},
        responses: [],
      } as any;
      setMessages([settled, processing], [settled, processing]);
      rerender();
      expect(result.current.isSubmitting).toBe(true);

      const answered = { ...settled, responses: [persistedReply] };
      setMessages(
        [answered, processing],
        [answered, persistedReply, processing],
      );
      rerender();
      expect(result.current.isSubmitting).toBe(false);
    });

    it("unlocks when the workflow fails", async () => {
      setMessages([prompt], [prompt]);
      const props = {
        ...defaultProps,
        activeConversation: onboardingConversation,
        onSubmitOnboardingReply: vi.fn().mockResolvedValue(undefined),
      };
      const { result, rerender } = renderHook(
        (p: typeof props) => useConversationSubmission(p),
        { initialProps: props },
      );

      await act(async () => {
        await result.current.handleNext({ answer: "yes" }, "parent-id");
      });
      expect(result.current.isSubmitting).toBe(true);

      rerender({
        ...props,
        activeConversation: { ...onboardingConversation, status: "FAILED" },
      });
      expect(result.current.isSubmitting).toBe(false);
    });

    it("unlocks immediately when the reply is rejected", async () => {
      setMessages([prompt], [prompt]);
      const onSubmitOnboardingReply = vi
        .fn()
        .mockRejectedValue(new Error("409 stale reply"));
      const { result } = renderHook(() =>
        useConversationSubmission({
          ...defaultProps,
          activeConversation: onboardingConversation,
          onSubmitOnboardingReply,
        }),
      );

      await act(async () => {
        await result.current.handleNext({ answer: "yes" }, "parent-id");
      });

      expect(result.current.isSubmitting).toBe(false);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "submission-error" }),
      );
    });
  });

  it("routes repository import answers only through the import owner", async () => {
    const onSubmitRepositoryImportReply = vi.fn().mockResolvedValue(undefined);
    const repositoryImportConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "repository-import",
      version: 6,
    };
    const answers = { repository_action: { action: "start" as const } };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: repositoryImportConversation,
        onSubmitRepositoryImportReply,
      }),
    );

    await act(async () => {
      await result.current.handleNext(answers, "parent-id");
    });

    expect(onSubmitRepositoryImportReply).toHaveBeenCalledWith({
      parentMessageId: "parent-id",
      expectedConversationVersion: 6,
      answers,
    });
    expect(mockPersistMessage).not.toHaveBeenCalled();
    expect(mockSubmitWorkflowAnswer).not.toHaveBeenCalled();
  });

  describe("repository import enrichment reply", () => {
    const enrichmentConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "repository-import",
    };
    const enrichmentQuestion = {
      id: "parent-id",
      type: MessageType.System,
      data: {
        uiElements: [
          {
            id: "reply",
            type: "repository_feature_enrichment_reply",
            submitText: "Send",
          },
        ],
      },
      responses: [],
    };

    beforeEach(() => {
      mockUseConversationMessages.mockReturnValue({
        data: [enrichmentQuestion],
        orderedData: [enrichmentQuestion],
      });
    });

    it("sends the answer as an ordinary message the CLI reads as userMessage, not as an import reply", async () => {
      const onSubmitRepositoryImportReply = vi.fn();
      const onDirectTrigger = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useConversationSubmission({
          ...defaultProps,
          activeConversation: enrichmentConversation,
          onSubmitRepositoryImportReply,
          onDirectTrigger,
        }),
      );

      await act(async () => {
        await result.current.handleNext(
          { "repository-feature-enrichment-reply": "  It powers billing.  " },
          "parent-id",
        );
      });

      expect(onSubmitRepositoryImportReply).not.toHaveBeenCalled();
      expect(onDirectTrigger).toHaveBeenCalledTimes(1);
      expect(
        mockCreateVersionAwareUserMessage.mock.calls[0]?.[0],
      ).toMatchObject({ agentInput: { userMessage: "It powers billing." } });
    });

    it("unlocks immediately when the answer is rejected", async () => {
      const onDirectTrigger = vi.fn().mockRejectedValue(new Error("rejected"));
      const { result } = renderHook(() =>
        useConversationSubmission({
          ...defaultProps,
          activeConversation: enrichmentConversation,
          onDirectTrigger,
        }),
      );

      await act(async () => {
        await result.current.handleNext({ reply: "answer" }, "parent-id");
      });

      expect(result.current.isSubmitting).toBe(false);
    });
  });

  it("fails closed when onboarding has no reply owner", async () => {
    const onDirectTrigger = vi.fn().mockResolvedValue(undefined);
    const onboardingConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "onboarding",
      version: 4,
    };
    const answers = { project_concept: "Keep this draft" };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: onboardingConversation,
        onDirectTrigger,
      }),
    );

    await act(async () => {
      await result.current.handleNext(answers, "parent-id");
    });

    expect(onDirectTrigger).not.toHaveBeenCalled();
    expect(mockPersistMessage).not.toHaveBeenCalled();
    expect(mockSubmitWorkflowAnswer).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-error",
      payload: {
        error: expect.objectContaining({
          message:
            "This onboarding conversation has no reply submission owner.",
        }),
        data: answers,
        parentMessageId: "parent-id",
      },
    });
    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "submission-success" }),
    );
  });

  it("keeps onboarding server rejection on the error rail", async () => {
    const error = new Error("The onboarding form is stale.");
    const onSubmitOnboardingReply = vi.fn().mockRejectedValueOnce(error);
    const onboardingConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "onboarding",
      version: 4,
    };
    const answers = { project_concept: "A draft that must remain editable" };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: onboardingConversation,
        onSubmitOnboardingReply,
      }),
    );

    await act(async () => {
      await result.current.handleNext(answers, "parent-id");
    });

    expect(onSubmitOnboardingReply).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-error",
      payload: { error, data: answers, parentMessageId: "parent-id" },
    });
    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "submission-success" }),
    );
  });

  it("uses the source node supplied with the submission instead of scanning messages", async () => {
    mockSubmitWorkflowAnswer.mockResolvedValue(undefined);
    mockUseConversationMessages.mockReturnValue({
      data: [],
      orderedData: [
        {
          type: MessageType.System,
          data: { nodeId: "latest-system-node" },
        },
      ],
    });
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
        agentSessionId: "agent-session-1",
      }),
    );

    const data = {
      plan: {
        action: "APPROVED",
        payload: {
          responseType: "startup_plan_v1",
          sessionTitle: "Reviewed plan",
        },
      },
      comment: "Approve with this review note.",
    };
    await act(async () => {
      await result.current.handleNext(data, "carrier", {
        nodeId: "feature-sync-coding-plan",
      });
    });

    expect(mockSubmitWorkflowAnswer).toHaveBeenCalledWith({
      operationId: expect.any(String),
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "agent-session-1",
      conversationId: "conv-1",
      workflowName: "feature-sync",
      nodeId: "feature-sync-coding-plan",
      parentMessageId: "carrier",
      action: "APPROVED",
      payload: {
        responseType: "startup_plan_v1",
        sessionTitle: "Reviewed plan",
      },
    });
    expect(mockPersistMessage).not.toHaveBeenCalled();
  });

  it("falls back to the latest system node when the submission has no source node", async () => {
    mockSubmitWorkflowAnswer.mockResolvedValue(undefined);
    mockUseConversationMessages.mockReturnValue({
      data: [],
      orderedData: [
        {
          type: MessageType.System,
          data: { nodeId: "older-system-node" },
        },
        {
          type: MessageType.User,
          data: { message: "A follow-up" },
        },
        {
          type: MessageType.System,
          data: { nodeId: " latest-system-node " },
        },
      ],
    });
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
      }),
    );

    await act(async () => {
      await result.current.handleNext(
        { review: { action: "DONE", payload: {} } },
        "review-system-message",
      );
    });

    expect(mockSubmitWorkflowAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: "latest-system-node" }),
    );
  });

  it("sends the selected workflow field payload instead of the field-keyed form state", async () => {
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };
    const data = {
      reviewField: {
        action: "REFINE",
        payload: { feedback: "2" },
      },
    };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
      }),
    );

    await act(async () => {
      await result.current.handleNext(data, "review-system-message", {
        nodeId: "feature-sync-review",
      });
    });

    expect(mockSubmitWorkflowAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REFINE",
        payload: { feedback: "2" },
      }),
    );
  });

  it("rejects a legacy decision envelope without advancing the workflow", async () => {
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };
    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
      }),
    );

    await act(async () => {
      await expect(
        result.current.handleNext(
          { plan: { decision: "approve" } },
          "review-system-message",
        ),
      ).rejects.toThrow(/explicit action and object payload/i);
    });

    expect(mockSubmitWorkflowAnswer).not.toHaveBeenCalled();
    expect(mockPersistMessage).not.toHaveBeenCalled();
  });

  it("forwards an explicit unknown action for server rejection without direct message fallback", async () => {
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };
    mockSubmitWorkflowAnswer.mockRejectedValueOnce(
      new Error("Unknown workflow action"),
    );
    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
      }),
    );

    await act(async () => {
      await result.current.handleNext(
        { review: { action: "UNKNOWN", payload: {} } },
        "review-system-message",
        { nodeId: "feature-sync-review" },
      );
    });

    expect(mockSubmitWorkflowAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ action: "UNKNOWN", payload: {} }),
    );
    expect(mockPersistMessage).not.toHaveBeenCalled();
  });

  it("routes a reply to a completed plan-shaping discrepancy through the active workflow", async () => {
    const onDirectTrigger = vi.fn().mockResolvedValue(undefined);
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };
    const submittedData = { guidance: "  Keep the stages outcome-focused.  " };
    const workflowAwareData = {
      ...submittedData,
      agentInput: {
        promptType: "workflow-defined",
        userMessage: "Keep the stages outcome-focused.",
      },
    };
    mockCreateVersionAwareUserMessage.mockReturnValueOnce({
      workflowId: "workflow-1",
      projectId: "project-1",
      data: workflowAwareData,
      type: MessageType.User,
      conversationId: "conv-1",
      status: MessageStatus.Completed,
      parentMessageId: "parent-id",
      expectedConversationVersion: 1,
    });

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
        onDirectTrigger,
      }),
    );

    await act(async () => {
      await result.current.handleNext(submittedData, "parent-id");
    });

    expect(mockCreateVersionAwareUserMessage).toHaveBeenCalledWith(
      workflowAwareData,
      "parent-id",
      workflowConversation,
      "project-1",
      undefined,
    );
    expect(onDirectTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ data: workflowAwareData }),
    );
    expect(mockSubmitWorkflowAnswer).not.toHaveBeenCalled();
    expect(mockPersistMessage).not.toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-success",
      payload: { messageId: "parent-id", data: submittedData },
    });
  });

  it("retains a workflow text draft when no submission owner is available", async () => {
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };
    const submittedData = { guidance: "Keep this draft" };

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
        onPersistMessage: undefined,
        onDirectTrigger: undefined,
      }),
    );

    await act(async () => {
      await result.current.handleNext(submittedData, "parent-id");
    });

    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-error",
      payload: {
        error: expect.objectContaining({
          message: "This conversation has no message submission owner.",
        }),
        data: submittedData,
        parentMessageId: "parent-id",
      },
    });
    expect(mockEmit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "submission-success" }),
    );
    expect(mockSubmitWorkflowAnswer).not.toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("reuses one workflow operation identity across transport retries", async () => {
    const workflowConversation: ConversationResponseDto = {
      ...mockConversation,
      workflowId: "workflow-1",
      workflowName: "feature-sync",
    };
    mockSubmitWorkflowAnswer
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(undefined);
    mockRetryWithBackoff.mockImplementation(async (operation) => {
      try {
        return await operation();
      } catch {
        return operation();
      }
    });

    const { result } = renderHook(() =>
      useConversationSubmission({
        ...defaultProps,
        activeConversation: workflowConversation,
      }),
    );

    await act(async () => {
      await result.current.handleNext(
        { plan: { action: "APPROVED", payload: {} } },
        "parent-id",
        { nodeId: "review-step" },
      );
    });

    expect(mockSubmitWorkflowAnswer).toHaveBeenCalledTimes(2);
    const firstOperationId =
      mockSubmitWorkflowAnswer.mock.calls[0]?.[0].operationId;
    const secondOperationId =
      mockSubmitWorkflowAnswer.mock.calls[1]?.[0].operationId;
    expect(firstOperationId).toBe(secondOperationId);
  });

  it("should call onConversationUpdated after a successful submission", async () => {
    const mockOnConversationUpdated = vi.fn().mockResolvedValue(undefined);
    const props = {
      ...defaultProps,
      onConversationUpdated: mockOnConversationUpdated,
    };

    const { result } = renderHook(() => useConversationSubmission(props));

    await act(async () => {
      await result.current.handleNext({ field: "value" }, "parent-id");
    });

    expect(mockOnConversationUpdated).toHaveBeenCalled();
  });

  it("should handle version conflicts", async () => {
    const versionError = {
      error: "VERSION_CONFLICT",
      message: "Version conflict",
      currentVersion: 2,
      expectedVersion: 1,
      latestConversation: { version: 2 } as any,
    };

    mockIsVersionConflictError.mockReturnValue(true);
    mockRetryWithBackoff.mockRejectedValueOnce(versionError);

    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    await act(async () => {
      await result.current.handleNext({ field: "value" }, "parent-id");
    });

    expect(mockEmit).toHaveBeenCalledWith({
      type: "version-conflict",
      payload: {
        error: versionError,
        retryFn: expect.any(Function),
        originalFormData: { field: "value" },
        parentMessageId: "parent-id",
      },
    });
  });

  it("should handle non-version conflict errors", async () => {
    const error = new Error("Network error");
    mockRetryWithBackoff.mockRejectedValueOnce(error);

    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    await act(async () => {
      await result.current.handleNext({ field: "value" }, "parent-id");
    });

    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-error",
      payload: {
        error,
        data: { field: "value" },
        parentMessageId: "parent-id",
      },
    });
  });

  it("should handle analysis acknowledgment", async () => {
    mockApiClient.postMessage.mockResolvedValueOnce({ id: "ack-msg" } as any);

    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    await act(async () => {
      await result.current.handleAnalysisAcknowledged("message-id");
    });

    expect(mockApiClient.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        postMessageRequest: expect.objectContaining({
          projectId: "project-1",
          data: { message: "acknowledged" },
          type: MessageType.User,
          conversationId: "conv-1",
          status: MessageStatus.Completed,
          parentMessageId: "message-id",
        }),
      }),
    );
    expect(mockEmit).toHaveBeenCalledWith({
      type: "analysis-acknowledged",
      payload: { messageId: "message-id" },
    });
  });

  it("should handle analysis acknowledgment error", async () => {
    const error = new Error("Acknowledgment failed");
    mockApiClient.postMessage.mockRejectedValueOnce(error);

    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    await act(async () => {
      await result.current.handleAnalysisAcknowledged("message-id");
    });

    expect(mockEmit).toHaveBeenCalledWith({
      type: "submission-error",
      payload: {
        error,
        data: { message: "acknowledged" },
        parentMessageId: "message-id",
      },
    });
  });

  it("should handle retry success", async () => {
    const mockOnConversationUpdated = vi.fn().mockResolvedValue(undefined);
    const props = {
      ...defaultProps,
      onConversationUpdated: mockOnConversationUpdated,
    };

    const { result } = renderHook(() => useConversationSubmission(props));

    await act(async () => {
      await result.current.handleRetrySuccess();
    });

    expect(mockOnConversationUpdated).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith({
      type: "retry-success",
      payload: { messageId: "retry-success" },
    });
  });

  it("should handle version conflict events from event system", () => {
    let versionConflictHandler: ((event: any) => void) | undefined;

    mockOn.mockImplementation((eventType, handler) => {
      if (eventType === "version-conflict") {
        versionConflictHandler = handler;
      }
      return vi.fn();
    });

    const { result } = renderHook(() =>
      useConversationSubmission(defaultProps),
    );

    // Simulate version conflict event
    const conflictEvent = {
      type: "version-conflict",
      payload: {
        error: {
          error: "VERSION_CONFLICT",
          expectedVersion: 1,
          currentVersion: 2,
          latestConversation: { version: 2 },
        },
        originalFormData: { field: "value" },
        parentMessageId: "parent-id",
      },
    };

    act(() => {
      versionConflictHandler!(conflictEvent);
    });

    expect(result.current.versionConflictDialog).toMatchObject({
      isOpen: true,
      expectedVersion: 1,
      currentVersion: 2,
      originalFormData: { field: "value" },
    });
  });

  it("should handle retry requests from event system", async () => {
    let retryHandler: ((event: any) => void) | undefined;

    mockOn.mockImplementation((eventType, handler) => {
      if (eventType === "retry-requested") {
        retryHandler = handler;
      }
      return vi.fn();
    });

    renderHook(() => useConversationSubmission(defaultProps));

    const retryEvent = {
      type: "retry-requested",
      payload: {
        data: { retryField: "retryValue" },
        parentId: "retry-parent-id",
      },
    };

    await act(async () => {
      retryHandler!(retryEvent);
    });

    expect(mockCreateVersionAwareUserMessage).toHaveBeenCalledWith(
      { retryField: "retryValue" },
      "retry-parent-id",
      mockConversation,
      "project-1",
      undefined,
    );
  });
});
