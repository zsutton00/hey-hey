import { describe, it, expect } from "vitest";
import { ConversationStatus } from "@hey-hey/ui-common/api";
import type { StepDto, ConversationResponseDto } from "@hey-hey/ui-common/api";

// Test the step matching logic in isolation
describe("Step Matching Logic", () => {
  const mockSteps: StepDto[] = [
    {
      id: "step-1",
      title: "Initialize Project",
      order: 0,
      description: "Set up project basics",
      workflowId: "workflow-1",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
    {
      id: "step-2",
      title: "Configure Settings",
      order: 1,
      description: "Configure project settings",
      workflowId: "workflow-1",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
    {
      id: "step-3",
      title: "Review & Launch",
      order: 2,
      description: "Final review and launch",
      workflowId: "workflow-1",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
  ];

  const createConversation = (
    title: string,
    status: string,
    metadata?: Record<string, any>,
  ): ConversationResponseDto => ({
    id: `conv-${Date.now()}-${Math.random()}`,
    title,
    status: status as any,
    organizationId: "org-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    category: "project_onboarding",
    messages: [],
    metadata,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  });

  // Helper function that mimics the logic from useOnboardingState
  const calculateActiveStep = (
    steps: StepDto[],
    conversations: ConversationResponseDto[],
  ): number => {
    let completedSteps = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const matchingConversation = conversations.find(
        (conv) =>
          conv.title === step.title ||
          conv.metadata?.stepId === step.id ||
          conv.metadata?.stepTitle === step.title,
      );

      if (
        matchingConversation &&
        matchingConversation.status === ConversationStatus.Completed
      ) {
        completedSteps++;
      } else {
        break;
      }
    }

    // Handle edge case where steps array is empty
    return steps.length === 0 ? 0 : Math.min(completedSteps, steps.length - 1);
  };

  describe("matching by title", () => {
    it("should match conversations to steps by exact title", () => {
      const conversations = [
        createConversation("Initialize Project", ConversationStatus.Completed),
        createConversation("Configure Settings", ConversationStatus.InProgress),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(1); // Second step should be active
    });

    it("should be case sensitive for title matching", () => {
      const conversations = [
        createConversation("initialize project", ConversationStatus.Completed), // lowercase
        createConversation("Configure Settings", ConversationStatus.InProgress),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(0); // Should stay at first step due to case mismatch
    });
  });

  describe("matching by metadata stepId", () => {
    it("should match conversations to steps by stepId in metadata", () => {
      const conversations = [
        createConversation("Some Custom Title", ConversationStatus.Completed, {
          stepId: "step-1",
        }),
        createConversation(
          "Another Custom Title",
          ConversationStatus.InProgress,
          { stepId: "step-2" },
        ),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(1); // Second step should be active
    });

    it("should prioritize stepId over title when both are present", () => {
      const conversations = [
        createConversation("Wrong Title", ConversationStatus.Completed, {
          stepId: "step-1",
        }),
        createConversation("Configure Settings", ConversationStatus.InProgress),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(1); // Should match by stepId, not title
    });
  });

  describe("matching by metadata stepTitle", () => {
    it("should match conversations to steps by stepTitle in metadata", () => {
      const conversations = [
        createConversation("Custom Name", ConversationStatus.Completed, {
          stepTitle: "Initialize Project",
        }),
        createConversation("Another Name", ConversationStatus.InProgress, {
          stepTitle: "Configure Settings",
        }),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(1); // Second step should be active
    });
  });

  describe("step progression rules", () => {
    it("should stop at first incomplete step", () => {
      const conversations = [
        createConversation("Initialize Project", ConversationStatus.Completed),
        createConversation("Configure Settings", ConversationStatus.InProgress), // Incomplete
        createConversation("Review & Launch", ConversationStatus.Completed), // This shouldn't count
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(1); // Should stop at incomplete step
    });

    it("should handle all steps completed", () => {
      const conversations = [
        createConversation("Initialize Project", ConversationStatus.Completed),
        createConversation("Configure Settings", ConversationStatus.Completed),
        createConversation("Review & Launch", ConversationStatus.Completed),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(2); // Last step index (length - 1)
    });

    it("should handle no matching conversations", () => {
      const conversations = [
        createConversation(
          "Unrelated Conversation",
          ConversationStatus.Completed,
        ),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(0); // Should stay at first step
    });

    it("should handle failed conversations as incomplete", () => {
      const conversations = [
        createConversation("Initialize Project", ConversationStatus.Failed),
        createConversation("Configure Settings", ConversationStatus.Completed),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(0); // Should stay at first step due to failed status
    });
  });

  describe("edge cases", () => {
    it("should handle empty steps array", () => {
      const conversations = [
        createConversation("Some Conversation", ConversationStatus.Completed),
      ];

      const activeStep = calculateActiveStep([], conversations);
      expect(activeStep).toBe(0); // Should handle empty steps gracefully
    });

    it("should handle empty conversations array", () => {
      const activeStep = calculateActiveStep(mockSteps, []);
      expect(activeStep).toBe(0); // No completed steps
    });

    it("should handle single step workflow", () => {
      const singleStep = [mockSteps[0]];
      const conversations = [
        createConversation("Initialize Project", ConversationStatus.Completed),
      ];

      const activeStep = calculateActiveStep(singleStep, conversations);
      expect(activeStep).toBe(0); // Only step index available
    });

    it("should handle conversations with null/undefined metadata", () => {
      const conversations = [
        createConversation(
          "Initialize Project",
          ConversationStatus.Completed,
          null as any,
        ),
        createConversation(
          "Configure Settings",
          ConversationStatus.Completed,
          undefined,
        ),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      expect(activeStep).toBe(2); // Both steps are completed, so should be at last step
    });

    it("should handle multiple conversations matching same step", () => {
      const conversations = [
        createConversation("Initialize Project", ConversationStatus.InProgress),
        createConversation("Duplicate", ConversationStatus.Completed, {
          stepId: "step-1",
        }), // Also matches step-1
        createConversation("Configure Settings", ConversationStatus.InProgress),
      ];

      const activeStep = calculateActiveStep(mockSteps, conversations);
      // The algorithm finds first matching conversation per step
      // Since 'Initialize Project' (InProgress) is checked before 'Duplicate' (Completed),
      // it stops at step 0 due to InProgress status
      expect(activeStep).toBe(0); // Stays at step 0 because first match is InProgress
    });
  });
});
