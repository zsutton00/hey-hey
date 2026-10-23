import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TaskStubField,
  hasApprovedStubs,
  prepareTaskStubPayload,
} from "../TaskStubField";
import type { FieldConfig } from "../types";
import type {
  TaskStubSystemMessageData,
  TaskStub,
  TaskStubUserMessage,
} from "../../../../api/api";

// Mock MUI theme
vi.mock("@mui/material", async () => {
  const actual = await vi.importActual("@mui/material");
  return {
    ...actual,
    useTheme: () => ({
      palette: {
        mode: "light",
        success: { main: "#4caf50", 50: "#e8f5e9" },
        error: { main: "#f44336" },
        primary: { main: "#1976d2", 50: "#e3f2fd" },
        grey: { 50: "#fafafa", 300: "#e0e0e0", 400: "#bdbdbd" },
        text: {
          primary: "#000000",
          secondary: "#666666",
          disabled: "#999999",
        },
        background: { paper: "#ffffff" },
      },
    }),
  };
});

// Test data from real example
const createMockStubs = (): TaskStub[] => [
  {
    id: "30c00e0e-a8eb-45aa-9fff-b39fc26b4f14",
    round: 1,
    title: "Design event-driven mutation tracking for sub-facets",
    status: "suggested",
    reasoning:
      "The ADR decision hinges on on-demand refresh triggered by mutations",
    influences: [
      {
        entityId: "top-level-category-summarization-adr",
        entityType: "ARTIFACT",
        reasoning: "Directly supports the on-demand refresh decision",
        confidence: 0.95,
        reasonType: "explicit_mention",
      },
    ],
    sourceType: "initiative",
    shortDescription:
      "Define the event schema and emission strategy for sub-facet mutations.",
  },
  {
    id: "d562d799-625d-43c8-99f4-e0380c3e98b0",
    round: 1,
    title: "Implement category summary regeneration pipeline",
    status: "suggested",
    reasoning:
      "Operationalizes the ADR decision by creating the execution layer",
    influences: [],
    sourceType: "initiative",
    shortDescription:
      "Build the async pipeline that consumes mutation events and queues LLM-driven regeneration.",
  },
  {
    id: "6045be78-9f3a-499c-9fe8-781d05efdf77",
    round: 1,
    title: "Validate sub-facet discovery completeness for each category",
    status: "suggested",
    reasoning:
      "Acceptance criteria require 3+ facets per category at 80%+ relevance",
    influences: [],
    sourceType: "initiative",
    shortDescription:
      "Verify that LLM sub-facet discovery generates 3+ relevant facets per category.",
  },
  {
    id: "bd3f9a1f-ad05-47ec-94ad-02e704703dfa",
    round: 1,
    title: "Build telemetry for category summary freshness and accuracy",
    status: "suggested",
    reasoning:
      "Measures whether the on-demand + 24-hour fallback strategy is working",
    influences: [],
    sourceType: "initiative",
    shortDescription:
      "Instrument the regeneration pipeline to track summary staleness and accuracy.",
  },
  {
    id: "8e111cae-7dc7-4771-ae98-d6626a50785d",
    round: 1,
    title: "Test category summary staleness under high mutation load",
    status: "suggested",
    reasoning:
      "Validates the trade-off between on-demand refresh complexity and agent experience",
    influences: [],
    sourceType: "initiative",
    shortDescription:
      "Simulate rapid sub-facet mutations and verify category summaries remain fresh.",
  },
];

const createMockTaskStubData = (
  overrides: Partial<TaskStubSystemMessageData> = {}
): TaskStubSystemMessageData => ({
  type: "TASK_STUBS",
  round: 1,
  stubs: createMockStubs(),
  nodeId: "task-generation-stubs",
  response:
    "Here are some tasks that operationalize the ADR decision on category summary refresh.",
  detectedIntent: "task_stub_iteration",
  intentConfidence: 1,
  ...overrides,
});

const mockConfig: FieldConfig = {
  field: "task-stubs",
  description: "Review and approve task suggestions",
  type: "task_stub",
  required: false,
};

const mockContext = {
  conversationId: "46221647-2981-47a7-b44b-fff08b74ef8d",
  projectId: "96c5429a-84d1-4813-b661-75be18f2b3c2",
  organizationId: "test-org-id",
};

describe("TaskStubField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic rendering", () => {
    it("should render with system message data showing response text", () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      expect(
        screen.getByTestId(`task-stub-field-${mockConfig.field}`)
      ).toBeInTheDocument();
    });

    it("should render all 5 stub cards with correct titles", () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      expect(
        screen.getByText("Design event-driven mutation tracking for sub-facets")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Implement category summary regeneration pipeline")
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Validate sub-facet discovery completeness for each category"
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Build telemetry for category summary freshness and accuracy"
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Test category summary staleness under high mutation load"
        )
      ).toBeInTheDocument();
    });

    it("should render accept and reject buttons for each stub", () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      const stubs = createMockStubs();
      stubs.forEach((stub) => {
        expect(screen.getByTestId(`accept-${stub.id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`reject-${stub.id}`)).toBeInTheDocument();
      });
    });

    it("should render feedback textarea and add task button", () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      expect(screen.getByTestId("feedback-textarea")).toBeInTheDocument();
      expect(screen.getByTestId("add-task-button")).toBeInTheDocument();
    });

    it("should show error message when error prop provided", () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
          error="At least one task must be selected"
        />
      );

      expect(
        screen.getByText("At least one task must be selected")
      ).toBeInTheDocument();
    });
  });

  describe("accept/reject functionality", () => {
    it("should call onChange with accept status when Accept clicked", async () => {
      const taskStubData = createMockTaskStubData();
      const mockOnChange = vi.fn();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          onChange={mockOnChange}
          isSubmitted={false}
          context={mockContext}
        />
      );

      const firstStubId = "30c00e0e-a8eb-45aa-9fff-b39fc26b4f14";
      const acceptButton = screen.getByTestId(`accept-${firstStubId}`);

      fireEvent.click(acceptButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalled();
        const lastCall =
          mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
        const review = lastCall.stubReviews.find(
          (r: { stubId: string }) => r.stubId === firstStubId
        );
        expect(review?.action).toBe("accept");
      });
    });

    it("should call onChange with reject status when Reject clicked", async () => {
      const taskStubData = createMockTaskStubData();
      const mockOnChange = vi.fn();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          onChange={mockOnChange}
          isSubmitted={false}
          context={mockContext}
        />
      );

      const firstStubId = "30c00e0e-a8eb-45aa-9fff-b39fc26b4f14";
      const rejectButton = screen.getByTestId(`reject-${firstStubId}`);

      fireEvent.click(rejectButton);

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalled();
        const lastCall =
          mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
        const review = lastCall.stubReviews.find(
          (r: { stubId: string }) => r.stubId === firstStubId
        );
        expect(review?.action).toBe("reject");
      });
    });

    it("should disable buttons when disabled prop is true", () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          disabled={true}
          context={mockContext}
        />
      );

      const firstStubId = "30c00e0e-a8eb-45aa-9fff-b39fc26b4f14";
      expect(screen.getByTestId(`accept-${firstStubId}`)).toBeDisabled();
      expect(screen.getByTestId(`reject-${firstStubId}`)).toBeDisabled();
    });
  });

  describe("manual task addition", () => {
    it("should open dialog when Add Task Manually clicked", async () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      fireEvent.click(screen.getByTestId("add-task-button"));

      await waitFor(() => {
        // Dialog title appears in addition to button text
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByTestId("new-task-title")).toBeInTheDocument();
        expect(screen.getByTestId("new-task-description")).toBeInTheDocument();
      });
    });

    it("should add task to manuallyAdded array on submit", async () => {
      const taskStubData = createMockTaskStubData();
      const mockOnChange = vi.fn();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          onChange={mockOnChange}
          isSubmitted={false}
          context={mockContext}
        />
      );

      fireEvent.click(screen.getByTestId("add-task-button"));

      await waitFor(() => {
        expect(screen.getByTestId("new-task-title")).toBeInTheDocument();
      });

      const titleInput = screen
        .getByTestId("new-task-title")
        .querySelector("input");
      const descriptionInput = screen
        .getByTestId("new-task-description")
        .querySelector("textarea");

      if (titleInput && descriptionInput) {
        fireEvent.change(titleInput, { target: { value: "My custom task" } });
        fireEvent.change(descriptionInput, {
          target: { value: "Description of my custom task" },
        });
      }

      fireEvent.click(screen.getByTestId("confirm-add-task"));

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalled();
        const calls = mockOnChange.mock.calls;
        const lastCall = calls[calls.length - 1][0] as TaskStubUserMessage;
        expect(lastCall.manuallyAdded).toContainEqual({
          title: "My custom task",
          shortDescription: "Description of my custom task",
        });
      });
    });

    it("should show validation error for empty title", async () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      fireEvent.click(screen.getByTestId("add-task-button"));

      await waitFor(() => {
        expect(screen.getByTestId("new-task-description")).toBeInTheDocument();
      });

      const descriptionInput = screen
        .getByTestId("new-task-description")
        .querySelector("textarea");

      if (descriptionInput) {
        fireEvent.change(descriptionInput, {
          target: { value: "Some description" },
        });
      }

      // The Add button should be disabled when title is empty
      expect(screen.getByTestId("confirm-add-task")).toBeDisabled();
    });

    it("should display manually added tasks with chip", async () => {
      const taskStubData = createMockTaskStubData();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      fireEvent.click(screen.getByTestId("add-task-button"));

      await waitFor(() => {
        expect(screen.getByTestId("new-task-title")).toBeInTheDocument();
      });

      const titleInput = screen
        .getByTestId("new-task-title")
        .querySelector("input");
      const descriptionInput = screen
        .getByTestId("new-task-description")
        .querySelector("textarea");

      if (titleInput && descriptionInput) {
        fireEvent.change(titleInput, {
          target: { value: "Custom manual task" },
        });
        fireEvent.change(descriptionInput, {
          target: { value: "Custom description here" },
        });
      }

      fireEvent.click(screen.getByTestId("confirm-add-task"));

      await waitFor(() => {
        expect(screen.getByText("Custom manual task")).toBeInTheDocument();
        expect(screen.getByTestId("manual-task-0")).toBeInTheDocument();
      });
    });
  });

  describe("feedback input", () => {
    it("should call onChange when feedback text changes", async () => {
      const taskStubData = createMockTaskStubData();
      const mockOnChange = vi.fn();

      render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          onChange={mockOnChange}
          isSubmitted={false}
          context={mockContext}
        />
      );

      const feedbackTextarea = screen
        .getByTestId("feedback-textarea")
        .querySelector("textarea");

      if (feedbackTextarea) {
        fireEvent.change(feedbackTextarea, {
          target: { value: "Please add more detail" },
        });
      }

      await waitFor(() => {
        expect(mockOnChange).toHaveBeenCalled();
        const calls = mockOnChange.mock.calls;
        // Check that the last call includes the feedback text
        const lastCallValue = calls[calls.length - 1][0] as TaskStubUserMessage;
        expect(lastCallValue.userMessage).toContain("Please add more detail");
      });
    });
  });

  describe("submitted view", () => {
    it("should show compact summary when isSubmitted=true", async () => {
      const taskStubData = createMockTaskStubData();

      // Create field value with some accepted/rejected stubs
      const fieldValue: TaskStubUserMessage = {
        userMessage: "Looks good!",
        stubReviews: [
          { stubId: "30c00e0e-a8eb-45aa-9fff-b39fc26b4f14", action: "accept" },
          { stubId: "d562d799-625d-43c8-99f4-e0380c3e98b0", action: "accept" },
          { stubId: "6045be78-9f3a-499c-9fe8-781d05efdf77", action: "reject" },
          { stubId: "bd3f9a1f-ad05-47ec-94ad-02e704703dfa", action: "pending" },
          { stubId: "8e111cae-7dc7-4771-ae98-d6626a50785d", action: "pending" },
        ],
        manuallyAdded: [],
      };

      // Render with both the system data and field value
      // The component uses the system data for stubs but needs field value for review state
      const { rerender } = render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      // First click accept on first two stubs
      fireEvent.click(
        screen.getByTestId("accept-30c00e0e-a8eb-45aa-9fff-b39fc26b4f14")
      );
      fireEvent.click(
        screen.getByTestId("accept-d562d799-625d-43c8-99f4-e0380c3e98b0")
      );
      fireEvent.click(
        screen.getByTestId("reject-6045be78-9f3a-499c-9fe8-781d05efdf77")
      );

      // Rerender as submitted
      rerender(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={true}
          context={mockContext}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Review Complete:/)).toBeInTheDocument();
      });
    });

    it("should expand to show details on click", async () => {
      const taskStubData = createMockTaskStubData();

      const { rerender } = render(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={false}
          context={mockContext}
        />
      );

      // Accept one stub
      fireEvent.click(
        screen.getByTestId("accept-30c00e0e-a8eb-45aa-9fff-b39fc26b4f14")
      );

      // Rerender as submitted
      rerender(
        <TaskStubField
          config={mockConfig}
          value={taskStubData}
          isSubmitted={true}
          context={mockContext}
        />
      );

      // Click to expand
      const summaryBox = screen.getByText(/Review Complete:/);
      fireEvent.click(summaryBox);

      await waitFor(() => {
        expect(screen.getByText("Accepted Tasks:")).toBeInTheDocument();
      });
    });
  });

  describe("helper functions", () => {
    describe("hasApprovedStubs", () => {
      it("should return true when stubs are accepted", () => {
        const value: TaskStubUserMessage = {
          userMessage: "",
          stubReviews: [
            { stubId: "stub-1", action: "accept" },
            { stubId: "stub-2", action: "pending" },
          ],
          manuallyAdded: [],
        };

        expect(hasApprovedStubs(value)).toBe(true);
      });

      it("should return true when manual tasks exist", () => {
        const value: TaskStubUserMessage = {
          userMessage: "",
          stubReviews: [{ stubId: "stub-1", action: "pending" }],
          manuallyAdded: [{ title: "Manual task", shortDescription: "Desc" }],
        };

        expect(hasApprovedStubs(value)).toBe(true);
      });

      it("should return false when no approved stubs and no manual tasks", () => {
        const value: TaskStubUserMessage = {
          userMessage: "",
          stubReviews: [
            { stubId: "stub-1", action: "pending" },
            { stubId: "stub-2", action: "reject" },
          ],
          manuallyAdded: [],
        };

        expect(hasApprovedStubs(value)).toBe(false);
      });

      it("should return false for undefined value", () => {
        expect(hasApprovedStubs(undefined)).toBe(false);
      });
    });

    describe("prepareTaskStubPayload", () => {
      it("should format payload correctly for finalize action", () => {
        const value: TaskStubUserMessage = {
          userMessage: "Ready to proceed",
          stubReviews: [
            { stubId: "stub-1", action: "accept" },
            { stubId: "stub-2", action: "reject" },
          ],
          manuallyAdded: [{ title: "Custom", shortDescription: "Task" }],
        };

        const payload = prepareTaskStubPayload(value, "finalize");

        expect(payload).toEqual({
          action: "finalize",
          feedback: "Ready to proceed",
          stubReviews: {
            "stub-1": "accept",
            "stub-2": "reject",
          },
          manualStubs: [{ title: "Custom", shortDescription: "Task" }],
        });
      });

      it("should format payload correctly for refine action", () => {
        const value: TaskStubUserMessage = {
          userMessage: "Need more tasks",
          stubReviews: [{ stubId: "stub-1", action: "pending" }],
          manuallyAdded: [],
        };

        const payload = prepareTaskStubPayload(value, "refine");

        expect(payload).toEqual({
          action: "refine",
          feedback: "Need more tasks",
          stubReviews: {
            "stub-1": "pending",
          },
          manualStubs: [],
        });
      });
    });
  });

  describe("error handling", () => {
    it("should show error when invalid data provided", () => {
      render(
        <TaskStubField
          config={mockConfig}
          value={undefined}
          isSubmitted={false}
          context={mockContext}
        />
      );

      expect(
        screen.getByText("Error: Invalid task stub data")
      ).toBeInTheDocument();
    });
  });
});
