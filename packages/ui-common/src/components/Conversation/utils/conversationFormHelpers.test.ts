import { vi } from "vitest";
import {
  createSecondActionFromAPI,
  classifyWorkflowSubmission,
  getStructuredWorkflowSubmission,
  getButtonSecondActions,
  prepareFormInitialData,
} from "./conversationFormHelpers";
import { buildCodingPromptAcceptPayload } from "../../LlmForms/Registry/secondaryActionBehaviors";
import {
  ExtendedUIFieldType,
  MessageType,
  SecondaryActionHandler,
} from "../../../api";
import type {
  QuestionsSystemMessageData,
  SecondaryActionConfig,
  UIElement,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import {
  PlanApprovalNextAction,
  PlanGapDiscoveryNextAction,
  PlanGapDiscoveryMessageType,
  PlanStageProposalNextAction,
  type SecondaryActionConfigWithHandler,
} from "../../LlmForms/Registry/types";

// Mock logger
vi.mock("../../../utils/logger", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock React to avoid issues with icon rendering
vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    createElement: vi.fn((type, props) => ({ type, props })),
  };
});

describe("conversationFormHelpers - Secondary Action Priority Logic", () => {
  const mockHandleNext = vi.fn();
  const mockTrackUI = vi.fn();
  const mockContext = {
    conversationId: "test-conversation",
    projectId: "test-project",
    organizationId: "test-org",
    interaction: { proposals: [] },
  };
  const messageId = "test-message";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Priority 1: Form-level secondary actions", () => {
    it("creates secondary action from API when secondaryActions is defined", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
        secondaryActions: [
          {
            id: "test-action",
            type: "form_action",
            label: "Generate Tasks",
            handler: SecondaryActionHandler.TaskGenerationGenerate,
            variant: "contained",
            icon: "✨",
            disabled: false,
            fieldId: null,
            config: null,
          },
        ],
      };

      const result = getButtonSecondActions(
        messageData,
        [],
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.label).toBe("Generate Tasks");
      expect(result[0]?.type).toBe("form_action");
      expect(result[0]?.variant).toBe("text");
    });

    it("returns all actions when multiple secondaryActions are defined", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
        secondaryActions: [
          {
            id: "first-action",
            type: "form_action",
            label: "First Action",
            handler: SecondaryActionHandler.TaskGenerationGenerate,
            variant: "contained",
            disabled: false,
            fieldId: null,
            config: null,
          },
          {
            id: "second-action",
            type: "form_action",
            label: "Second Action",
            handler: SecondaryActionHandler.TaskGenerationGenerate,
            variant: "outlined",
            disabled: false,
            fieldId: null,
            config: null,
          },
        ],
      };

      const result = getButtonSecondActions(
        messageData,
        [],
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.label).toBe("First Action");
      expect(result[1]?.label).toBe("Second Action");
    });

    it("contains continue and ready-for-plan actions but not dismiss", () => {
      const revisionAction: SecondaryActionConfig = {
        id: "feature-sync-revision-action",
        type: "field_action",
        label: "Revise",
        handler:
          SecondaryActionHandler.PlanShapingFeatureSyncReviewRequestRevisions,
        presentation: "BUTTON",
        disabled: false,
        fieldId: "feature-sync-review-field",
        config: null,
      };
      const unrelatedAction: SecondaryActionConfig = {
        id: "unrelated-action",
        type: "form_action",
        label: "Unrelated action",
        handler: SecondaryActionHandler.TaskGenerationGenerate,
        presentation: "BUTTON",
        disabled: false,
        fieldId: null,
        config: null,
      };

      const revision = createSecondActionFromAPI(
        revisionAction,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: "feature-sync-review-field",
            type: "plan_shaping_feature_sync_review",
            label: "Review flagged items",
            influences: [],
            required: false,
          },
        ],
      );
      const readyForPlanAction: SecondaryActionConfig = {
        id: "feature-sync-ready-for-plan-action",
        type: "field_action",
        label: "Ready for Plan",
        handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewDone,
        presentation: "BUTTON",
        disabled: false,
        fieldId: "feature-sync-review-field",
        config: null,
      };
      const readyForPlan = createSecondActionFromAPI(
        readyForPlanAction,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: "feature-sync-review-field",
            type: "plan_shaping_feature_sync_review",
            label: "Review flagged items",
            influences: [],
            required: false,
          },
        ],
      );
      const dismissAction: SecondaryActionConfig = {
        id: "feature-sync-dismiss-action",
        type: "field_action",
        label: "Dismiss",
        handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewDone,
        presentation: "BUTTON",
        disabled: false,
        fieldId: "feature-sync-review-field",
        config: null,
      };
      const dismiss = createSecondActionFromAPI(
        dismissAction,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: "feature-sync-review-field",
            type: "plan_shaping_feature_sync_review",
            label: "Review flagged items",
            influences: [],
            required: false,
          },
        ],
      );
      const unrelated = createSecondActionFromAPI(
        unrelatedAction,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [],
      );

      expect(revision.variant).toBe("contained");
      expect(readyForPlan.variant).toBe("contained");
      expect(dismiss.variant).toBe("text");
      expect(unrelated.variant).toBe("text");
    });

    it("keeps the feature-sync revision discriminator and feedback payload stable", () => {
      const fieldId = "feature-sync-review-field";
      const action: SecondaryActionConfig = {
        id: "feature-sync-revision-action",
        type: "field_action",
        label: "Revise",
        handler:
          SecondaryActionHandler.PlanShapingFeatureSyncReviewRequestRevisions,
        presentation: "BUTTON",
        disabled: false,
        fieldId,
        config: null,
      };
      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: fieldId,
            type: "plan_shaping_feature_sync_review",
            label: "Review flagged items",
            influences: [],
            required: false,
          },
        ],
      );

      secondAction.onExecute({
        [fieldId]: {
          action: "REFINE",
          payload: { feedback: "Keep the selected remediation choices." },
        },
      });

      expect(mockHandleNext).toHaveBeenCalledWith(
        {
          [fieldId]: {
            action: "REFINE",
            payload: { feedback: "Keep the selected remediation choices." },
          },
        },
        messageId,
        {
          handler: "plan_shaping_feature_sync_review_request_revisions",
        },
      );
    });

    it("serializes feature-sync completion with an empty payload", () => {
      const fieldId = "feature-sync-review-field";
      const action: SecondaryActionConfig = {
        id: "feature-sync-done-action",
        type: "field_action",
        label: "Done",
        handler: SecondaryActionHandler.PlanShapingFeatureSyncReviewDone,
        presentation: "BUTTON",
        disabled: false,
        fieldId,
        config: null,
      };
      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: fieldId,
            type: "plan_shaping_feature_sync_review",
            label: "Review flagged items",
            influences: [],
            required: false,
          },
        ],
      );

      secondAction.onExecute({
        [fieldId]: {
          action: "REFINE",
          payload: { feedback: "This must not cross the done boundary." },
        },
      });

      expect(mockHandleNext).toHaveBeenCalledWith(
        {
          [fieldId]: {
            action: "DISMISSED",
            payload: {},
          },
        },
        messageId,
        { handler: "plan_shaping_feature_sync_review_done" },
      );
    });
  });

  describe("Priority 2: Field-level secondary actions", () => {
    it("creates secondary action from field when no form-level actions exist", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
      };

      const uiElements: UIElement[] = [
        {
          id: "task-field",
          type: "task_generation",
          label: "Task Input",
          placeholder: "Enter task",
          required: true,
          influences: [],
          secondaryAction: {
            id: "field-action",
            type: "field_action",
            label: "Generate Tasks",
            handler: SecondaryActionHandler.TaskGenerationGenerate,
            variant: "text",
            disabled: false,
            fieldId: "task-field",
            config: null,
          },
        },
      ];

      const result = getButtonSecondActions(
        messageData,
        uiElements,
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.label).toBe("Generate Tasks");
      expect(result[0]?.type).toBe("field_action");
    });

    it("prioritizes form-level over field-level actions", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
        secondaryActions: [
          {
            id: "form-action",
            type: "form_action",
            label: "Form Action",
            handler: SecondaryActionHandler.TaskGenerationGenerate,
            variant: "contained",
            disabled: false,
            fieldId: null,
            config: null,
          },
        ],
      };

      const uiElements: UIElement[] = [
        {
          id: "task-field",
          type: "task_generation",
          label: "Task Input",
          placeholder: "Enter task",
          required: true,
          influences: [],
          secondaryAction: {
            id: "field-action",
            type: "field_action",
            label: "Field Action",
            handler: SecondaryActionHandler.TaskGenerationGenerate,
            variant: "text",
            disabled: false,
            fieldId: "task-field",
            config: null,
          },
        },
      ];

      const result = getButtonSecondActions(
        messageData,
        uiElements,
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(2);
      expect(result[0]?.label).toBe("Form Action"); // Form-level comes first
    });
  });

  describe("Priority 4: Legacy skippable behavior", () => {
    it("creates skip action when skippable is true and no API actions exist", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
        skippable: true,
      };

      const result = getButtonSecondActions(
        messageData,
        [],
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.label).toBe("Skip");
      expect(result[0]?.type).toBe("skip");
      expect(result[0]?.variant).toBe("text");
    });
  });

  describe("Priority 5: Task generation field detection", () => {
    it("creates task generation action when task_generation field exists and no other actions", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
      };

      const uiElements: UIElement[] = [
        {
          id: "task-field",
          type: "task_generation",
          label: "Task Input",
          placeholder: "Enter task",
          required: true,
          influences: [],
        },
      ];

      const result = getButtonSecondActions(
        messageData,
        uiElements,
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("No secondary action scenarios", () => {
    it("returns empty array when no secondary action conditions are met", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Test response",
        detectedIntent: "task_planning",
        intentConfidence: 0.8,
        uiElements: [],
        influences: [],
        skippable: false,
      };

      const uiElements: UIElement[] = [
        {
          id: "text-field",
          type: "text",
          label: "Regular Input",
          placeholder: "Enter text",
          required: true,
          influences: [],
        },
      ];

      const result = getButtonSecondActions(
        messageData,
        uiElements,
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(result).toHaveLength(0);
    });
  });

  describe("Startup plan secondary action", () => {
    it("creates Continue Refining button for startup plan forms", () => {
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Startup plan response",
        detectedIntent: "coding_prompts_iteration",
        intentConfidence: 1,
        uiElements: [],
        influences: [],
        skippable: false,
      };

      const uiElements: UIElement[] = [
        {
          id: "startup-plan-field",
          type: "coding_prompt_startup_plan",
          label: "Startup Plan",
          influences: [],
          required: false,
        },
      ];

      const action = getButtonSecondActions(
        messageData,
        uiElements,
        messageId,
        mockTrackUI,
        mockHandleNext,
        mockContext,
      );

      expect(action).toHaveLength(1);
      expect(action[0]?.label).toBe("Continue Refining");
      expect(action[0]?.type).toBe("field_action");

      const formValues = {
        "startup-plan-field": {
          responseType: "startup_plan_v1",
          sessionTitle: "Startup Session",
          requiredServiceIds: ["service-1"],
          primaryImplementations: [],
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
        },
      };

      action[0]?.onExecute(formValues);

      expect(mockTrackUI).toHaveBeenCalledWith("button_click", {
        elementType: "form_navigation",
        elementText: "continue_refining",
      });
      expect(mockHandleNext).toHaveBeenCalledWith(
        {
          "startup-plan-field": {
            action: "REFINE",
            payload: {
              responseType: "startup_plan_v1",
              sessionTitle: "Startup Session",
              requiredServiceIds: ["service-1"],
              primaryImplementations: [],
              executionPlan: [],
              discrepancies: [],
              clarificationQuestions: [],
            },
          },
        },
        messageId,
      );
    });
  });

  describe("workflow submission classification", () => {
    it("forwards only an explicit action and its inner object payload", () => {
      expect(
        getStructuredWorkflowSubmission({
          field: {
            action: "REFINE",
            payload: { responseType: "startup_plan_v1" },
          },
          comment: "Revise the plan",
        }),
      ).toEqual({
        kind: "structured-answer",
        action: "REFINE",
        payload: { responseType: "startup_plan_v1" },
      });
    });

    it("keeps text-only replies conversational", () => {
      expect(
        classifyWorkflowSubmission({ reply: "  Explain this step  " }),
      ).toEqual({
        kind: "conversational-text",
        userMessage: "Explain this step",
      });
    });

    it.each([
      { field: { decision: "approve" } },
      { field: { action: "APPROVED" } },
      { field: { action: "APPROVED", payload: "legacy-field-map" } },
    ])("rejects legacy or malformed structured values", (data) => {
      expect(() => classifyWorkflowSubmission(data)).toThrow(
        /explicit action and object payload/i,
      );
    });
  });

  describe("prepareFormInitialData - submitted textarea feedback", () => {
    it("rehydrates a Goal PM actual outcome from its field-keyed linked answer", () => {
      const answer = {
        type: "GOAL_PM_ROUTING", state: "COMPLETED", operationId: "operation",
        pendingRequest: "Discuss launch", requestedAt: "2026-09-27T00:00:00Z",
        selectedOption: { kind: "startNewConversation", optionId: "new", title: "Launch", rationale: "New topic", requiresConfirmation: true },
        outcome: { entityType: "CONVERSATION", entityId: "actual-destination", agentSessionId: "actual-session", title: "Launch" },
      };
      const field = { id: "route", type: "goal_pm_action" as const, payload: { goalId: "goal", options: [answer.selectedOption] } };
      const conversationMessage = { message: { data: { type: "QUESTIONS", uiElements: [field] }, responses: [
        { type: MessageType.User, data: { unrelated: "Earlier field answer" } },
        { type: MessageType.User, data: { route: answer } },
      ] } } as unknown as ConversationMessage;
      expect(prepareFormInitialData(conversationMessage, [field]).route).toEqual(answer);
    });
    it("restores visual-preview feedback from the linked USER response payload", () => {
      const feedbackField: UIElement = {
        id: "visual-preview-feedback",
        type: ExtendedUIFieldType.Textarea,
        label: "Feedback on the visual plan preview",
        influences: [],
        required: false,
      };
      const messageData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "Review the visual plan preview",
        uiElements: [feedbackField],
        influences: [],
      };
      const conversationMessage = {
        message: {
          data: messageData,
          responses: [
            {
              type: MessageType.User,
              data: {
                action: "REFINE",
                feedback: "Keep the navigation visible",
                payload: { feedback: "Keep the navigation visible" },
              },
            },
          ],
        },
      } as unknown as ConversationMessage;

      expect(
        prepareFormInitialData(conversationMessage, [feedbackField]),
      ).toEqual(
        expect.objectContaining({
          [feedbackField.id]: "Keep the navigation visible",
        }),
      );
    });

    it("keeps a directly persisted field value ahead of projected feedback", () => {
      const feedbackField: UIElement = {
        id: "feedback-field",
        type: ExtendedUIFieldType.Textarea,
        label: "Feedback",
        influences: [],
        required: false,
      };
      const conversationMessage = {
        message: {
          data: {
            type: "QUESTIONS",
            response: "Share feedback",
            uiElements: [feedbackField],
            influences: [],
          },
          responses: [
            {
              type: MessageType.User,
              data: {
                [feedbackField.id]: "Direct field response",
                payload: { feedback: "Projected workflow feedback" },
              },
            },
          ],
        },
      } as unknown as ConversationMessage;

      expect(
        prepareFormInitialData(conversationMessage, [feedbackField]),
      ).toEqual(
        expect.objectContaining({
          [feedbackField.id]: "Direct field response",
        }),
      );
    });
  });

  describe("prepareFormInitialData - coding prompts", () => {
    it("attaches the system message data to coding_prompt fields when no user response exists", () => {
      const codingPromptField: UIElement = {
        id: "coding-prompt-field",
        type: "coding_prompt",
        label: "Coding Prompt",
        influences: [],
        placeholder: "Say hello to the agent",
        required: false,
      };

      const codingPromptData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "System provided coding prompt content",
        title: "Generated Prompt",
        detectedIntent: "coding_prompts_iteration",
        intentConfidence: 1,
        reasoning: "agent loop",
        uiElements: [codingPromptField],
        influences: [],
      };

      const conversationMessage = {
        message: {
          data: codingPromptData,
          responses: [],
        },
      } as unknown as ConversationMessage;

      const result = prepareFormInitialData(conversationMessage, [
        codingPromptField,
      ]);

      expect(result[codingPromptField.id]).toEqual(codingPromptData);
    });

    it("prefers submitted startup plan response over payload when both exist", () => {
      const startupField: UIElement = {
        id: "startup-plan-field",
        type: "coding_prompt_startup_plan",
        label: "Startup Plan",
        influences: [],
        required: false,
        payload: {
          responseType: "startup_plan_v1",
          sessionTitle: "System startup plan",
          executionPlan: [],
          discrepancies: [
            {
              sourceRef: {
                sourceType: "task",
                sourceId: "task-1",
              },
              sourceExcerpt: "system excerpt",
              reasoning: "system reasoning",
              discrepancyText: "System discrepancy",
              severity: "medium",
            },
          ],
          clarificationQuestions: [],
        },
      };

      const startupData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "System provided startup plan",
        detectedIntent: "coding_prompts_iteration",
        intentConfidence: 1,
        reasoning: "agent loop",
        uiElements: [startupField],
        influences: [],
      };

      const submittedValue = {
        responseType: "startup_plan_v1",
        sessionTitle: "User submitted startup plan",
        executionPlan: [],
        discrepancies: [
          {
            sourceRef: {
              sourceType: "task",
              sourceId: "task-1",
            },
            sourceExcerpt: "user excerpt",
            reasoning: "user reasoning",
            discrepancyText: "User discrepancy",
            severity: "high",
          },
        ],
        clarificationQuestions: [],
        discrepancyDispositions: [
          {
            discrepancyIndex: 0,
            disposition: "acknowledged",
            note: "Persist this note",
          },
        ],
      };

      const conversationMessage = {
        message: {
          data: startupData,
          responses: [
            {
              type: MessageType.User,
              data: {
                [startupField.id]: submittedValue,
              },
            },
          ],
        },
      } as unknown as ConversationMessage;

      const result = prepareFormInitialData(conversationMessage, [
        startupField,
      ]);

      expect(result[startupField.id]).toEqual(submittedValue);
    });

    it("prefers submitted coding_prompt value over payload when both exist", () => {
      const codingPromptField: UIElement = {
        id: "coding-prompt-field",
        type: "coding_prompt",
        label: "Coding Prompt",
        influences: [],
        required: false,
        payload: {
          type: "CODING_PROMPTS",
          response: "System provided prompt",
          steps: ["Step 1"],
          outcomes: ["Outcome 1"],
        },
      };

      const codingPromptData: QuestionsSystemMessageData = {
        type: "QUESTIONS",
        response: "System coding prompt message",
        detectedIntent: "coding_prompts_iteration",
        intentConfidence: 1,
        reasoning: "agent loop",
        uiElements: [codingPromptField],
        influences: [],
      };

      const submittedValue = {
        type: "CODING_PROMPTS",
        userMessage: "User feedback",
        nextAction: "ACCEPT",
      };

      const conversationMessage = {
        message: {
          data: codingPromptData,
          responses: [
            {
              type: MessageType.User,
              data: {
                [codingPromptField.id]: submittedValue,
              },
            },
          ],
        },
      } as unknown as ConversationMessage;

      const result = prepareFormInitialData(conversationMessage, [
        codingPromptField,
      ]);

      expect(result[codingPromptField.id]).toEqual(submittedValue);
    });
  });

  describe("buildCodingPromptAcceptPayload", () => {
    const baseAction: SecondaryActionConfig = {
      id: "accept-coding-prompt",
      type: "field_action",
      label: "Accept",
      handler: SecondaryActionHandler.CodingPromptAccept,
      presentation: "BUTTON",
      fieldId: "coding-field",
    };

    const codingPromptField: UIElement = {
      id: "coding-field",
      type: "coding_prompt",
      label: "Coding Prompt",
      influences: [],
      required: false,
    };

    it("builds payload from system data response", () => {
      const formValues = {
        [codingPromptField.id]: {
          type: "CODING_PROMPTS",
          response: "system response text",
          steps: [],
          outcomes: [],
        },
      };

      const payload = buildCodingPromptAcceptPayload(formValues, baseAction);

      expect(payload?.[codingPromptField.id]).toMatchObject({
        userMessage: "system response text",
        type: "CODING_PROMPTS",
        nextAction: "ACCEPT",
      });
    });

    it("preserves user-entered coding prompt message object", () => {
      const formValues = {
        [codingPromptField.id]: {
          type: "CODING_PROMPTS",
          userMessage: "user feedback",
          nextAction: "GENERATE",
        },
      };

      const payload = buildCodingPromptAcceptPayload(formValues, baseAction);

      expect(payload?.[codingPromptField.id]).toMatchObject({
        userMessage: "user feedback",
        type: "CODING_PROMPTS",
        nextAction: "ACCEPT",
      });
    });

    it("handles raw string coding prompt value", () => {
      const formValues = {
        [codingPromptField.id]: "quick feedback",
      };

      const payload = buildCodingPromptAcceptPayload(formValues, baseAction);

      expect(payload?.[codingPromptField.id]).toMatchObject({
        userMessage: "quick feedback",
        type: "CODING_PROMPTS",
        nextAction: "ACCEPT",
      });
    });

    it("returns null when coding prompt field is missing", () => {
      const payload = buildCodingPromptAcceptPayload({}, baseAction);

      expect(payload).toBeNull();
    });
  });

  describe("createSecondActionFromAPI - implementation readiness", () => {
    it("submits a readiness disposition when the API fieldId is stale", () => {
      const readinessFieldId = "readiness-field";
      const action = {
        id: "readiness-dismiss-action",
        type: "field_action",
        label: "Dismiss",
        handler: SecondaryActionHandler.ImplementationReadinessDismiss,
        presentation: "BUTTON",
        fieldId: "stale-readiness-field",
        payload: {
          handlerType: "implementation_readiness_dismiss",
          runId: "run-1",
          sourceRevision: "sha256:source-1",
        },
      } satisfies SecondaryActionConfigWithHandler;
      const readinessContext = {
        ...mockContext,
        messageData: {
          type: "QUESTIONS",
          nodeId: "readiness-node",
        } as QuestionsSystemMessageData,
      };

      const secondAction = createSecondActionFromAPI(
        action,
        readinessContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: readinessFieldId,
            type: ExtendedUIFieldType.ImplementationReadiness,
            label: "Implementation readiness",
          },
        ],
      );

      expect(secondAction.submitsForm).toBe(true);
      secondAction.onExecute({});

      expect(mockHandleNext).toHaveBeenCalledWith(
        {
          [readinessFieldId]: {
            action: SecondaryActionHandler.ImplementationReadinessDismiss,
            payload: {
              runId: "run-1",
              sourceRevision: "sha256:source-1",
              confirmed: true,
            },
          },
        },
        messageId,
        {
          handler: SecondaryActionHandler.ImplementationReadinessDismiss,
          nodeId: "readiness-node",
        },
      );
    });
  });

  describe("createSecondActionFromAPI - visual preview feedback textarea", () => {
    it("submits textarea feedback through the visual-preview refine action", () => {
      const fieldId = "visual-preview-feedback";
      const action = {
        id: "visual-preview-revise-action",
        type: "field_action",
        label: "Continue Revising",
        handler:
          SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
        presentation: "BUTTON",
        fieldId,
      } satisfies SecondaryActionConfigWithHandler;

      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: fieldId,
            type: ExtendedUIFieldType.Textarea,
            label: "Feedback on the visual plan preview",
          },
        ],
      );

      expect(secondAction.submitsForm).toBe(true);
      expect(secondAction.variant).toBe("text");
      secondAction.onExecute({ [fieldId]: "Show the empty state" });

      expect(mockHandleNext).toHaveBeenCalledWith(
        {
          [fieldId]: {
            action: "REFINE",
            payload: { feedback: "Show the empty state" },
          },
        },
        messageId,
        { handler: action.handler },
      );
    });

    it("submits an empty payload through the visual-preview approve action", () => {
      const fieldId = "visual-preview-feedback";
      const action = {
        id: "visual-preview-approve-action",
        type: "field_action",
        label: "Approve Visual Set",
        handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
        presentation: "BUTTON",
        fieldId,
      } satisfies SecondaryActionConfigWithHandler;

      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: fieldId,
            type: ExtendedUIFieldType.Textarea,
            label: "Feedback on the visual plan preview",
          },
        ],
      );

      expect(secondAction.submitsForm).toBe(true);
      expect(secondAction.variant).toBe("contained");
      secondAction.onExecute({ [fieldId]: "" });

      expect(mockHandleNext).toHaveBeenCalledWith(
        {
          [fieldId]: {
            action: "APPROVED",
            payload: {},
          },
        },
        messageId,
        { handler: action.handler },
      );
    });
  });

  describe("createSecondActionFromAPI - plan gap continue revising", () => {
    it("submits plan gap values with continue revising nextAction", () => {
      const action = {
        id: "plan-gap-action",
        type: "field_action",
        label: "Continue Revising",
        handler: "plan_gap_continue_revising",
        presentation: "BUTTON",
        fieldId: "gap-field",
      };

      const formValues = {
        [action.fieldId]: {
          type: PlanGapDiscoveryMessageType.PlanGaps,
          nextAction: PlanGapDiscoveryNextAction.ReadyForNextStep,
          gapReviews: [],
          existingReviews: [],
          manuallyAdded: [],
          clarifyingAnswers: [],
        },
      };

      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: action.fieldId,
            type: "plan_gaps_tasks",
            label: "Plan Gaps",
            influences: [],
            required: false,
          },
        ],
      );

      expect(secondAction.submitsForm).toBe(true);
      secondAction.onExecute(formValues);

      expect(mockHandleNext).toHaveBeenCalledWith(
        expect.objectContaining({
          [action.fieldId]: expect.objectContaining({
            nextAction: PlanGapDiscoveryNextAction.ContinueRevising,
          }),
        }),
        messageId,
        { handler: action.handler },
      );
    });
  });

  describe("createSecondActionFromAPI - plan approval continue revising", () => {
    it("submits plan approval values with continue revising nextAction", async () => {
      const action = {
        id: "plan-approval-action",
        type: "field_action",
        label: "Continue Revising",
        handler: "plan_approval_continue_revising",
        presentation: "BUTTON",
        fieldId: "plan-approval-field",
      };

      const formValues = {
        [action.fieldId]: {
          type: "PLAN_APPROVAL",
          nextAction: PlanApprovalNextAction.Approve,
          userMessage: "",
          description: {
            approach: "Approach",
            outcome: "Outcome",
            verification: "Verification",
          },
          workstreams: [],
        },
      };

      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: action.fieldId,
            type: "plan_approval",
            label: "Plan Approval",
            influences: [],
            required: false,
          },
        ],
      );

      expect(secondAction.submitsForm).toBe(true);
      await secondAction.onExecute(formValues);

      expect(mockHandleNext).toHaveBeenCalledWith(
        expect.objectContaining({
          [action.fieldId]: expect.objectContaining({
            nextAction: PlanApprovalNextAction.ContinueRevising,
          }),
        }),
        messageId,
        { handler: action.handler },
      );
    });
  });

  describe("createSecondActionFromAPI - plan stage continue revising", () => {
    it("submits plan stage values with continue revising nextAction", () => {
      const action = {
        id: "plan-stage-action",
        type: "field_action",
        label: "Continue Revising",
        handler: "plan_stage_continue_revising",
        presentation: "BUTTON",
        fieldId: "plan-stage-field",
      };

      const formValues = {
        [action.fieldId]: {
          type: "PLAN_STAGE_PROPOSAL",
          nextAction: PlanStageProposalNextAction.ReadyForNextStep,
          userMessage: "",
          stages: [],
          stageFeedback: [],
        },
      };

      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [
          {
            id: action.fieldId,
            type: "plan_stage_proposal",
            label: "Plan Stage",
            influences: [],
            required: false,
          },
        ],
      );

      expect(secondAction.submitsForm).toBe(true);
      secondAction.onExecute(formValues);

      expect(mockHandleNext).toHaveBeenCalledWith(
        expect.objectContaining({
          [action.fieldId]: expect.objectContaining({
            nextAction: PlanStageProposalNextAction.ContinueRevising,
          }),
        }),
        messageId,
        { handler: action.handler },
      );
    });
  });

  describe("createSecondActionFromAPI - next step button", () => {
    it("does not mark render-only next_step actions as submitting", () => {
      const action = {
        id: "next-step-action",
        type: "form_action",
        label: "Next Step",
        handler: "next_step",
        presentation: "BUTTON",
        fieldId: null,
        payload: {
          handlerType: "next_step",
          nextStep: "Review the generated plan.",
        },
      };

      const secondAction = createSecondActionFromAPI(
        action,
        mockContext,
        mockTrackUI,
        messageId,
        mockHandleNext,
        [],
      );

      expect(secondAction.submitsForm).toBe(false);
      secondAction.onExecute({});
      expect(mockHandleNext).not.toHaveBeenCalled();
    });
  });
});
