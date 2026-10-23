import { calculateMessageStatus } from "../messageStatusCalculator";
import type {
  ConversationMessage,
  OptimisticMessageState,
} from "../../../../types/conversation";
import type { MessageResponseDto } from "../../../../api";
import { MessageType } from "../../../../api";

// Test helpers to create mock objects
const createMockConversationMessage = (
  overrides: Partial<ConversationMessage> = {}
): ConversationMessage => ({
  message: {
    id: "test-message-id",
    type: MessageType.System,
    data: { type: "QUESTIONS" },
    responses: [],
    ...overrides.message,
  } as MessageResponseDto,
  state: "open",
  canEdit: true,
  data: {},
  ...overrides,
});

const createMockOptimisticMessage = (
  overrides: Partial<OptimisticMessageState> = {}
): OptimisticMessageState => ({
  parentMessageId: "parent-id",
  formData: { field: "value" },
  status: "sending",
  conversationVersion: 1,
  ...overrides,
});

describe("calculateMessageStatus", () => {
  describe("completed state handling", () => {
    it('should return "complete" for completed messages', () => {
      const conversationMessage = createMockConversationMessage({
        state: "completed",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("complete");
    });

    it('should return "complete" for messages with responses even if not marked completed', () => {
      const conversationMessage = createMockConversationMessage({
        state: "open",
        message: {
          ...createMockConversationMessage().message,
          responses: [
            {
              id: "response-1",
              type: MessageType.User,
            } as MessageResponseDto,
          ],
        },
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("complete");
    });

    it("should prioritize completed state over other conditions", () => {
      const conversationMessage = createMockConversationMessage({
        state: "completed",
      });
      const optimisticMessage = createMockOptimisticMessage();

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: true,
        optimisticMessage,
      });

      expect(result).toBe("complete");
    });
  });

  describe("awaiting_response state handling", () => {
    it('should return "saving" for awaiting_response messages when isSubmitting is true', () => {
      const conversationMessage = createMockConversationMessage({
        state: "awaiting_response",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: true,
        optimisticMessage: null,
      });

      expect(result).toBe("saving");
    });

    it('should return "submitting" for awaiting_response messages with optimistic updates', () => {
      const conversationMessage = createMockConversationMessage({
        state: "awaiting_response",
      });
      const optimisticMessage = createMockOptimisticMessage();

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage,
      });

      expect(result).toBe("submitting");
    });

    it('should prioritize "saving" over "submitting" when both isSubmitting and optimisticMessage are present', () => {
      const conversationMessage = createMockConversationMessage({
        state: "awaiting_response",
      });
      const optimisticMessage = createMockOptimisticMessage();

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: true,
        optimisticMessage,
      });

      expect(result).toBe("saving");
    });
  });

  describe("draft state handling", () => {
    it('should return "draft" for default cases', () => {
      const conversationMessage = createMockConversationMessage({
        state: "open",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("draft");
    });

    it('should return "draft" for error state', () => {
      const conversationMessage = createMockConversationMessage({
        state: "error",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("draft");
    });

    it('should return "draft" for system_processing state', () => {
      const conversationMessage = createMockConversationMessage({
        state: "system_processing",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("draft");
    });
  });

  describe("edge cases and null handling", () => {
    it("should handle null optimistic messages correctly", () => {
      const conversationMessage = createMockConversationMessage({
        state: "awaiting_response",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("draft");
    });

    it("should handle undefined responses array", () => {
      const conversationMessage = createMockConversationMessage({
        state: "open",
        message: {
          ...createMockConversationMessage().message,
          responses: undefined,
        },
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("draft");
    });

    it("should handle empty responses array", () => {
      const conversationMessage = createMockConversationMessage({
        state: "open",
        message: {
          ...createMockConversationMessage().message,
          responses: [],
        },
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage: null,
      });

      expect(result).toBe("draft");
    });

    it("should handle optimistic message with different statuses", () => {
      const conversationMessage = createMockConversationMessage({
        state: "awaiting_response",
      });
      const optimisticMessage = createMockOptimisticMessage({
        status: "sent",
      });

      const result = calculateMessageStatus({
        conversationMessage,
        isSubmitting: false,
        optimisticMessage,
      });

      expect(result).toBe("submitting");
    });
  });

  describe("complex combinations", () => {
    const testCases = [
      {
        description: "completed message with response and isSubmitting",
        input: {
          state: "completed" as const,
          hasResponses: true,
          isSubmitting: true,
          hasOptimistic: false,
        },
        expected: "complete",
      },
      {
        description: "awaiting_response with no submission or optimistic",
        input: {
          state: "awaiting_response" as const,
          hasResponses: false,
          isSubmitting: false,
          hasOptimistic: false,
        },
        expected: "draft",
      },
      {
        description: "open state with responses",
        input: {
          state: "open" as const,
          hasResponses: true,
          isSubmitting: false,
          hasOptimistic: false,
        },
        expected: "complete",
      },
    ];

    testCases.forEach(({ description, input, expected }) => {
      it(`should return "${expected}" for ${description}`, () => {
        const conversationMessage = createMockConversationMessage({
          state: input.state,
          message: {
            ...createMockConversationMessage().message,
            responses: input.hasResponses
              ? [
                  {
                    id: "response-1",
                    type: MessageType.User,
                  } as MessageResponseDto,
                ]
              : [],
          },
        });

        const result = calculateMessageStatus({
          conversationMessage,
          isSubmitting: input.isSubmitting,
          optimisticMessage: input.hasOptimistic
            ? createMockOptimisticMessage()
            : null,
        });

        expect(result).toBe(expected);
      });
    });
  });
});
it("should not treat SYSTEM responses as complete", () => {
  const conversationMessage = createMockConversationMessage({
    state: "open",
    message: {
      ...createMockConversationMessage().message,
      responses: [
        {
          id: "system-response",
          type: MessageType.System,
        } as MessageResponseDto,
      ],
    },
  });

  const result = calculateMessageStatus({
    conversationMessage,
    isSubmitting: false,
    optimisticMessage: null,
  });

  expect(result).toBe("draft");
});
