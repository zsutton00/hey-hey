import {
  shouldShowForm,
  determineMessageState,
  isQuestionsMessage,
  isAnalysisMessage,
} from "../messageStateUtils";
import type { ConversationMessage } from "../../../../types/conversation";
import {
  MessageResponseDto,
  MessageType,
  MessageStatus,
} from "../../../../api";

// Test helpers
const createMockMessageDto = (
  overrides: Partial<MessageResponseDto> = {}
): MessageResponseDto => ({
  id: "test-message-id",
  type: MessageType.System,
  status: MessageStatus.Open,
  data: { type: "QUESTIONS" },
  responses: [],
  awaitingResponse: false,
  ...overrides,
});

const createMockConversationMessage = (
  overrides: Partial<ConversationMessage> = {}
): ConversationMessage => ({
  message: createMockMessageDto(overrides.message),
  state: "open",
  canEdit: true,
  data: {},
  ...overrides,
});

describe("messageStateUtils", () => {
  describe("shouldShowForm", () => {
    it("does not show a form for a resolved Task Monitor judgment request", () => {
      const conversationMessage = createMockConversationMessage({
        state: "completed",
        message: {
          ...createMockMessageDto(),
          awaitingResponse: false,
          data: {
            type: "TASK_MONITOR_SUPERVISION",
            agentIdentity: "task-monitor-coordinator",
            outcome: "JUDGMENT_REQUESTED",
            rationale: "The evidence is inconclusive.",
            guidance: "Choose the safer product behavior.",
          },
        },
      });

      expect(shouldShowForm(conversationMessage)).toBe(false);
    });

    describe("basic form display logic", () => {
      it("should show form for questions messages with UI elements", () => {
        const conversationMessage = createMockConversationMessage({
          state: "awaiting_response",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "input", id: "field1" }],
            },
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(true);
      });

      it("should show form for initiatives messages with UI elements", () => {
        const conversationMessage = createMockConversationMessage({
          state: "awaiting_response",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "INITIATIVES",
              uiElements: [{ type: "initiative_list", id: "initiatives" }],
            },
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(true);
      });

      it("should not show form for messages without UI elements", () => {
        const conversationMessage = createMockConversationMessage({
          state: "awaiting_response",
          message: {
            ...createMockMessageDto(),
            data: { type: "QUESTIONS", uiElements: [] },
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });
    });

    describe("system_processing state handling", () => {
      it("should not show form when message is system_processing", () => {
        const conversationMessage = createMockConversationMessage({
          state: "system_processing",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "input", id: "field1" }],
            },
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });
    });

    describe("completed state with replacement logic", () => {
      it("should not show form for completed messages without responses", () => {
        const conversationMessage = createMockConversationMessage({
          state: "completed",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "input", id: "field1" }],
            },
            responses: [],
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });

      it("should not show form for completed messages with SYSTEM responses (replacement case)", () => {
        const conversationMessage = createMockConversationMessage({
          state: "completed",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "input", id: "field1" }],
            },
            responses: [
              { ...createMockMessageDto(), type: MessageType.System },
            ],
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });

      it("should show form for completed messages with USER responses", () => {
        const conversationMessage = createMockConversationMessage({
          state: "completed",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "input", id: "field1" }],
            },
            responses: [{ ...createMockMessageDto(), type: MessageType.User }],
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(true);
      });

      it("should show form for completed messages whose only response is an empty workflow envelope", () => {
        // An external-agent completion envelope arrives ~ms after the
        // QUESTIONS message it follows and flips its `awaitingResponse`
        // to false. The envelope is workflow plumbing (empty response,
        // `agent_hidden` ui, carries `completesExternalAgentNode`) and
        // must not lock the just-emitted question's form closed.
        const envelopeResponse: MessageResponseDto = {
          ...createMockMessageDto(),
          type: MessageType.System,
          data: {
            type: "AGENT",
            response: "",
            uiElements: [
              { id: "agent_hidden", type: "agent_hidden", label: "" },
            ],
            completesExternalAgentNode: { action: "REVISED" },
          },
          proposals: [],
        };
        const conversationMessage = createMockConversationMessage({
          state: "completed",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [
                { type: "plan_shaping_feature_sync_review", id: "f1" },
              ],
              secondaryActions: [
                { presentation: "BUTTON", handler: "x" } as never,
              ],
            },
            responses: [envelopeResponse],
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(true);
      });

      it("should show form for completed file diff messages with SYSTEM responses", () => {
        const conversationMessage = createMockConversationMessage({
          state: "completed",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "file_diff", id: "field1" }],
            },
            responses: [
              { ...createMockMessageDto(), type: MessageType.System },
            ],
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(true);
      });
    });

    describe("edge cases", () => {
      it("should handle undefined uiElements", () => {
        const conversationMessage = createMockConversationMessage({
          state: "awaiting_response",
          message: {
            ...createMockMessageDto(),
            data: { type: "QUESTIONS" }, // No uiElements property
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });

      it("should handle null data", () => {
        const conversationMessage = createMockConversationMessage({
          state: "awaiting_response",
          message: {
            ...createMockMessageDto(),
            data: null,
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });

      it("should handle undefined responses array", () => {
        const conversationMessage = createMockConversationMessage({
          state: "completed",
          message: {
            ...createMockMessageDto(),
            data: {
              type: "QUESTIONS",
              uiElements: [{ type: "input", id: "field1" }],
            },
            responses: undefined,
          },
        });

        const result = shouldShowForm(conversationMessage);

        expect(result).toBe(false);
      });
    });
  });

  describe("determineMessageState", () => {
    describe("System message handling", () => {
      it('should return "awaiting_response" for system messages awaiting response', () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          awaitingResponse: true,
          status: MessageStatus.Open,
        });

        const result = determineMessageState(message);

        expect(result).toBe("awaiting_response");
      });

      it("should fall through to status handling for system messages not awaiting response", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          awaitingResponse: false,
          status: MessageStatus.Completed,
        });

        const result = determineMessageState(message);

        expect(result).toBe("completed");
      });
    });

    describe("Status-based state determination", () => {
      console.log("MessageStatus keys (test)", Object.keys(MessageStatus));
      const statusTestCases = [
        {
          status: MessageStatus.SystemProcessing,
          expected: "system_processing",
        },
        {
          status: MessageStatus.StreamingReady,
          expected: "system_processing",
        },
        { status: MessageStatus.Open, expected: "open" },
        { status: MessageStatus.Completed, expected: "completed" },
        { status: MessageStatus.Failed, expected: "error" },
      ];

      statusTestCases.forEach(({ status, expected }) => {
        it(`should return "${expected}" for ${status} status`, () => {
          const message = createMockMessageDto({
            type: MessageType.User, // Non-system message to avoid awaiting response logic
            status,
          });

          const result = determineMessageState(message);

          expect(result).toBe(expected);
        });
      });
    });

    describe("Default/unknown status handling", () => {
      it('should return "error" for unknown status', () => {
        const message = createMockMessageDto({
          type: MessageType.User,
          status: "unknown_status" as MessageStatus,
        });

        const result = determineMessageState(message);

        expect(result).toBe("error");
      });

      it('should return "error" for undefined status', () => {
        const message = createMockMessageDto({
          type: MessageType.User,
          status: undefined as unknown as MessageStatus,
        });

        const result = determineMessageState(message);

        expect(result).toBe("error");
      });
    });

    describe("Priority handling", () => {
      it("should prioritize awaitingResponse over status for system messages", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          awaitingResponse: true,
          status: MessageStatus.Completed, // This should be ignored
        });

        const result = determineMessageState(message);

        expect(result).toBe("awaiting_response");
      });
    });
  });

  describe("message type helpers", () => {
    describe("isQuestionsMessage", () => {
      it("should return true for SYSTEM messages with QUESTIONS type", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: { type: "QUESTIONS" },
        });

        expect(isQuestionsMessage(message)).toBe(true);
      });

      it("should return false for non-SYSTEM messages", () => {
        const message = createMockMessageDto({
          type: MessageType.User,
          data: { type: "QUESTIONS" },
        });

        expect(isQuestionsMessage(message)).toBe(false);
      });

      it("should return false for SYSTEM messages without QUESTIONS type", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: { type: "ANALYSIS" },
        });

        expect(isQuestionsMessage(message)).toBe(false);
      });
    });

    describe("isAnalysisMessage", () => {
      it("should return true for SYSTEM messages with ANALYSIS type", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: { type: "ANALYSIS" },
        });

        expect(isAnalysisMessage(message)).toBe(true);
      });

      it("should return false for non-SYSTEM messages", () => {
        const message = createMockMessageDto({
          type: MessageType.User,
          data: { type: "ANALYSIS" },
        });

        expect(isAnalysisMessage(message)).toBe(false);
      });

      it("should return false for SYSTEM messages without ANALYSIS type", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: { type: "QUESTIONS" },
        });

        expect(isAnalysisMessage(message)).toBe(false);
      });
    });

    describe("type helper edge cases", () => {
      it("should handle null data gracefully", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: null,
        });

        expect(isQuestionsMessage(message)).toBe(false);
        expect(isAnalysisMessage(message)).toBe(false);
      });

      it("should handle undefined data gracefully", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: undefined,
        });

        expect(isQuestionsMessage(message)).toBe(false);
        expect(isAnalysisMessage(message)).toBe(false);
      });

      it("should handle data without type property", () => {
        const message = createMockMessageDto({
          type: MessageType.System,
          data: { someOtherField: "value" } as { someOtherField: string },
        });

        expect(isQuestionsMessage(message)).toBe(false);
        expect(isAnalysisMessage(message)).toBe(false);
      });
    });
  });
});
