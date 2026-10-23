import { fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CodingPromptField } from "./CodingPromptField";
import type { FieldConfig } from "./types";
import type { SmartTextAreaCardProps } from "../../SmartTextAreaCard";

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({
    currentOrgId: "test-org-id",
  }),
}));

vi.mock("../../../hooks/useEditorContext", () => ({
  useProjectIds: () => null,
}));

vi.mock("../../../data/hooks/useEntitySearch", () => ({
  useEntitySearch: () => ({
    searchEntities: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock("../../SmarterTextAreaCard/MentionPlugin", () => ({
  MentionPlugin: () => null,
}));

vi.mock("../../Selectors/ServiceSelector", () => ({
  ServiceSelector: () => <div data-testid="mock-service-selector" />,
}));

vi.mock("../../Selectors/ImplementationHintsSelector", () => ({
  ImplementationHintsSelector: () => <div data-testid="mock-hints-selector" />,
}));

const hoistedMocks = vi.hoisted(() => ({
  MockSmartTextAreaCard: ({
    value,
    onChange,
    disabled,
    helperText,
    error,
    placeholder,
    headerText,
    "data-testid": dataTestId,
  }: SmartTextAreaCardProps & { "data-testid"?: string }) => (
    <div>
      {headerText && <div>{headerText}</div>}
      <textarea
        data-testid={dataTestId ?? "smarter-textarea-input"}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error}
        onChange={(event) => onChange(event.target.value)}
      />
      {helperText && <span>{helperText}</span>}
    </div>
  ),
}));

vi.mock("../../SmartTextAreaCard", () => ({
  SmartTextAreaCard: hoistedMocks.MockSmartTextAreaCard,
}));

vi.mock("@mui/material", async () => {
  const actual = await vi.importActual("@mui/material");
  return {
    ...actual,
    useTheme: () => ({
      shape: { borderRadius: 4 },
      palette: {
        divider: "#e0e0e0",
        text: { primary: "#000000", secondary: "#666666" },
        actionable: {
          main: "#1976d2",
          dark: "#115293",
          contrastText: "#ffffff",
        },
        heyhey: {
          main: "#087e8b",
          dark: "#065f68",
          light: "#e0f2f1",
        },
        success: { main: "#2e7d32" },
        error: { main: "#d32f2f", light: "#ef9a9a" },
        grey: { 50: "#fafafa", 100: "#f5f5f5" },
      },
    }),
  };
});

// Initialize i18n for tests
beforeAll(() => {
  if (!i18n.isInitialized) {
    i18n.use(initReactI18next).init({
      lng: "en",
      resources: {
        en: {
          translation: {
            "common.error": "Error",
            "coding.feedbackPlaceholder":
              "Provide feedback or additional context about this coding prompt...",
            "coding.feedbackLabel": "Your Feedback (Optional)",
            "coding.optional": "Feedback is optional",
            "common.submitted": "Submitted",
          },
        },
      },
    });
  }
});

const mockConfig: FieldConfig = {
  field: "coding-test-field",
  description: "Test coding prompt field",
  type: "coding_prompt",
  required: false,
};

const mockContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
};

const mockSystemData = {
  type: "CODING_PROMPTS",
  steps: [
    "Step 0: Investigate the existing prompt structures and Zod schema validation to understand how entity-level prompts currently function and how they can be integrated with top-level and facet-level templates.",
    "Step 1: Design the top-level prompt template, specifying input structure, output format, and constraints, while ensuring it adheres to Zod schema validation.",
    "Step 2: Create the facet-level prompt template with similar specifications, ensuring it can generate coherent summaries and is compatible with existing workflows.",
    "Step 3: Develop the entity-level prompt templates using a dual-path approach, ensuring both generation-time and post-hoc paths are designed to work within existing prompts and utilize Zod validation.",
    "Step 4: Document the input/output specifications, constraints, and known failure modes for each template, including mitigation strategies.",
    "Step 5: Provide 2-3 worked examples for each template to demonstrate expected output quality and adherence to abstraction levels.",
    "Step 6: Validate the templates through manual test runs to ensure quality parity between generation-time and post-hoc summaries.",
  ],
  title: "Generated Prompt",
  nodeId: "coding-prompts-agent",
  outcomes: [
    "Three prompt template families (top-level, facet-level, entity-level) designed and documented with clear input/output specifications and constraints.",
    "Templates are parameterized to support variable numbers of source documents and topology categories, ensuring flexibility.",
    "Successful validation of both generation-time and post-hoc paths with consistent output quality, confirming the dual-path approach reduces summarization latency.",
  ],
  response:
    "The task involves designing role-specific LLM prompt templates for multi-level summarization within the RAG system. These templates will guide the synthesis of top-level, facet-level, and entity-level summaries while ensuring source attribution, confidence scoring, and brevity. The templates must integrate with existing workflows and utilize Zod-based schema validation for consistency and reliability.",
  questions: [],
  reasoning: "agent loop",
  uiElements: [
    {
      id: "5eb5f139-61b7-40c3-8509-777703eb15bc",
      type: "coding_prompt",
      label: "Let us know what you think...",
      required: false,
      influences: [],
      placeholder: "Can you add a step that ...",
      secondaryAction: {
        id: "d944884c-8ad4-4460-b1d0-5b2c0a41905d",
        icon: "✨",
        type: "field_action",
        label: "Accept Coding Prompt",
        handler: "coding_prompt_accept",
        payload: {
          steps: [
            "Step 0: Investigate the existing prompt structures and Zod schema validation to understand how entity-level prompts currently function and how they can be integrated with top-level and facet-level templates.",
            "Step 1: Design the top-level prompt template, specifying input structure, output format, and constraints, while ensuring it adheres to Zod schema validation.",
            "Step 2: Create the facet-level prompt template with similar specifications, ensuring it can generate coherent summaries and is compatible with existing workflows.",
            "Step 3: Develop the entity-level prompt templates using a dual-path approach, ensuring both generation-time and post-hoc paths are designed to work within existing prompts and utilize Zod validation.",
            "Step 4: Document the input/output specifications, constraints, and known failure modes for each template, including mitigation strategies.",
            "Step 5: Provide 2-3 worked examples for each template to demonstrate expected output quality and adherence to abstraction levels.",
            "Step 6: Validate the templates through manual test runs to ensure quality parity between generation-time and post-hoc summaries.",
          ],
          outcomes: [
            "Three prompt template families (top-level, facet-level, entity-level) designed and documented with clear input/output specifications and constraints.",
            "Templates are parameterized to support variable numbers of source documents and topology categories, ensuring flexibility.",
            "Successful validation of both generation-time and post-hoc paths with consistent output quality, confirming the dual-path approach reduces summarization latency.",
          ],
          handlerType: "coding_prompt_accept",
        },
        disabled: false,
        presentation: "BUTTON",
      },
    },
  ],
  detectedIntent: "coding_prompts_iteration",
  intentConfidence: 1,
};

describe("CodingPromptField", () => {
  const renderField = (
    overrides: Partial<React.ComponentProps<typeof CodingPromptField>> = {}
  ) =>
    render(
      <CodingPromptField
        config={mockConfig}
        value={mockSystemData}
        context={mockContext}
        isSubmitted={false}
        {...overrides}
      />
    );

  it("should render the component with system data", () => {
    renderField();

    expect(
      screen.getByTestId(`coding-prompt-field-${mockConfig.field}`)
    ).toBeInTheDocument();
    expect(screen.getByText(mockConfig.description)).toBeInTheDocument();
  });

  it("should render feedback textarea when not submitted", () => {
    renderField();

    const textarea = screen.getByTestId("coding-prompt-feedback-textarea");
    expect(textarea).toBeInTheDocument();
    expect(textarea).not.toBeDisabled();
  });

  it("should handle feedback text input changes", () => {
    const mockOnChange = vi.fn();
    renderField({ onChange: mockOnChange });

    const textarea = screen.getByTestId("coding-prompt-feedback-textarea");
    fireEvent.change(textarea, { target: { value: "Great suggestion!" } });

    expect(mockOnChange).toHaveBeenCalledWith(
      expect.objectContaining({
        userMessage: "Great suggestion!",
        type: "CODING_PROMPTS",
      })
    );
  });

  it("should render submitted state", () => {
    renderField({ isSubmitted: true });

    const textarea = screen.getByTestId("coding-prompt-feedback-textarea");
    expect(textarea).toBeDisabled();
  });

  it("should show error message when provided", () => {
    renderField({ error: "This field is required" });

    expect(screen.getByText("This field is required")).toBeInTheDocument();
  });

  it("should disable textarea when disabled prop is true", () => {
    renderField({ disabled: true });

    const textarea = screen.getByTestId("coding-prompt-feedback-textarea");
    expect(textarea).toBeDisabled();
  });

  it("should render when system data is missing", () => {
    renderField({ value: undefined });

    expect(
      screen.getByTestId(`coding-prompt-field-${mockConfig.field}`)
    ).toBeInTheDocument();
  });
});
