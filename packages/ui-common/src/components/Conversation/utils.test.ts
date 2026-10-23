import { describe, it, expect } from "vitest";
import {
  collectSystemMessages,
  getConversationSystemThread,
  isEmptyExternalAgentCompletionMessage,
  isAgentHiddenSystemMessage,
  isExternalAgentTriggerMessage,
  isHiddenQuestionsMessage,
  isRoutingMessage,
} from "./utils";
import { MessageType } from "../../api";
import type { MessageResponseDto, SystemMessage } from "../../api";

describe("collectSystemMessages", () => {
  it("should collect system messages with nested system responses", () => {
    const testMessage: MessageResponseDto = {
      id: "5e35ad80-2be1-4808-bb3a-17a12c73bd68",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "completed",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [
        {
          id: "d447b059-bd58-4163-a070-1fd3aff6d281",
          workflowId: "test-workflow",
          projectId: "test-project",
          status: "open",
          conversationId: "test-conversation",
          parentMessageId: "5e35ad80-2be1-4808-bb3a-17a12c73bd68",
          createdAt: "2025-09-06T05:17:13.951Z",
          responses: [],
          type: "SYSTEM" as MessageType,
          data: {
            type: "QUESTIONS",
            response: "Great! We've got details now. What do you think?",
            uiElements: [
              {
                id: "what_next",
                type: "textarea",
                label: "What should we do next",
                influences: [],
              },
            ],
          },
          awaitingResponse: true,
        },
      ],
      type: "SYSTEM" as MessageType,
      data: {
        type: "INITIATIVES",
        response: "opener processing completed",
        uiElements: [
          {
            id: "initiative_feedback",
            type: "initiative_intro",
            label: "Let's review the high-level description",
            required: false,
            influences: [],
          },
        ],
      },
      awaitingResponse: false,
    };

    const result = collectSystemMessages(testMessage);

    // Should collect both the parent system message and its system response
    expect(result.systemMessages).toHaveLength(2);
    expect(result.systemMessages[0].id).toBe(
      "5e35ad80-2be1-4808-bb3a-17a12c73bd68"
    );
    expect(result.systemMessages[1].id).toBe(
      "d447b059-bd58-4163-a070-1fd3aff6d281"
    );
  });

  it("should handle system messages with user responses", () => {
    const testMessage: MessageResponseDto = {
      id: "parent-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "completed",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [
        {
          id: "user-response",
          workflowId: "test-workflow",
          projectId: "test-project",
          status: "open",
          conversationId: "test-conversation",
          parentMessageId: "parent-message",
          createdAt: "2025-09-06T05:17:13.951Z",
          responses: [
            {
              id: "system-followup",
              workflowId: "test-workflow",
              projectId: "test-project",
              status: "open",
              conversationId: "test-conversation",
              parentMessageId: "user-response",
              createdAt: "2025-09-06T05:18:13.951Z",
              responses: [],
              type: "SYSTEM" as MessageType,
              data: {
                type: "QUESTIONS",
                response: "Follow-up question",
                uiElements: [],
              },
              awaitingResponse: true,
            },
          ],
          type: "USER" as MessageType,
          data: {
            userInput: "User's response",
          },
          awaitingResponse: false,
        },
      ],
      type: "SYSTEM" as MessageType,
      data: {
        type: "QUESTIONS",
        response: "Initial question",
        uiElements: [],
      },
      awaitingResponse: false,
    };

    const result = collectSystemMessages(testMessage);

    // Should collect parent system message and the system follow-up after user response
    expect(result.systemMessages).toHaveLength(2);
    expect(result.systemMessages[0].id).toBe("parent-message");
    expect(result.systemMessages[1].id).toBe("system-followup");

    // Should mark step as completed since first response is user
    expect(result.activeStep).toBe(1); // lastCompletedStep + 1
  });

  it("should handle empty/null messages", () => {
    expect(collectSystemMessages(undefined)).toEqual({
      systemMessages: [],
      activeStep: -1,
    });
  });

  it("should handle user messages (non-system)", () => {
    const userMessage: MessageResponseDto = {
      id: "user-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "completed",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [],
      type: "USER" as MessageType,
      data: {
        userInput: "User message",
      },
      awaitingResponse: false,
    };

    const result = collectSystemMessages(userMessage);

    // Should not collect user messages
    expect(result.systemMessages).toHaveLength(0);
    expect(result.activeStep).toBe(-1);
  });

  it("should collect nested system messages under a top-level user message", () => {
    const userRootMessage: MessageResponseDto = {
      id: "user-root",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "completed",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [
        {
          id: "nested-system",
          workflowId: "test-workflow",
          projectId: "test-project",
          status: "open",
          conversationId: "test-conversation",
          parentMessageId: "user-root",
          createdAt: "2025-09-06T05:17:13.951Z",
          responses: [],
          type: "SYSTEM" as MessageType,
          data: {
            type: "ANALYSIS",
            response: "Nested system response",
          } as MessageResponseDto["data"],
          awaitingResponse: false,
        },
      ],
      type: "USER" as MessageType,
      data: {
        comment: "Top-level user",
      },
      awaitingResponse: false,
    };

    const result = collectSystemMessages(userRootMessage);

    expect(result.systemMessages).toHaveLength(1);
    expect(result.systemMessages[0].id).toBe("nested-system");
    expect(result.activeStep).toBe(0);
  });

  it("should find the first system message in a user-rooted thread", () => {
    const conversationMessages: MessageResponseDto[] = [
      {
        id: "user-root",
        workflowId: "test-workflow",
        projectId: "test-project",
        status: "completed",
        conversationId: "test-conversation",
        parentMessageId: undefined,
        createdAt: "2025-09-06T05:16:16.157Z",
        responses: [
          {
            id: "nested-system",
            projectId: "test-project",
            status: "open",
            conversationId: "test-conversation",
            parentMessageId: "user-root",
            createdAt: "2025-09-06T05:17:13.951Z",
            responses: [],
            type: "SYSTEM" as "SYSTEM",
            data: {
              type: "ANALYSIS",
              response: "Nested system response",
            } as MessageResponseDto["data"],
            awaitingResponse: false,
          },
        ],
        type: "USER" as MessageType,
        data: {
          comment: "Top-level user",
        },
        awaitingResponse: false,
      },
    ];

    const result = getConversationSystemThread(conversationMessages);

    expect(result.rootMessage?.id).toBe("user-root");
    expect(result.firstSystemMessage?.id).toBe("nested-system");
    expect(result.systemMessages).toHaveLength(1);
  });
});

describe("isRoutingMessage", () => {
  it("should return true for ROUTING system messages", () => {
    const routingMessage: SystemMessage = {
      id: "routing-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "open",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [],
      type: "SYSTEM",
      data: {
        type: "ROUTING",
      } as SystemMessage["data"],
      awaitingResponse: false,
    };

    expect(isRoutingMessage(routingMessage)).toBe(true);
  });

  it("should return false for non-ROUTING system messages", () => {
    const questionsMessage: SystemMessage = {
      id: "questions-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "open",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [],
      type: "SYSTEM",
      data: {
        type: "QUESTIONS",
        response: "Test question",
        uiElements: [],
      } as SystemMessage["data"],
      awaitingResponse: false,
    };

    expect(isRoutingMessage(questionsMessage)).toBe(false);
  });

  it("should return false for USER messages", () => {
    const userMessage = {
      id: "user-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "completed",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [],
      type: "USER",
      data: {
        userInput: "User message",
      },
      awaitingResponse: false,
    } as SystemMessage;

    expect(isRoutingMessage(userMessage)).toBe(false);
  });

  it("should return false for system messages with invalid data structure", () => {
    const invalidMessage: SystemMessage = {
      id: "invalid-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "open",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [],
      type: "SYSTEM",
      data: null as unknown as SystemMessage["data"],
      awaitingResponse: false,
    };

    expect(isRoutingMessage(invalidMessage)).toBe(false);
  });

  it("should return false for system messages with missing type property", () => {
    const noTypeMessage: SystemMessage = {
      id: "no-type-message",
      workflowId: "test-workflow",
      projectId: "test-project",
      status: "open",
      conversationId: "test-conversation",
      parentMessageId: null,
      createdAt: "2025-09-06T05:16:16.157Z",
      responses: [],
      type: "SYSTEM",
      data: {
        response: "Some response",
      } as SystemMessage["data"],
      awaitingResponse: false,
    };

    expect(isRoutingMessage(noTypeMessage)).toBe(false);
  });
});

const makeSystemMessage = (
  overrides: Partial<SystemMessage> & { data?: SystemMessage["data"] }
): SystemMessage => ({
  id: overrides.id ?? "system-message",
  workflowId: "test-workflow",
  projectId: "test-project",
  status: overrides.status ?? "open",
  conversationId: "test-conversation",
  parentMessageId: null,
  createdAt: "2026-04-21T22:34:48.362Z",
  responses: overrides.responses ?? [],
  type: "SYSTEM",
  data: overrides.data ?? ({} as SystemMessage["data"]),
  awaitingResponse: overrides.awaitingResponse ?? false,
  ...overrides,
});

describe("isExternalAgentTriggerMessage", () => {
  it("returns true for SYSTEM messages carrying data.triggersAgent", () => {
    const trigger = makeSystemMessage({
      data: {
        triggersAgent: {
          promptType: "FEATURE_SYNC_ANALYZE",
          nodeId: "node-1",
        },
      } as unknown as SystemMessage["data"],
    });

    expect(isExternalAgentTriggerMessage(trigger)).toBe(true);
  });

  it("returns false for SYSTEM messages without triggersAgent", () => {
    const plain = makeSystemMessage({
      data: { response: "hello" } as SystemMessage["data"],
    });

    expect(isExternalAgentTriggerMessage(plain)).toBe(false);
  });

  it("returns false for USER messages", () => {
    const userMessage = {
      ...makeSystemMessage({
        data: {
          triggersAgent: { promptType: "X", nodeId: "n" },
        } as unknown as SystemMessage["data"],
      }),
      type: "USER",
    } as unknown as SystemMessage;

    expect(isExternalAgentTriggerMessage(userMessage)).toBe(false);
  });

  it("returns false when data is null", () => {
    const brokenMessage = makeSystemMessage({
      data: null as unknown as SystemMessage["data"],
    });

    expect(isExternalAgentTriggerMessage(brokenMessage)).toBe(false);
  });
});

describe("isEmptyExternalAgentCompletionMessage", () => {
  const completion = (
    data: Record<string, unknown>,
    proposals: SystemMessage["proposals"] = []
  ): SystemMessage =>
    makeSystemMessage({
      data: {
        completesExternalAgentNode: {
          nodeId: "n",
          action: "NO_DISCREPANCY",
          completesTriggerMessageId: "t",
        },
        ...data,
      } as unknown as SystemMessage["data"],
      proposals,
    });

  it("returns true when response, uiElements, secondaryActions, and proposals are all empty", () => {
    expect(isEmptyExternalAgentCompletionMessage(completion({}))).toBe(true);
  });

  it("treats whitespace-only response as empty", () => {
    expect(
      isEmptyExternalAgentCompletionMessage(completion({ response: "   " }))
    ).toBe(true);
  });

  it("returns false when response has text", () => {
    expect(
      isEmptyExternalAgentCompletionMessage(
        completion({ response: "analyzed the tree" })
      )
    ).toBe(false);
  });

  it("returns false when uiElements is non-empty", () => {
    expect(
      isEmptyExternalAgentCompletionMessage(
        completion({ uiElements: [{ id: "x" }] })
      )
    ).toBe(false);
  });

  it("returns false when secondaryActions is non-empty", () => {
    expect(
      isEmptyExternalAgentCompletionMessage(
        completion({ secondaryActions: [{ id: "a", handler: "h" }] })
      )
    ).toBe(false);
  });

  it("returns false when proposals are attached", () => {
    const proposals = [{ id: "p1" }] as unknown as SystemMessage["proposals"];
    expect(
      isEmptyExternalAgentCompletionMessage(completion({}, proposals))
    ).toBe(false);
  });

  it("returns false when the message is not a completion", () => {
    const plain = makeSystemMessage({
      data: { response: "" } as SystemMessage["data"],
    });
    expect(isEmptyExternalAgentCompletionMessage(plain)).toBe(false);
  });
});

describe("isHiddenQuestionsMessage", () => {
  const opener = (
    data: Record<string, unknown>,
    proposals: SystemMessage["proposals"] = []
  ): SystemMessage =>
    makeSystemMessage({
      data: {
        type: "QUESTIONS",
        ...data,
      } as unknown as SystemMessage["data"],
      proposals,
    });

  it("recognizes the marker even when the response has text", () => {
    expect(isAgentHiddenSystemMessage(opener({ response: "Starting...", uiElements: [{ id: "x", type: "agent_hidden" }] }))).toBe(true);
    expect(isAgentHiddenSystemMessage(opener({ response: "Visible", uiElements: [] }))).toBe(false);
  });

  it("returns true for a QUESTIONS message with empty response and only agent_hidden uiElements", () => {
    expect(
      isHiddenQuestionsMessage(
        opener({
          response: "",
          uiElements: [
            { id: "x", type: "agent_hidden", label: "hidden", influences: [] },
          ],
        })
      )
    ).toBe(true);
  });

  it("returns true when uiElements is empty", () => {
    expect(
      isHiddenQuestionsMessage(opener({ response: "", uiElements: [] }))
    ).toBe(true);
  });

  it("returns false when any uiElement is visible (non agent_hidden)", () => {
    expect(
      isHiddenQuestionsMessage(
        opener({
          uiElements: [
            { id: "x", type: "agent_hidden", influences: [] },
            { id: "y", type: "textarea", label: "Describe...", influences: [] },
          ],
        })
      )
    ).toBe(false);
  });

  it("returns false when response has text", () => {
    expect(
      isHiddenQuestionsMessage(opener({ response: "tell me about it" }))
    ).toBe(false);
  });

  it("returns false for non-QUESTIONS data types", () => {
    const completion = makeSystemMessage({
      data: { type: "INITIATIVES", response: "" } as SystemMessage["data"],
    });
    expect(isHiddenQuestionsMessage(completion)).toBe(false);
  });

  it("returns false when proposals are attached", () => {
    const proposals = [{ id: "p1" }] as unknown as SystemMessage["proposals"];
    expect(isHiddenQuestionsMessage(opener({}, proposals))).toBe(false);
  });

  it("returns false for USER messages", () => {
    const userMessage = {
      ...opener({}),
      type: "USER",
    } as unknown as SystemMessage;
    expect(isHiddenQuestionsMessage(userMessage)).toBe(false);
  });
});
