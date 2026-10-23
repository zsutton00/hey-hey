import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SystemMessageWithRetry } from "../SystemMessageWithRetry";
import type {
  MessageResponseDto,
  ProjectResponseDto,
  SystemMessageData,
} from "../../../../api";
import { MessageStatus } from "../../../../api";
import * as useMessageRetryModule from "../../../../hooks/useMessageRetry";

// Mock the translation hook
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "common.processing": "Processing...",
        "conversation.systemMessageFailed": "System message failed",
      };
      return translations[key] || key;
    },
  }),
}));

// Mock the retry hook
const mockRetryState = {
  isRetrying: false,
  retry: vi.fn(),
  canRetry: true,
};

vi.mock("../../../../hooks/useMessageRetry", () => ({
  useMessageRetry: vi.fn(() => mockRetryState),
}));

// Mock the SystemMessage component
vi.mock("../SystemMessage", () => ({
  SystemMessage: ({
    animationType,
    enableTypingAnimation,
    text,
    isThinking,
    isCompleted,
    awaitingResponse,
    isFailed,
    thinkingMessage,
    retryState,
    showLoadingGames,
    type,
    errorMessage,
    messageData,
    showStreamingSkeleton,
    "data-testid": dataTestId,
  }: {
    animationType: string;
    enableTypingAnimation?: boolean;
    text: string;
    isThinking: boolean;
    isCompleted: boolean;
    awaitingResponse: boolean;
    isFailed: boolean;
    thinkingMessage: string;
    retryState?: unknown;
    showLoadingGames: boolean;
    type: string;
    errorMessage?: string;
    messageData?: SystemMessageData;
    showStreamingSkeleton?: boolean;
    "data-testid"?: string;
  }) => (
    <div
      data-testid={dataTestId || "system-message"}
      data-animation-type={animationType}
      data-enable-typing-animation={enableTypingAnimation ? "true" : "false"}
      data-thinking={isThinking}
      data-completed={isCompleted}
      data-awaiting-response={awaitingResponse}
      data-failed={isFailed}
      data-thinking-message={thinkingMessage}
      data-has-retry={!!retryState}
      data-show-loading-games={showLoadingGames}
      data-type={type}
      data-error-message={errorMessage}
      data-has-message-data={messageData ? "true" : "false"}
      data-show-streaming-skeleton={showStreamingSkeleton ? "true" : "false"}
    >
      {text}
    </div>
  ),
}));

// Test data factories
const createMockMessage = (
  overrides: Partial<MessageResponseDto> = {}
): MessageResponseDto => ({
  id: "test-message-id",
  type: "SYSTEM",
  status: MessageStatus.Completed,
  data: { type: "QUESTIONS", response: "Test system message" },
  responses: [],
  ...overrides,
});

const createMockProject = (
  overrides: Partial<ProjectResponseDto> = {}
): ProjectResponseDto =>
  ({
    id: "test-project-id",
    organizationId: "test-org-id",
    name: "Test Project",
    ...overrides,
  } as ProjectResponseDto);

describe("SystemMessageWithRetry", () => {
  const mockOnRetrySuccess = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRetryState.isRetrying = false;
    mockRetryState.canRetry = true;
  });

  describe("basic rendering", () => {
    it("should render SystemMessage with correct props", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toBeInTheDocument();
      expect(systemMessage).toHaveAttribute("data-animation-type", "fun");
      expect(systemMessage).toHaveAttribute(
        "data-enable-typing-animation",
        "true"
      );
      expect(systemMessage).toHaveTextContent("Test system message");
      expect(systemMessage).toHaveAttribute("data-type", "QUESTIONS");
      expect(systemMessage).toHaveAttribute("data-has-message-data", "true");
    });

    it("should handle message without response text", () => {
      const message = createMockMessage({
        data: { type: "QUESTIONS" }, // No response property
      });
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="minimal"
          message={message}
          state="open"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveTextContent(""); // Empty text
      expect(systemMessage).toHaveAttribute("data-animation-type", "minimal");
    });

    it("should apply data-testid when provided", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
          data-testid="custom-system-message"
        />
      );

      expect(screen.getByTestId("custom-system-message")).toBeInTheDocument();
      expect(screen.queryByTestId("system-message")).not.toBeInTheDocument();
    });

    it("should forward typing animation preference to SystemMessage", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          enableTypingAnimation={false}
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      expect(screen.getByTestId("system-message")).toHaveAttribute(
        "data-enable-typing-animation",
        "false"
      );
    });
  });

  describe("state handling", () => {
    it("should set isThinking for system_processing state", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="system_processing"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-thinking", "true");
      expect(systemMessage).toHaveAttribute("data-completed", "false");
      expect(systemMessage).toHaveAttribute("data-awaiting-response", "false");
      expect(systemMessage).toHaveAttribute("data-failed", "false");
    });

    it("should set isCompleted for completed state", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-thinking", "false");
      expect(systemMessage).toHaveAttribute("data-completed", "true");
      expect(systemMessage).toHaveAttribute("data-awaiting-response", "false");
      expect(systemMessage).toHaveAttribute("data-failed", "false");
    });

    it("should set awaitingResponse for awaiting_response state", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="awaiting_response"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-thinking", "false");
      expect(systemMessage).toHaveAttribute("data-completed", "false");
      expect(systemMessage).toHaveAttribute("data-awaiting-response", "true");
      expect(systemMessage).toHaveAttribute("data-failed", "false");
    });

    it("should set isFailed and provide retry state for error state", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="error"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-thinking", "false");
      expect(systemMessage).toHaveAttribute("data-completed", "false");
      expect(systemMessage).toHaveAttribute("data-awaiting-response", "false");
      expect(systemMessage).toHaveAttribute("data-failed", "true");
      expect(systemMessage).toHaveAttribute("data-has-retry", "true");
      expect(systemMessage).toHaveAttribute(
        "data-error-message",
        "System message failed"
      );
    });
  });

  describe("retry functionality", () => {
    it("should not provide retry state for non-error states", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-has-retry", "false");
      expect(systemMessage).not.toHaveAttribute("data-error-message");
    });

    it("should call useMessageRetry with correct parameters", () => {
      const { useMessageRetry } = useMessageRetryModule;
      const message = createMockMessage({ id: "test-msg-123" });
      const project = createMockProject({
        id: "test-proj-456",
        organizationId: "test-org-789",
      });

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="error"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      expect(useMessageRetry).toHaveBeenCalledWith({
        organizationId: "test-org-789",
        projectId: "test-proj-456",
        messageId: "test-msg-123",
        onRetrySuccess: mockOnRetrySuccess,
        onRetryError: expect.any(Function),
      });
    });

    it("should log error when retry fails", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { useMessageRetry } = useMessageRetryModule;

      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="error"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      // Get the onRetryError function that was passed to useMessageRetry
      const retryConfig = useMessageRetry.mock.calls[0][0];
      const onRetryError = retryConfig.onRetryError;

      // Simulate retry error
      const testError = new Error("Retry failed");
      onRetryError(testError);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to retry message:",
        testError
      );

      consoleSpy.mockRestore();
    });
  });

  describe("UI hints and loading games", () => {
    it("should show loading games when estimated delay is over 15000ms", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="system_processing"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
          uiHints={{ estimatedDelayMs: 20000 }}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-show-loading-games", "true");
    });

    it("should not show loading games when estimated delay is under 15000ms", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="system_processing"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
          uiHints={{ estimatedDelayMs: 10000 }}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-show-loading-games", "false");
    });

    it("should not show loading games when no UI hints provided", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="system_processing"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-show-loading-games", "false");
    });
  });

  describe("message type handling", () => {
    it("should use message data type when available", () => {
      const message = createMockMessage({
        data: { type: "ANALYSIS", response: "Analysis response" },
      });
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-type", "ANALYSIS");
    });

    it('should use "N/A" when message data type is not available', () => {
      const message = createMockMessage({
        data: { response: "Response without type" },
      });
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-type", "N/A");
    });
  });

  describe("thinking message", () => {
    it("should always use translated processing message", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="system_processing"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute(
        "data-thinking-message",
        "Processing..."
      );
    });
  });

  describe("animation types", () => {
    it("should support fun animation type", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-animation-type", "fun");
    });

    it("should support minimal animation type", () => {
      const message = createMockMessage();
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="minimal"
          message={message}
          state="completed"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute("data-animation-type", "minimal");
    });

    it("should show streaming skeleton when message status is streaming ready", () => {
      const message = createMockMessage({
        status: MessageStatus.StreamingReady,
      });
      const project = createMockProject();

      render(
        <SystemMessageWithRetry
          animationType="fun"
          message={message}
          state="awaiting_response"
          project={project}
          onRetrySuccess={mockOnRetrySuccess}
        />
      );

      const systemMessage = screen.getByTestId("system-message");
      expect(systemMessage).toHaveAttribute(
        "data-show-streaming-skeleton",
        "true"
      );
    });
  });
});
