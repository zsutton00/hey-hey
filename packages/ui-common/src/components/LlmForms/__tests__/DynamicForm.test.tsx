import React from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { DynamicForm, applyPrimaryNextActionOverrides } from "../DynamicForm";
import type { UIElement } from "../../../api";
import {
  ExtendedUIFieldType,
  MessageStatus,
  MessageType,
  SystemMessageDataTypeEnum,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import type { FieldComponentProps } from "../Registry/types";
import type { FormValue } from "../types";
import type { SecondAction } from "../types";
import { useConversationEvents } from "../../Conversation/hooks/useConversationEvents";

// Mock the registry components
vi.mock("../Registry", () => ({
  FIELD_REGISTRY: {
    select: {
      Component: ({ config, onChange }: FieldComponentProps<string>) => (
        <div>
          {config.selectOptions?.map((option) => (
            <button
              type="button"
              key={option.value}
              onClick={() => onChange?.(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ),
      getHasContent: (value: FormValue | undefined) =>
        typeof value === "string" && value.length > 0,
    },
    text: {
      Component: ({ config, value, onChange }: FieldComponentProps<string>) => (
        <input
          data-testid={`field-${config.field}`}
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={config.placeholder}
          required={config.required}
        />
      ),
      getHasContent: (value: FormValue | undefined) =>
        typeof value === "string" && value.trim().length > 0,
    },
    textarea: {
      Component: ({ config, value, onChange }: FieldComponentProps<string>) => (
        <textarea
          data-testid={`field-${config.field}`}
          value={value || ""}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={config.placeholder}
          required={config.required}
        />
      ),
      getHasContent: (value: FormValue | undefined) =>
        typeof value === "string" && value.trim().length > 0,
    },
    repository_grounding_intent: {
      Component: ({ config, value, onChange }: FieldComponentProps) => (
        <div>
          <button
            type="button"
            data-testid={`field-${config.field}-yes`}
            onClick={() => onChange?.({ choice: "yes" })}
          >
            Import existing work
          </button>
          <output data-testid={`field-${config.field}-value`}>
            {value && typeof value === "object" && "choice" in value
              ? String(value.choice)
              : "unanswered"}
          </output>
        </div>
      ),
      getHasContent: (value: FormValue | undefined) =>
        typeof value === "object" &&
        value !== null &&
        "choice" in value &&
        (value.choice === "yes" || value.choice === "no"),
    },
    verify_feature: {
      Component: () => (
        <div data-testid="verify-feature-field">Verification explanation</div>
      ),
      getHasContent: () => false,
    },
    plan_shaping_feature_sync_review: {
      Component: ({ config, onSubmit }: FieldComponentProps) => (
        <button
          type="button"
          data-testid={`field-${config.field}-keyboard-submit`}
          onClick={onSubmit}
        />
      ),
      fieldSubmitHandler: "plan_shaping_feature_sync_review_request_revisions",
      getHasContent: () => true,
    },
    coding_prompt: {
      Component: ({
        config,
        value,
        onChange,
      }: FieldComponentProps<{
        userMessage: string;
        type: string;
        nextAction: string;
      }>) => (
        <input
          data-testid={`field-${config.field}`}
          value={
            value && typeof value === "object" && "userMessage" in value
              ? value.userMessage
              : ""
          }
          onChange={(e) =>
            onChange?.({
              userMessage: e.target.value,
              type: "CODING_PROMPTS",
              nextAction: "ACCEPT",
            })
          }
        />
      ),
      getHasContent: (value: FormValue | undefined) =>
        typeof value === "object" &&
        value !== null &&
        "userMessage" in value &&
        typeof value.userMessage === "string" &&
        value.userMessage.trim().length > 0,
    },
    validity: {
      Component: ({ config, onValidityChange }: FieldComponentProps) => (
        <div>
          <button
            type="button"
            data-testid={`field-${config.field}-invalid`}
            onClick={() => onValidityChange?.("invalid")}
          >
            Mark invalid
          </button>
          <button
            type="button"
            data-testid={`field-${config.field}-valid`}
            onClick={() => onValidityChange?.("valid")}
          >
            Mark valid
          </button>
        </div>
      ),
      getHasContent: () => true,
    },
  },
  getRegistryType: (input: string | { id?: string; type: string }) => {
    if (
      typeof input !== "string" &&
      input.id === "repository_grounding_intent"
    ) {
      return "repository_grounding_intent";
    }
    const type = typeof input === "string" ? input : input.type;
    return type === "repository_grounding_intent"
      ? "repository_grounding_intent"
      : type === "text_input"
      ? "text"
      : type;
  },
}));

vi.mock("../../Conversation/SecondaryActionRenderer", () => ({
  SecondaryActionRenderer: ({
    action,
  }: {
    action: { id: string; label: string };
  }) => (
    <button type="button" data-testid={`inline-secondary-${action.id}`}>
      {action.label}
    </button>
  ),
}));

// Mock the tracking contexts
vi.mock("../../../contexts/TrackingContext", () => ({
  useFormTracking: () => ({
    trackFormStart: vi.fn(),
    trackFieldChange: vi.fn(),
    trackSubmitSuccess: vi.fn(),
  }),
  useUserAction: () => ({
    trackUI: vi.fn(),
  }),
}));

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

// Mock MUI theme
vi.mock("@mui/material", async () => {
  const actual = await vi.importActual("@mui/material");
  return {
    ...actual,
    useTheme: () => ({
      palette: {
        mode: "light",
        divider: "#e0e0e0",
        common: {
          white: "#ffffff",
        },
        actionable: {
          main: "#1976d2",
          dark: "#115293",
          contrastText: "#fff",
        },
        primary: {
          main: "#1976d2",
          dark: "#115293",
          contrastText: "#fff",
        },
        action: {
          disabled: "#999999",
          disabledBackground: "#e0e0e0",
        },
        text: {
          primary: "#000000",
          secondary: "#666666",
          disabled: "#999999",
        },
        grey: {
          50: "#fafafa",
          100: "#f5f5f5",
          300: "#e0e0e0",
          500: "#9e9e9e",
          600: "#757575",
          800: "#424242",
          900: "#212121",
        },
      },
    }),
  };
});

// AnimatedButton is not mocked - we use the real component

describe("DynamicForm", () => {
  it("projects the primary Coding Plan action as APPROVED without a UI decision", () => {
    expect(
      applyPrimaryNextActionOverrides({
        "startup-plan-field": {
          responseType: "startup_plan_v1",
          sessionTitle: "Canonical actions",
          requiredServiceIds: ["service-1"],
          primaryImplementations: [],
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
          feedback: "Keep this approval note",
          decision: "improve",
        },
      })
    ).toEqual({
      "startup-plan-field": {
        action: "APPROVED",
        payload: {
          responseType: "startup_plan_v1",
          sessionTitle: "Canonical actions",
          requiredServiceIds: ["service-1"],
          primaryImplementations: [],
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
          feedback: "Keep this approval note",
        },
      },
      comment: expect.stringContaining("Keep this approval note"),
    });
  });
  const defaultContext = {
    conversationId: "test-conversation-id",
    projectId: "test-project-id",
    organizationId: "test-org-id",
    interaction: { proposals: [] },
  };

  const mockOnNext = vi.fn();
  const baseConversationMessage: ConversationMessage = {
    message: {
      id: "message-1",
      workflowId: "workflow-1",
      projectId: "test-project-id",
      type: MessageType.System,
      status: MessageStatus.Open,
      data: {
        type: SystemMessageDataTypeEnum.Noop,
      },
      conversationId: "test-conversation-id",
      createdAt: new Date().toISOString(),
      awaitingResponse: false,
    },
    state: "open",
    canEdit: false,
  };

  const defaultProps: React.ComponentProps<typeof DynamicForm> = {
    context: defaultContext,
    uiElements: [],
    isSubmitted: false,
    isSubmittable: true,
    onNext: mockOnNext,
    showSkeleton: false,
    conversationMessage: baseConversationMessage,
  };

  const renderForm = (
    props: Partial<React.ComponentProps<typeof DynamicForm>>
  ) => render(<DynamicForm {...defaultProps} {...props} />);

  const createSecondAction = (
    overrides: Partial<SecondAction> = {}
  ): SecondAction => ({
    type: "skip",
    label: "Skip Step",
    onExecute: vi.fn(),
    submitsForm: false,
    presentation: "BUTTON",
    ...overrides,
  });

  const createUIElement = (overrides: Partial<UIElement> = {}): UIElement => ({
    id: typeof overrides.id === "string" ? overrides.id : "test-field",
    type: ExtendedUIFieldType.TextInput,
    label: "Test Field",
    influences: [],
    required: false,
    field:
      typeof overrides.field === "string"
        ? overrides.field
        : typeof overrides.id === "string"
        ? overrides.id
        : "test-field",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe("basic rendering", () => {
    it("should render form with UI elements", () => {
      const uiElements = [createUIElement({ label: "Test Input" })];

      renderForm({ uiElements });

      expect(screen.getByTestId("dynamic-form")).toBeInTheDocument();
      expect(screen.getByTestId("field-test-field")).toBeInTheDocument();
      expect(
        screen.getByTestId("registry-field-root-text-test-field")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId(
          "registry-field-root-message-message-1-text-test-field"
        )
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeInTheDocument();
    });

    it("accepts and submits the typed existing-work intent value", async () => {
      const user = userEvent.setup();
      const fieldId = "repository_grounding_intent";
      const uiElements = [
        createUIElement({
          id: fieldId,
          type: ExtendedUIFieldType.Select,
          required: true,
        }),
      ];

      renderForm({ uiElements });

      expect(screen.getByTestId(`field-${fieldId}-value`)).toHaveTextContent(
        "unanswered"
      );
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeDisabled();

      await user.click(screen.getByTestId(`field-${fieldId}-yes`));
      expect(screen.getByTestId(`field-${fieldId}-value`)).toHaveTextContent(
        "yes"
      );
      await user.click(screen.getByTestId("run-stream-external-reply-submit"));

      await waitFor(() =>
        expect(mockOnNext).toHaveBeenCalledWith(
          {
            [fieldId]: { choice: "yes" },
          },
          undefined
        )
      );
    });

    it("places Verify Feature explanation before its inline action only", () => {
      const verifyFieldId = "verify-feature-field";
      const verifyField = createUIElement({
        id: verifyFieldId,
        field: verifyFieldId,
        type: ExtendedUIFieldType.VerifyFeature,
        payload: {
          feature: {
            entityType: "FEATURE",
            entityId: "feature-1",
          },
          explanation: "A feature changed.",
        },
        secondaryAction: {
          id: "verify-action",
          type: "field_action",
          label: "Start a conversation to verify this feature",
          fieldId: verifyFieldId,
          handler: "verify_feature",
          presentation: "INLINE",
        },
      });
      const textField = createUIElement({
        id: "text-with-action",
        secondaryAction: {
          id: "text-action",
          type: "field_action",
          label: "Text action",
          fieldId: "text-with-action",
          handler: "continue_conversation",
          presentation: "INLINE",
        },
      });

      renderForm({ uiElements: [verifyField, textField] });

      const verifyExplanation = screen.getByTestId("verify-feature-field");
      const verifyAction = screen.getByTestId("inline-secondary-verify-action");
      const verifyRoot = screen.getByTestId(
        "registry-field-root-message-message-1-verify_feature-verify-feature-field"
      );
      const verifyRootStyle = window.getComputedStyle(verifyRoot);
      expect(verifyRootStyle.borderStyle).toBe("solid");
      expect(verifyRootStyle.borderWidth).toBe("1px");
      expect(verifyRootStyle.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(verifyRootStyle.marginTop).toBe("8px");
      expect(verifyRoot).toContainElement(verifyAction);
      expect(
        window.getComputedStyle(verifyAction.parentElement as HTMLElement)
          .marginTop
      ).toBe("16px");
      expect(
        verifyExplanation.compareDocumentPosition(verifyAction) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      const textAction = screen.getByTestId("inline-secondary-text-action");
      const textFieldRoot = screen.getByTestId(
        "registry-field-root-text-text-with-action"
      );
      expect(
        textAction.compareDocumentPosition(textFieldRoot) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("should render submit button with default icon when submitText is not provided", () => {
      const uiElements = [createUIElement()];

      renderForm({ uiElements });

      expect(
        screen
          .getByTestId("run-stream-external-reply-submit")
          .querySelector("svg")
      ).toBeInTheDocument();
    });
  });

  describe("submitText functionality", () => {
    it("should use submitText from first UI element when provided", () => {
      const uiElements = [
        createUIElement({
          submitText: "Create Initiative",
        }),
      ];

      renderForm({ uiElements });

      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toHaveTextContent("Create Initiative");
    });

    it("should use submitText from first UI element with submitText when multiple elements exist", () => {
      const uiElements = [
        createUIElement({
          id: "field1",
          // No submitText
        }),
        createUIElement({
          id: "field2",
          submitText: "Generate Tasks",
        }),
        createUIElement({
          id: "field3",
          submitText: "Save Changes", // This should be ignored
        }),
      ];

      renderForm({ uiElements });

      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toHaveTextContent("Generate Tasks");
    });

    it("should fallback to default icon when no UI element has submitText", () => {
      const uiElements = [
        createUIElement({ id: "field1" }),
        createUIElement({ id: "field2" }),
      ];

      renderForm({ uiElements });

      expect(
        screen
          .getByTestId("run-stream-external-reply-submit")
          .querySelector("svg")
      ).toBeInTheDocument();
    });

    it("should handle empty uiElements array gracefully", () => {
      renderForm({ uiElements: [] });

      expect(
        screen
          .getByTestId("run-stream-external-reply-submit")
          .querySelector("svg")
      ).toBeInTheDocument();
    });

    it("should handle undefined/null submitText gracefully", () => {
      const uiElements = [
        createUIElement({
          submitText: undefined,
        }),
      ];

      renderForm({ uiElements });

      expect(
        screen
          .getByTestId("run-stream-external-reply-submit")
          .querySelector("svg")
      ).toBeInTheDocument();
    });

    it("should handle empty string submitText by falling back to default", () => {
      const uiElements = [
        createUIElement({
          submitText: "",
        }),
      ];

      renderForm({ uiElements });

      expect(
        screen
          .getByTestId("run-stream-external-reply-submit")
          .querySelector("svg")
      ).toBeInTheDocument();
    });
  });

  describe("form submission", () => {
    it("passes labeled enrichment choices through to the server as their typed values", async () => {
      const user = userEvent.setup();
      renderForm({
        uiElements: [
          createUIElement({
            id: "repository_feature_enrichment_choice",
            type: ExtendedUIFieldType.Select,
            label: "Add more detail?",
            options: [
              { value: "ENRICH", label: "Enrich details" },
              { value: "SKIP", label: "Continue with this outline" },
            ],
          }),
        ],
      });
      await user.click(
        screen.getByRole("button", { name: "Continue with this outline" })
      );
      await user.click(screen.getByTestId("run-stream-external-reply-submit"));
      await waitFor(() =>
        expect(mockOnNext).toHaveBeenCalledWith(
          { repository_feature_enrichment_choice: "SKIP" },
          undefined
        )
      );
    });
    it("should call onNext with form data when submitted", async () => {
      const user = userEvent.setup();
      const uiElements = [
        createUIElement({
          id: "test-input",
          label: "Test Input",
          submitText: "Submit Test",
        }),
      ];

      renderForm({ uiElements });

      // Fill in the form
      const input = screen.getByTestId("field-test-input");
      await user.type(input, "test value");

      // Submit the form
      const submitButton = screen.getByTestId(
        "run-stream-external-reply-submit"
      );
      expect(submitButton).toHaveTextContent("Submit Test");

      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnNext).toHaveBeenCalledWith(
          {
            "test-input": "test value",
          },
          undefined
        );
      });
    });

    it("should disable submit button when no content is provided", () => {
      const uiElements = [createUIElement({ required: true })];

      renderForm({ uiElements });

      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeDisabled();
    });

    it("should enable submit button when content is provided", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement()];

      renderForm({ uiElements });

      const input = screen.getByTestId("field-test-field");
      await user.type(input, "some content");

      await waitFor(() => {
        expect(
          screen.getByTestId("run-stream-external-reply-submit")
        ).not.toBeDisabled();
      });
    });

    it("should block submit while a field reports invalid scope and recover when valid", async () => {
      const user = userEvent.setup();
      const uiElements = [
        createUIElement({
          id: "service-scope",
          type: "validity" as ExtendedUIFieldType,
        }),
      ];

      renderForm({ uiElements });

      const submitButton = screen.getByTestId(
        "run-stream-external-reply-submit"
      );
      expect(submitButton).not.toBeDisabled();

      await user.click(screen.getByTestId("field-service-scope-invalid"));
      await waitFor(() => expect(submitButton).toBeDisabled());

      fireEvent.submit(screen.getByTestId("dynamic-form"));
      expect(mockOnNext).not.toHaveBeenCalled();

      await user.click(screen.getByTestId("field-service-scope-valid"));
      await waitFor(() => expect(submitButton).not.toBeDisabled());
    });
  });

  describe("form state management", () => {
    it("should not show submit button when form is submitted", () => {
      const uiElements = [createUIElement()];

      renderForm({ uiElements, isSubmitted: true });

      expect(screen.queryByTestId("submit-button")).not.toBeInTheDocument();
    });

    it("should disable form when disabled prop is true", () => {
      const uiElements = [createUIElement()];

      renderForm({ uiElements, disabled: true });

      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeDisabled();
    });

    it("should populate initial data correctly", () => {
      const uiElements = [createUIElement({ id: "test-field" })];
      const initialData = { "test-field": "initial value" };

      renderForm({ uiElements, initialData });

      expect(screen.getByTestId("field-test-field")).toHaveValue(
        "initial value"
      );
    });

    it("should clear text fields on submission-success when composerResetMode is clearOnSuccess", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];

      renderForm({
        uiElements,
        composerResetMode: "clearOnSuccess",
      });

      const input = screen.getByTestId("field-message-input");
      await user.type(input, "hello");
      expect(input).toHaveValue("hello");

      const { result: events } = renderHook(() =>
        useConversationEvents(defaultContext.conversationId)
      );
      act(() => {
        events.current.emit({
          type: "submission-success",
          payload: {
            messageId: baseConversationMessage.message.id,
            data: { "message-input": "hello" },
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("field-message-input")).toHaveValue("");
      });
    });

    it("should preserve text field values when composerResetMode is preserve", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];

      renderForm({
        uiElements,
        composerResetMode: "preserve",
      });

      const input = screen.getByTestId("field-message-input");
      await user.type(input, "hello");
      expect(input).toHaveValue("hello");

      const { result: events } = renderHook(() =>
        useConversationEvents(defaultContext.conversationId)
      );
      act(() => {
        events.current.emit({
          type: "submission-success",
          payload: {
            messageId: baseConversationMessage.message.id,
            data: { "message-input": "hello" },
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("field-message-input")).toHaveValue("hello");
      });
    });

    it("should not clear when submission-success is for a different message", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];

      renderForm({
        uiElements,
        composerResetMode: "clearOnSuccess",
      });

      const input = screen.getByTestId("field-message-input");
      await user.type(input, "hello");
      expect(input).toHaveValue("hello");

      const { result: events } = renderHook(() =>
        useConversationEvents(defaultContext.conversationId)
      );
      act(() => {
        events.current.emit({
          type: "submission-success",
          payload: {
            messageId: "different-message-id",
            data: { "message-input": "hello" },
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("field-message-input")).toHaveValue("hello");
      });
    });

    it("should clear coding_prompt userMessage on submission-success", async () => {
      const user = userEvent.setup();
      const uiElements = [
        createUIElement({
          id: "coding-prompt-input",
          type: "coding_prompt" as UIElement["type"],
        }),
      ];

      renderForm({
        uiElements,
        composerResetMode: "clearOnSuccess",
      });

      const input = screen.getByTestId("field-coding-prompt-input");
      await user.type(input, "ship this");
      expect(input).toHaveValue("ship this");

      const { result: events } = renderHook(() =>
        useConversationEvents(defaultContext.conversationId)
      );
      act(() => {
        events.current.emit({
          type: "submission-success",
          payload: {
            messageId: baseConversationMessage.message.id,
            data: {},
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("field-coding-prompt-input")).toHaveValue("");
      });
    });

    it("should preserve the draft until the matching submission succeeds", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "judgment-input" })];
      const storageKey = "form-draft-test-project-id-test-conversation-id";

      renderForm({
        uiElements,
        composerResetMode: "clearOnSuccess",
      });

      const input = screen.getByTestId("field-judgment-input");
      await user.type(input, "Keep this judgment if posting fails");
      await waitFor(() => {
        expect(localStorage.getItem(storageKey)).not.toBeNull();
      });

      await user.click(screen.getByTestId("run-stream-external-reply-submit"));

      const { result: events } = renderHook(() =>
        useConversationEvents(defaultContext.conversationId)
      );
      act(() => {
        events.current.emit({
          type: "submission-error",
          payload: {
            error: new Error("post failed"),
            data: { "judgment-input": "Keep this judgment if posting fails" },
            parentMessageId: baseConversationMessage.message.id,
          },
        });
      });

      expect(screen.getByTestId("field-judgment-input")).toHaveValue(
        "Keep this judgment if posting fails"
      );
      expect(localStorage.getItem(storageKey)).not.toBeNull();

      act(() => {
        events.current.emit({
          type: "submission-success",
          payload: {
            messageId: baseConversationMessage.message.id,
            data: { "judgment-input": "Keep this judgment if posting fails" },
          },
        });
      });

      await waitFor(() => {
        expect(localStorage.getItem(storageKey)).toBeNull();
        expect(screen.getByTestId("field-judgment-input")).toHaveValue("");
      });
    });
  });

  describe("streaming UI element updates", () => {
    it("should preserve existing values and apply defaults when new fields stream in", async () => {
      const user = userEvent.setup();
      const initialElements = [
        createUIElement({ id: "field1", field: "field1", label: "Field 1" }),
      ];

      const { rerender } = renderForm({ uiElements: initialElements });

      const firstInput = screen.getByTestId("field-field1") as HTMLInputElement;
      await user.type(firstInput, "hello");

      expect(firstInput).toHaveValue("hello");

      const updatedElements = [
        ...initialElements,
        createUIElement({
          id: "field2",
          field: "field2",
          label: "Field 2",
          required: true,
        }),
      ];

      rerender(
        <DynamicForm
          {...defaultProps}
          uiElements={updatedElements}
          initialData={{ field2: "prefilled" }}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId("field-field1")).toHaveValue("hello");
      });
      const streamedField = await waitFor(
        () => screen.getByTestId("field-field2") as HTMLInputElement
      );
      expect(streamedField).toHaveValue("prefilled");

      await user.clear(streamedField);
      await user.type(streamedField, "updated");

      expect(streamedField).toHaveValue("updated");
    });
  });

  describe("secondary actions", () => {
    it("should render secondary action button when provided", () => {
      const uiElements = [createUIElement()];
      const secondActions = [createSecondAction()];

      renderForm({ uiElements, secondActions });

      expect(screen.getByText("Skip Step")).toBeInTheDocument();
    });

    it("renders contained secondary actions with the primary palette", () => {
      const action = createSecondAction({
        label: "Revise",
        variant: "contained",
        testId: "contained-secondary-action",
      });

      renderForm({
        uiElements: [createUIElement()],
        secondActions: [action],
      });

      expect(screen.getByTestId("contained-secondary-action")).toHaveStyle({
        backgroundColor: "#1976d2",
        color: "#fff",
      });
    });

    it("explains unavailable secondary actions with an accessible tooltip", async () => {
      const user = userEvent.setup();
      const action = createSecondAction({
        label: "Ready for next step",
        testId: "ready-action",
        getAvailability: () => ({
          disabled: true,
          reason: "Approve every proposed stage first.",
        }),
      });

      renderForm({ uiElements: [createUIElement()], secondActions: [action] });

      const button = screen.getByTestId("ready-action");
      expect(button).toBeDisabled();
      await user.hover(button.parentElement!);
      expect(
        await screen.findByText("Approve every proposed stage first.")
      ).toBeInTheDocument();
    });

    it("keeps enabled and reasonless secondary actions free of tooltips", async () => {
      const user = userEvent.setup();
      const enabled = createSecondAction({
        label: "Enabled",
        testId: "enabled-action",
        getAvailability: () => ({ disabled: false }),
      });
      const reasonless = createSecondAction({
        label: "Reasonless",
        testId: "reasonless-action",
        getAvailability: () => ({ disabled: true }),
      });

      renderForm({
        uiElements: [createUIElement()],
        secondActions: [enabled, reasonless],
      });

      expect(screen.getByTestId("enabled-action")).not.toBeDisabled();
      expect(screen.getByTestId("reasonless-action")).toBeDisabled();
      await user.hover(screen.getByTestId("reasonless-action").parentElement!);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });

    it("should render submit button with custom text alongside secondary action", () => {
      const uiElements = [createUIElement({ submitText: "Continue" })];
      const secondActions = [createSecondAction()];

      renderForm({ uiElements, secondActions });

      expect(screen.getByText("Skip Step")).toBeInTheDocument();
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toHaveTextContent("Continue");
    });

    it("should keep footer buttons visible when a non-submitting secondary action is clicked", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];
      const secondAction = createSecondAction();

      renderForm({ uiElements, secondActions: [secondAction] });

      const input = screen.getByTestId("field-message-input");
      await user.type(input, "hello");
      await user.click(screen.getByText("Skip Step"));

      expect(secondAction.onExecute).toHaveBeenCalledWith({
        "message-input": "hello",
      });
      expect(
        screen.getByTestId("run-stream-external-reply-submit")
      ).toBeInTheDocument();
      expect(screen.getByText("Skip Step")).toBeInTheDocument();
    });

    it("should disable secondary action buttons immediately on click", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];
      const firstAction = createSecondAction({
        label: "Approve",
        testId: "approve-action",
      });
      const secondAction = createSecondAction({
        label: "Skip Step",
        testId: "skip-action",
      });

      renderForm({ uiElements, secondActions: [firstAction, secondAction] });

      const approveButton = screen.getByTestId("approve-action");
      const skipButton = screen.getByTestId("skip-action");
      expect(approveButton).not.toBeDisabled();
      expect(skipButton).not.toBeDisabled();

      await user.click(approveButton);

      expect(firstAction.onExecute).toHaveBeenCalledTimes(1);
      expect(approveButton).toBeDisabled();
      expect(skipButton).toBeDisabled();
    });

    it("should re-enable secondary action buttons after submission-error", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];
      const action = createSecondAction({
        label: "Approve",
        testId: "approve-action",
      });

      renderForm({ uiElements, secondActions: [action] });

      const approveButton = screen.getByTestId("approve-action");
      await user.click(approveButton);
      expect(approveButton).toBeDisabled();

      const { result: events } = renderHook(() =>
        useConversationEvents(defaultContext.conversationId)
      );
      act(() => {
        events.current.emit({
          type: "submission-error",
          payload: {
            error: new Error("boom"),
            data: {},
            parentMessageId: baseConversationMessage.message.id,
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId("approve-action")).not.toBeDisabled();
      });
    });

    it("should immediately hide footer buttons when a submitting secondary action is clicked", async () => {
      const user = userEvent.setup();
      const uiElements = [createUIElement({ id: "message-input" })];
      const secondAction = createSecondAction({
        submitsForm: true,
      });

      renderForm({ uiElements, secondActions: [secondAction] });

      const input = screen.getByTestId("field-message-input");
      await user.type(input, "hello");

      const secondaryButton = screen.getByText("Skip Step");
      await user.click(secondaryButton);

      expect(secondAction.onExecute).toHaveBeenCalledWith({
        "message-input": "hello",
      });
      await waitFor(() => {
        expect(
          screen.queryByTestId("run-stream-external-reply-submit")
        ).not.toBeInTheDocument();
      });
      expect(screen.queryByText("Skip Step")).not.toBeInTheDocument();
    });

    it("routes the feature-sync field submit through the typed action and guards in-flight duplicates", async () => {
      const user = userEvent.setup();
      const fieldId = "feature-sync-review-field";
      const action = createSecondAction({
        fieldId,
        handler: "plan_shaping_feature_sync_review_request_revisions",
        submitsForm: true,
      });
      const uiElements = [
        createUIElement({
          id: fieldId,
          field: fieldId,
          type: ExtendedUIFieldType.PlanShapingFeatureSyncReview,
        }),
      ];

      renderForm({ uiElements, secondActions: [action] });

      const keyboardSubmit = screen.getByTestId(
        `${"field"}-${fieldId}-keyboard-submit`
      );
      await user.click(keyboardSubmit);
      await user.click(keyboardSubmit);

      expect(action.onExecute).toHaveBeenCalledTimes(1);
    });

    it("does not invoke the feature-sync field submit while the form is disabled", async () => {
      const user = userEvent.setup();
      const fieldId = "feature-sync-review-field";
      const action = createSecondAction({
        fieldId,
        handler: "plan_shaping_feature_sync_review_request_revisions",
        submitsForm: true,
      });

      renderForm({
        disabled: true,
        uiElements: [
          createUIElement({
            id: fieldId,
            field: fieldId,
            type: ExtendedUIFieldType.PlanShapingFeatureSyncReview,
          }),
        ],
        secondActions: [action],
      });

      await user.click(
        screen.getByTestId(`${"field"}-${fieldId}-keyboard-submit`)
      );

      expect(action.onExecute).not.toHaveBeenCalled();
    });
  });
});
