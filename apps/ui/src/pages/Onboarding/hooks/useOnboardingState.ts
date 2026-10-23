import { useState, useEffect } from "react";
import type { PillarsState, IntegrationsState } from "../types";
import type { ConversationResponseDto, StepDto } from "@hey-hey/ui-common/api";
import { ConversationStatus } from "@hey-hey/ui-common/api";

export const useOnboardingState = (
  steps?: StepDto[],
  conversations?: ConversationResponseDto[],
) => {
  const [activeStepIdx, setActiveStepIdx] = useState(0);
  const [projectDescription, setProjectDescription] = useState("");
  const [feedbackGiven, setFeedbackGiven] = useState(false);

  const [integrations, setIntegrations] = useState<IntegrationsState>({
    github: false,
    googleAlerts: false,
    analytics: false,
  });

  // Placeholder for AI-generated pillars (would come from API in real app)
  const [pillars, setPillars] = useState<PillarsState>({
    engineering: {
      title: "Engineering Breakdown",
      content: "",
      feedback: "",
    },
    launch: {
      title: "Launch Strategy",
      content: "",
      feedback: "",
    },
    marketing: {
      title: "Marketing Plan",
      content: "",
      feedback: "",
    },
    analytics: {
      title: "Analytics & Tracking",
      content: "",
      feedback: "",
    },
  });

  // Calculate active step based on conversation status
  useEffect(() => {
    if (steps && conversations) {
      // Count completed steps by matching step titles/IDs with conversation status
      let completedSteps = 0;

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        // Find conversation that matches this step
        const matchingConversation = conversations.find(
          (conv) => conv.title === step.title,
        );

        if (
          matchingConversation &&
          matchingConversation.status === ConversationStatus.Completed
        ) {
          completedSteps++;
        } else {
          // Stop at first incomplete step
          break;
        }
      }

      // Current step is the first incomplete step (or last step if all complete)
      // Handle edge case where steps array is empty
      const currentStep =
        steps.length === 0 ? 0 : Math.min(completedSteps, steps.length - 1);
      setActiveStepIdx(currentStep);
    }
  }, [steps, conversations]);

  return {
    activeStepIdx,
    setActiveStepIdx,
    projectDescription,
    setProjectDescription,
    feedbackGiven,
    setFeedbackGiven,
    integrations,
    setIntegrations,
    pillars,
    setPillars,
  };
};
