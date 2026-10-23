import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  classifyStartupServiceScope,
  StartupPlanStructuredField,
} from "../StartupPlanStructuredField";
import type { FieldConfig, FieldComponentContext } from "../types";
import type { ServiceDto } from "../../../../api";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../../api";
import {
  resetCapabilityCatalogForTests,
  setCapabilityCatalogForTests,
} from "../../../AgentSession/capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../../test/capabilityCatalogFixture";

const useAgentSessionMock = vi.fn();
const useServicesMock = vi.fn();

vi.mock("../../../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: () => ({
    status: "empty",
    bindings: [],
    bindingsByServiceId: {},
  }),
}));

vi.mock("../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: (...args: unknown[]) => useAgentSessionMock(...args),
}));

vi.mock("../../../../data/hooks/useServices", () => ({
  useServices: (...args: unknown[]) => useServicesMock(...args),
}));

const buildAgentSessionReturn = (
  provider?: ConversationStartRunRequestDtoProviderEnum,
  serviceIds: string[] = [],
): {
  agentSession: {
    id: string;
    provider?: ConversationStartRunRequestDtoProviderEnum;
    serviceIds: string[];
  } | null;
  data: {
    id: string;
    provider?: ConversationStartRunRequestDtoProviderEnum;
    serviceIds: string[];
  } | null;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: null;
  isStale: boolean;
  refetch: ReturnType<typeof vi.fn>;
  markStale: ReturnType<typeof vi.fn>;
} => {
  const agentSession =
    provider || serviceIds.length > 0
      ? { id: "session-1", ...(provider ? { provider } : {}), serviceIds }
      : null;
  return {
    agentSession,
    data: agentSession,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  };
};

vi.mock("../../../../data/hooks/useWorkItem", () => ({
  useWorkItem: vi.fn(
    (_orgId: string, _entityType: string, workItemId: string) => ({
      workItem: workItemId
        ? {
            id: workItemId,
            name: workItemId,
          }
        : null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    }),
  ),
}));

vi.mock("../../../../data/hooks/useDesignDoc", () => ({
  useDesignDoc: vi.fn(() => ({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(),
    markStale: vi.fn(),
  })),
}));

vi.mock("../../../../data/hooks/usePlan", () => ({
  usePlan: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    error: null,
    update: vi.fn(),
    deletePlan: vi.fn(),
  })),
}));

const baseConfig: FieldConfig = {
  field: "coding_prompt_startup_plan",
  description: "Startup Plan",
  type: "agent_response",
};

const baseContext: FieldComponentContext = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "org-1",
  messageId: "coding-prompt:event:run-1:7",
};

const renderStartupPlanStructuredField = (
  props: React.ComponentProps<typeof StartupPlanStructuredField>,
) =>
  render(
    <MemoryRouter>
      <StartupPlanStructuredField {...props} />
    </MemoryRouter>,
  );

const buildService = (overrides: Partial<ServiceDto> = {}): ServiceDto => ({
  id: "service-1",
  name: "UI Common",
  organizationId: "org-1",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const buildStartupPlanValue = (
  requiredServiceIds: string[] = ["service-1"],
) => ({
  responseType: "startup_plan_v1" as const,
  requiredServiceIds,
  primaryImplementations: [
    {
      title: "Core implementation",
      content: "Implementation details",
      rationale: "Primary plan outcome",
    },
  ],
  sessionTitle: "Startup Session",
  executionPlan: [],
  discrepancies: [],
  clarificationQuestions: [],
});

describe("StartupPlanStructuredField", () => {
  beforeEach(() => {
    localStorage.clear();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
    useAgentSessionMock.mockReset();
    useAgentSessionMock.mockReturnValue(buildAgentSessionReturn());
    useServicesMock.mockReset();
    useServicesMock.mockReturnValue({
      services: [
        {
          id: "service-1",
          name: "UI Common",
          organizationId: "org-1",
          status: "ACTIVE",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      data: [],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
  });

  it("renders direct startup_plan payload values with plan details", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Kick off coding execution",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Audit current flow",
            description: "Review current DTO mapping behavior",
            phase: 1,
            references: [
              {
                sourceType: "task",
                sourceId: "task-1",
                rationale: "Primary task scope",
              },
            ],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(screen.getByText("Kick off coding execution")).toBeInTheDocument();
    expect(screen.queryByText("Startup Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("startup_plan_v1")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan steps: 1")).not.toBeInTheDocument();
    expect(
      screen.getByTestId(
        "startup-plan-structured-field-coding_prompt_startup_plan",
      ),
    ).toHaveAttribute("data-message-id", "coding-prompt:event:run-1:7");
    expect(
      screen.getByTestId(
        "startup-plan-structured-field-coding_prompt_startup_plan-message-coding-prompt:event:run-1:7",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Execution Plan")).toBeInTheDocument();
    expect(screen.getByText("1. Audit current flow")).toBeInTheDocument();
    expect(
      screen.getByText("Review current DTO mapping behavior"),
    ).toBeInTheDocument();
    expect(screen.getByText("Discrepancies")).toBeInTheDocument();
    expect(
      screen.getByText("No discrepancies were identified."),
    ).toBeInTheDocument();
    expect(screen.getByText("Clarification Questions")).toBeInTheDocument();
    expect(
      screen.getByText("No blocking clarification questions."),
    ).toBeInTheDocument();
    const feedbackNotice = screen.getByTestId("startup-plan-feedback-notice");
    const modelControls = screen.getByTestId("startup-plan-model-effort");
    expect(
      modelControls.compareDocumentPosition(feedbackNotice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders discrepancies and clarification question details", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Read-only plan viewer",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Render startup plan",
            description: "Show startup plan in the timeline",
            phase: 1,
            references: [
              {
                sourceType: "task",
                sourceId: "task-1",
                rationale: "Align with task scope",
              },
            ],
          },
        ],
        discrepancies: [
          {
            sourceRef: {
              sourceType: "task",
              sourceId: "task-1",
            },
            sourceField: "acceptanceCriteria",
            sourceExcerpt: "Source excerpt",
            reasoning: "Read-only pass does not include editing.",
            discrepancyText: "Inline editing is out of scope for this pass.",
            severity: "medium",
          },
        ],
        clarificationQuestions: [
          {
            question: "Should we include edit controls in this pass?",
            reason: "Needed to confirm first-pass scope.",
            relatedSourceRefs: [
              {
                sourceType: "task",
                sourceId: "task-1",
              },
            ],
          },
        ],
      },
    });

    expect(
      screen.getByText("Inline editing is out of scope for this pass."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Read-only pass does not include editing."),
    ).toBeInTheDocument();
    const discrepancySource = screen.getByTestId(
      "startup-plan-discrepancy-source-0",
    );
    expect(discrepancySource).toBeInTheDocument();
    expect(
      within(discrepancySource).getByRole("link", { name: "task-1" }),
    ).toHaveAttribute("href", "/projects/project-1/tasks/task-1");
    expect(discrepancySource.parentElement).toHaveTextContent(
      "acceptanceCriteria",
    );
    expect(
      screen.getByText("Should we include edit controls in this pass?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Needed to confirm first-pass scope."),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("startup-plan-clarification-source-0-0"),
    ).toBeInTheDocument();
  });

  it("classifies required Services as already available versus added on approval", () => {
    const review = classifyStartupServiceScope({
      requiredServiceIds: ["service-1", "service-2"],
      projectServices: [
        buildService(),
        buildService({ id: "service-2", name: "API Service" }),
      ],
      selectedServiceIds: ["service-1"],
      servicesReady: true,
      servicesError: false,
    });

    expect(review).toMatchObject({ status: "valid" });
    if (review.status !== "valid") {
      throw new Error("Expected a valid Service scope review");
    }

    expect(review.alreadySelected.map((service) => service.name)).toEqual([
      "UI Common",
    ]);
    expect(review.addedOnApproval.map((service) => service.name)).toEqual([
      "API Service",
    ]);
  });

  it("reports loading until the project Service list is ready", () => {
    expect(
      classifyStartupServiceScope({
        requiredServiceIds: ["service-1"],
        projectServices: [],
        selectedServiceIds: [],
        servicesReady: false,
        servicesError: false,
      }),
    ).toEqual({
      status: "loading",
      message: "Loading the Services required by this plan.",
    });
  });

  it("rejects unknown, archived, and nameless required Services", () => {
    const review = classifyStartupServiceScope({
      requiredServiceIds: ["service-1", "service-2", "missing-service"],
      projectServices: [
        buildService({ name: "" }),
        buildService({
          id: "service-2",
          name: "Archived Service",
          status: "ARCHIVED",
        }),
      ],
      selectedServiceIds: [],
      servicesReady: true,
      servicesError: false,
    });

    expect(review).toEqual({
      status: "invalid",
      message:
        "One or more required Services are unavailable in this project; approval is blocked until the scope resolves.",
    });
  });

  it("renders only deduplicated required Services with distinct approval states", () => {
    useAgentSessionMock.mockReturnValue(
      buildAgentSessionReturn(undefined, ["service-1"]),
    );
    useServicesMock.mockReturnValue({
      services: [
        buildService(),
        buildService({ id: "service-2", name: "API Service" }),
        buildService({ id: "service-3", name: "Unrelated Service" }),
      ],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: buildStartupPlanValue(["service-1", "service-2", "service-2"]),
    });

    const scope = screen.getByTestId("startup-plan-service-scope");
    const alreadySelectedChip = within(
      screen.getByTestId("startup-plan-service-scope-already-selected"),
    ).getByText("UI Common");
    expect(alreadySelectedChip.closest(".MuiChip-root")).toHaveAttribute(
      "data-service-state",
      "already-selected",
    );
    const addedChips = within(
      screen.getByTestId("startup-plan-service-scope-added"),
    ).getAllByText("API Service");
    expect(addedChips).toHaveLength(1);
    expect(addedChips[0].closest(".MuiChip-root")).toHaveAttribute(
      "data-service-state",
      "added-by-plan",
    );
    expect(scope).not.toHaveTextContent("Unrelated Service");
    expect(scope).not.toHaveTextContent("service-1");
    expect(scope).not.toHaveTextContent("service-2");
  });

  it("renders a visible scope error while blocking an unresolved Service", () => {
    const onValidityChange = vi.fn();
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onValidityChange,
      value: buildStartupPlanValue(["missing-service"]),
    });

    expect(
      screen.getByTestId("startup-plan-service-scope-error"),
    ).toHaveTextContent("approval is blocked");
    expect(onValidityChange).toHaveBeenCalledWith("invalid");
  });

  it("emits discrepancy feedback updates when user replies", () => {
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [
          {
            sourceRef: {
              sourceType: "task",
              sourceId: "task-1",
            },
            sourceExcerpt: "Source excerpt",
            reasoning: "Needs acknowledgement before implementation.",
            discrepancyText: "Scope differs from acceptance criteria.",
            severity: "high",
          },
        ],
        clarificationQuestions: [],
      },
    });

    fireEvent.click(
      within(screen.getByTestId("startup-plan-discrepancies")).getByRole(
        "button",
        { name: "Add comment" },
      ),
    );
    const discrepancyFeedbackInput = screen.getByLabelText(
      "Discrepancy feedback (optional)",
    );
    fireEvent.change(discrepancyFeedbackInput, {
      target: { value: "Please account for this in the plan." },
    });
    fireEvent.blur(discrepancyFeedbackInput);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        discrepancyFeedback: [
          {
            discrepancyIndex: 0,
            note: "Please account for this in the plan.",
          },
        ],
      }),
    );
  });

  it("emits step feedback updates when user replies on execution steps", () => {
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Implement startup plan UI",
            description: "Render the startup plan details in the form.",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    fireEvent.click(
      within(screen.getByTestId("startup-plan-execution-plan")).getByRole(
        "button",
        { name: "Add comment" },
      ),
    );
    const stepFeedbackInput = screen.getByLabelText("Step feedback (optional)");
    fireEvent.change(stepFeedbackInput, {
      target: { value: "Include test coverage guidance for this step." },
    });
    fireEvent.blur(stepFeedbackInput);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        stepFeedback: [
          {
            stepId: "step-1",
            note: "Include test coverage guidance for this step.",
          },
        ],
      }),
    );
  });

  it("emits clarification answer updates when user replies", () => {
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [
          {
            question: "Which event family should we use?",
          },
        ],
      },
    });

    fireEvent.click(
      within(
        screen.getByTestId("startup-plan-clarification-questions"),
      ).getByRole("button", { name: "Add comment" }),
    );
    const clarificationAnswerInput = screen.getByLabelText(
      "Clarification answer (optional)",
    );
    fireEvent.change(clarificationAnswerInput, {
      target: { value: "Use notification.created for this task." },
    });
    fireEvent.blur(clarificationAnswerInput);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        questionAnswers: [
          {
            questionIndex: 0,
            answer: "Use notification.created for this task.",
          },
        ],
      }),
    );
  });

  it("emits discrepancy feedback updates for existing replies", () => {
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [
          {
            sourceRef: {
              sourceType: "task",
              sourceId: "task-1",
            },
            sourceExcerpt: "Source excerpt",
            reasoning: "Needs additional context from user.",
            discrepancyText: "Scope differs from acceptance criteria.",
            severity: "medium",
          },
        ],
        clarificationQuestions: [],
        discrepancyFeedback: [
          {
            discrepancyIndex: 0,
            note: "Initial note",
          },
        ],
      },
    });

    const discrepancyFeedbackInput = screen.getByLabelText(
      "Discrepancy feedback (optional)",
    );
    fireEvent.change(discrepancyFeedbackInput, {
      target: { value: "Updated handling note" },
    });
    fireEvent.blur(discrepancyFeedbackInput);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        discrepancyFeedback: [
          {
            discrepancyIndex: 0,
            note: "Updated handling note",
          },
        ],
      }),
    );
  });

  it("preserves trailing spaces while typing discrepancy notes", () => {
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [
          {
            sourceRef: {
              sourceType: "task",
              sourceId: "task-1",
            },
            sourceExcerpt: "Source excerpt",
            reasoning: "Needs additional context from user.",
            discrepancyText: "Scope differs from acceptance criteria.",
            severity: "medium",
          },
        ],
        clarificationQuestions: [],
        discrepancyFeedback: [
          {
            discrepancyIndex: 0,
            note: "existing",
          },
        ],
      },
    });

    const discrepancyFeedbackInput = screen.getByLabelText(
      "Discrepancy feedback (optional)",
    );
    fireEvent.change(discrepancyFeedbackInput, {
      target: { value: "a " },
    });
    fireEvent.blur(discrepancyFeedbackInput);

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        discrepancyFeedback: [
          {
            discrepancyIndex: 0,
            note: "a ",
          },
        ],
      }),
    );
  });

  it("renders persisted discrepancy replies in submitted read-only mode", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: true,
      onChange: vi.fn(),
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [
          {
            sourceRef: {
              sourceType: "task",
              sourceId: "task-1",
            },
            sourceExcerpt: "Source excerpt",
            reasoning: "Needs additional context from user.",
            discrepancyText: "Scope differs from acceptance criteria.",
            severity: "medium",
          },
        ],
        clarificationQuestions: [],
        discrepancyFeedback: [
          {
            discrepancyIndex: 0,
            note: "Persisted reply note",
          },
        ],
      },
    });

    expect(
      screen.getByLabelText("Discrepancy feedback (optional)"),
    ).toHaveValue("Persisted reply note");
    expect(
      screen.getByLabelText("Discrepancy feedback (optional)"),
    ).toBeDisabled();
  });

  it("renders persisted clarification answers in submitted read-only mode", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: true,
      onChange: vi.fn(),
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [
          {
            question: "Which event family should we use?",
          },
        ],
        questionAnswers: [
          {
            questionIndex: 0,
            answer: "Use notification.created.",
          },
        ],
      },
    });

    expect(
      screen.getByLabelText("Clarification answer (optional)"),
    ).toHaveValue("Use notification.created.");
    expect(
      screen.getByLabelText("Clarification answer (optional)"),
    ).toBeDisabled();
  });

  it("renders provider, model, and effort selectors", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(screen.getByTestId("startup-plan-model-effort")).toBeInTheDocument();
    expect(screen.getByText("Model & Reasoning Effort")).toBeInTheDocument();
    expect(
      screen.getByTestId("startup-plan-provider-select"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("startup-plan-model-select")).toBeInTheDocument();
    expect(
      screen.getByTestId("startup-plan-effort-select"),
    ).toBeInTheDocument();
  });

  it("emits provider, model, and reasoningEffort on onChange when the dropdowns change", () => {
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    const modelSelect = screen.getByTestId("startup-plan-model-select");
    fireEvent.mouseDown(within(modelSelect).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Sonnet 5.5" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: "claude-sonnet-5-5",
      }),
    );

    onChange.mockClear();

    const effortSelect = screen.getByTestId("startup-plan-effort-select");
    fireEvent.mouseDown(within(effortSelect).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "High" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: "claude-sonnet-5-5",
        reasoningEffort: "high",
      }),
    );

    onChange.mockClear();

    const providerSelect = screen.getByTestId("startup-plan-provider-select");
    fireEvent.mouseDown(within(providerSelect).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
      }),
    );
  });

  it("seeds the provider from the originating agent session when surface memory is empty", () => {
    useAgentSessionMock.mockReturnValue(
      buildAgentSessionReturn(ConversationStartRunRequestDtoProviderEnum.Codex),
    );

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: { ...baseContext, agentSessionId: "session-1" },
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      within(screen.getByTestId("startup-plan-provider-select")).getByText(
        /Codex/,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("startup-plan-model-select")).getByRole(
        "combobox",
      ),
    ).toHaveValue("GPT 5.6 Sol");
  });

  it("round-trips provider/model/effort through localStorage under plan-approval", () => {
    const { unmount } = renderStartupPlanStructuredField({
      config: baseConfig,
      context: { ...baseContext, agentSessionId: "session-1" },
      isSubmitted: false,
      onChange: vi.fn(),
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    const modelSelect = screen.getByTestId("startup-plan-model-select");
    fireEvent.mouseDown(within(modelSelect).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Sonnet 5.5" }));

    const effortSelect = screen.getByTestId("startup-plan-effort-select");
    fireEvent.mouseDown(within(effortSelect).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "High" }));

    const stored = localStorage.getItem(
      "hey-hey:agent-selection:plan-approval",
    );
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? "{}")).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
      fastMode: false,
    });

    unmount();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: { ...baseContext, agentSessionId: "session-1" },
      isSubmitted: false,
      onChange: vi.fn(),
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      within(screen.getByTestId("startup-plan-model-select")).getByRole(
        "combobox",
      ),
    ).toHaveValue("Sonnet 5.5");
    expect(
      within(screen.getByTestId("startup-plan-effort-select")).getByText(
        "High",
      ),
    ).toBeInTheDocument();
  });

  it("commits and persists explicit Fast mode for a supported Codex model", () => {
    localStorage.setItem(
      "hey-hey:agent-selection:plan-approval",
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        fastMode: false,
      }),
    );
    const onChange = vi.fn();
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: { ...baseContext, agentSessionId: "session-1" },
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    fireEvent.click(screen.getByTestId("startup-plan-fast-mode-switch"));

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: ConversationStartRunRequestDtoProviderEnum.Codex,
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        fastMode: true,
      }),
    );
    expect(
      JSON.parse(
        localStorage.getItem("hey-hey:agent-selection:plan-approval") ?? "null",
      ),
    ).toEqual({
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: true,
    });
  });

  it("commits the remembered selection into the field value on mount without interaction", () => {
    localStorage.setItem(
      "hey-hey:agent-selection:plan-approval",
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: "claude-opus-5",
        reasoningEffort: "high",
      }),
    );
    const onChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: { ...baseContext, agentSessionId: "session-1" },
      isSubmitted: false,
      onChange,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    // The remembered model must land in the submission envelope even when the
    // user approves the plan without touching the ModelSelector; otherwise the
    // run silently falls back to the SDK default.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: "claude-opus-5",
        reasoningEffort: "high",
      }),
    );
  });

  it("preselects nothing and blocks approval until the session machine's catalog is available", () => {
    resetCapabilityCatalogForTests();
    localStorage.setItem(
      "hey-hey:agent-selection:plan-approval",
      JSON.stringify({
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: "claude-opus-5",
        reasoningEffort: "high",
      }),
    );
    const onChange = vi.fn();
    const onValidityChange = vi.fn();

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: { ...baseContext, agentSessionId: "session-1" },
      isSubmitted: false,
      onChange,
      onValidityChange,
      value: buildStartupPlanValue(),
    });

    expect(
      screen.getByTestId("startup-plan-catalog-machine-required"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("startup-plan-model-select")).toBeNull();
    expect(onValidityChange).toHaveBeenLastCalledWith("loading");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders target file chips beneath each step description", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan with target files",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Update startup plan widget",
            description: "Render target files for each step.",
            phase: 1,
            targetFiles: [
              "src/components/LlmForms/Registry/StartupPlanStructuredField.tsx",
              "src/components/LlmForms/Registry/__tests__/StartupPlanStructuredField.test.tsx",
            ],
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    const wrapper = screen.getByTestId("startup-plan-step-target-files-step-1");
    expect(wrapper).toBeInTheDocument();
    const firstChip = within(wrapper).getByText(
      "src/components/LlmForms/Registry/StartupPlanStructuredField.tsx",
    );
    const secondChip = within(wrapper).getByText(
      "src/components/LlmForms/Registry/__tests__/StartupPlanStructuredField.test.tsx",
    );
    expect(firstChip).toBeInTheDocument();
    expect(secondChip).toBeInTheDocument();
    expect(firstChip).toHaveStyle({ fontFamily: "monospace" });
    expect(secondChip).toHaveStyle({ fontFamily: "monospace" });
  });

  it("omits the target files wrapper when no target files are present", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan without target files",
        executionPlan: [
          {
            stepId: "step-without-files",
            title: "Investigative step",
            description: "Read code without modifying anything.",
            phase: 1,
            references: [],
          },
          {
            stepId: "step-with-empty-files",
            title: "Empty target files",
            description: "An empty array should also render nothing.",
            phase: 1,
            targetFiles: [],
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.queryByTestId("startup-plan-step-target-files-step-without-files"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(
        "startup-plan-step-target-files-step-with-empty-files",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders target file chips in submitted read-only mode", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: true,
      onChange: vi.fn(),
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Approved plan",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Approved step",
            description: "Persisted approved step description.",
            phase: 1,
            targetFiles: ["src/foo/bar.ts"],
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    const wrapper = screen.getByTestId("startup-plan-step-target-files-step-1");
    expect(wrapper).toBeInTheDocument();
    expect(within(wrapper).getByText("src/foo/bar.ts")).toBeInTheDocument();
  });

  it("disables provider, model, and effort selectors when submitted", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: true,
      onChange: vi.fn(),
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Startup review",
        executionPlan: [],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    const providerInput = screen
      .getByTestId("startup-plan-provider-select")
      .querySelector("input");
    const modelInput = screen
      .getByTestId("startup-plan-model-select")
      .querySelector("input");
    const effortInput = screen
      .getByTestId("startup-plan-effort-select")
      .querySelector("input");

    expect(providerInput).toBeDisabled();
    expect(modelInput).toBeDisabled();
    expect(effortInput).toBeDisabled();
  });

  it("does not render difficulty metadata on execution steps", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan with difficulty labels",
        executionPlan: [
          {
            stepId: "step-medium",
            title: "Medium effort step",
            description: "A medium difficulty step.",
            phase: 1,
            references: [],
          },
          {
            stepId: "step-hard",
            title: "Hard effort step",
            description: "A hard difficulty step.",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.queryByTestId("startup-plan-step-difficulty-step-medium"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("startup-plan-step-difficulty-step-hard"),
    ).not.toBeInTheDocument();
  });

  it("omits the difficulty label when difficulty is absent", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan without difficulty",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Step without difficulty",
            description: "No difficulty should mean no label.",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.queryByTestId("startup-plan-step-difficulty-step-1"),
    ).not.toBeInTheDocument();
  });

  it("renders execution steps in one global order across retained phases", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Phased plan",
        executionPlan: [
          {
            stepId: "step-1",
            title: "First phase one step",
            description: "Phase one, step one.",
            phase: 1,
            references: [],
          },
          {
            stepId: "step-2",
            title: "Second phase one step",
            description: "Phase one, step two.",
            phase: 1,
            references: [],
          },
          {
            stepId: "step-3",
            title: "First phase two step",
            description: "Phase two, step three.",
            phase: 2,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(screen.getByText("1. First phase one step")).toBeInTheDocument();
    expect(screen.getByText("2. Second phase one step")).toBeInTheDocument();
    expect(screen.getByText("3. First phase two step")).toBeInTheDocument();
    expect(screen.queryByText("Phase 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Phase 2")).not.toBeInTheDocument();
  });

  it("leaves the model and effort selectors alongside the flat step list", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan with difficulty and selectors",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Hard step",
            description: "Difficulty is a label, never a prefill.",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(screen.getByTestId("startup-plan-model-effort")).toBeInTheDocument();
    expect(
      screen.getByTestId("startup-plan-effort-select"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("startup-plan-effort-select")).queryByText(
        "hard",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders phase as typed metadata without presenting it", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan with missing phase",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Step without a phase",
            description: "This step should never render silently.",
            phase: 3,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.queryByTestId("startup-plan-execution-plan-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1. Step without a phase")).toBeInTheDocument();
    expect(screen.queryByText("Phase 3")).not.toBeInTheDocument();
  });

  it("renders typed steps without runtime difficulty validation", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan with malformed difficulty",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Step with bad difficulty",
            description: "Difficulty must be medium, hard, or absent.",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.queryByTestId("startup-plan-execution-plan-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("1. Step with bad difficulty")).toBeInTheDocument();
  });

  it("leads with prose and code implementations and renders only supplied connections", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        sessionTitle: "Primary implementation plan",
        primaryImplementations: [
          {
            title: "Approval behavior",
            content: "Present the **primary behavior** before the steps.",
            rationale: "Reviewers see the proposed outcome first.",
          },
          {
            title: "Typed payload",
            content: "interface Plan {\n  title: string;\n}",
            rationale: "The generated contract remains authoritative.",
            language: "typescript",
            location:
              "[$UI Common/src/api/api.ts](heyhey-file:v1:service-1:src%2Fapi%2Fapi.ts)",
            connections: [
              {
                entityType: "contract",
                entityId: "b74388c0-f605-405a-937c-f9035d9de0e3",
                entityTitle: "Report mention rendering contract",
                relationship: "enforces",
                sourceField: "requirements[0]",
                sourceExcerpt: "Structured identities use navigable mentions.",
                rationale:
                  "This implementation presents the supplied identity.",
              },
            ],
          },
        ],
        executionPlan: [
          {
            stepId: "step-1",
            title: "Ordered step",
            description: "The execution list follows the implementations.",
            phase: 2,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    const implementations = screen.getByTestId(
      "startup-plan-primary-implementations",
    );
    const implementationList = screen.getByTestId(
      "startup-plan-primary-implementation-list",
    );
    expect(implementationList).toHaveStyle({ borderStyle: "solid" });
    expect(
      within(implementationList).getByText(
        "Implementation preview — final changes may differ.",
      ),
    ).toBeInTheDocument();
    const typedPayloadTab = within(implementationList).getByRole("tab", {
      name: "Typed payload",
    });
    expect(typedPayloadTab).toHaveStyle({
      flex: "0 0 240px",
      maxWidth: "240px",
      minWidth: "240px",
      overflow: "hidden",
    });
    expect(typedPayloadTab.firstElementChild).toHaveStyle({
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    });
    const executionPlan = screen.getByTestId("startup-plan-execution-plan");
    expect(
      implementations.compareDocumentPosition(executionPlan) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        "startup-plan-primary-implementation-list-item-0-content",
      ),
    ).toHaveTextContent("Present the **primary behavior** before the steps.");
    expect(
      screen.queryByTestId(
        "startup-plan-primary-implementation-list-item-0-connections",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(implementations).getByRole("tab", { name: "Typed payload" }),
    );
    expect(
      screen.getByTestId(
        "startup-plan-primary-implementation-list-item-1-content",
      ),
    ).toHaveTextContent("interface Plan {");
    expect(
      within(implementations).getByTestId("file-reference"),
    ).toHaveTextContent("UI Common/src/api/api.ts");
    expect(
      within(implementations)
        .getByText("Report mention rendering contract")
        .closest('[data-testid="mention-badge"]'),
    ).toHaveAttribute("data-entity-id", "b74388c0-f605-405a-937c-f9035d9de0e3");
    expect(within(implementations).getByText("Enforces")).toBeInTheDocument();
    expect(
      within(implementations).queryByText("requirements[0]"),
    ).not.toBeInTheDocument();
    expect(
      within(implementations).queryByText(
        "Structured identities use navigable mentions.",
      ),
    ).not.toBeInTheDocument();
    expect(
      within(implementations).queryByText(
        "This implementation presents the supplied identity.",
      ),
    ).not.toBeInTheDocument();
  });

  it("renders agent caption in the title row when messageCreatedAt and messageData are in context", () => {
    const contextWithMessage: FieldComponentContext = {
      ...baseContext,
      messageCreatedAt: "2024-01-01T12:00:00Z",
      messageData: {
        type: "AGENT",
        providerSessionId: "provider-session-123",
        promptHandler: "coding_prompt",
      } as import("../../../../api").SystemMessageData,
    };

    renderStartupPlanStructuredField({
      config: baseConfig,
      context: contextWithMessage,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan with caption",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Single step",
            description: "Description",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.getByTestId(`agent-caption-${baseContext.messageId}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`agent-caption-tooltip-${baseContext.messageId}`),
    ).toHaveTextContent("Coding Prompt agent");
  });

  it("omits caption when messageCreatedAt is absent from context", () => {
    renderStartupPlanStructuredField({
      config: baseConfig,
      context: baseContext,
      isSubmitted: false,
      value: {
        responseType: "startup_plan_v1",
        requiredServiceIds: ["service-1"],
        primaryImplementations: [
          {
            title: "Core implementation",
            content: "Implementation details",
            rationale: "Primary plan outcome",
          },
        ],
        sessionTitle: "Plan without caption",
        executionPlan: [
          {
            stepId: "step-1",
            title: "Single step",
            description: "Description",
            phase: 1,
            references: [],
          },
        ],
        discrepancies: [],
        clarificationQuestions: [],
      },
    });

    expect(
      screen.queryByTestId(`agent-caption-${baseContext.messageId}`),
    ).not.toBeInTheDocument();
  });
});
