import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useOnboardingState } from "../useOnboardingState";
import { ConversationStatus } from "@hey-hey/ui-common/api";
import type { StepDto, ConversationResponseDto } from "@hey-hey/ui-common/api";

describe("useOnboardingState", () => {
  const mockSteps: StepDto[] = [
    {
      id: "step-1",
      title: "Start Step",
      order: 0,
      description: "First step",
      workflowId: "workflow-1",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
    {
      id: "step-2",
      title: "Info Step",
      order: 1,
      description: "Second step",
      workflowId: "workflow-1",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
    {
      id: "step-3",
      title: "Finish Step",
      order: 2,
      description: "Final step",
      workflowId: "workflow-1",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
  ];

  const createMockConversation = (
    title: string,
    status: string,
  ): ConversationResponseDto => ({
    id: `conv-${title.toLowerCase().replace(" ", "-")}`,
    title,
    status: status as any,
    organizationId: "org-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    category: "project_onboarding",
    messages: [],
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  });

  describe("step calculation logic", () => {
    it("should start at step 0 when no conversations are provided", () => {
      const { result } = renderHook(() => useOnboardingState(mockSteps, []));

      expect(result.current.activeStepIdx).toBe(0);
    });

    it("should start at step 0 when no steps are provided", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
      ];

      const { result } = renderHook(() =>
        useOnboardingState([], conversations),
      );

      expect(result.current.activeStepIdx).toBe(0);
    });

    it("should remain at step 0 when first step is not completed", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.InProgress),
        createMockConversation("Info Step", ConversationStatus.Started),
      ];

      const { result } = renderHook(() =>
        useOnboardingState(mockSteps, conversations),
      );

      expect(result.current.activeStepIdx).toBe(0);
    });

    it("should move to step 1 when first step is completed", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
        createMockConversation("Info Step", ConversationStatus.InProgress),
      ];

      const { result } = renderHook(() =>
        useOnboardingState(mockSteps, conversations),
      );

      expect(result.current.activeStepIdx).toBe(1);
    });

    it("should move to step 2 when first two steps are completed", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
        createMockConversation("Info Step", ConversationStatus.Completed),
        createMockConversation("Finish Step", ConversationStatus.InProgress),
      ];

      const { result } = renderHook(() =>
        useOnboardingState(mockSteps, conversations),
      );

      expect(result.current.activeStepIdx).toBe(2);
    });

    it("should stay at last step index when all steps are completed", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
        createMockConversation("Info Step", ConversationStatus.Completed),
        createMockConversation("Finish Step", ConversationStatus.Completed),
      ];

      const { result } = renderHook(() =>
        useOnboardingState(mockSteps, conversations),
      );

      expect(result.current.activeStepIdx).toBe(2); // Last step index
    });

    it("should handle missing conversations for steps", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
        // Info Step conversation is missing
      ];

      const { result } = renderHook(() =>
        useOnboardingState(mockSteps, conversations),
      );

      expect(result.current.activeStepIdx).toBe(1); // Should stop at second step since first is complete
    });

    it("should update activeStepIdx when conversations change", () => {
      const initialConversations = [
        createMockConversation("Start Step", ConversationStatus.InProgress),
      ];

      const { result, rerender } = renderHook(
        ({ conversations }) => useOnboardingState(mockSteps, conversations),
        { initialProps: { conversations: initialConversations } },
      );

      expect(result.current.activeStepIdx).toBe(0);

      // Update conversations to mark first step as completed
      const updatedConversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
        createMockConversation("Info Step", ConversationStatus.InProgress),
      ];

      rerender({ conversations: updatedConversations });

      expect(result.current.activeStepIdx).toBe(1);
    });

    it("should update activeStepIdx when steps change", () => {
      const conversations = [
        createMockConversation("Start Step", ConversationStatus.Completed),
      ];

      const { result, rerender } = renderHook(
        ({ steps }) => useOnboardingState(steps, conversations),
        { initialProps: { steps: mockSteps.slice(0, 1) } }, // Only first step
      );

      expect(result.current.activeStepIdx).toBe(0); // At last available step

      // Add more steps
      rerender({ steps: mockSteps });

      expect(result.current.activeStepIdx).toBe(1); // Should move to next step since first is completed
    });
  });

  describe("state management", () => {
    it("should initialize with default values", () => {
      const { result } = renderHook(() => useOnboardingState());

      expect(result.current.activeStepIdx).toBe(0);
      expect(result.current.projectDescription).toBe("");
      expect(result.current.feedbackGiven).toBe(false);
      expect(result.current.integrations).toEqual({
        github: false,
        googleAlerts: false,
        analytics: false,
      });
      expect(result.current.pillars).toBeDefined();
    });

    it("should allow updating state values", () => {
      const { result } = renderHook(() => useOnboardingState());

      act(() => {
        result.current.setActiveStepIdx(2);
        result.current.setProjectDescription("Test project");
        result.current.setFeedbackGiven(true);
      });

      expect(result.current.activeStepIdx).toBe(2);
      expect(result.current.projectDescription).toBe("Test project");
      expect(result.current.feedbackGiven).toBe(true);
    });
  });
});
